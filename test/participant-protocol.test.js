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
const fs = require('node:fs');
const path = require('node:path');

const {
  runInProcessDemo,
  createMockServer,
  buildValidators,
} = require('../scripts/participant-protocol-mock');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'external-participant-http-json');
const readFixture = (file) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'));

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

test('external registration defaults to pending_review and source_only lanes', () => {
  const server = createMockServer(buildValidators());
  const response = server.register(readFixture('registration-valid.json'));
  assert.equal(response.status, 'pending_review');
  assert.equal(response.participant_class, 'external_self_serve');
  assert.deepEqual(response.allowed_lanes, ['source_only']);
});

test('pre-seeded internal_managed registration is reviewed but still source_only', () => {
  const server = createMockServer(buildValidators());
  const response = server.register(readFixture('registration-internal-managed-valid.json'));
  assert.equal(response.status, 'reviewed');
  assert.equal(response.participant_class, 'internal_managed');
  assert.equal(response.participant_id, 'sogyo');
  assert.deepEqual(response.allowed_lanes, ['source_only']);
});

test('human_baseline registers through the same schema, pending manual review', () => {
  const server = createMockServer(buildValidators());
  const response = server.register(readFixture('registration-human-baseline-valid.json'));
  assert.equal(response.status, 'pending_review');
  assert.equal(response.participant_class, 'human_baseline');
});

test('external agent self-claiming a pre-seeded accreditation is rejected', () => {
  const server = createMockServer(buildValidators());
  assert.throws(
    () => server.register(readFixture('negative-registration-external-preaccredited.json')),
    /register failed .*validation/
  );
});

test('requesting a live lane via registration is rejected for any class', () => {
  const server = createMockServer(buildValidators());
  assert.throws(
    () => server.register(readFixture('negative-registration-live-lane.json')),
    /register failed .*validation/
  );
});
