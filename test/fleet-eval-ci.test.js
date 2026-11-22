'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  loadQset,
  runEval,
  stubAdapter,
  commandAdapter,
  gate,
  main: evalMain,
  fileSha256,
  UsageError,
} = require('../scripts/fleet-eval.js');
const overlay = require('../scripts/fleet-eval-overlay.js');
const { ciCheck, main: ciMain } = require('../scripts/fleet-eval-ci.js');

const ROOT = path.resolve(__dirname, '..');
const STUB_PASS = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'fixtures', 'fleet-eval', 'stub', 'seed-pass.json'), 'utf8')
);
const items = loadQset();
const NODE = process.execPath;
const REPO = 'jinwon-int/caller';
const LANE = 'claude-code-overlay';
const RUNS = 'eval/fleet-eval/runs';
const AO_SHA = 'ea85c4b96fa33f923a3e169e0e7c1652170f5f43';
const LOCK = {
  schemaVersion: 'fleet-eval-lock-v1',
  agentOlympics: AO_SHA,
  repo: REPO,
  lane: LANE,
  overlay: ['style.md', 'claude.md'],
  runsDir: RUNS,
};

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-eval-ci-'));
}

function quiet() {
  const lines = [];
  return { log: (line) => lines.push(line), lines };
}

function sh(dir, args) {
  return execFileSync(
    'git',
    ['-C', dir, '-c', 'user.email=t@example.invalid', '-c', 'user.name=t', ...args],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  ).trim();
}

/** Write files (path -> string | null to delete) and commit; returns the sha. */
function commit(dir, files, msg = 'c') {
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(dir, rel);
    if (body === null) fs.rmSync(file);
    else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
    }
  }
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-q', '--allow-empty', '-m', msg]);
  return sh(dir, ['rev-parse', 'HEAD']);
}

/** A caller repo on `main`: lock + overlay files (+ extra), then a `pr` branch. */
function callerRepo({ withLock = true, extra = {} } = {}) {
  const dir = tmpDir();
  sh(dir, ['init', '-q', '-b', 'main']);
  const files = { 'README.md': 'caller\n', ...extra };
  if (withLock) {
    Object.assign(files, {
      'eval/fleet-eval.lock.json': JSON.stringify(LOCK, null, 2) + '\n',
      'style.md': '# style v1\n',
      'claude.md': '# claude v1\n',
    });
  }
  const base = commit(dir, files, 'main');
  sh(dir, ['checkout', '-q', '-b', 'pr']);
  return { dir, base };
}

function overlaySha(dir, ref) {
  return overlay.renderOverlay(dir, ref, overlay.readLock(dir, ref)).sha256;
}

/** Body-free run records for the whole Q-set, stamped with a subject. */
async function records(sha, { suffix, at, outputs = STUB_PASS, lane = LANE, repo = REPO }) {
  const { runId, records: recs } = await runEval({
    items,
    adapter: stubAdapter(outputs),
    target: { lane, model: 'stub-fixed', adapter: 'stub' },
    qsetCommit: 'ea85c4b',
    runSuffix: suffix,
    subject: { repo, overlaySha256: sha },
    now: () => new Date(at),
  });
  return { runId, body: recs.map((r) => JSON.stringify(r)).join('\n') + '\n' };
}

async function runFile(sha, opts) {
  const { runId, body } = await records(sha, opts);
  return { [`${RUNS}/${runId}.jsonl`]: body };
}

function check(dir, base, head = 'HEAD') {
  return ciCheck({ repoDir: dir, base, head: sh(dir, ['rev-parse', head]), items });
}

const ONE_FAILS = { ...STUB_PASS, 'phone-intent-003': { error: 'adapter_error' } };

// --- overlay renderer -------------------------------------------------------

test('overlay renders lock files from the ref, not the working tree, with a stable sha', () => {
  const { dir } = callerRepo();
  const sha = overlaySha(dir, 'HEAD');
  assert.match(sha, /^[0-9a-f]{64}$/);
  fs.writeFileSync(path.join(dir, 'style.md'), '# dirty worktree\n');
  assert.equal(overlaySha(dir, 'HEAD'), sha, 'uncommitted edits do not change the overlay');

  const out = path.join(tmpDir(), 'overlay.md');
  const q = quiet();
  assert.equal(overlay.main(['render', '--repo-dir', dir, '--out', out], q.log), 0);
  assert.equal(fileSha256(out), sha, 'the rendered file hashes to the overlay sha');
  const text = fs.readFileSync(out, 'utf8');
  assert.match(text, /^<!-- fleet-eval overlay v1: style\.md -->\n# style v1\n/);
  assert.match(text, /<!-- fleet-eval overlay v1: claude\.md -->\n# claude v1\n/);
  assert.equal(overlay.main(['render', '--repo-dir', dir, '--out', out], q.log), 2, 'no overwrite');
  const s = quiet();
  assert.equal(overlay.main(['sha', '--repo-dir', dir], s.log), 0);
  assert.deepEqual(s.lines, [sha]);
});

test('overlay lock rejects unsafe paths, unknown keys and bad refs', () => {
  const bad = (patch) => overlay.lockProblems({ ...LOCK, ...patch });
  assert.deepEqual(bad({}), []);
  for (const p of ['../x', '/etc/passwd', 'a/../b', 'a\\b', 'a//b', '.']) {
    assert.ok(bad({ overlay: [p] }).length > 0, `${p} is refused`);
  }
  assert.ok(bad({ overlay: ['a', 'a'] }).some((p) => /twice/.test(p)));
  assert.ok(bad({ runsDir: '../runs' }).length > 0);
  assert.ok(bad({ extra: 1 }).some((p) => /unknown key/.test(p)));
  assert.ok(bad({ agentOlympics: 'ea85c4b' }).length > 0, 'the pin is a full sha');
  assert.equal(overlay.safeRef('--output=/tmp/x'), false);
  assert.equal(overlay.safeRef('HEAD~1'), true);

  const { dir } = callerRepo({ withLock: false });
  commit(dir, { 'eval/fleet-eval.lock.json': JSON.stringify({ ...LOCK, overlay: ['../x'] }) });
  assert.throws(() => overlay.readLock(dir, 'HEAD'), overlay.OverlayError);
  commit(dir, { 'eval/fleet-eval.lock.json': JSON.stringify({ ...LOCK, overlay: ['nope.md'] }) });
  assert.throws(
    () => overlay.renderOverlay(dir, 'HEAD', overlay.readLock(dir, 'HEAD')),
    /does not exist/
  );
});

// --- caller CI check ------------------------------------------------------------

test('not_applicable when the overlay is unchanged and no run is added', () => {
  const { dir, base } = callerRepo();
  commit(dir, { 'README.md': 'unrelated change\n' });
  const r = check(dir, base);
  assert.equal(r.status, 'not_applicable');
  assert.equal(r.exitCode, 0);
  assert.equal(r.overlay.changed, false);
});

test('candidate_needed when the overlay changes without a run, with a run hint', () => {
  const { dir, base } = callerRepo();
  commit(dir, { 'style.md': '# style v2\n' });
  const r = check(dir, base);
  assert.equal(r.status, 'candidate_needed');
  assert.equal(r.exitCode, 1);
  assert.ok(r.hint.some((l) => l.includes(`--subject-repo ${REPO}`)));
  assert.ok(r.hint.every((l) => !/--adapter stub/.test(l)));
});

test('pass and fail against the newest base run for the base overlay', async () => {
  const { dir, base: first } = callerRepo();
  sh(dir, ['checkout', '-q', 'main']);
  const mainSha = overlaySha(dir, 'HEAD');
  const older = await runFile(mainSha, {
    suffix: 'old',
    at: '2026-11-20T01:00:00Z',
    outputs: ONE_FAILS,
  });
  const newer = await runFile(mainSha, { suffix: 'new', at: '2026-11-21T01:00:00Z' });
  commit(dir, older);
  const base = commit(dir, newer);
  assert.notEqual(base, first);
  sh(dir, ['checkout', '-q', '-B', 'pr']);

  commit(dir, { 'style.md': '# style v2\n' });
  const headSha = overlaySha(dir, 'HEAD');
  commit(dir, await runFile(headSha, { suffix: 'pr', at: '2026-11-22T01:00:00Z' }));
  const ok = check(dir, base);
  assert.equal(ok.status, 'pass');
  assert.equal(ok.exitCode, 0);
  assert.equal(ok.baseline.source, 'base');
  assert.match(ok.baseline.runId, /-new$/, 'the newest base run is the baseline');
  assert.equal(ok.gate.pass, true);

  sh(dir, ['reset', '-q', '--hard', 'HEAD~1']);
  commit(
    dir,
    await runFile(headSha, { suffix: 'prbad', at: '2026-11-22T02:00:00Z', outputs: ONE_FAILS })
  );
  const bad = check(dir, base);
  assert.equal(bad.status, 'fail');
  assert.equal(bad.exitCode, 1);
  assert.ok(bad.gate.reasons.includes('family phone-intent pass rate dropped'));
});

test('stale_run when the PR changes the overlay after its run was recorded', async () => {
  const { dir, base } = callerRepo();
  commit(dir, { 'style.md': '# style v2\n' });
  commit(dir, await runFile(overlaySha(dir, 'HEAD'), { suffix: 'pr', at: '2026-11-22T01:00:00Z' }));
  commit(dir, { 'claude.md': '# claude v2\n' });
  const r = check(dir, base);
  assert.equal(r.status, 'stale_run');
  assert.equal(r.exitCode, 1);
  assert.equal(r.addedRuns[0].matchesHead, false);
});

test('baseline_needed without a base run; two PR runs introduce the gate (A/A)', async () => {
  const { dir, base } = callerRepo();
  commit(dir, { 'style.md': '# style v2\n' });
  const headSha = overlaySha(dir, 'HEAD');
  commit(dir, await runFile(headSha, { suffix: 'a', at: '2026-11-22T01:00:00Z' }));
  assert.equal(check(dir, base).status, 'baseline_needed');

  const intro = callerRepo({ withLock: false });
  commit(intro.dir, {
    'eval/fleet-eval.lock.json': JSON.stringify(LOCK),
    'style.md': '# style v1\n',
    'claude.md': '# claude v1\n',
  });
  const sha = overlaySha(intro.dir, 'HEAD');
  commit(intro.dir, await runFile(sha, { suffix: 'base', at: '2026-11-22T01:00:00Z' }));
  commit(intro.dir, await runFile(sha, { suffix: 'aa', at: '2026-11-22T02:00:00Z' }));
  const r = check(intro.dir, intro.base);
  assert.equal(r.status, 'pass');
  assert.equal(r.overlay.base, null);
  assert.deepEqual(
    [r.baseline.source, r.baseline.runId.endsWith('-base'), r.candidate.runId.endsWith('-aa')],
    ['pr', true, true]
  );
});

test('run files are append-only and must belong to the lock lane and repo', async () => {
  const { dir } = callerRepo();
  sh(dir, ['checkout', '-q', 'main']);
  const sha = overlaySha(dir, 'HEAD');
  const file = await runFile(sha, { suffix: 'base', at: '2026-11-21T01:00:00Z' });
  const base = commit(dir, file);
  sh(dir, ['checkout', '-q', '-B', 'pr']);

  const [rel] = Object.keys(file);
  commit(dir, { [rel]: null });
  assert.throws(() => check(dir, base), /append-only/);

  sh(dir, ['reset', '-q', '--hard', base]);
  commit(
    dir,
    await runFile(sha, { suffix: 'other', at: '2026-11-22T01:00:00Z', lane: 'claude-code' })
  );
  assert.throws(() => check(dir, base), /does not match the lock/);

  sh(dir, ['reset', '-q', '--hard', base]);
  const { body } = await records(sha, { suffix: 'named', at: '2026-11-22T01:00:00Z' });
  commit(dir, { [`${RUNS}/renamed.jsonl`]: body });
  assert.throws(() => check(dir, base), /file name must be/);

  sh(dir, ['reset', '-q', '--hard', base]);
  const forged = body.replace('"verdict":"pass"', '"verdict":"fail"');
  const { runId } = await records(sha, { suffix: 'named', at: '2026-11-22T01:00:00Z' });
  commit(dir, { [`${RUNS}/${runId}.jsonl`]: forged });
  assert.throws(() => check(dir, base), /inconsistent with check outcomes/);
});

test('CLI: text and json output, exit codes, usage errors', async () => {
  const { dir, base } = callerRepo();
  commit(dir, { 'style.md': '# style v2\n' });
  const head = sh(dir, ['rev-parse', 'HEAD']);
  const q = quiet();
  assert.equal(ciMain(['--repo-dir', dir, '--base', base, '--head', head], q.log), 1);
  assert.equal(q.lines[0], `fleet-eval CANDIDATE_NEEDED repo=${REPO} lane=${LANE}`);
  const j = quiet();
  assert.equal(ciMain(['--repo-dir', dir, '--base', base, '--head', head, '--json'], j.log), 1);
  assert.equal(JSON.parse(j.lines[0]).status, 'candidate_needed');

  const u = quiet();
  assert.equal(ciMain(['--repo-dir', dir, '--base', base], u.log), 2);
  assert.equal(ciMain(['--repo-dir', dir, '--base', '-x', '--head', head], u.log), 2);
  assert.equal(
    ciMain(['--repo-dir', dir, '--base', base, '--head', head, '--nope', '1'], u.log),
    2
  );
  const nolock = callerRepo({ withLock: false });
  assert.equal(
    ciMain(['--repo-dir', nolock.dir, '--base', nolock.base, '--head', nolock.base], u.log),
    2
  );
  assert.ok(u.lines.every((l) => l.startsWith('ERR   ')));
});

// --- runner subject support ----------------------------------------------------

test('run --subject-repo/--overlay stamps every record and passes the overlay path', async () => {
  const work = tmpDir();
  const file = path.join(work, 'overlay.md');
  fs.writeFileSync(file, '# overlay\n');
  const out = path.join(work, 'runs');
  const stubFile = path.join(work, 'stub.json');
  fs.writeFileSync(stubFile, JSON.stringify(STUB_PASS));
  const base = [
    'run',
    '--target-lane',
    LANE,
    '--target-model',
    'stub-fixed',
    '--adapter',
    'stub',
    '--stub-outputs',
    stubFile,
    '--qset-commit',
    'ea85c4b',
    '--out',
    out,
  ];
  const q = quiet();
  assert.equal(await evalMain([...base, '--subject-repo', REPO], q.log), 2);
  assert.match(q.lines.at(-1), /go together/);
  assert.equal(await evalMain([...base, '--subject-repo', 'nope', '--overlay', file], q.log), 2);
  assert.equal(await evalMain([...base, '--subject-repo', REPO, '--overlay', file], q.log), 0);
  const [name] = fs.readdirSync(out);
  const recs = fs.readFileSync(path.join(out, name), 'utf8').trim().split('\n').map(JSON.parse);
  const sha = fileSha256(file);
  assert.ok(recs.every((r) => r.subject.repo === REPO && r.subject.overlaySha256 === sha));
  assert.ok(q.lines.some((l) => l === `subject ${REPO} overlay sha256 ${sha}`));

  const echo = commandAdapter(
    NODE,
    ['-e', 'process.stdout.write(process.env.FLEET_EVAL_OVERLAY||"none")'],
    {
      FLEET_EVAL_OVERLAY: file,
    }
  );
  assert.deepEqual(await echo.call(null, 'p', 1, 5000), { output: file });
});

test('gate refuses to compare runs of different subject repositories or installed runs', async () => {
  const sha = 'a'.repeat(64);
  const a = await records(sha, { suffix: 'a', at: '2026-11-22T01:00:00Z' });
  const b = await records(sha, {
    suffix: 'b',
    at: '2026-11-22T01:00:00Z',
    repo: 'jinwon-int/other',
  });
  const parse = (x) => x.body.trim().split('\n').map(JSON.parse);
  assert.equal(gate(parse(a), parse(a), items).pass, true);
  assert.throws(() => gate(parse(a), parse(b), items), /subjects differ/);
  const installed = parse(a).map(({ subject: _s, ...r }) => r);
  assert.throws(() => gate(installed, parse(a), items), UsageError);
  const mixed = [...parse(a).slice(0, 3), ...installed.slice(3)];
  assert.throws(() => gate(mixed, parse(a), items), /mixes subjects/);
});
