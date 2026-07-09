'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Requiring validate.js runs its top-level schema loading but not the CLI
// (guarded by `require.main === module`), so the pure helpers are safe to import.
const { detectKind, getSchemaVersion, renderRunIdTemplate } = require('../scripts/validate.js');

test('getSchemaVersion honours numeric versions', () => {
  assert.equal(getSchemaVersion({ schema_version: 2 }), 2);
  assert.equal(getSchemaVersion({ schema_version: 1 }), 1);
});

test('getSchemaVersion coerces string versions (no silent v1 fallback)', () => {
  assert.equal(getSchemaVersion({ schema_version: '2' }), 2);
});

test('getSchemaVersion defaults to 1 when absent', () => {
  assert.equal(getSchemaVersion({}), 1);
});

test('getSchemaVersion returns NaN for non-numeric so callers can flag it', () => {
  assert.ok(Number.isNaN(getSchemaVersion({ schema_version: 'abc' })));
});

test('detectKind identifies a result packet', () => {
  assert.equal(detectKind({ agent_id: 'a', status: 'completed', evidence: [] }), 'result-packet');
});

test('detectKind returns null/undefined for an unrecognised doc', () => {
  const kind = detectKind({ nothing: true });
  assert.ok(kind === null || kind === undefined);
});

test('renderRunIdTemplate fills task/agent from provided objects', () => {
  const out = renderRunIdTemplate(
    'run-{task_id}-{agent_id}-{timestamp}',
    { round_id: 'r1', season: 'season-001' },
    { task_id: 'ops-001' },
    { agent_id: 'sogyo' },
  );
  assert.equal(out, 'run-ops-001-sogyo-20260101T000000UTC');
});
