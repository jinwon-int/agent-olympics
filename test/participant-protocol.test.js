'use strict';

/**
 * Tests for the loopback-only participant-protocol mock (#287, Slice C).
 *
 * In-process path ONLY — no sockets are bound here (CI-safe). Covers:
 *   - a full in-process demo run succeeds,
 *   - a repeated claim is idempotent (same run_id, already_claimed marker),
 *   - tampered payloads are rejected by schema validation.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runInProcessDemo,
  createMockServer,
  buildValidators,
} = require('../scripts/participant-protocol-mock');

// Silence step output so test logs stay clean.
const quiet = () => {};

test('full in-process demo run succeeds and validates all 5 steps', () => {
  const summary = runInProcessDemo({ log: quiet });
  assert.equal(summary.ok, true);
  assert.deepEqual(summary.steps, ['register', 'claim', 'submit', 'status']);
  assert.ok(summary.run_id, 'expected a run_id');
});

test('repeat claim is idempotent: same run_id, already_claimed marker', () => {
  const server = createMockServer(buildValidators());
  const request = {
    kind: 'claim_request',
    schema_version: 1,
    participant_id: 'part_example',
    round_id: 'season-002-preview',
    task_id: 'ops-201-source-only-incident-triage',
    mode: 'source_only',
  };
  const key = `${request.participant_id}:${request.task_id}`;

  const first = server.claim(key, request);
  const second = server.claim(key, request);

  assert.equal(first.kind, 'claim_response');
  assert.equal(second.kind, 'already_claimed');
  assert.equal(second.run_id, first.run_id);
});

test('tampered registration (safety.oracle_access: true) is rejected', () => {
  const server = createMockServer(buildValidators());
  const tampered = {
    schema_version: 1,
    agent_id: 'example-agent',
    display_name: 'Example Agent',
    runtime: { kind: 'external_http_json', name: 'ExampleHarness', version: '0.1.0' },
    capabilities: {
      event_families: ['ops'],
      supports_task_envelope_v2: true,
      supports_result_packet_v2: true,
      supports_trace_record: true,
      supports_evidence_bundle: true,
      supports_polling: true,
      supports_webhook_delivery: false,
      max_concurrent_runs: 1,
    },
    safety: {
      approval_boundaries: ['no live mutation without explicit task authorization'],
      redaction_rules: ['no secrets in summaries'],
      oracle_access: true,
    },
    contact: { github: 'example-org/example-agent' },
  };
  assert.throws(() => server.register(tampered), /register failed .*validation/);
});

test('tampered run status (state: "deployed") is rejected', () => {
  const server = createMockServer(buildValidators());
  const tampered = {
    schema_version: 1,
    run_id: 'run_example',
    participant_id: 'part_example',
    task_id: 'ops-201-source-only-incident-triage',
    state: 'deployed',
    validation: 'accepted',
    judge: 'pending',
    scoreboard: 'not_published',
  };
  assert.throws(() => server.status(tampered), /status failed/);
});
