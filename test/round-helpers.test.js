'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { exitCodeToStatus, renderRunId, generateTimestamp } = require('../scripts/round.js');

test('exitCodeToStatus maps the documented exit codes', () => {
  assert.equal(exitCodeToStatus(0), 'completed');
  assert.equal(exitCodeToStatus(1), 'failed');
  assert.equal(exitCodeToStatus(2), 'partial');
});

test('exitCodeToStatus maps any other code to blocked', () => {
  assert.equal(exitCodeToStatus(3), 'blocked');
  assert.equal(exitCodeToStatus(127), 'blocked');
});

test('renderRunId uses the manifest template and provided timestamp', () => {
  const out = renderRunId(
    {
      run_id_template: 'run-{task_id}-{agent_id}-{timestamp}',
      round_id: 'r1',
      season: 'season-001',
    },
    { task_id: 'ops-001' },
    { agent_id: 'sogyo' },
    '20260709T000000UTC'
  );
  assert.equal(out, 'run-ops-001-sogyo-20260709T000000UTC');
});

test('renderRunId falls back to the default template', () => {
  const out = renderRunId(
    {},
    { task_id: 'code-001' },
    { agent_id: 'gwakga' },
    '20260709T010203UTC'
  );
  assert.equal(out, 'run-code-001-gwakga-20260709T010203UTC');
});

test('generateTimestamp emits a UTC-suffixed compact timestamp', () => {
  assert.match(generateTimestamp(), /^\d{8}T\d{6}UTC$/);
});

test('generateTimestamp derives a filesystem-safe slug from an ISO source', () => {
  // Derived from a single ISO 8601 source with separators/millis stripped.
  assert.equal(generateTimestamp(new Date('2026-07-09T02:44:52.123Z')), '20260709T024452UTC');
});
