'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  validate,
  itemProblems,
  runProblems,
  compileSchemas,
} = require('../scripts/validate-fleet-eval.js');

const ROOT = path.resolve(__dirname, '..');
const schemas = compileSchemas();

function seed(family) {
  const file = path.join(ROOT, 'fixtures', 'fleet-eval', 'qset', family, `${family}.jsonl`);
  return JSON.parse(fs.readFileSync(file, 'utf8').split('\n')[0]);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function baseRun(overrides = {}) {
  return {
    schemaVersion: 'fleet-eval-run-v1',
    runId: '2026-11-07-07d32c3',
    qsetCommit: '07d32c3',
    itemId: 'phone-intent-001',
    family: 'phone-intent',
    itemVersion: 1,
    attempt: 1,
    target: { lane: 'claude-code', model: 'm', adapter: 'cli' },
    judge: { kind: 'rule' },
    verdict: 'pass',
    score: 1,
    checks: [
      { op: 'json_equals', ok: true },
      { op: 'json_includes_all', ok: true },
    ],
    durationMs: 10,
    startedAt: '2026-11-07T03:00:00Z',
    ...overrides,
  };
}

const index = new Map([['phone-intent-001', seed('phone-intent')]]);

test('the committed Q-set and examples validate with zero errors', () => {
  const counts = validate({ log: () => {} });
  assert.equal(counts.errors, 0);
  assert.ok(counts.items >= 4, 'expected at least one seed item per family');
});

test('every seed item is schema-valid and has a source', () => {
  for (const family of ['hande-reply', 'skill-select', 'a2a-verdict', 'phone-intent']) {
    const item = seed(family);
    assert.ok(schemas.item(item), `${family}: ${JSON.stringify(schemas.item.errors)}`);
    assert.ok(item.source.length > 0);
    assert.deepEqual(itemProblems(item, family), []);
  }
});

test('an item without a source is rejected by the schema', () => {
  const item = clone(seed('phone-intent'));
  item.source = [];
  assert.equal(schemas.item(item), false);
});

test('an llm-judged item must carry a rubric, a rule item must carry checks', () => {
  const item = clone(seed('hande-reply'));
  item.judge = 'llm';
  assert.equal(schemas.item(item), false, 'llm item with checks only must fail');
  item.expected = {
    rubric: { id: 'hande.reply.v1', criteria: ['picks one option'], passScore: 0.7 },
  };
  assert.ok(schemas.item(item), JSON.stringify(schemas.item.errors));
  const rule = clone(seed('hande-reply'));
  rule.expected = {};
  assert.equal(schemas.item(rule), false, 'rule item without checks must fail');
});

test('family must match directory and id prefix', () => {
  const item = seed('phone-intent');
  assert.match(itemProblems(item, 'skill-select').join(';'), /does not match directory/);
  const renamed = clone(item);
  renamed.id = 'skill-select-001';
  assert.match(itemProblems(renamed, 'phone-intent').join(';'), /does not start with family/);
});

test('credential material and personal contact data are refused in item text', () => {
  const secret = clone(seed('phone-intent'));
  secret.input.context = 'token ghp_' + 'a'.repeat(36);
  assert.match(itemProblems(secret, 'phone-intent').join(';'), /credential-like/);
  const email = clone(seed('phone-intent'));
  email.input.context = 'mail someone@example.com';
  assert.match(itemProblems(email, 'phone-intent').join(';'), /personal contact/);
  const phone = clone(seed('phone-intent'));
  phone.input.context = '010-1234-5678 로 전화';
  assert.match(itemProblems(phone, 'phone-intent').join(';'), /personal contact/);
});

test('a check pattern that does not compile is reported', () => {
  const item = clone(seed('hande-reply'));
  item.expected.checks[0].pattern = '([unclosed';
  assert.match(itemProblems(item, 'hande-reply').join(';'), /does not compile/);
});

test('run records are body-free: an output field is rejected by the schema', () => {
  assert.ok(schemas.run(baseRun()), JSON.stringify(schemas.run.errors));
  assert.equal(schemas.run(baseRun({ output: 'the model said ...' })), false);
});

test('an llm judge on the target lane is refused (no self-evaluation)', () => {
  const run = baseRun({ judge: { kind: 'llm', lane: 'claude-code', model: 'j' } });
  assert.match(runProblems(run, index).join(';'), /self-evaluation/);
  const other = baseRun({ judge: { kind: 'llm', lane: 'codex', model: 'j' } });
  assert.doesNotMatch(runProblems(other, index).join(';'), /self-evaluation/);
});

test('an llm judge record must name its lane and model', () => {
  assert.equal(schemas.run(baseRun({ judge: { kind: 'llm' } })), false);
});

test('an error verdict must carry an error type', () => {
  assert.equal(schemas.run(baseRun({ verdict: 'error', score: 0 })), false);
  assert.ok(schemas.run(baseRun({ verdict: 'error', score: 0, error: { type: 'timeout' } })));
});

test('run records are cross-checked against the item', () => {
  assert.deepEqual(runProblems(baseRun(), index), []);
  assert.match(runProblems(baseRun({ itemId: 'phone-intent-999' }), index).join(';'), /unknown/);
  assert.match(runProblems(baseRun({ itemVersion: 2 }), index).join(';'), /itemVersion/);
  const missingCheck = baseRun({ checks: [{ op: 'json_equals', ok: true }] });
  assert.match(runProblems(missingCheck, index).join(';'), /do not match item checks/);
  const lying = baseRun({
    checks: [
      { op: 'json_equals', ok: false },
      { op: 'json_includes_all', ok: true },
    ],
  });
  assert.match(runProblems(lying, index).join(';'), /inconsistent/);
});
