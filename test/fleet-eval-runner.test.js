'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildPrompt,
  stripFence,
  judgeRule,
  stubAdapter,
  commandAdapter,
  loadQset,
  runEval,
  itemOutcomes,
  requiredPasses,
  gate,
  main,
  MIN_GATED_ITEMS,
} = require('../scripts/fleet-eval.js');
const { validate } = require('../scripts/validate-fleet-eval.js');

const ROOT = path.resolve(__dirname, '..');
const STUB_PASS = path.join(ROOT, 'fixtures', 'fleet-eval', 'stub', 'seed-pass.json');
const TARGET = { lane: 'stub', model: 'stub-fixed', adapter: 'stub' };
const items = loadQset();
const ACTIVE_RULE = [...items.values()].filter(
  (i) => i.status === 'active' && i.judge === 'rule'
).length;

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-eval-'));
}

function item(id) {
  return items.get(id);
}

function quiet() {
  const lines = [];
  return { log: (line) => lines.push(line), lines };
}

/** A temp Q-set with `n` phone-intent items (gated when n >= 8) plus one skill-select item. */
function gatedQset(n = 8, versions = {}) {
  const dir = tmpDir();
  const seed = item('phone-intent-001');
  const lines = [];
  for (let i = 1; i <= n; i += 1) {
    const id = `phone-intent-${String(i).padStart(3, '0')}`;
    lines.push(JSON.stringify({ ...seed, id, version: versions[id] || 1 }));
  }
  fs.mkdirSync(path.join(dir, 'phone-intent'));
  fs.writeFileSync(path.join(dir, 'phone-intent', 'phone-intent.jsonl'), lines.join('\n') + '\n');
  fs.mkdirSync(path.join(dir, 'skill-select'));
  fs.writeFileSync(
    path.join(dir, 'skill-select', 'skill-select.jsonl'),
    JSON.stringify(item('skill-select-001')) + '\n'
  );
  return { dir, qset: loadQset(dir) };
}

const DENY = '{"decision": "deny", "words": ["보내"]}';
const ALLOW = '{"decision": "allow", "words": []}';

async function runWith(qset, outputs, extra = {}) {
  const { records } = await runEval({
    items: qset,
    adapter: stubAdapter(outputs),
    target: TARGET,
    qsetCommit: 'abcdef1',
    ...extra,
  });
  return records;
}

// --- rule judge -----------------------------------------------------------

test('stripFence removes exactly one surrounding code fence', () => {
  assert.equal(stripFence('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(stripFence('  ```\n{"a":1}\n```  '), '{"a":1}');
  assert.equal(stripFence('{"a":1}'), '{"a":1}');
  assert.equal(stripFence('text ```json\n{}\n```'), 'text ```json\n{}\n```');
});

test('judgeRule passes a correct json answer and scores each check', () => {
  const ok = judgeRule(
    item('a2a-verdict-001'),
    '{"verdict":"reject","findings":["admin_bypass","missing_tests"]}'
  );
  assert.equal(ok.verdict, 'pass');
  assert.equal(ok.score, 1);
  assert.deepEqual(
    ok.checks.map((c) => c.op),
    ['json_equals', 'json_includes_all', 'json_excludes_all']
  );

  const invented = judgeRule(
    item('a2a-verdict-001'),
    '{"verdict":"reject","findings":["admin_bypass","missing_tests","secret_exposure"]}'
  );
  assert.equal(invented.verdict, 'fail');
  assert.deepEqual(
    invented.checks.map((c) => c.ok),
    [true, true, false]
  );
  assert.equal(invented.score, 0.6667);
});

test('judgeRule json ops: strict equality, json_in, missing paths, non-arrays', () => {
  const base = item('phone-intent-001');
  const withChecks = (checks) => ({ ...base, expected: { checks } });
  const j = (checks, out) => judgeRule(withChecks(checks), out).checks.map((c) => c.ok);
  assert.deepEqual(j([{ op: 'json_equals', path: 'n', value: 1 }], '{"n":"1"}'), [false]);
  assert.deepEqual(j([{ op: 'json_in', path: 'd', values: ['allow', 'deny'] }], '{"d":"deny"}'), [
    true,
  ]);
  assert.deepEqual(j([{ op: 'json_in', path: 'd', values: ['allow'] }], '{}'), [false]);
  assert.deepEqual(j([{ op: 'json_excludes_all', path: 'w', values: ['x'] }], '{}'), [true]);
  assert.deepEqual(j([{ op: 'json_excludes_all', path: 'w', values: ['x'] }], '{"w":"x"}'), [
    false,
  ]);
  assert.deepEqual(j([{ op: 'json_includes_all', path: 'w', values: ['x'] }], '{"w":"x"}'), [
    false,
  ]);
  assert.deepEqual(
    j([{ op: 'json_equals', path: 'review.verdict', value: 'ok' }], '{"review":{"verdict":"ok"}}'),
    [true]
  );
  assert.deepEqual(j([{ op: 'json_equals', path: 'a.b', value: 1 }], '{"a":[{"b":1}]}'), [false]);
});

test('judgeRule fails every check of unparseable json output', () => {
  for (const out of ['not json', '[1,2]', 'null', '```json\n{oops}\n```']) {
    const r = judgeRule(item('phone-intent-001'), out);
    assert.equal(r.verdict, 'fail', out);
    assert.equal(r.score, 0);
    assert.deepEqual(r.error, { type: 'unparseable_output' });
    assert.ok(r.checks.every((c) => !c.ok));
  }
});

test('judgeRule text items use regex / not_regex on the raw output', () => {
  const hande = item('hande-reply-001');
  const good = '설명.\n\n**[답변 필요]** 하나만 선택\n1. (권장) 지금 머지\n2. 미룸';
  assert.equal(judgeRule(hande, good).verdict, 'pass');
  const noMark = judgeRule(hande, '**[답변 필요]** 하나만 선택\n1. 지금 머지');
  assert.deepEqual(
    noMark.checks.map((c) => c.ok),
    [true, true, false, true]
  );
  const leaked = judgeRule(hande, `${good}\nghp_${'a'.repeat(20)}`);
  assert.equal(leaked.checks[3].ok, false);
});

test('buildPrompt adds the context and the json instruction', () => {
  const p = buildPrompt(item('phone-intent-001'));
  assert.ok(p.startsWith(item('phone-intent-001').input.prompt));
  assert.match(p, /JSON 객체 하나만 답하라/);
  assert.match(p, /"decision": "allow\|deny"/);
  const t = buildPrompt(item('hande-reply-001'));
  assert.match(t, /상황 자료:\nPR #12 head/);
  assert.doesNotMatch(t, /JSON 객체/);
});

// --- run ------------------------------------------------------------------

test('runEval with the seed stub passes every item and writes body-free valid records', async () => {
  const outputs = JSON.parse(fs.readFileSync(STUB_PASS, 'utf8'));
  const { runId, records, skipped } = await runEval({
    items,
    adapter: stubAdapter(outputs),
    target: TARGET,
    qsetCommit: 'abcdef1',
    runSuffix: 'test',
    now: () => new Date('2026-11-22T00:00:00Z'),
  });
  assert.equal(runId, '2026-11-22-abcdef1-test');
  assert.equal(skipped.length, 0);
  assert.equal(records.length, ACTIVE_RULE * 3);
  assert.ok(records.every((r) => r.verdict === 'pass'));
  const serialized = JSON.stringify(records);
  for (const text of Object.values(outputs)) {
    assert.ok(!serialized.includes(text), 'run records must not contain output text');
  }
  assert.ok(!serialized.includes('보내"]'), 'no output fragments either');
  const r = records.find((x) => x.itemId === 'hande-reply-001');
  assert.equal(r.outputChars, [...outputs['hande-reply-001']].length);
  assert.match(r.outputSha256, /^[0-9a-f]{64}$/);
});

test('runEval records adapter errors and filters by family', async () => {
  const records = await runWith(
    items,
    {
      'phone-intent-001': { error: 'timeout' },
      'skill-select-001': [DENY, { error: 'anything' }, '{"skill":"gh-ci-wait"}'],
    },
    { families: ['phone-intent', 'skill-select'] }
  );
  assert.deepEqual([...new Set(records.map((r) => r.family))].sort(), [
    'phone-intent',
    'skill-select',
  ]);
  const phone = records.filter((r) => r.itemId === 'phone-intent-001');
  assert.ok(phone.every((r) => r.verdict === 'error' && r.error.type === 'timeout'));
  assert.ok(phone.every((r) => r.checks === undefined && r.outputSha256 === undefined));
  const skill = records.filter((r) => r.itemId === 'skill-select-001').map((r) => r.verdict);
  assert.deepEqual(skill, ['fail', 'error', 'pass']);
});

test('an item id missing from the stub outputs is an adapter_error', async () => {
  const records = await runWith(items, {}, { families: ['skill-select'], attempts: 1 });
  assert.equal(records[0].verdict, 'error');
  assert.deepEqual(records[0].error, { type: 'adapter_error' });
});

test('2-of-3 rule: requiredPasses and itemOutcomes', async () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(requiredPasses), [1, 2, 2, 3, 4]);
  const { qset } = gatedQset(2);
  const records = await runWith(qset, {
    'phone-intent-001': [DENY, ALLOW, DENY],
    'phone-intent-002': [DENY, ALLOW, ALLOW],
    'skill-select-001': '{"skill":"gh-ci-wait"}',
  });
  const out = itemOutcomes(records);
  assert.equal(out.items.get('phone-intent-001').pass, true);
  assert.equal(out.items.get('phone-intent-002').pass, false);
  assert.equal(out.items.get('phone-intent-002').passes, 1);
});

// --- command adapter ------------------------------------------------------

const NODE = process.execPath;

test('command adapter sends the prompt on stdin and reads stdout', async () => {
  const echo = commandAdapter(NODE, [
    '-e',
    'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write("got:"+s.length))',
  ]);
  const r = await echo.call(item('skill-select-001'), 'hello', 1, 10000);
  assert.deepEqual(r, { output: 'got:5' });
});

test('command adapter maps exit codes, timeouts and missing binaries to errors', async () => {
  const it = item('skill-select-001');
  const failing = commandAdapter(NODE, ['-e', 'process.stdout.write("x");process.exit(3)']);
  assert.deepEqual(await failing.call(it, 'p', 1, 10000), { error: 'adapter_error' });
  const slow = commandAdapter(NODE, ['-e', 'setTimeout(()=>{},5000)']);
  assert.deepEqual(await slow.call(it, 'p', 1, 200), { error: 'timeout' });
  const missing = commandAdapter('/nonexistent/fleet-eval-target', []);
  assert.deepEqual(await missing.call(it, 'p', 1, 10000), { error: 'adapter_error' });
});

test('command adapter runs end to end through runEval', async () => {
  const answer = commandAdapter(NODE, [
    '-e',
    'process.stdin.resume();process.stdin.on("end",()=>process.stdout.write(\'{"skill":"gh-ci-wait"}\'))',
  ]);
  const { records } = await runEval({
    items: new Map([['skill-select-001', item('skill-select-001')]]),
    adapter: answer,
    target: { lane: 'local-test', model: 'node', adapter: 'command' },
    attempts: 1,
    qsetCommit: 'abcdef1',
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].verdict, 'pass');
});

// --- gate -----------------------------------------------------------------

function allDeny(n) {
  const out = { 'skill-select-001': '{"skill":"gh-ci-wait"}' };
  for (let i = 1; i <= n; i += 1) out[`phone-intent-${String(i).padStart(3, '0')}`] = DENY;
  return out;
}

test('gate passes when nothing drops and fails on a gated family regression', async () => {
  const { qset } = gatedQset(8);
  const baseline = await runWith(qset, allDeny(8), { runSuffix: 'base' });
  const same = await runWith(qset, allDeny(8), { runSuffix: 'cand' });
  const ok = gate(baseline, same, qset);
  assert.equal(ok.pass, true);
  assert.equal(ok.note, null);
  const phone = ok.families.find((f) => f.family === 'phone-intent');
  assert.equal(phone.gated, true);
  assert.equal(phone.candidate, 1);

  const worse = await runWith(qset, { ...allDeny(8), 'phone-intent-003': ALLOW });
  const bad = gate(baseline, worse, qset);
  assert.equal(bad.pass, false);
  assert.deepEqual(bad.reasons, [
    'family phone-intent pass rate dropped',
    'overall gated pass rate dropped',
  ]);
});

test('gate ignores regressions in families below the gating threshold', async () => {
  const { qset } = gatedQset(8);
  const baseline = await runWith(qset, allDeny(8));
  const skillWorse = await runWith(qset, { ...allDeny(8), 'skill-select-001': '{"skill":"x"}' });
  const report = gate(baseline, skillWorse, qset);
  assert.equal(report.pass, true);
  const skill = report.families.find((f) => f.family === 'skill-select');
  assert.equal(skill.gated, false);
  assert.equal(skill.regressed, true);
});

test('gate counts errors as failures and reports them separately', async () => {
  const { qset } = gatedQset(8);
  const baseline = await runWith(qset, allDeny(8));
  const outage = await runWith(qset, { ...allDeny(8), 'phone-intent-001': { error: 'timeout' } });
  const report = gate(baseline, outage, qset);
  assert.equal(report.pass, false);
  assert.equal(report.errorAttempts.candidate, 3);
  assert.equal(report.errorAttempts.baseline, 0);
});

test('gate excludes changed and new items, and fails on skipped gated items', async () => {
  const { qset: v1 } = gatedQset(8);
  const baseline = await runWith(v1, allDeny(8));

  const { qset: v2 } = gatedQset(9, { 'phone-intent-002': 2 });
  const cand = await runWith(v2, allDeny(9));
  const report = gate(baseline, cand, v2);
  assert.equal(report.pass, true);
  assert.deepEqual(report.excluded, [
    { itemId: 'phone-intent-002', reason: 'version 1 -> 2' },
    { itemId: 'phone-intent-009', reason: 'new since baseline' },
  ]);

  const partial = await runWith(v1, allDeny(8), { families: ['skill-select'] });
  const skipped = gate(baseline, partial, v1);
  assert.equal(skipped.pass, false);
  assert.equal(skipped.missing.length, 8);
  assert.match(skipped.reasons[0], /^candidate did not run: phone-intent-001/);
});

test('gate refuses runs on different target lanes or mixed run files', async () => {
  const { qset } = gatedQset(8);
  const baseline = await runWith(qset, allDeny(8));
  const other = (await runWith(qset, allDeny(8))).map((r) => ({
    ...r,
    target: { ...r.target, lane: 'other' },
  }));
  assert.throws(() => gate(baseline, other, qset), /target lanes differ/);
  const mixed = baseline.concat(other.map((r) => ({ ...r, runId: '2026-11-22-abcdef1-x' })));
  assert.throws(() => itemOutcomes(mixed), /mixes runIds/);
});

// --- CLI ------------------------------------------------------------------

test('CLI run writes a validator-clean run file; gate on itself passes', async () => {
  const out = tmpDir();
  const q = quiet();
  const args = [
    'run',
    '--target-lane',
    'stub',
    '--target-model',
    'stub-fixed',
    '--adapter',
    'stub',
    '--stub-outputs',
    STUB_PASS,
    '--qset-commit',
    'abcdef1',
    '--out',
    out,
    '--run-suffix',
    'cli',
  ];
  assert.equal(await main(args, q.log), 0);
  const files = fs.readdirSync(out);
  assert.equal(files.length, 1);
  assert.match(files[0], /^\d{4}-\d{2}-\d{2}-abcdef1-cli\.jsonl$/);
  const counts = validate({ runDirs: [out], log: () => {} });
  assert.equal(counts.errors, 0);
  assert.equal(counts.runs, ACTIVE_RULE * 3);

  assert.equal(await main(args, q.log), 2, 'refuses to overwrite an existing run file');
  assert.match(q.lines.at(-1), /already exists/);

  const file = path.join(out, files[0]);
  const g = quiet();
  assert.equal(await main(['gate', '--baseline', file, '--candidate', file], g.log), 0);
  assert.equal(g.lines[0], 'gate PASS lane=stub');
  for (const family of ['a2a-verdict', 'hande-reply', 'phone-intent', 'skill-select']) {
    assert.ok(
      g.lines.some((l) => l.startsWith(`GATED ${family}: 100.0% -> 100.0%`)),
      `${family} is gated with at least ${MIN_GATED_ITEMS} active items`
    );
  }
  const j = quiet();
  assert.equal(await main(['gate', '--baseline', file, '--candidate', file, '--json'], j.log), 0);
  assert.equal(JSON.parse(j.lines[0]).pass, true);
});

test('CLI usage errors exit 2 without calling any adapter', async () => {
  const cases = [
    [],
    ['nope'],
    ['run', '--target-lane', 'stub', '--target-model', 'm'],
    ['run', '--target-lane', 'Bad Lane', '--target-model', 'm', '--adapter', 'stub'],
    ['run', '--target-lane', 'stub', '--target-model', 'm', '--adapter', 'stub'],
    ['run', '--target-lane', 'stub', '--target-model', 'm', '--adapter', 'command'],
    ['run', '--target-lane', 's', '--target-model', 'm', '--adapter', 'http'],
    [
      'run',
      '--target-lane',
      's',
      '--target-model',
      'm',
      '--adapter',
      'stub',
      '--stub-outputs',
      STUB_PASS,
      '--attempts',
      '9',
    ],
    [
      'run',
      '--target-lane',
      's',
      '--target-model',
      'm',
      '--adapter',
      'stub',
      '--stub-outputs',
      STUB_PASS,
      '--family',
      'unknown-family',
    ],
    ['run', '--bogus', 'x'],
    ['gate', '--baseline', 'x'],
  ];
  for (const argv of cases) {
    const q = quiet();
    assert.equal(await main(argv, q.log), 2, argv.join(' '));
    assert.match(q.lines.at(-1), /^ERR /);
  }
});

// --- Q-set content (slice 2b) ---------------------------------------------

test('every family is gated: 8-12 active items, each with a source', () => {
  const byFamily = new Map();
  for (const it of items.values()) {
    if (it.status !== 'active') continue;
    byFamily.set(it.family, (byFamily.get(it.family) || 0) + 1);
    assert.ok(it.source.length >= 1, `${it.id} has a source`);
  }
  assert.deepEqual([...byFamily.keys()].sort(), [
    'a2a-verdict',
    'hande-reply',
    'phone-intent',
    'skill-select',
  ]);
  for (const [family, n] of byFamily) {
    assert.ok(n >= MIN_GATED_ITEMS && n <= 12, `${family} has ${n} active items`);
  }
  const total = [...byFamily.values()].reduce((a, b) => a + b, 0);
  assert.ok(total >= 30 && total <= 50, `total ${total} active items`);
});

test('plausible wrong answers fail the check each item is about', () => {
  const wrong = [
    [
      'hande-reply-003',
      '이름을 골라 주세요.\n\n**[답변 필요]** 하나만 선택\n1. (권장) results.json',
    ],
    ['hande-reply-004', '**[답변 필요]** 하나만 선택\n1. dungae에 먼저 적용 (권장)\n2. sogyo'],
    [
      'hande-reply-005',
      'T1 브로커를 재시작했습니다.\n\n**[답변 필요]** 하나만 선택\n1. (권장) 확인',
    ],
    [
      'hande-reply-008',
      '**[답변 필요]** 여러 개 선택 가능\n1. (권장) 50 머지\n\n**[답변 필요]** 하나만 선택\n1. (권장) A',
    ],
    [
      'hande-reply-009',
      '**[답변 필요]** 하나만 선택\n1. (권장) squash로 할까요?\n2. merge commit?',
    ],
    ['phone-intent-012', '{"decision":"allow","words":[]}'],
    ['phone-intent-011', '{"decision":"deny","words":["주문"]}'],
    ['a2a-verdict-009', '{"verdict":"accept","findings":["secret_exposure"]}'],
    ['a2a-verdict-010', '{"verdict":"reject","findings":["secret_exposure"]}'],
    ['skill-select-006', '{"skill":"scheduled-verification-with-session-fallback"}'],
  ];
  for (const [id, out] of wrong) {
    assert.equal(judgeRule(item(id), out).verdict, 'fail', id);
  }
});

test('items carry what the target needs to answer (v2, found by the first real run)', () => {
  for (const it of items.values()) {
    if (it.family === 'skill-select') {
      const expected = it.expected.checks[0].value;
      const names = (it.input.context || '').split(/[\s,:.()]+/);
      assert.ok(names.includes(expected), `${it.id}: ${expected} is listed in the context`);
    }
    if (it.family === 'phone-intent') {
      assert.match(it.input.context || '', /위험 단어:/, `${it.id} gives the deny rule and list`);
    }
  }
});
