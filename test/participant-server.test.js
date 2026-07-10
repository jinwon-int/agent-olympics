'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  PersistentParticipantBroker,
  ProtocolError,
  listenParticipantServer,
  sanitizeTaskEnvelope,
} = require('../scripts/participant-server');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE_DIR = path.join(ROOT, 'fixtures', 'external-participant-http-json');
const ROUND = 'rounds/season-002-round-001.yaml';

function readFixture(file) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'));
}

function registration(agentId = 'gwakga') {
  const value = readFixture('registration-internal-managed-valid.json');
  value.agent_id = agentId;
  value.display_name = `${agentId} source-only participant`;
  value.capabilities.event_families = ['ops', 'code', 'node'];
  return value;
}

function submissionFor(runId, participantId, taskId) {
  const value = readFixture('artifact-submission-valid.json');
  value.result_packet.agent_id = participantId;
  value.result_packet.task_id = taskId;
  value.result_packet.comparable_metadata.participant.agent_id = participantId;
  value.result_packet.comparable_metadata.task.task_id = taskId;
  value.trace.agent_id = participantId;
  value.trace.run_id = runId;
  value.evidence_bundle.agent_id = participantId;
  value.evidence_bundle.run_id = runId;
  value.artifact_manifest = [
    {
      path: 'result-packet.yaml',
      sha256: `sha256:${'a'.repeat(64)}`,
      content_type: 'application/x-yaml',
    },
    {
      path: 'trace.yaml',
      sha256: `sha256:${'b'.repeat(64)}`,
      content_type: 'application/x-yaml',
    },
    {
      path: 'evidence-bundle.yaml',
      sha256: `sha256:${'c'.repeat(64)}`,
      content_type: 'application/x-yaml',
    },
  ];
  return value;
}

async function jsonRequest(baseUrl, method, pathname, body, headers = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body ? { 'content-type': 'application/json', ...headers } : { ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { response, document: await response.json() };
}

test('task envelope sanitization removes nested oracle and private-judge fields', () => {
  const sanitized = sanitizeTaskEnvelope({
    task_id: 'ops-201',
    nested: {
      keep: 'public',
      oracle_ref: 'oracles/private.yaml',
      judge_notes: { answer: 'private' },
      deeper: [{ hidden_judge_notes: 'private', keep: true }],
    },
  });
  assert.deepEqual(sanitized, {
    task_id: 'ops-201',
    nested: { keep: 'public', deeper: [{ keep: true }] },
  });
});

test('persistent loopback server carries a reviewed participant through claim, validation, judge, and scoreboard', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-olympics-participant-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const broker = new PersistentParticipantBroker({
    root: ROOT,
    dataDir,
    roundManifestPaths: [ROUND],
  });
  const listening = await listenParticipantServer({ broker, port: 0 });
  t.after(() => listening.close());

  const registered = await jsonRequest(listening.baseUrl, 'POST', '/participants', registration());
  assert.equal(registered.response.status, 201);
  assert.equal(registered.document.status, 'pending_review');
  assert.deepEqual(registered.document.allowed_lanes, ['source_only']);

  const pendingEligible = await jsonRequest(
    listening.baseUrl,
    'GET',
    '/participants/gwakga/eligible-runs'
  );
  assert.equal(pendingEligible.response.status, 200);
  assert.deepEqual(pendingEligible.document.eligible, []);

  const pendingClaim = {
    kind: 'claim_request',
    schema_version: 1,
    participant_id: 'gwakga',
    round_id: 'season-002-round-001',
    task_id: 'ops-201',
    mode: 'source_only',
  };
  const blocked = await jsonRequest(listening.baseUrl, 'POST', '/runs', pendingClaim, {
    'idempotency-key': 'gwakga:ops-201:pending',
  });
  assert.equal(blocked.response.status, 403);
  assert.equal(blocked.document.error, 'participant_not_reviewed');

  const review = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'scripts/participant-server.js'),
      'review',
      '--data-dir',
      dataDir,
      '--participant',
      'gwakga',
      '--approval-ref',
      'issue 291: source-test',
    ],
    { cwd: ROOT, encoding: 'utf8' }
  );
  assert.equal(review.status, 0, review.stderr);
  assert.equal(JSON.parse(review.stdout).status, 'reviewed');

  const eligible = await jsonRequest(
    listening.baseUrl,
    'GET',
    '/participants/gwakga/eligible-runs'
  );
  assert.equal(eligible.response.status, 200);
  assert.deepEqual(
    eligible.document.eligible.map((item) => item.task_id),
    ['code-201', 'node-201', 'ops-201']
  );

  const claimed = await jsonRequest(listening.baseUrl, 'POST', '/runs', pendingClaim, {
    'idempotency-key': 'gwakga:ops-201:001',
  });
  assert.equal(claimed.response.status, 201);
  assert.equal(claimed.document.kind, 'claim_response');
  assert.equal(claimed.document.task_envelope.task_id, 'ops-201');
  assert.equal('judge_notes_ref' in claimed.document.task_envelope, false);
  assert.equal('oracle_ref' in claimed.document.task_envelope, false);
  const runId = claimed.document.run_id;

  const replay = await jsonRequest(listening.baseUrl, 'POST', '/runs', pendingClaim, {
    'idempotency-key': 'gwakga:ops-201:001',
  });
  assert.equal(replay.response.status, 200);
  assert.equal(replay.document.kind, 'already_claimed');
  assert.equal(replay.document.run_id, runId);

  const conflictingClaim = { ...pendingClaim, task_id: 'code-201' };
  const conflict = await jsonRequest(listening.baseUrl, 'POST', '/runs', conflictingClaim, {
    'idempotency-key': 'gwakga:ops-201:001',
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.document.error, 'idempotency_conflict');

  const submission = submissionFor(runId, 'gwakga', 'ops-201');
  const submitted = await jsonRequest(
    listening.baseUrl,
    'POST',
    `/runs/${runId}/artifacts`,
    submission
  );
  assert.equal(submitted.response.status, 202);
  assert.deepEqual(
    {
      state: submitted.document.state,
      validation: submitted.document.validation,
      judge: submitted.document.judge,
      scoreboard: submitted.document.scoreboard,
    },
    {
      state: 'accepted',
      validation: 'accepted',
      judge: 'scored',
      scoreboard: 'published',
    }
  );

  const status = await jsonRequest(listening.baseUrl, 'GET', `/runs/${runId}/status`);
  assert.equal(status.response.status, 200);
  assert.equal(status.document.state, 'accepted');

  const runDir = path.join(dataDir, 'rounds', 'season-002-round-001', runId);
  for (const file of [
    'manifest.yaml',
    'result-packet.yaml',
    'trace.yaml',
    'evidence-bundle.yaml',
    'result-packet-auto-judge.yaml',
  ]) {
    assert.equal(fs.existsSync(path.join(runDir, file)), true, `missing ${file}`);
  }
  const scoreboard = JSON.parse(
    fs.readFileSync(path.join(dataDir, 'rounds', 'season-002-round-001', 'scoreboard.json'))
  );
  const scoreboardEntry = scoreboard.entries.find((entry) => entry.run_id === runId);
  assert.ok(scoreboardEntry, 'scoreboard must preserve the claimed run id');
  assert.equal(scoreboardEntry.schema_validation.valid, true);
  assert.equal(scoreboardEntry.semantic_checks.passed, true);

  const submissionReplay = await jsonRequest(
    listening.baseUrl,
    'POST',
    `/runs/${runId}/artifacts`,
    submission
  );
  assert.equal(submissionReplay.response.status, 200);
  assert.equal(submissionReplay.document.state, 'accepted');

  const tampered = JSON.parse(JSON.stringify(submission));
  tampered.result_packet.summary = `${tampered.result_packet.summary} tampered`;
  const immutable = await jsonRequest(
    listening.baseUrl,
    'POST',
    `/runs/${runId}/artifacts`,
    tampered
  );
  assert.equal(immutable.response.status, 409);
  assert.equal(immutable.document.error, 'accepted_run_immutable');

  await listening.close();
  const recovered = new PersistentParticipantBroker({
    root: ROOT,
    dataDir,
    roundManifestPaths: [ROUND],
  });
  assert.equal(recovered.getStatus(runId).state, 'accepted');
});

test('an interrupted post-persistence submission is quarantined and replayable', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-olympics-recovery-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const broker = new PersistentParticipantBroker({
    root: ROOT,
    dataDir,
    roundManifestPaths: [ROUND],
  });
  broker.register(registration());
  broker.reviewParticipant('gwakga', {
    status: 'reviewed',
    approvalRef: 'issue 291: recovery-test',
  });
  const claim = broker.claim('gwakga:ops-201:recovery', {
    kind: 'claim_request',
    schema_version: 1,
    participant_id: 'gwakga',
    round_id: 'season-002-round-001',
    task_id: 'ops-201',
    mode: 'source_only',
  }).response;
  const payload = submissionFor(claim.run_id, 'gwakga', 'ops-201');
  assert.equal(broker.submit(claim.run_id, payload).response.state, 'accepted');

  const statePath = path.join(dataDir, 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  Object.assign(state.runs[claim.run_id], {
    state: 'submitted',
    validation: 'pending',
    judge: 'pending',
    scoreboard: 'not_published',
  });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.rmSync(path.join(dataDir, 'rounds', 'season-002-round-001', 'scoreboard.json'));

  const recovered = new PersistentParticipantBroker({
    root: ROOT,
    dataDir,
    roundManifestPaths: [ROUND],
  });
  assert.equal(recovered.getStatus(claim.run_id).state, 'needs_review');
  assert.equal(
    fs.existsSync(path.join(dataDir, 'rounds', 'season-002-round-001', claim.run_id)),
    false
  );
  assert.equal(fs.readdirSync(path.join(dataDir, 'recovery', 'season-002-round-001')).length, 1);

  const retry = recovered.submit(claim.run_id, payload);
  assert.equal(retry.accepted, true);
  assert.equal(retry.response.state, 'accepted');
});

test('local operator review is required and non-loopback binding fails closed', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-olympics-policy-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const broker = new PersistentParticipantBroker({ root: ROOT, dataDir });
  broker.register(registration('sogyo'));

  assert.throws(
    () => broker.reviewParticipant('sogyo', { status: 'reviewed' }),
    (error) => error instanceof ProtocolError && error.code === 'approval_ref_required'
  );
  assert.throws(
    () => listenParticipantServer({ broker, host: '0.0.0.0', port: 0 }),
    (error) => error instanceof ProtocolError && error.code === 'non_loopback_forbidden'
  );

  const limited = await listenParticipantServer({
    broker,
    host: '127.0.0.1',
    port: 0,
    maxBodyBytes: 64,
  });
  t.after(() => limited.close());
  const oversized = await jsonRequest(
    limited.baseUrl,
    'POST',
    '/participants',
    registration('gwakga')
  );
  assert.equal(oversized.response.status, 413);
  assert.equal(oversized.document.error, 'payload_too_large');

  assert.equal(fs.statSync(dataDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(dataDir, 'state.json')).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(path.join(dataDir, '.state.lock')), false);
});
