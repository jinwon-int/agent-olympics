'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { loadQset, fileSha256 } = require('../scripts/fleet-eval.js');
const overlay = require('../scripts/fleet-eval-overlay.js');
const { ciCheck } = require('../scripts/fleet-eval-ci.js');

const items = loadQset();
const LOCK = {
  schemaVersion: 'fleet-eval-lock-v1',
  agentOlympics: 'ea85c4b96fa33f923a3e169e0e7c1652170f5f43',
  repo: 'jinwon-int/caller',
  lane: 'claude-code-overlay',
  catalog: { dirs: ['skills'] },
  runsDir: 'eval/fleet-eval/runs',
};

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-eval-catalog-'));
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

function write(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(dir, rel);
    if (body === null) fs.rmSync(file, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
    }
  }
}

function commit(dir, files, msg = 'c') {
  write(dir, files);
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-q', '--allow-empty', '-m', msg]);
  return sh(dir, ['rev-parse', 'HEAD']);
}

function skill(name, description) {
  const front = description === null ? '' : `description: ${description}\n`;
  return `---\nname: ${name}\n${front}---\n\n# ${name}\n\nbody text that is never listed\n`;
}

const SKILLS = {
  'skills/beta/SKILL.md': skill('beta', 'Use when B happens.'),
  'skills/alpha/SKILL.md': skill('alpha', 'Use when A happens.'),
  'skills/gamma/SKILL.md': skill('gamma', null),
  'skills/README.md': 'not a skill\n',
  'skills/no-skill-file/notes.md': 'a directory without SKILL.md\n',
};

/** A caller repo on `main` with a catalog lock and three skills, then a `pr` branch. */
function callerRepo(lock = LOCK, extra = {}) {
  const dir = tmpDir();
  sh(dir, ['init', '-q', '-b', 'main']);
  const base = commit(dir, {
    'eval/fleet-eval.lock.json': JSON.stringify(lock, null, 2) + '\n',
    ...SKILLS,
    ...extra,
  });
  sh(dir, ['checkout', '-q', '-b', 'pr']);
  return { dir, base };
}

function render(dir, ref = 'HEAD') {
  return overlay.renderOverlay(dir, ref, overlay.readLock(dir, ref));
}

const text = (r) => r.text.toString('utf8');

// --- front matter -----------------------------------------------------------

test('skillDescription reads the front matter description as one line', () => {
  const d = overlay.skillDescription;
  assert.equal(d(skill('a', 'Use when A happens.')), 'Use when A happens.');
  assert.equal(
    d('---\nname: a\ndescription: "quoted: with a colon"\n---\n'),
    'quoted: with a colon'
  );
  assert.equal(
    d('---\nname: a\ndescription: >-\n  folded over\n  two lines\n---\nbody\n'),
    'folded over two lines'
  );
  assert.equal(d('---\r\nname: a\r\ndescription: crlf   spaced\r\n---\r\n'), 'crlf spaced');
  assert.equal(d('\uFEFF---\ndescription: with bom\n---\n'), 'with bom');
  assert.equal(d(Buffer.from('---\ndescription: 한글 설명\n---\n', 'utf8')), '한글 설명');
});

test('skillDescription is empty without a usable description', () => {
  const d = overlay.skillDescription;
  assert.equal(d('# no front matter\n\ndescription: in the body\n'), '');
  assert.equal(d(skill('a', null)), '');
  assert.equal(d('---\ndescription:\n  - a list\n---\n'), '');
  assert.equal(d('---\nname: a\n'), '', 'unterminated front matter');
});

test('skillDescription keeps the line when the front matter is not valid YAML', () => {
  const raw = '---\nname: a\ndescription: Use when: the text has a bare colon\ntags: [x\n---\n';
  assert.equal(overlay.skillDescription(raw), 'Use when: the text has a bare colon');
});

test('skillDescription cuts a long description at 1024 code points', () => {
  const long = '가'.repeat(1500);
  const out = overlay.skillDescription(`---\ndescription: ${long}\n---\n`);
  assert.equal(Array.from(out).length, 1025);
  assert.ok(out.endsWith('…'));
  const exact = 'x'.repeat(1024);
  assert.equal(overlay.skillDescription(`---\ndescription: ${exact}\n---\n`), exact);
});

// --- name lists ---------------------------------------------------------------

test('parseNameList ignores comments and blanks, refuses bad names and duplicates', () => {
  const p = (s) => overlay.parseNameList(Buffer.from(s), 'list');
  assert.deepEqual(p('# head\nalpha\n\n  beta  # trailing\r\n'), ['alpha', 'beta']);
  assert.deepEqual(p(''), []);
  assert.throws(() => p('alpha\n../x\n'), overlay.OverlayError);
  assert.throws(() => p('two words\n'), overlay.OverlayError);
  assert.throws(() => p('alpha\nalpha\n'), /listed twice/);
});

// --- renderCatalog --------------------------------------------------------------

const ENTRIES = [
  { name: 'beta', dir: 'd', description: 'B.' },
  { name: 'alpha', dir: 'd', description: 'A.' },
  { name: 'gamma', dir: 'd', description: '' },
];

test('renderCatalog lists skills sorted by name, name-only when asked or undescribed', () => {
  const all = overlay.renderCatalog(ENTRIES);
  assert.equal(
    all.text.toString('utf8'),
    '<!-- fleet-eval catalog v1 -->\nThe following skills are available:\n\n- alpha: A.\n- beta: B.\n- gamma\n'
  );
  assert.deepEqual([all.skills, all.described], [3, 2]);

  const bare = overlay.renderCatalog(ENTRIES, { nameOnly: ['beta'] });
  assert.match(bare.text.toString('utf8'), /\n- alpha: A\.\n- beta\n- gamma\n$/);
  assert.deepEqual([bare.skills, bare.described], [3, 1]);

  const some = overlay.renderCatalog(ENTRIES, { include: ['gamma', 'alpha'] });
  assert.match(some.text.toString('utf8'), /\n\n- alpha: A\.\n- gamma\n$/);
  assert.deepEqual([some.skills, some.described], [2, 1]);

  const reordered = overlay.renderCatalog([...ENTRIES].reverse());
  assert.ok(reordered.text.equals(all.text), 'input order does not change the text');
});

test('renderCatalog refuses unknown names, duplicates and an empty catalog', () => {
  const r = (opts) => () => overlay.renderCatalog(ENTRIES, opts);
  assert.throws(r({ include: ['alpha', 'nope'] }), /include names nope/);
  assert.throws(r({ nameOnly: ['nope'] }), /nameOnly names nope/);
  assert.throws(r({ include: ['alpha'], nameOnly: ['beta'] }), /nameOnly names beta/);
  assert.throws(r({ include: [] }), /no skills/);
  assert.throws(() => overlay.renderCatalog([]), /no skills/);
  assert.throws(
    () => overlay.renderCatalog([...ENTRIES, { name: 'alpha', dir: 'e', description: 'other' }]),
    /alpha is in both d and e/
  );
});

// --- lock + git ref -------------------------------------------------------------

test('lock accepts a catalog, alone or with files, and refuses a malformed one', () => {
  const bad = (patch) => overlay.lockProblems({ ...LOCK, ...patch });
  assert.deepEqual(overlay.lockProblems(LOCK), [], 'catalog-only lock');
  assert.deepEqual(bad({ overlay: [] }), [], 'empty file list with a catalog');
  assert.deepEqual(bad({ overlay: ['style.md'] }), [], 'files and a catalog');
  assert.deepEqual(
    bad({ catalog: { dirs: ['a', 'b/c'], include: 'eval/in.txt', nameOnly: 'eval/bare.txt' } }),
    []
  );
  assert.ok(
    bad({ catalog: undefined }).some((p) => /overlay must be/.test(p)),
    'neither'
  );
  assert.ok(bad({ catalog: undefined, overlay: [] }).length > 0, 'empty files, no catalog');
  for (const catalog of [
    null,
    [],
    'skills',
    {},
    { dirs: [] },
    { dirs: 'skills' },
    { dirs: ['../x'] },
    { dirs: ['/abs'] },
    { dirs: ['a', 'a'] },
    { dirs: ['a'], include: '../in.txt' },
    { dirs: ['a'], nameOnly: 7 },
    { dirs: ['a'], extra: true },
    { dirs: Array.from({ length: 17 }, (_, i) => `d${i}`) },
  ]) {
    assert.ok(bad({ catalog }).length > 0, `${JSON.stringify(catalog)} is refused`);
  }
});

test('catalog overlay is read from the ref, not the working tree, with a stable sha', () => {
  const { dir } = callerRepo();
  const first = render(dir);
  assert.equal(
    text(first),
    '<!-- fleet-eval catalog v1 -->\nThe following skills are available:\n\n' +
      '- alpha: Use when A happens.\n- beta: Use when B happens.\n- gamma\n'
  );
  assert.deepEqual(first.catalog, { skills: 3, described: 2 });
  assert.deepEqual(first.files, []);

  write(dir, {
    'skills/alpha/SKILL.md': skill('alpha', 'edited, not committed'),
    'skills/delta/SKILL.md': skill('delta', 'new, not committed'),
  });
  assert.equal(render(dir).sha256, first.sha256, 'uncommitted edits do not change the overlay');

  const out = path.join(tmpDir(), 'overlay.md');
  const q = quiet();
  assert.equal(overlay.main(['render', '--repo-dir', dir, '--out', out], q.log), 0);
  assert.equal(fileSha256(out), first.sha256);
  assert.match(q.lines.join('\n'), /0 files, catalog 3 skills \/ 2 described/);
});

test('catalog overlay hash follows descriptions, the skill set and the list files', () => {
  const { dir } = callerRepo();
  const base = render(dir).sha256;

  commit(dir, { 'skills/alpha/SKILL.md': skill('alpha', 'Use when A happens, v2.') });
  const edited = render(dir);
  assert.notEqual(edited.sha256, base, 'a description change');

  commit(dir, { 'skills/delta/SKILL.md': skill('delta', 'Use when D happens.') });
  const added = render(dir);
  assert.notEqual(added.sha256, edited.sha256, 'a new skill');
  assert.deepEqual(added.catalog, { skills: 4, described: 3 });

  commit(dir, {
    'skills/alpha/SKILL.md': skill('alpha', 'Use when A happens, v2.') + '\nmore body\n',
  });
  assert.equal(render(dir).sha256, added.sha256, 'the skill body is not part of the catalog');

  const lock = { ...LOCK, catalog: { dirs: ['skills'], nameOnly: 'eval/bare.txt' } };
  commit(dir, {
    'eval/fleet-eval.lock.json': JSON.stringify(lock),
    'eval/bare.txt': '# listed without a description\nbeta\n',
  });
  const bare = render(dir);
  assert.match(text(bare), /\n- beta\n/);
  assert.deepEqual(bare.catalog, { skills: 4, described: 2 });

  const picked = { ...LOCK, catalog: { dirs: ['skills'], include: 'eval/in.txt' } };
  commit(dir, {
    'eval/fleet-eval.lock.json': JSON.stringify(picked),
    'eval/in.txt': 'alpha\ndelta\n',
  });
  assert.deepEqual(render(dir).catalog, { skills: 2, described: 2 });
});

test('catalog overlay comes after the lock files and spans several dirs', () => {
  const lock = { ...LOCK, overlay: ['style.md'], catalog: { dirs: ['skills', 'approved/shared'] } };
  const { dir } = callerRepo(lock, {
    'style.md': '# style v1\n',
    'approved/shared/zeta/SKILL.md': skill('zeta', 'Use when Z happens.'),
  });
  const r = render(dir);
  assert.match(
    text(r),
    /^<!-- fleet-eval overlay v1: style\.md -->\n# style v1\n\n<!-- fleet-eval catalog v1 -->\n/
  );
  assert.match(text(r), /- gamma\n- zeta: Use when Z happens\.\n$/);
  assert.deepEqual(r.files, ['style.md']);
  assert.deepEqual(r.catalog, { skills: 4, described: 3 });

  commit(dir, { 'approved/shared/alpha/SKILL.md': skill('alpha', 'a second alpha') });
  assert.throws(() => render(dir), /alpha is in both skills and approved\/shared/);
});

test('catalog overlay fails closed on a missing dir, list file or listed name', () => {
  const fails = (catalog, extra, pattern) => {
    const { dir } = callerRepo({ ...LOCK, catalog }, extra);
    assert.throws(() => render(dir), pattern);
  };
  fails({ dirs: ['nope'] }, {}, /catalog dir nope does not exist/);
  fails({ dirs: ['skills/alpha/SKILL.md'] }, {}, /does not exist/);
  fails(
    { dirs: ['skills'], include: 'eval/in.txt' },
    {},
    /catalog\.include eval\/in\.txt does not exist/
  );
  fails(
    { dirs: ['skills'], include: 'eval/in.txt' },
    { 'eval/in.txt': 'alpha\nretired-skill\n' },
    /not in the catalog/
  );
  fails(
    { dirs: ['skills'], nameOnly: 'eval/bare.txt' },
    { 'eval/bare.txt': 'bad name\n' },
    /not a skill name/
  );
  fails(
    { dirs: ['skills'], include: 'eval/in.txt' },
    { 'eval/in.txt': '# nothing\n' },
    /no skills/
  );
  const { dir } = callerRepo();
  assert.throws(
    () => overlay.catalogEntriesAtRef(dir, '--upload-pack=x', ['skills']),
    /plain git ref/
  );
});

// --- caller CI check ------------------------------------------------------------

test('caller CI sees a catalog change as an overlay change', () => {
  const { dir, base } = callerRepo();
  const head = () => sh(dir, ['rev-parse', 'HEAD']);
  const check = () => ciCheck({ repoDir: dir, base, head: head(), items });

  commit(dir, { 'README.md': 'unrelated\n' });
  const same = check();
  assert.equal(same.status, 'not_applicable');
  assert.equal(same.overlay.changed, false);

  commit(dir, { 'skills/alpha/SKILL.md': skill('alpha', 'Use when A happens.') + '\nbody only\n' });
  assert.equal(check().status, 'not_applicable', 'a body-only edit is not a catalog change');

  commit(dir, { 'skills/beta/SKILL.md': skill('beta', 'Use when B or C happens.') });
  const changed = check();
  assert.equal(changed.status, 'candidate_needed');
  assert.equal(changed.overlay.changed, true);

  commit(dir, {
    'skills/beta/SKILL.md': skill('beta', 'Use when B happens.'),
    'skills/gamma': null,
  });
  assert.equal(check().status, 'candidate_needed', 'a removed skill');
});

// --- catalog command (plain directories) ----------------------------------------

test('catalog command renders installed skill dirs, with include and name-only lists', () => {
  const root = tmpDir();
  write(root, {
    'a/alpha/SKILL.md': skill('alpha', 'Use when A happens.'),
    'a/beta/SKILL.md': skill('beta', 'Use when B happens.'),
    'a/.hidden/SKILL.md': skill('hidden', 'never listed'),
    'a/README.md': 'not a skill\n',
    'b/gamma/SKILL.md': skill('gamma', 'Use when G happens.'),
    'lists/bare.txt': 'beta\n',
    'lists/in.txt': 'alpha\nbeta\n',
    'real/delta/SKILL.md': skill('delta', 'Use when D happens.'),
  });
  fs.symlinkSync(path.join(root, 'real', 'delta'), path.join(root, 'b', 'delta'));
  const a = path.join(root, 'a');
  const b = path.join(root, 'b');
  const run = (args) => {
    const q = quiet();
    return { code: overlay.main(['catalog', ...args], q.log), lines: q.lines };
  };

  const out = path.join(root, 'catalog.md');
  const full = run(['--skills-dir', a, '--skills-dir', b, '--out', out]);
  assert.equal(full.code, 0);
  assert.match(full.lines[0], /^catalog 4 skills \(4 described\) -> /);
  assert.equal(
    fs.readFileSync(out, 'utf8'),
    '<!-- fleet-eval catalog v1 -->\nThe following skills are available:\n\n' +
      '- alpha: Use when A happens.\n- beta: Use when B happens.\n' +
      '- delta: Use when D happens.\n- gamma: Use when G happens.\n'
  );
  assert.equal(fs.statSync(out).mode & 0o777, 0o600);
  assert.equal(full.lines[1], `sha256 ${fileSha256(out)}`);
  assert.deepEqual(
    run(['--skills-dir', b, '--skills-dir', a]).lines,
    [fileSha256(out)],
    'dir order'
  );
  assert.equal(run(['--skills-dir', a, '--out', out]).code, 2, 'no overwrite');

  const picked = path.join(root, 'picked.md');
  const args = ['--skills-dir', a, '--skills-dir', b];
  const lists = [
    '--include',
    path.join(root, 'lists', 'in.txt'),
    '--name-only',
    path.join(root, 'lists', 'bare.txt'),
  ];
  assert.equal(run([...args, ...lists, '--out', picked]).code, 0);
  assert.match(fs.readFileSync(picked, 'utf8'), /\n\n- alpha: Use when A happens\.\n- beta\n$/);

  assert.equal(run([]).code, 2, 'needs --skills-dir');
  assert.equal(run(['--skills-dir', path.join(root, 'missing')]).code, 2);
  assert.equal(run([...args, '--include', path.join(root, 'missing.txt')]).code, 2);
  assert.equal(run([...args, '--ref', 'HEAD']).code, 2, 'unknown option for catalog');
  assert.equal(run(['--skills-dir', a, '--skills-dir', a]).code, 2, 'the same dir twice');
});
