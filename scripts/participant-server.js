#!/usr/bin/env node
'use strict';

/**
 * Persistent, loopback-only HTTP/JSON participant broker for Agent Olympics.
 *
 * This is the source implementation for the Slice D contract. It deliberately
 * does not provide deployment, authentication, provider-send, database, ACK,
 * or other live-mutation capabilities. A non-loopback bind fails closed.
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');
const Ajv2020 = require('ajv/dist/2020').default;
const addFormats = require('ajv-formats');
const { SECRET_VALUE_PATTERNS } = require('./lib/secret-patterns');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;
const REQUIRED_ARTIFACT_PATHS = new Set([
  'result-packet.yaml',
  'trace.yaml',
  'evidence-bundle.yaml',
]);
const SAFE_PARTICIPANT_ID = /^[a-z0-9][a-z0-9-]*$/;
const SAFE_RUN_ID = /^run-[a-z0-9][a-z0-9-]*$/;
const SAFE_IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,200}$/;

class ProtocolError extends Error {
  constructor(message, { status = 400, code = 'bad_request', details = [] } = {}) {
    super(message);
    this.name = 'ProtocolError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const PRIVATE_TASK_FIELDS = new Set([
  'oracle_ref',
  'judge_notes_ref',
  'hidden_judge_notes',
  'private_judge_notes',
  'judge_notes',
]);

function sanitizeTaskEnvelope(value) {
  if (Array.isArray(value)) return value.map((item) => sanitizeTaskEnvelope(item));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PRIVATE_TASK_FIELDS.has(key))
      .map(([key, child]) => [key, sanitizeTaskEnvelope(child)])
  );
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function formatAjvErrors(errors) {
  return (errors || []).map((error) => {
    const location = error.instancePath || '(root)';
    return `${location}: ${error.message}`;
  });
}

function buildValidators(root = ROOT) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const schemaFiles = {
    registration: 'participant-registration.schema.json',
    participant_status: 'participant-status.schema.json',
    eligible_runs: 'eligible-runs.schema.json',
    run_claim: 'run-claim.schema.json',
    artifact_submission: 'artifact-submission.schema.json',
    run_status: 'run-status.schema.json',
    result_packet: 'result-packet-v2.schema.json',
    trace: 'trace-record.schema.json',
    evidence_bundle: 'evidence-bundle.schema.json',
    round_manifest: 'round-manifest.schema.json',
    task_envelope: 'task-envelope-v2.schema.json',
    scoreboard: 'scoreboard.schema.json',
    judge_record: 'judge-record.schema.json',
    artifact_manifest: 'artifact-manifest.schema.json',
  };
  const schemas = {};

  for (const [name, file] of Object.entries(schemaFiles)) {
    const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas', file), 'utf8'));
    schemas[name] = schema;
    ajv.addSchema(schema);
  }

  const validators = {};
  for (const [name, schema] of Object.entries(schemas)) {
    const validator = ajv.getSchema(schema.$id);
    if (!validator) throw new Error(`Could not compile schema ${name}`);
    validators[name] = validator;
  }
  return validators;
}

function assertValid(validators, name, document, { status = 422, output = false } = {}) {
  const validate = validators[name];
  if (!validate) throw new Error(`Unknown validator: ${name}`);
  if (validate(document)) return;
  const details = formatAjvErrors(validate.errors);
  throw new ProtocolError(`${name} schema validation failed`, {
    status: output ? 500 : status,
    code: output ? 'invalid_server_output' : 'schema_validation_failed',
    details: output ? [] : details,
  });
}

function emptyState() {
  return {
    schema_version: 1,
    participants: {},
    idempotency_keys: {},
    claims_by_tuple: {},
    runs: {},
  };
}

function ensureInside(root, candidate, label) {
  const rootReal = fs.realpathSync(root);
  const candidateReal = fs.realpathSync(candidate);
  if (candidateReal !== rootReal && !candidateReal.startsWith(`${rootReal}${path.sep}`)) {
    throw new Error(`${label} escapes repository root: ${candidate}`);
  }
  return candidateReal;
}

function writeAtomicJson(file, value) {
  const dir = path.dirname(file);
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
  try {
    const dirFd = fs.openSync(dir, 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    // Directory fsync is not available on every platform; the atomic rename remains.
  }
}

function writeYaml(file, value) {
  const rendered = yaml.dump(value, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
  fs.writeFileSync(file, rendered, { encoding: 'utf8', mode: 0o600 });
}

function artifactEntry(file, runDir, kind, generatedBy = 'participant') {
  const content = fs.readFileSync(path.join(runDir, file));
  return {
    path: file,
    kind,
    content_type: file.endsWith('.json') ? 'application/json' : 'application/x-yaml',
    size_bytes: content.byteLength,
    checksum: { algorithm: 'sha256', value: sha256(content) },
    retention: 'round',
    redacted: false,
    generated_by: generatedBy,
  };
}

function isLoopbackHost(host) {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

function runChild(label, args, { cwd = ROOT, timeout = 60_000 } = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: 4 * 1024 * 1024,
    env: process.env,
  });
  if (result.error || result.status !== 0) {
    const reason = result.error
      ? result.error.message
      : `${label} exited with status ${String(result.status)}`;
    throw new ProtocolError(`${label} failed: ${reason}`, {
      status: 500,
      code: 'pipeline_failed',
    });
  }
  return result;
}

function scanForSecretValues(value) {
  const text = JSON.stringify(value);
  const matches = [];
  for (const pattern of SECRET_VALUE_PATTERNS || []) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) matches.push(pattern.source);
  }
  return matches;
}

class PersistentParticipantBroker {
  constructor({ root = ROOT, dataDir, roundManifestPaths = [], validators } = {}) {
    if (!dataDir) throw new Error('dataDir is required');
    this.root = fs.realpathSync(root);
    this.dataDir = path.resolve(dataDir);
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.dataDir, 0o700);
    fs.mkdirSync(path.join(this.dataDir, 'rounds'), { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.join(this.dataDir, 'staging'), { recursive: true, mode: 0o700 });

    this.validators = validators || buildValidators(this.root);
    this.catalog = this.loadCatalog(roundManifestPaths);
    this.statePath = path.join(this.dataDir, 'state.json');
    this.stateLockPath = path.join(this.dataDir, '.state.lock');
    this.stateLockDepth = 0;
    this.state = emptyState();
    this.withStateLock(() => this.recoverCompletedRuns());
  }

  acquireStateLock() {
    const deadline = Date.now() + 10_000;
    const sleeper = new Int32Array(new SharedArrayBuffer(4));
    while (true) {
      try {
        const fd = fs.openSync(this.stateLockPath, 'wx', 0o600);
        fs.writeFileSync(fd, `${process.pid}\n`, 'utf8');
        fs.fsyncSync(fd);
        return fd;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let removeStale = false;
        try {
          const rawOwner = fs.readFileSync(this.stateLockPath, 'utf8').trim();
          const ownerPid = Number(rawOwner);
          const ageMs = Date.now() - fs.statSync(this.stateLockPath).mtimeMs;
          if (!Number.isInteger(ownerPid) || ownerPid <= 0) {
            removeStale = ageMs > 5_000;
          } else {
            try {
              process.kill(ownerPid, 0);
            } catch (signalError) {
              if (signalError.code === 'ESRCH') removeStale = true;
              else if (signalError.code !== 'EPERM') throw signalError;
            }
          }
          if (removeStale) {
            fs.rmSync(this.stateLockPath, { force: true });
            continue;
          }
        } catch (readError) {
          if (readError.code === 'ENOENT') continue;
          throw readError;
        }
        if (Date.now() >= deadline) {
          throw new ProtocolError('Participant state is busy', {
            status: 503,
            code: 'state_busy',
          });
        }
        Atomics.wait(sleeper, 0, 0, 25);
      }
    }
  }

  withStateLock(operation) {
    if (this.stateLockDepth > 0) return operation();
    const fd = this.acquireStateLock();
    this.stateLockDepth = 1;
    try {
      this.state = this.loadState();
      return operation();
    } finally {
      this.stateLockDepth = 0;
      fs.closeSync(fd);
      fs.rmSync(this.stateLockPath, { force: true });
    }
  }

  refreshState() {
    if (this.stateLockDepth === 0) this.state = this.loadState();
  }

  loadState() {
    if (!fs.existsSync(this.statePath)) return emptyState();
    const state = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
    if (!state || state.schema_version !== 1) {
      throw new Error('Unsupported or corrupt participant server state');
    }
    for (const field of ['participants', 'idempotency_keys', 'claims_by_tuple', 'runs']) {
      if (!state[field] || typeof state[field] !== 'object' || Array.isArray(state[field])) {
        throw new Error(`Corrupt participant server state field: ${field}`);
      }
    }
    fs.chmodSync(this.statePath, 0o600);
    return state;
  }

  saveState() {
    if (this.stateLockDepth === 0) {
      throw new Error('saveState requires the cross-process state lock');
    }
    writeAtomicJson(this.statePath, this.state);
  }

  loadCatalog(roundManifestPaths) {
    const catalog = new Map();
    for (const manifestInput of roundManifestPaths) {
      const resolved = path.isAbsolute(manifestInput)
        ? manifestInput
        : path.resolve(this.root, manifestInput);
      const manifestPath = ensureInside(this.root, resolved, 'round manifest');
      const manifest = yaml.load(fs.readFileSync(manifestPath, 'utf8'));
      assertValid(this.validators, 'round_manifest', manifest);
      if (catalog.has(manifest.round_id)) {
        throw new Error(`Duplicate round id in catalog: ${manifest.round_id}`);
      }

      const tasks = new Map();
      for (const task of manifest.tasks || []) {
        const envelopePath = ensureInside(
          this.root,
          path.resolve(this.root, task.envelope_path),
          'task envelope'
        );
        const envelope = yaml.load(fs.readFileSync(envelopePath, 'utf8'));
        assertValid(this.validators, 'task_envelope', envelope);
        if (envelope.task_id !== task.task_id) {
          throw new Error(
            `Task id mismatch: manifest=${task.task_id} envelope=${String(envelope.task_id)}`
          );
        }
        if (envelope.participant_visibility === 'internal') {
          throw new Error(`Internal-only task cannot be served: ${task.task_id}`);
        }
        const publicEnvelope = sanitizeTaskEnvelope(envelope);
        assertValid(this.validators, 'task_envelope', publicEnvelope, { output: true });
        tasks.set(task.task_id, {
          manifestTask: clone(task),
          envelope: publicEnvelope,
          taskEnvelopeRef: `agent-olympics://rounds/${manifest.round_id}/tasks/${task.task_id}`,
        });
      }
      catalog.set(manifest.round_id, { manifest: clone(manifest), tasks });
    }
    return catalog;
  }

  recoverCompletedRuns() {
    let changed = false;
    for (const run of Object.values(this.state.runs)) {
      if (run.state !== 'submitted' && run.state !== 'needs_review') continue;
      const runDir = this.runDirectory(run);
      const scoreboardPath = this.scoreboardPath(run.round_id);
      if (
        fs.existsSync(path.join(runDir, 'result-packet.yaml')) &&
        fs.existsSync(path.join(runDir, 'result-packet-auto-judge.yaml')) &&
        fs.existsSync(scoreboardPath)
      ) {
        try {
          const scoreboard = JSON.parse(fs.readFileSync(scoreboardPath, 'utf8'));
          assertValid(this.validators, 'scoreboard', scoreboard, { output: true });
          const entry = scoreboard.entries.find((item) => item.run_id === run.run_id);
          if (entry && entry.schema_validation && entry.schema_validation.valid) {
            run.state = 'accepted';
            run.validation = 'accepted';
            run.judge = 'scored';
            run.scoreboard = 'published';
            run.accepted_at = run.accepted_at || nowIso();
            changed = true;
            continue;
          }
        } catch {
          // Leave the run for an operator-reviewed retry below.
        }
      }
      const runDirExists = fs.existsSync(runDir);
      if (runDirExists) {
        const recoveryRoot = path.join(this.dataDir, 'recovery', run.round_id);
        fs.mkdirSync(recoveryRoot, { recursive: true, mode: 0o700 });
        const recoveryName = `${run.run_id}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
        const recoveryDir = path.join(recoveryRoot, recoveryName);
        fs.renameSync(runDir, recoveryDir);
        run.recovery_artifact_ref = path.relative(this.dataDir, recoveryDir);
        changed = true;
      }
      if (run.state === 'submitted') {
        run.state = 'needs_review';
        run.errors = [runDirExists ? 'interrupted_after_persist' : 'interrupted_before_scoreboard'];
        changed = true;
      }
    }
    if (changed) this.saveState();
  }

  participantStatus(record) {
    const response = {
      schema_version: 1,
      participant_id: record.registration.agent_id,
      participant_class: record.registration.participant_class || 'external_self_serve',
      status: record.policy.status,
      allowed_lanes: ['source_only'],
    };
    assertValid(this.validators, 'participant_status', response, { output: true });
    return response;
  }

  register(registration) {
    return this.withStateLock(() => this.registerUnlocked(registration));
  }

  registerUnlocked(registration) {
    assertValid(this.validators, 'registration', registration);
    const normalized = clone(registration);
    normalized.participant_class = normalized.participant_class || 'external_self_serve';
    normalized.allowed_lanes = normalized.allowed_lanes || ['source_only'];
    const id = normalized.agent_id;
    const existing = this.state.participants[id];
    const exactReplay =
      existing && canonicalJson(existing.registration) === canonicalJson(normalized);
    if (exactReplay) return { created: false, response: this.participantStatus(existing) };

    const timestamp = nowIso();
    const record = {
      registration: normalized,
      policy: {
        status: 'pending_review',
        allowed_lanes: ['source_only'],
        approval_ref: null,
      },
      registered_at: existing ? existing.registered_at : timestamp,
      updated_at: timestamp,
    };
    this.state.participants[id] = record;
    this.saveState();
    return { created: !existing, response: this.participantStatus(record) };
  }

  reviewParticipant(participantId, { status = 'reviewed', approvalRef } = {}) {
    return this.withStateLock(() =>
      this.reviewParticipantUnlocked(participantId, { status, approvalRef })
    );
  }

  reviewParticipantUnlocked(participantId, { status = 'reviewed', approvalRef } = {}) {
    if (!SAFE_PARTICIPANT_ID.test(participantId)) {
      throw new ProtocolError('Invalid participant id', { status: 400, code: 'invalid_id' });
    }
    if (!['reviewed', 'revoked'].includes(status)) {
      throw new ProtocolError('Review status must be reviewed or revoked', {
        status: 400,
        code: 'invalid_review_status',
      });
    }
    if (status === 'reviewed' && (!approvalRef || typeof approvalRef !== 'string')) {
      throw new ProtocolError('approvalRef is required to review a participant', {
        status: 400,
        code: 'approval_ref_required',
      });
    }
    const record = this.state.participants[participantId];
    if (!record) {
      throw new ProtocolError('Participant not found', { status: 404, code: 'not_found' });
    }
    record.policy.status = status;
    record.policy.allowed_lanes = ['source_only'];
    record.policy.approval_ref = status === 'reviewed' ? approvalRef : null;
    record.policy.reviewed_at = nowIso();
    record.updated_at = nowIso();
    this.saveState();
    return this.participantStatus(record);
  }

  eligibleRuns(participantId) {
    this.refreshState();
    const record = this.state.participants[participantId];
    if (!record) {
      throw new ProtocolError('Participant not found', { status: 404, code: 'not_found' });
    }
    const eligible = [];
    const registration = record.registration;
    const capabilities = registration.capabilities;
    const artifactCapable =
      capabilities.supports_task_envelope_v2 &&
      capabilities.supports_result_packet_v2 &&
      capabilities.supports_trace_record &&
      capabilities.supports_evidence_bundle &&
      capabilities.supports_polling;

    if (record.policy.status === 'reviewed' && artifactCapable) {
      for (const [roundId, round] of this.catalog.entries()) {
        const roundParticipant = (round.manifest.participants || []).find(
          (item) => (item.agent_id || item.id) === participantId && item.enabled !== false
        );
        if (!roundParticipant) continue;
        for (const [taskId, task] of round.tasks.entries()) {
          const family = taskId.split('-')[0];
          if (!capabilities.event_families.includes(family)) continue;
          eligible.push({
            round_id: roundId,
            task_id: taskId,
            task_envelope_ref: task.taskEnvelopeRef,
            lane: 'source_only',
            time_limit_sec:
              task.manifestTask.time_limit_sec || task.envelope.time_limit_minutes * 60,
          });
        }
      }
    }

    eligible.sort((a, b) =>
      `${a.round_id}:${a.task_id}`.localeCompare(`${b.round_id}:${b.task_id}`)
    );
    const response = {
      schema_version: 1,
      participant_id: participantId,
      status: record.policy.status,
      eligible,
    };
    assertValid(this.validators, 'eligible_runs', response, { output: true });
    return response;
  }

  taskFor(roundId, taskId) {
    const round = this.catalog.get(roundId);
    return round ? round.tasks.get(taskId) : null;
  }

  claimResponse(run, kind) {
    const task = this.taskFor(run.round_id, run.task_id);
    if (!task) throw new Error(`Catalog task disappeared for ${run.run_id}`);
    const response = {
      kind,
      schema_version: 1,
      run_id: run.run_id,
      task_envelope_ref: task.taskEnvelopeRef,
      task_envelope: clone(task.envelope),
      required_artifacts: ['result_packet', 'trace', 'evidence_bundle'],
      forbidden_actions: ['oracle_access', 'unapproved_live_mutation', 'secret_disclosure'],
    };
    assertValid(this.validators, 'run_claim', response, { output: true });
    assertValid(this.validators, 'task_envelope', response.task_envelope, { output: true });
    return response;
  }

  claim(idempotencyKey, request) {
    return this.withStateLock(() => this.claimUnlocked(idempotencyKey, request));
  }

  claimUnlocked(idempotencyKey, request) {
    assertValid(this.validators, 'run_claim', request);
    if (!idempotencyKey || !SAFE_IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw new ProtocolError('A safe Idempotency-Key header is required', {
        status: 400,
        code: 'idempotency_key_required',
      });
    }
    const fingerprint = sha256(canonicalJson(request));
    const priorKey = this.state.idempotency_keys[idempotencyKey];
    if (priorKey) {
      if (priorKey.fingerprint !== fingerprint) {
        throw new ProtocolError('Idempotency-Key was already used for a different request', {
          status: 409,
          code: 'idempotency_conflict',
        });
      }
      return {
        created: false,
        response: this.claimResponse(this.state.runs[priorKey.run_id], 'already_claimed'),
      };
    }

    const participant = this.state.participants[request.participant_id];
    if (!participant) {
      throw new ProtocolError('Participant not found', { status: 404, code: 'not_found' });
    }
    if (participant.policy.status !== 'reviewed') {
      throw new ProtocolError('Participant is not reviewed for source-only runs', {
        status: 403,
        code: 'participant_not_reviewed',
      });
    }
    const eligible = this.eligibleRuns(request.participant_id).eligible;
    if (
      !eligible.some(
        (item) => item.round_id === request.round_id && item.task_id === request.task_id
      )
    ) {
      throw new ProtocolError('Requested run is not eligible for this participant', {
        status: 403,
        code: 'run_not_eligible',
      });
    }

    const tuple = `${request.participant_id}:${request.round_id}:${request.task_id}`;
    const existingRunId = this.state.claims_by_tuple[tuple];
    if (existingRunId) {
      this.state.idempotency_keys[idempotencyKey] = { fingerprint, run_id: existingRunId };
      this.saveState();
      return {
        created: false,
        response: this.claimResponse(this.state.runs[existingRunId], 'already_claimed'),
      };
    }

    const maxConcurrent = participant.registration.capabilities.max_concurrent_runs || 1;
    const activeCount = Object.values(this.state.runs).filter(
      (run) =>
        run.participant_id === request.participant_id &&
        ['claimed', 'submitted', 'needs_review'].includes(run.state)
    ).length;
    if (activeCount >= maxConcurrent) {
      throw new ProtocolError('Participant concurrency limit reached', {
        status: 429,
        code: 'concurrency_limit',
      });
    }

    const suffix = sha256(`${idempotencyKey}:${fingerprint}`).slice(0, 12);
    const runId = `run-${request.task_id}-${request.participant_id}-${suffix}`;
    if (!SAFE_RUN_ID.test(runId)) throw new Error(`Generated unsafe run id: ${runId}`);
    const run = {
      run_id: runId,
      participant_id: request.participant_id,
      round_id: request.round_id,
      task_id: request.task_id,
      mode: 'source_only',
      state: 'claimed',
      validation: 'pending',
      judge: 'pending',
      scoreboard: 'not_published',
      claimed_at: nowIso(),
      errors: [],
    };
    this.state.runs[runId] = run;
    this.state.claims_by_tuple[tuple] = runId;
    this.state.idempotency_keys[idempotencyKey] = { fingerprint, run_id: runId };
    this.saveState();
    return { created: true, response: this.claimResponse(run, 'claim_response') };
  }

  runDirectory(run) {
    return path.join(this.dataDir, 'rounds', run.round_id, run.run_id);
  }

  scoreboardPath(roundId) {
    return path.join(this.dataDir, 'rounds', roundId, 'scoreboard.json');
  }

  statusResponse(run) {
    const response = {
      schema_version: 1,
      run_id: run.run_id,
      participant_id: run.participant_id,
      task_id: run.task_id,
      state: run.state,
      validation: run.validation,
      judge: run.judge,
      scoreboard: run.scoreboard,
    };
    if (run.errors && run.errors.length > 0) response.errors = [...run.errors];
    assertValid(this.validators, 'run_status', response, { output: true });
    return response;
  }

  getStatus(runId) {
    this.refreshState();
    if (!SAFE_RUN_ID.test(runId)) {
      throw new ProtocolError('Invalid run id', { status: 400, code: 'invalid_id' });
    }
    const run = this.state.runs[runId];
    if (!run) throw new ProtocolError('Run not found', { status: 404, code: 'not_found' });
    return this.statusResponse(run);
  }

  validateSubmission(run, submission) {
    assertValid(this.validators, 'artifact_submission', submission);
    if (!submission.trace || !submission.evidence_bundle) {
      throw new ProtocolError('trace and evidence_bundle are required by the real server', {
        status: 422,
        code: 'required_artifacts_missing',
      });
    }
    assertValid(this.validators, 'result_packet', submission.result_packet);
    assertValid(this.validators, 'trace', submission.trace);
    assertValid(this.validators, 'evidence_bundle', submission.evidence_bundle);

    const resultPacket = submission.result_packet;
    const trace = submission.trace;
    const evidence = submission.evidence_bundle;
    const mismatches = [];
    if (submission.status !== resultPacket.status) mismatches.push('status');
    if (resultPacket.agent_id !== run.participant_id) mismatches.push('result_packet.agent_id');
    if (resultPacket.task_id !== run.task_id) mismatches.push('result_packet.task_id');
    if (trace.agent_id !== run.participant_id) mismatches.push('trace.agent_id');
    if (trace.run_id !== run.run_id) mismatches.push('trace.run_id');
    if (evidence.agent_id && evidence.agent_id !== run.participant_id) {
      mismatches.push('evidence_bundle.agent_id');
    }
    if (evidence.run_id !== run.run_id) mismatches.push('evidence_bundle.run_id');
    const comparable = resultPacket.comparable_metadata || {};
    if (
      comparable.participant &&
      comparable.participant.agent_id &&
      comparable.participant.agent_id !== run.participant_id
    ) {
      mismatches.push('result_packet.comparable_metadata.participant.agent_id');
    }
    if (comparable.task && comparable.task.task_id && comparable.task.task_id !== run.task_id) {
      mismatches.push('result_packet.comparable_metadata.task.task_id');
    }
    if (comparable.task && comparable.task.oracle_ref) {
      mismatches.push('result_packet.comparable_metadata.task.oracle_ref');
    }
    if (mismatches.length > 0) {
      throw new ProtocolError('Submission does not match the claimed run', {
        status: 422,
        code: 'claim_submission_mismatch',
        details: mismatches,
      });
    }

    const paths = new Set();
    for (const entry of submission.artifact_manifest) {
      if (!REQUIRED_ARTIFACT_PATHS.has(entry.path)) {
        throw new ProtocolError(`Unsupported artifact path: ${entry.path}`, {
          status: 422,
          code: 'unsafe_artifact_path',
        });
      }
      if (paths.has(entry.path)) {
        throw new ProtocolError(`Duplicate artifact path: ${entry.path}`, {
          status: 422,
          code: 'duplicate_artifact_path',
        });
      }
      paths.add(entry.path);
    }
    for (const required of REQUIRED_ARTIFACT_PATHS) {
      if (!paths.has(required)) {
        throw new ProtocolError(`Required artifact is missing from manifest: ${required}`, {
          status: 422,
          code: 'required_artifacts_missing',
        });
      }
    }

    const secretMatches = scanForSecretValues(submission);
    if (secretMatches.length > 0) {
      throw new ProtocolError('Submission matched a secret-value pattern', {
        status: 422,
        code: 'secret_value_rejected',
      });
    }
  }

  buildRunManifest(run, runDir, status) {
    const task = this.taskFor(run.round_id, run.task_id);
    const createdAt = run.claimed_at;
    const manifest = {
      schema_version: 1,
      manifest_id: `am-${run.run_id}`,
      run_id: run.run_id,
      round_id: run.round_id,
      task_id: run.task_id,
      agent_id: run.participant_id,
      status,
      status_history: [
        { status: 'pending', timestamp: createdAt, note: 'Claim persisted by participant server' },
        {
          status,
          timestamp: nowIso(),
          note: 'Submitted artifacts validated by participant server',
        },
      ],
      created_at: createdAt,
      updated_at: nowIso(),
      artifacts: [
        artifactEntry('result-packet.yaml', runDir, 'result_packet'),
        artifactEntry('trace.yaml', runDir, 'trace'),
        artifactEntry('evidence-bundle.yaml', runDir, 'evidence_bundle'),
        artifactEntry('task-envelope.yaml', runDir, 'fixture_copy', 'runner'),
      ],
      retention_policy: {
        default_retention: 'round',
        cleanup_after_days: 30,
        scrubbing_required: true,
      },
      run_metadata: {
        runner: 'participant-server',
        runner_version: '1',
        participant_transport: 'http_json',
        execution_mode: 'source_only',
        task_envelope_ref: task.taskEnvelopeRef,
      },
    };
    assertValid(this.validators, 'artifact_manifest', manifest, { output: true });
    return manifest;
  }

  validatePersistedArtifacts(runDir) {
    for (const file of ['result-packet.yaml', 'trace.yaml', 'evidence-bundle.yaml']) {
      runChild(
        'artifact validation',
        [path.join(this.root, 'scripts', 'validate.js'), path.join(runDir, file)],
        {
          cwd: this.root,
        }
      );
    }
  }

  scoreRound(resultsDir, expectedRunId) {
    runChild(
      'judge/scoreboard pipeline',
      [path.join(this.root, 'scripts', 'score.js'), 'run', resultsDir],
      {
        cwd: this.root,
        timeout: 120_000,
      }
    );
    const scoreboardPath = path.join(resultsDir, 'scoreboard.json');
    const scoreboard = JSON.parse(fs.readFileSync(scoreboardPath, 'utf8'));
    assertValid(this.validators, 'scoreboard', scoreboard, { output: true });
    const entry = scoreboard.entries.find((item) => item.run_id === expectedRunId);
    if (!entry) {
      throw new ProtocolError('Scoreboard did not contain the submitted run', {
        status: 500,
        code: 'pipeline_failed',
      });
    }
    if (!entry.schema_validation.valid || !entry.semantic_checks.passed) {
      throw new ProtocolError('Scoreboard rejected the submitted result packet', {
        status: 422,
        code: 'scoreboard_validation_rejected',
      });
    }
    return scoreboard;
  }

  submit(runId, submission) {
    return this.withStateLock(() => this.submitUnlocked(runId, submission));
  }

  submitUnlocked(runId, submission) {
    if (!SAFE_RUN_ID.test(runId)) {
      throw new ProtocolError('Invalid run id', { status: 400, code: 'invalid_id' });
    }
    const run = this.state.runs[runId];
    if (!run) throw new ProtocolError('Run not found', { status: 404, code: 'not_found' });
    const submissionHash = sha256(canonicalJson(submission));
    if (run.state === 'accepted') {
      if (run.submission_sha256 !== submissionHash) {
        throw new ProtocolError('Accepted run artifacts are immutable', {
          status: 409,
          code: 'accepted_run_immutable',
        });
      }
      return { accepted: false, response: this.statusResponse(run) };
    }

    try {
      this.validateSubmission(run, submission);
    } catch (error) {
      if (error instanceof ProtocolError) {
        run.state = 'rejected';
        run.validation = 'rejected';
        run.judge = 'pending';
        run.scoreboard = 'not_published';
        run.errors = [error.code];
        run.updated_at = nowIso();
        this.saveState();
      }
      throw error;
    }

    run.state = 'submitted';
    run.validation = 'pending';
    run.judge = 'pending';
    run.scoreboard = 'not_published';
    run.submission_sha256 = submissionHash;
    run.submitted_at = nowIso();
    run.errors = [];
    this.saveState();

    const stagingRoot = fs.mkdtempSync(path.join(this.dataDir, 'staging', `${runId}-`));
    const stagingRun = path.join(stagingRoot, runId);
    fs.mkdirSync(stagingRun, { mode: 0o700 });
    const finalRoundDir = path.join(this.dataDir, 'rounds', run.round_id);
    const finalRunDir = this.runDirectory(run);
    fs.mkdirSync(finalRoundDir, { recursive: true, mode: 0o700 });
    let moved = false;
    let previousScoreboard = null;
    const finalScoreboardPath = this.scoreboardPath(run.round_id);

    try {
      if (fs.existsSync(finalRunDir)) {
        throw new ProtocolError('Run directory already exists and requires operator review', {
          status: 409,
          code: 'run_directory_conflict',
        });
      }
      writeYaml(path.join(stagingRun, 'result-packet.yaml'), submission.result_packet);
      writeYaml(path.join(stagingRun, 'trace.yaml'), submission.trace);
      writeYaml(path.join(stagingRun, 'evidence-bundle.yaml'), submission.evidence_bundle);
      writeYaml(
        path.join(stagingRun, 'task-envelope.yaml'),
        this.taskFor(run.round_id, run.task_id).envelope
      );

      const manifest = this.buildRunManifest(
        run,
        stagingRun,
        submission.status === 'completed' ? 'completed' : 'failed'
      );
      writeYaml(path.join(stagingRun, 'manifest.yaml'), manifest);
      this.validatePersistedArtifacts(stagingRun);
      this.scoreRound(stagingRoot, runId);

      const judgePath = path.join(stagingRun, 'result-packet-auto-judge.yaml');
      const judgeRecord = yaml.load(fs.readFileSync(judgePath, 'utf8'));
      assertValid(this.validators, 'judge_record', judgeRecord, { output: true });
      manifest.status = 'scored';
      manifest.updated_at = nowIso();
      manifest.status_history.push({
        status: 'scored',
        timestamp: manifest.updated_at,
        note: 'Existing judge/scoreboard pipeline completed',
      });
      manifest.artifacts.push(
        artifactEntry('result-packet-auto-judge.yaml', stagingRun, 'judge_record', 'judge')
      );
      assertValid(this.validators, 'artifact_manifest', manifest, { output: true });
      writeYaml(path.join(stagingRun, 'manifest.yaml'), manifest);

      if (fs.existsSync(finalScoreboardPath)) {
        previousScoreboard = fs.readFileSync(finalScoreboardPath);
      }
      fs.renameSync(stagingRun, finalRunDir);
      moved = true;
      this.scoreRound(finalRoundDir, runId);

      run.state = 'accepted';
      run.validation = 'accepted';
      run.judge = 'scored';
      run.scoreboard = 'published';
      run.accepted_at = nowIso();
      run.updated_at = run.accepted_at;
      run.errors = [];
      this.saveState();
      return { accepted: true, response: this.statusResponse(run) };
    } catch (error) {
      if (moved && fs.existsSync(finalRunDir))
        fs.rmSync(finalRunDir, { recursive: true, force: true });
      if (previousScoreboard) {
        fs.writeFileSync(finalScoreboardPath, previousScoreboard, { mode: 0o600 });
      } else if (fs.existsSync(finalScoreboardPath)) {
        fs.rmSync(finalScoreboardPath, { force: true });
      }
      run.state =
        error instanceof ProtocolError && error.status < 500 ? 'rejected' : 'needs_review';
      run.validation = run.state === 'rejected' ? 'rejected' : 'pending';
      run.judge = 'pending';
      run.scoreboard = 'not_published';
      run.errors = [error instanceof ProtocolError ? error.code : 'pipeline_failed'];
      run.updated_at = nowIso();
      this.saveState();
      throw error;
    } finally {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  }
}

function sendJson(response, status, document) {
  const body = `${JSON.stringify(document)}\n`;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function readJsonBody(request, maxBodyBytes) {
  return new Promise((resolve, reject) => {
    const contentType = String(request.headers['content-type'] || '')
      .split(';')[0]
      .trim();
    if (contentType !== 'application/json') {
      reject(
        new ProtocolError('Content-Type must be application/json', {
          status: 415,
          code: 'unsupported_media_type',
        })
      );
      return;
    }
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    request.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBodyBytes) {
        tooLarge = true;
        chunks.length = 0;
        reject(
          new ProtocolError('Request body exceeds the configured limit', {
            status: 413,
            code: 'payload_too_large',
          })
        );
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ProtocolError('Malformed JSON body', { status: 400, code: 'malformed_json' }));
      }
    });
    request.on('error', (error) => reject(error));
  });
}

function createParticipantHttpServer(broker, { maxBodyBytes = DEFAULT_MAX_BODY_BYTES } = {}) {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const pathname = url.pathname;
      let match;

      if (request.method === 'POST' && pathname === '/participants') {
        const body = await readJsonBody(request, maxBodyBytes);
        const result = broker.register(body);
        sendJson(response, result.created ? 201 : 200, result.response);
        return;
      }
      match = pathname.match(/^\/participants\/([a-z0-9][a-z0-9-]*)\/eligible-runs$/);
      if (request.method === 'GET' && match) {
        sendJson(response, 200, broker.eligibleRuns(match[1]));
        return;
      }
      if (request.method === 'POST' && pathname === '/runs') {
        const body = await readJsonBody(request, maxBodyBytes);
        const result = broker.claim(String(request.headers['idempotency-key'] || ''), body);
        sendJson(response, result.created ? 201 : 200, result.response);
        return;
      }
      match = pathname.match(/^\/runs\/(run-[a-z0-9][a-z0-9-]*)\/artifacts$/);
      if (request.method === 'POST' && match) {
        const body = await readJsonBody(request, maxBodyBytes);
        const result = broker.submit(match[1], body);
        sendJson(response, result.accepted ? 202 : 200, result.response);
        return;
      }
      match = pathname.match(/^\/runs\/(run-[a-z0-9][a-z0-9-]*)\/status$/);
      if (request.method === 'GET' && match) {
        sendJson(response, 200, broker.getStatus(match[1]));
        return;
      }
      throw new ProtocolError('Route not found', { status: 404, code: 'not_found' });
    } catch (error) {
      if (error instanceof ProtocolError) {
        const body = { error: error.code, message: error.message };
        if (error.status < 500 && error.details.length > 0) body.details = error.details;
        sendJson(response, error.status, body);
        return;
      }
      sendJson(response, 500, { error: 'internal_error', message: 'Internal server error' });
    }
  });
}

function listenParticipantServer({ broker, host = '127.0.0.1', port = 0, maxBodyBytes } = {}) {
  if (!broker) throw new Error('broker is required');
  if (!isLoopbackHost(host)) {
    throw new ProtocolError('The source server may bind only to a loopback address', {
      status: 400,
      code: 'non_loopback_forbidden',
    });
  }
  const server = createParticipantHttpServer(broker, { maxBodyBytes });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      const address = server.address();
      resolve({
        server,
        host,
        port: address.port,
        baseUrl: `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`,
        close: () =>
          new Promise((done, fail) => {
            if (!server.listening) {
              done();
              return;
            }
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}

function parseArgs(argv) {
  const args = { command: argv[0] || '', rounds: [] };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];
    if (token === '--round') {
      args.rounds.push(value);
      index += 1;
    } else if (token.startsWith('--')) {
      args[token.slice(2).replace(/-/g, '_')] = value;
      index += 1;
    } else {
      throw new Error(`Unexpected argument: ${token}`);
    }
  }
  return args;
}

function usage() {
  console.log(`Usage:
  node scripts/participant-server.js serve --data-dir <path> --round <manifest> [--round <manifest>] [--host 127.0.0.1] [--port 8787]
  node scripts/participant-server.js review --data-dir <path> --participant <id> --status reviewed --approval-ref <ref>
  node scripts/participant-server.js review --data-dir <path> --participant <id> --status revoked

The source implementation binds loopback only. Production deployment, authentication,
restarts, provider sends, DB/ACK/replay operations, and non-loopback exposure remain
separately approval-gated.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!['serve', 'review'].includes(args.command)) {
    usage();
    process.exit(args.command ? 1 : 0);
  }
  if (!args.data_dir) throw new Error('--data-dir is required');

  if (args.command === 'review') {
    if (!args.participant) throw new Error('--participant is required');
    const broker = new PersistentParticipantBroker({ dataDir: args.data_dir });
    const result = broker.reviewParticipant(args.participant, {
      status: args.status || 'reviewed',
      approvalRef: args.approval_ref,
    });
    console.log(JSON.stringify(result));
    return;
  }

  if (args.rounds.length === 0) throw new Error('At least one --round is required');
  const host = args.host || '127.0.0.1';
  const port = args.port === undefined ? 8787 : Number(args.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid --port');
  const broker = new PersistentParticipantBroker({
    dataDir: args.data_dir,
    roundManifestPaths: args.rounds,
  });
  const listening = await listenParticipantServer({ broker, host, port });
  console.log(`participant_server=ready host=${listening.host} port=${listening.port}`);

  const shutdown = () => {
    listening.server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = {
  ProtocolError,
  PersistentParticipantBroker,
  buildValidators,
  createParticipantHttpServer,
  listenParticipantServer,
  canonicalJson,
  sanitizeTaskEnvelope,
  sha256,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`participant_server_error=${error.message}`);
    process.exit(1);
  });
}
