#!/usr/bin/env node
/**
 * Agent Olympics Season 001 Live Runner (local_exec transport)
 *
 * Implements the Minimum Live Runner Contract from
 * docs/live-runner-boundary-season-001.md for the local_exec transport:
 *
 *   1. Dispatch            — selects participants from a round manifest,
 *                            creates isolated run directories (round.js
 *                            conventions), writes dispatch records.
 *   2. Credential injection— by reference only. Records credential class,
 *                            approver, participant read permission, and
 *                            value-free redaction rules. Never reads values.
 *   3. Timeout/cancel      — enforces the envelope/task time limit on the
 *                            spawned transport, supports SIGINT cancellation,
 *                            maps outcomes to standard packet statuses.
 *   4. Artifact capture    — verifies presence (or explained absence) of the
 *                            run-directory artifacts; writes a capture report.
 *   5. Result fan-in       — schema validation, identity consistency,
 *                            oracle-reference / secret / evidence-reference
 *                            checks; rejects go to quarantine/ with a reason.
 *   6. Safety redaction    — captured transport stdout/stderr is redacted
 *                            with the shared secret patterns before being
 *                            written; redaction metadata is value-free.
 *   7. Judge handoff       — assembles judge-handoff/ per clean run with the
 *                            validated packet, trace + evidence bundle,
 *                            rubric reference, PUBLIC envelope fields only,
 *                            run metadata, and the redaction report.
 *   8. Lifecycle gates     — schema validation before any dispatch, stub
 *                            smoke per task envelope, operator approval +
 *                            readiness (live-runner-readiness.js) before any
 *                            live dispatch, artifact validation before
 *                            handoff, redaction check on the handoff package.
 *
 * The only implemented transport is local_exec: an argv array spawned
 * directly (never through a shell). Live A2A/network transports remain an
 * operator configuration/extension point — this script contains no network
 * code and never reads credential values.
 *
 * Usage:
 *   node scripts/live-runner.js run      <round-manifest> --config <runner-config> [options]
 *   node scripts/live-runner.js dispatch <round-manifest> --config <runner-config> [options]
 *   node scripts/live-runner.js fanin    <round-runs-dir>
 *   node scripts/live-runner.js failure-report <round-runs-dir>
 *   node scripts/live-runner.js fixtures
 *
 * Options:
 *   --config <file>         Runner config YAML (required for run/dispatch)
 *   --run-directory <dir>   Override the run directory (config/manifest default)
 *   --run-id <substr>       Dispatch only runs whose run id contains <substr>
 *   --dry-run-only          Skip live-profile participants entirely
 *   --allow-runtime-mismatch  Downgrade the runtime_identity gate to a warning
 *   --verbose, -v           Verbose output
 *   --help, -h              Show usage
 *
 * Exit codes:
 *   0  success
 *   1  validation or runtime error
 *   2  lifecycle/approval gate refused dispatch
 *   130 cancelled by operator (SIGINT)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const os = require('os');
const yaml = require('js-yaml');
const {
  SECRET_KEY_PATTERNS,
  SECRET_VALUE_PATTERNS,
  looksLikeSecretValue,
} = require('./lib/secret-patterns');
const { fingerprintRuntime } = require('./lib/runtime-fingerprint');
const {
  FAILURE_CATEGORIES,
  categorizeReasons,
  categorizeWarnings,
} = require('./lib/failure-taxonomy');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_RUN_ID_TEMPLATE = 'run-{task_id}-{agent_id}-{timestamp}';
const RUNNER_VERSION = '1.0.0';
const RUNNER_CONFIG_KIND = 'agent-olympics.live-runner.config';
const TIMEOUT_KILL_GRACE_MS = 2000;
const ATTESTATION_TIMEOUT_MS = 10000;
const ATTESTATION_EXCERPT_CHARS = 200;

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_GATE_BLOCKED = 2;
const EXIT_CANCELLED = 130;

// Allowed placeholders inside command argv elements (no shell interpolation —
// each argv element is substituted independently and passed to spawn()).
const COMMAND_PLACEHOLDERS = new Set([
  'envelope', 'run_dir', 'agent_id', 'run_id', 'task_id', 'round_id',
  'time_limit_minutes', 'seed',
]);

// Envelope fields that are judge-only and must never reach participants or
// participant-facing artifacts (v1 inline notes + v2 private references).
// v1_compat is migration metadata whose notes quote the private oracle and
// judge-notes paths, so it is stripped from the participant copy as well.
const ENVELOPE_PRIVATE_FIELDS = ['hidden_judge_notes', 'judge_notes_ref', 'oracle_ref', 'v1_compat'];

// Value-free runner redaction rules, kept in sync with the shared
// SECRET_VALUE_PATTERNS list (same order). Descriptions never include values.
// Reason strings are value-free AND deliberately avoid substrings that match
// the secret value patterns themselves (e.g. "github_pat_...").
const VALUE_RULE_META = [
  { id: 'rv-openai-style-key', reason: 'openai_style_api_key_in_transport_output' },
  { id: 'rv-github-pat', reason: 'gh_legacy_personal_access_token_in_transport_output' },
  { id: 'rv-github-pat-org', reason: 'gh_org_personal_access_token_in_transport_output' },
  { id: 'rv-github-finegrained-pat', reason: 'gh_finegrained_personal_access_token_in_transport_output' },
  { id: 'rv-slack-token', reason: 'slack_token_in_transport_output' },
  { id: 'rv-pem-private-key', reason: 'pem_private_key_in_transport_output' },
  { id: 'rv-jwt', reason: 'jwt_in_transport_output' },
];
const RUNNER_REDACTION_RULES = SECRET_VALUE_PATTERNS.map((pattern, i) => ({
  rule_id: (VALUE_RULE_META[i] || { id: `rv-${i}` }).id,
  reason: (VALUE_RULE_META[i] || { reason: 'secret_value_in_transport_output' }).reason,
  pattern: new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'),
}));
const KEY_REDACTION_RULE = {
  rule_id: 'rk-secret-named-field',
  reason: 'secret_named_field_value_in_transport_output',
};

// Self-check: redaction metadata must never itself look like a secret.
for (const { rule_id, reason } of RUNNER_REDACTION_RULES) {
  for (const pattern of SECRET_VALUE_PATTERNS) {
    if (pattern.test(rule_id) || pattern.test(reason)) {
      throw new Error(`Redaction rule metadata matches a secret pattern: ${rule_id}/${reason}`);
    }
  }
}

// Oracle / hidden-judge-material reference patterns that must not appear in
// participant-facing artifacts.
const ORACLE_REFERENCE_PATTERNS = [
  { id: 'oracle-path', pattern: /\boracle\// },
  { id: 'oracle-ref-field', pattern: /\boracle_ref\b/ },
  { id: 'hidden-judge-notes-field', pattern: /\bhidden_judge_notes\b/ },
];

class RunnerError extends Error {}
class GateError extends Error {}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function repoPath(relPath) {
  const resolved = path.resolve(ROOT, relPath);
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) {
    throw new RunnerError(`Path escapes repository root: ${relPath}`);
  }
  return resolved;
}

function loadYamlFile(filePath) {
  const resolved = path.isAbsolute(filePath) ? filePath : repoPath(filePath);
  if (!fs.existsSync(resolved)) {
    throw new RunnerError(`File not found: ${filePath}`);
  }
  return yaml.load(fs.readFileSync(resolved, 'utf8'));
}

function writeYamlFile(filePath, doc) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, yaml.dump(doc, { indent: 2, lineWidth: 120, noRefs: true }), 'utf8');
}

function isoNow() {
  return new Date().toISOString();
}

function generateTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}UTC`;
}

/** Render a run id with round.js's template convention. */
function renderRunId(manifest, task, participant, timestamp) {
  const template = manifest.run_id_template || DEFAULT_RUN_ID_TEMPLATE;
  const values = {
    task_id: task.task_id,
    agent_id: participant.agent_id,
    timestamp,
    round_id: manifest.round_id,
    season: manifest.season,
  };
  return template.replace(/\{([^{}]+)\}/g, (match, key) => (values[key] !== undefined ? values[key] : match));
}

function gitSourceRevision() {
  try {
    const cp = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
    if (cp.status === 0 && cp.stdout) return cp.stdout.trim();
  } catch { /* fall through */ }
  return null;
}

function spawnValidate(filePath) {
  const cp = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'validate.js'), filePath],
    { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', timeout: 60000 }
  );
  return {
    ok: cp.status === 0,
    output: `${cp.stdout || ''}${cp.stderr || ''}`.trim(),
  };
}

// ---------------------------------------------------------------------------
// Secret / oracle scanning helpers
// ---------------------------------------------------------------------------

function scanTextForSecrets(text) {
  const hits = [];
  for (const rule of RUNNER_REDACTION_RULES) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(String(text))) hits.push(rule.rule_id);
  }
  return hits;
}

/** Walk an object for secret-named keys carrying credential-looking values. */
function scanObjectForSecretFields(value, pathParts = []) {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, i) => findings.push(...scanObjectForSecretFields(entry, [...pathParts, String(i)])));
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_KEY_PATTERNS.some((p) => p.test(key)) && looksLikeSecretValue(entry)) {
        findings.push([...pathParts, key].join('.'));
      }
      findings.push(...scanObjectForSecretFields(entry, [...pathParts, key]));
    }
  } else if (typeof value === 'string' && scanTextForSecrets(value).length > 0) {
    findings.push(pathParts.join('.') || '(root)');
  }
  return findings;
}

function scanTextForOracleReferences(text) {
  return ORACLE_REFERENCE_PATTERNS
    .filter(({ pattern }) => pattern.test(String(text)))
    .map(({ id }) => id);
}

// ---------------------------------------------------------------------------
// Redaction (contract §6)
// ---------------------------------------------------------------------------

/**
 * Redact secret values from captured text. Returns { text, appliedRules }.
 * appliedRules entries are value-free: { rule_id, reason, match_count }.
 */
function redactText(rawText) {
  let text = String(rawText);
  const appliedRules = [];

  for (const rule of RUNNER_REDACTION_RULES) {
    rule.pattern.lastIndex = 0;
    let count = 0;
    text = text.replace(rule.pattern, () => {
      count += 1;
      return `[REDACTED:${rule.rule_id}]`;
    });
    if (count > 0) appliedRules.push({ rule_id: rule.rule_id, reason: rule.reason, match_count: count });
  }

  // Key-named fields ("api_key: <value>", "TOKEN=<value>") with
  // credential-looking values.
  let keyCount = 0;
  text = text.replace(/^(\s*"?([A-Za-z0-9_-]+)"?\s*[:=]\s*)(\S.*)$/gm, (line, prefix, key, value) => {
    if (SECRET_KEY_PATTERNS.some((p) => p.test(key)) && looksLikeSecretValue(value.trim())) {
      keyCount += 1;
      return `${prefix}[REDACTED:${KEY_REDACTION_RULE.rule_id}]`;
    }
    return line;
  });
  if (keyCount > 0) {
    appliedRules.push({ rule_id: KEY_REDACTION_RULE.rule_id, reason: KEY_REDACTION_RULE.reason, match_count: keyCount });
  }

  return { text, appliedRules };
}

// ---------------------------------------------------------------------------
// Runner config loading + validation
// ---------------------------------------------------------------------------

function loadRunnerConfigSchemaValidator() {
  try {
    const Ajv = require('ajv/dist/2020');
    const addFormats = require('ajv-formats');
    const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'runner-config.schema.json'), 'utf8'));
    const ajv = new Ajv({ allErrors: true });
    addFormats(ajv);
    return ajv.compile(schema);
  } catch (err) {
    return null; // hand-rolled checks below still run
  }
}

function validateRunnerConfig(config, configPath) {
  const errors = [];
  if (!config || typeof config !== 'object') {
    throw new RunnerError(`Runner config is empty or not a YAML mapping: ${configPath}`);
  }

  const schemaValidator = loadRunnerConfigSchemaValidator();
  if (schemaValidator && !schemaValidator(config)) {
    for (const err of schemaValidator.errors || []) {
      errors.push(`schema: ${err.instancePath || '(root)'} ${err.message}`);
    }
  }

  if (config.config_kind !== RUNNER_CONFIG_KIND) {
    errors.push(`config_kind must be ${RUNNER_CONFIG_KIND}`);
  }

  // No credential values anywhere in the config.
  const secretFields = scanObjectForSecretFields(config);
  if (secretFields.length > 0) {
    errors.push(`credential-looking value detected at: ${secretFields.join(', ')} — credentials must be referenced by class/handle only`);
  }

  for (const [i, p] of (config.participants || []).entries()) {
    const label = `participants[${i}]${p && p.participant_id ? ` (${p.participant_id})` : ''}`;
    if (!p || typeof p !== 'object') { errors.push(`${label}: not a mapping`); continue; }
    if (p.transport !== 'local_exec') {
      errors.push(`${label}: transport "${p.transport}" is not implemented — only local_exec is available in this repository`);
    }
    const validateArgv = (fieldName, argv) => {
      if (!Array.isArray(argv) || argv.length === 0 || argv.some((a) => typeof a !== 'string')) {
        errors.push(`${label}: ${fieldName} must be a non-empty argv array of strings (no shell strings)`);
        return;
      }
      for (const arg of argv) {
        for (const m of arg.matchAll(/\{([^{}]+)\}/g)) {
          if (!COMMAND_PLACEHOLDERS.has(m[1])) {
            errors.push(`${label}: unknown ${fieldName} placeholder {${m[1]}} (allowed: ${[...COMMAND_PLACEHOLDERS].join(', ')})`);
          }
        }
        if (/[;&|<>`$]/.test(arg.replace(/\{[^{}]+\}/g, ''))) {
          errors.push(`${label}: ${fieldName} argument "${arg}" contains shell metacharacters — argv elements are never shell-interpreted, remove them`);
        }
      }
    };
    validateArgv('command', p.command);
    if (p.identify_command !== undefined) {
      validateArgv('identify_command', p.identify_command);
    }
    if (p.execution_profile === 'live') {
      const creds = p.credentials || {};
      if (creds.handling !== 'reference_only') {
        errors.push(`${label}: live profile requires credentials.handling: reference_only`);
      }
      if (!creds.credential_class || creds.credential_class === 'none') {
        errors.push(`${label}: live profile requires a credential_class (by reference)`);
      }
      if (!creds.ref) {
        errors.push(`${label}: live profile requires credentials.ref (path/handle reference, never a value)`);
      }
      if (!p.readiness_declaration) {
        errors.push(`${label}: live profile requires readiness_declaration (live-runner-readiness input)`);
      }
      // Approval may legitimately be absent — that is a GATE failure at
      // dispatch time, not a config-shape error (the blocked fixture relies
      // on a well-formed config that fails the approval gate).
    } else if (p.execution_profile === 'dry_run') {
      if (p.credentials && p.credentials.credential_class && p.credentials.credential_class !== 'none') {
        errors.push(`${label}: dry_run profile must not declare a credential class (use 'none' or omit credentials)`);
      }
    } else {
      errors.push(`${label}: execution_profile must be dry_run or live`);
    }
  }

  if (errors.length > 0) {
    throw new RunnerError(`Runner config invalid (${configPath}):\n  - ${errors.join('\n  - ')}`);
  }
  return config;
}

// ---------------------------------------------------------------------------
// Lifecycle gates (contract §8)
// ---------------------------------------------------------------------------

/** Gate: round manifest must pass schema validation before any dispatch. */
function gateSchemaValidation(manifestPath, gates) {
  const result = spawnValidate(path.isAbsolute(manifestPath) ? manifestPath : repoPath(manifestPath));
  gates.push({
    gate: 'schema_validation',
    target: manifestPath,
    status: result.ok ? 'pass' : 'fail',
    detail: result.ok ? 'round manifest passed schema validation' : result.output.slice(0, 600),
  });
  if (!result.ok) {
    throw new GateError(`GATE schema_validation failed for ${manifestPath}:\n${result.output}`);
  }
}

/** Gate: stub smoke per distinct task envelope before dispatch. */
function gateStubSmoke(tasks, gates, verbose) {
  const envelopes = [...new Set(tasks.map((t) => t.envelope_path))];
  for (const envelopePath of envelopes) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'live-runner-smoke-'));
    let ok = false;
    let detail = '';
    try {
      const cp = spawnSync(
        process.execPath,
        [
          path.join(ROOT, 'scripts', 'stub-adapter.js'),
          repoPath(envelopePath),
          '--run-dir', tmp,
          '--agent-id', 'live-runner-smoke',
          '--runtime', 'cli',
          '--seed', 'live-runner-smoke',
        ],
        { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', timeout: 60000 }
      );
      ok = cp.status === 0 && fs.existsSync(path.join(tmp, 'result-packet.yaml'));
      detail = ok
        ? 'stub adapter produced a result packet for this envelope'
        : `stub smoke failed (exit ${cp.status}): ${`${cp.stdout || ''}${cp.stderr || ''}`.slice(0, 400)}`;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    gates.push({ gate: 'stub_smoke', target: envelopePath, status: ok ? 'pass' : 'fail', detail });
    if (verbose) console.log(`  gate stub_smoke ${envelopePath}: ${ok ? 'pass' : 'FAIL'}`);
    if (!ok) {
      throw new GateError(`GATE stub_smoke failed for envelope ${envelopePath} — fix the task fixture before dispatch.`);
    }
  }
}

/**
 * Gates for a live-profile participant: operator approval must be present in
 * the config AND the readiness declaration must evaluate to decision 'ready'
 * via scripts/live-runner-readiness.js. Returns { ok, failures }.
 */
function gateLiveParticipant(participant, gates) {
  const failures = [];

  const approval = participant.approval || {};
  if (!approval.approver || !approval.approval_ref) {
    failures.push('operator approval is missing (approval.approver + approval.approval_ref are required for credential-bearing live dispatch)');
  }
  gates.push({
    gate: 'operator_approval',
    target: participant.participant_id,
    status: approval.approver && approval.approval_ref ? 'pass' : 'fail',
    detail: approval.approver
      ? `approved by ${approval.approver} (${approval.approval_ref})`
      : 'no approval recorded in runner config',
  });

  let readinessDetail = 'no readiness declaration';
  let readinessOk = false;
  if (participant.readiness_declaration) {
    const cp = spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'live-runner-readiness.js'), participant.readiness_declaration],
      { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', timeout: 30000 }
    );
    readinessOk = cp.status === 0; // 0 = decision ready; 2 = blocked; 1 = invalid
    const out = `${cp.stdout || ''}${cp.stderr || ''}`;
    const blockers = out.split('\n').filter((l) => /^\s+- /.test(l)).map((l) => l.trim());
    readinessDetail = readinessOk
      ? `readiness declaration ${participant.readiness_declaration} → ready`
      : `readiness declaration ${participant.readiness_declaration} → blocked${blockers.length > 0 ? `: ${blockers.join('; ')}` : ''}`;
  }
  if (!readinessOk) failures.push(readinessDetail);
  gates.push({
    gate: 'runner_readiness',
    target: participant.participant_id,
    status: readinessOk ? 'pass' : 'fail',
    detail: readinessDetail,
  });

  return { ok: failures.length === 0, failures };
}

/**
 * Gate: runtime declaration consistency (identity layer 1, deterministic).
 * The runner config `adapter` must match the round manifest participant's
 * `runtime` (case-insensitive). The manifest `runtime` is the authoritative
 * registration; the config adapter is what actually gets dispatched, so a
 * disagreement means the round would record a runtime it did not run.
 * `--allow-runtime-mismatch` downgrades the refusal to a recorded warning
 * (operator escape hatch, noted in the dispatch record).
 */
function gateRuntimeIdentity(participant, gates, allowMismatch) {
  const declaredRuntime = String(participant.manifest.runtime || '');
  const declaredAdapter = String(participant.config.adapter || '');
  const consistent = declaredRuntime.toLowerCase() === declaredAdapter.toLowerCase();

  let status = 'pass';
  let detail = `config adapter "${declaredAdapter}" matches manifest runtime "${declaredRuntime}"`;
  if (!consistent) {
    status = allowMismatch ? 'warn' : 'fail';
    detail = `config adapter "${declaredAdapter}" does not match manifest runtime "${declaredRuntime}" (manifest registration is authoritative)`
      + (allowMismatch ? ' — dispatched anyway via --allow-runtime-mismatch (recorded warning)' : '');
  }
  gates.push({ gate: 'runtime_identity', target: participant.config.participant_id, status, detail });
  return { consistent, allowed: consistent || allowMismatch, detail, declaredRuntime, declaredAdapter };
}

/**
 * Identity layer 2: optional runtime attestation probe. Runs the
 * participant's `identify_command` (argv, no shell) with a short timeout
 * before the main transport and records a value-free attestation block in
 * the dispatch record. `consistent` is a case-insensitive substring
 * heuristic: the probe output should mention the declared adapter name
 * (e.g. "Hermes Agent v0.16.0" contains "hermes"). Probes can be flaky, so
 * an inconsistent/failed probe is a recorded warning, never a refusal.
 */
function runRuntimeAttestation(participantConfig, substitutionValues) {
  if (!Array.isArray(participantConfig.identify_command) || participantConfig.identify_command.length === 0) {
    return { record: { command_ran: false }, warning: null };
  }
  const argv = substituteCommand(participantConfig.identify_command, substitutionValues);
  const declaredAdapter = String(participantConfig.adapter || '');
  let exitCode = null;
  let rawOutput = '';
  try {
    const cp = spawnSync(argv[0], argv.slice(1), {
      cwd: ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
      shell: false,
      timeout: ATTESTATION_TIMEOUT_MS,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG },
    });
    exitCode = cp.status;
    rawOutput = cp.stdout || '';
  } catch (err) {
    rawOutput = '';
  }
  // Redact before storing anything (value-free attestation record).
  const { text: redacted } = redactText(rawOutput);
  const consistent = exitCode === 0
    && redacted.toLowerCase().includes(declaredAdapter.toLowerCase());
  const record = {
    command_ran: true,
    exit_code: exitCode,
    output_excerpt: redacted.slice(0, ATTESTATION_EXCERPT_CHARS),
    declared_adapter: declaredAdapter,
    consistent,
  };
  const warning = consistent
    ? null
    : `runtime attestation probe ${exitCode === 0 ? 'output does not mention' : `failed (exit ${exitCode}) — could not confirm`} declared adapter "${declaredAdapter}"`;
  return { record, warning };
}

// ---------------------------------------------------------------------------
// Envelope sanitization (public fields only for participants + handoff)
// ---------------------------------------------------------------------------

function sanitizeEnvelope(envelope) {
  const publicEnvelope = JSON.parse(JSON.stringify(envelope));
  const stripped = [];
  for (const field of ENVELOPE_PRIVATE_FIELDS) {
    if (publicEnvelope[field] !== undefined) {
      delete publicEnvelope[field];
      stripped.push(field);
    }
  }
  return { publicEnvelope, stripped };
}

// ---------------------------------------------------------------------------
// Dispatch (contract §1–§3)
// ---------------------------------------------------------------------------

const cancelState = {
  cancelled: false,
  currentChild: null,
  handlerInstalled: false,
};

function installCancelHandler() {
  if (cancelState.handlerInstalled) return;
  cancelState.handlerInstalled = true;
  process.on('SIGINT', () => {
    if (cancelState.cancelled) process.exit(EXIT_CANCELLED); // second ^C: hard exit
    cancelState.cancelled = true;
    console.error('\nCancellation requested (SIGINT) — terminating active transport and finalizing runs...');
    if (cancelState.currentChild && !cancelState.currentChild.killed) {
      cancelState.currentChild.kill('SIGTERM');
      setTimeout(() => {
        if (cancelState.currentChild && cancelState.currentChild.exitCode === null) {
          cancelState.currentChild.kill('SIGKILL');
        }
      }, TIMEOUT_KILL_GRACE_MS).unref();
    }
  });
}

function substituteCommand(template, values) {
  return template.map((arg) => arg.replace(/\{([^{}]+)\}/g, (m, key) => (values[key] !== undefined ? String(values[key]) : m)));
}

/**
 * Spawn the transport command (argv array, no shell), enforce the time limit,
 * capture stdout/stderr, and resolve with the raw outcome.
 */
function spawnTransport(argv, runDirAbs, timeLimitMs, envExtra) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let child;
    const childEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LANG: process.env.LANG,
      ...envExtra,
    };
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd: ROOT,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    } catch (err) {
      resolve({ spawnError: err, stdout: '', stderr: '', exitCode: null, timedOut: false, cancelled: false, durationMs: 0 });
      return;
    }

    cancelState.currentChild = child;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnError = null;

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => { spawnError = err; });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, TIMEOUT_KILL_GRACE_MS).unref();
    }, timeLimitMs);

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      cancelState.currentChild = null;
      resolve({
        spawnError,
        stdout,
        stderr,
        exitCode: code,
        signal,
        timedOut,
        cancelled: cancelState.cancelled && !timedOut,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

function exitCodeToStatus(exitCode) {
  switch (exitCode) {
    case 0: return 'completed';
    case 1: return 'failed';
    case 2: return 'partial';
    default: return 'blocked';
  }
}

/** Is there a usable (parseable, status-bearing) result packet in the run dir? */
function packetUsable(runDirAbs) {
  const packetPath = path.join(runDirAbs, 'result-packet.yaml');
  if (!fs.existsSync(packetPath)) return false;
  try {
    const packet = yaml.load(fs.readFileSync(packetPath, 'utf8'));
    return !!(packet && packet.status && packet.summary !== undefined);
  } catch {
    return false;
  }
}

/**
 * Map the raw transport outcome to a standard packet status (contract §3):
 *   completed with required outputs        → completed
 *   timed out with usable partial output   → partial
 *   timed out without usable output        → failed
 *   missing credentials / unreachable      → blocked
 *   forbidden action / oracle leak / secret→ disqualified (escalated later)
 */
function mapOutcomeToStatus(outcome, runDirAbs) {
  if (outcome.spawnError) {
    return {
      status: 'blocked',
      note: `transport could not be spawned (${outcome.spawnError.code || outcome.spawnError.message}) — unreachable runtime`,
    };
  }
  if (outcome.timedOut || outcome.cancelled) {
    const cause = outcome.timedOut ? 'timed out at the enforced time limit' : 'cancelled by operator';
    if (packetUsable(runDirAbs)) {
      return { status: 'partial', note: `transport ${cause}; usable partial result packet present` };
    }
    return { status: 'failed', note: `transport ${cause}; no usable result packet` };
  }
  const status = exitCodeToStatus(outcome.exitCode);
  return { status, note: `transport exited with code ${outcome.exitCode} → ${status}` };
}

/** Run-manifest lifecycle helpers (round.js manifest.yaml conventions). */
function writeRunManifest(runDirAbs, runManifest) {
  fs.writeFileSync(path.join(runDirAbs, 'manifest.yaml'), yaml.dump(runManifest, { indent: 2, lineWidth: 120 }));
}

function isRunnerRunManifest(doc) {
  return !!(doc && doc.run_id && doc.lifecycle !== undefined && doc.manifest_id === undefined);
}

/**
 * Update the run-manifest lifecycle. If the adapter replaced manifest.yaml
 * with its artifact manifest, the lifecycle stays in the dispatch record and
 * the replacement is noted (the artifact manifest is preserved).
 */
function finalizeRunManifest(runDirAbs, runManifest, status, note) {
  runManifest.lifecycle = status;
  runManifest.updated_at = isoNow();
  runManifest.status_history = runManifest.status_history || [];
  runManifest.status_history.push({ status, timestamp: runManifest.updated_at, note });

  const manifestPath = path.join(runDirAbs, 'manifest.yaml');
  let onDisk = null;
  try { onDisk = yaml.load(fs.readFileSync(manifestPath, 'utf8')); } catch { /* missing/unparseable */ }
  if (onDisk && !isRunnerRunManifest(onDisk)) {
    // Adapter wrote its artifact manifest to manifest.yaml — keep it and
    // store the lifecycle manifest alongside it.
    fs.writeFileSync(path.join(runDirAbs, 'run-manifest.yaml'), yaml.dump(runManifest, { indent: 2, lineWidth: 120 }));
    return { manifestFile: 'run-manifest.yaml', artifactManifestPresent: true };
  }
  writeRunManifest(runDirAbs, runManifest);
  return { manifestFile: 'manifest.yaml', artifactManifestPresent: false };
}

// ---------------------------------------------------------------------------
// Artifact capture (contract §4)
// ---------------------------------------------------------------------------

function buildCaptureReport(runDirAbs, runId, status, statusNote, manifestInfo) {
  const expectation = (file) => fs.existsSync(path.join(runDirAbs, file));
  const absenceNote = `absent — run status "${status}": ${statusNote}`;

  const artifactManifestPath = manifestInfo.artifactManifestPresent ? 'manifest.yaml' : null;
  const artifacts = [
    {
      artifact: 'result_packet', path: 'result-packet.yaml', present: expectation('result-packet.yaml'),
      note: expectation('result-packet.yaml') ? 'emitted by participant transport' : absenceNote,
    },
    {
      artifact: 'trace_record', path: 'trace.yaml', present: expectation('trace.yaml'),
      note: expectation('trace.yaml') ? 'emitted by participant transport' : absenceNote,
    },
    {
      artifact: 'evidence_bundle', path: 'evidence-bundle.yaml', present: expectation('evidence-bundle.yaml'),
      note: expectation('evidence-bundle.yaml') ? 'emitted by participant transport' : absenceNote,
    },
    {
      artifact: 'artifact_manifest',
      path: artifactManifestPath,
      present: !!artifactManifestPath,
      note: artifactManifestPath
        ? 'adapter emitted an artifact manifest at manifest.yaml (runner lifecycle manifest moved to run-manifest.yaml)'
        : 'absent — this adapter does not emit an artifact manifest (run lifecycle manifest occupies manifest.yaml)',
    },
    {
      artifact: 'envelope_copy', path: 'envelope.yaml', present: expectation('envelope.yaml'),
      note: 'public-fields-only envelope copy written by the runner before dispatch',
    },
    {
      artifact: 'run_manifest', path: manifestInfo.manifestFile, present: expectation(manifestInfo.manifestFile),
      note: 'runner-maintained run lifecycle manifest (round.js convention)',
    },
    {
      artifact: 'run_metadata', path: 'run.yaml', present: expectation('run.yaml'),
      note: expectation('run.yaml') ? 'adapter run metadata' : absenceNote,
    },
    {
      artifact: 'adapter_stdout_stderr_summary', path: 'runner-transport.log', present: expectation('runner-transport.log'),
      note: 'captured by the runner from the transport stdout/stderr, redacted before writing (see redaction-report.yaml)',
    },
    {
      artifact: 'safe_logs', path: 'adapter.log', present: expectation('adapter.log'),
      note: expectation('adapter.log') ? 'adapter-written safe log' : `${absenceNote} (runner-transport.log remains the safe captured log)`,
    },
    {
      artifact: 'dispatch_record', path: 'dispatch-record.yaml', present: expectation('dispatch-record.yaml'),
      note: 'written by the runner at dispatch time',
    },
    {
      artifact: 'redaction_report', path: 'redaction-report.yaml', present: expectation('redaction-report.yaml'),
      note: 'written by the runner after log capture',
    },
  ];

  return {
    schema_version: 1,
    report_kind: 'agent-olympics.live-runner.capture-report',
    run_id: runId,
    generated_at: isoNow(),
    run_status: status,
    artifacts,
    summary: {
      present: artifacts.filter((a) => a.present).length,
      absent: artifacts.filter((a) => !a.present).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Dispatch driver
// ---------------------------------------------------------------------------

function selectParticipants(manifest, config, options) {
  const manifestByAgent = new Map((manifest.participants || []).map((p) => [p.agent_id, p]));
  const selected = [];
  for (const cp of config.participants) {
    if (cp.enabled === false) continue;
    const mp = manifestByAgent.get(cp.participant_id);
    if (!mp) {
      throw new RunnerError(`Config participant "${cp.participant_id}" is not in the round manifest participants list`);
    }
    if (mp.enabled === false) continue;
    if (options.dryRunOnly && cp.execution_profile === 'live') {
      console.log(`  Skipping live participant ${cp.participant_id} (--dry-run-only)`);
      continue;
    }
    selected.push({ config: cp, manifest: mp });
  }
  return selected;
}

function selectTasks(manifest, config) {
  let tasks = manifest.tasks || [];
  if (Array.isArray(config.tasks) && config.tasks.length > 0) {
    const wanted = new Set(config.tasks);
    const known = new Set(tasks.map((t) => t.task_id));
    for (const id of wanted) {
      if (!known.has(id)) throw new RunnerError(`Config task filter "${id}" is not in the round manifest`);
    }
    tasks = tasks.filter((t) => wanted.has(t.task_id));
  }
  return tasks;
}

function buildDispatchRecord(ctx) {
  const { manifest, manifestPath, task, participant, runId, command, timeLimitMs, envelope, credentials } = ctx;
  return {
    schema_version: 1,
    record_kind: 'agent-olympics.live-runner.dispatch-record',
    runner_id: ctx.runnerId,
    runner_version: RUNNER_VERSION,
    round_id: manifest.round_id,
    round_manifest: manifestPath,
    run_id: runId,
    task_id: task.task_id,
    participant_id: participant.config.participant_id,
    agent_id: participant.manifest.agent_id,
    adapter: participant.config.adapter,
    runtime: participant.manifest.runtime,
    runtime_version: participant.manifest.runtime_version || null,
    runtime_identity: ctx.runtimeIdentity,
    runtime_attestation: ctx.runtimeAttestation,
    transport: participant.config.transport,
    execution_profile: participant.config.execution_profile,
    source_revision: ctx.sourceRevision || `fixture-bundle:${task.fixture_bundle_ref || 'unknown'}`,
    fixture_bundle_ref: task.fixture_bundle_ref || null,
    envelope_ref: task.envelope_path,
    envelope_public_copy: 'envelope.yaml',
    envelope_private_fields_stripped: ctx.strippedFields,
    scoring_rubric: task.scoring_rubric || envelope.scoring_rubric || null,
    started_at: ctx.startedAt,
    time_limit_minutes: task.time_limit_minutes,
    enforced_time_limit_ms: timeLimitMs,
    time_limit_source: ctx.timeLimitSource,
    action_boundary: {
      allowed_actions: envelope.allowed_actions || [],
      forbidden_actions: envelope.forbidden_actions || [],
    },
    credentials,
    command,
    status: 'running',
    status_history: [
      { status: 'running', timestamp: ctx.startedAt, note: 'dispatched via local_exec transport' },
    ],
  };
}

function buildCredentialRecord(participantConfig) {
  if (participantConfig.execution_profile !== 'live') {
    return {
      credential_class: 'none',
      handling: 'none',
      credential_ref: null,
      approver: null,
      approval_ref: null,
      participant_may_read: false,
      redaction_rules: RUNNER_REDACTION_RULES.map(({ rule_id, reason }) => ({ rule_id, reason })),
      notes: 'dry_run profile — no credentials were made available to this run',
    };
  }
  const creds = participantConfig.credentials || {};
  const approval = participantConfig.approval || {};
  return {
    credential_class: creds.credential_class,
    handling: 'reference_only',
    credential_ref: creds.ref || null, // reference/handle only — never a value
    approver: approval.approver || null,
    approval_ref: approval.approval_ref || null,
    participant_may_read: creds.participant_may_read === true,
    redaction_rules: RUNNER_REDACTION_RULES.map(({ rule_id, reason }) => ({ rule_id, reason })),
    notes: 'live profile — credential passed by reference only; the runner never reads or stores credential values',
  };
}

async function dispatchRound(manifestPath, config, options) {
  const manifest = loadYamlFile(manifestPath);
  const gates = [];
  const gateFailures = [];

  // Gate: schema validation before any dispatch.
  gateSchemaValidation(manifestPath, gates);

  const runDirBase = options.runDirectory || config.run_directory || manifest.run_directory;
  if (!runDirBase) throw new RunnerError('No run directory: set config.run_directory or pass --run-directory');
  const runDirBaseAbs = path.isAbsolute(runDirBase) ? runDirBase : repoPath(runDirBase);

  const tasks = selectTasks(manifest, config);
  const participants = selectParticipants(manifest, config, options);
  if (tasks.length === 0) throw new RunnerError('No tasks selected');
  if (participants.length === 0) throw new RunnerError('No participants selected');

  // Gate: stub smoke per distinct task envelope.
  gateStubSmoke(tasks, gates, options.verbose);

  // Gate per participant (all profiles): runtime declaration consistency —
  // the runner config adapter must match the round manifest's registered
  // runtime for that participant (identity layer 1).
  // Gates per live participant: operator approval + runner readiness.
  const dispatchable = [];
  for (const participant of participants) {
    const identity = gateRuntimeIdentity(participant, gates, options.allowRuntimeMismatch === true);
    if (!identity.allowed) {
      const failure = {
        participant_id: participant.config.participant_id,
        execution_profile: participant.config.execution_profile,
        refused: true,
        reasons: [`runtime identity mismatch: ${identity.detail} — re-register the participant or fix the runner config (override: --allow-runtime-mismatch)`],
      };
      gateFailures.push(failure);
      console.error(`\nGATE BLOCKED — dispatch refused for participant "${participant.config.participant_id}" before any transport was started:`);
      for (const reason of failure.reasons) console.error(`  - ${reason}`);
      continue;
    }
    participant.runtimeIdentity = {
      declared_runtime: identity.declaredRuntime,
      declared_adapter: identity.declaredAdapter,
      consistent: identity.consistent,
      mismatch_allowed: !identity.consistent,
      note: identity.consistent
        ? 'runner config adapter matches the round manifest runtime registration'
        : `OPERATOR OVERRIDE: ${identity.detail}`,
    };
    if (!identity.consistent) {
      console.warn(`  ⚠ runtime identity mismatch allowed for ${participant.config.participant_id}: ${identity.detail}`);
    }
    if (participant.config.execution_profile === 'live') {
      const result = gateLiveParticipant(participant.config, gates);
      if (!result.ok) {
        const failure = {
          participant_id: participant.config.participant_id,
          execution_profile: 'live',
          refused: true,
          reasons: result.failures,
        };
        gateFailures.push(failure);
        console.error(`\nGATE BLOCKED — live dispatch refused for participant "${participant.config.participant_id}" before any transport was started:`);
        for (const reason of result.failures) console.error(`  - ${reason}`);
        continue;
      }
    }
    dispatchable.push(participant);
  }

  const sourceRevision = gitSourceRevision();
  fs.mkdirSync(runDirBaseAbs, { recursive: true });
  installCancelHandler();

  const runResults = [];
  let skippedByFilter = 0;

  outer:
  for (const participant of dispatchable) {
    for (const task of tasks) {
      if (cancelState.cancelled) break outer;

      const timestamp = generateTimestamp();
      const runId = renderRunId(manifest, task, participant.manifest, timestamp);
      if (options.runIdFilter && !runId.includes(options.runIdFilter)) {
        skippedByFilter += 1;
        continue;
      }

      const runDirAbs = path.join(runDirBaseAbs, runId);
      if (fs.existsSync(runDirAbs)) {
        throw new RunnerError(`Run directory already exists — refusing to overwrite: ${runDirAbs}`);
      }
      fs.mkdirSync(runDirAbs, { recursive: true });
      fs.mkdirSync(path.join(runDirAbs, 'evidence'), { recursive: true });

      // Participant-facing envelope: public fields only.
      const envelope = loadYamlFile(task.envelope_path);
      const { publicEnvelope, stripped } = sanitizeEnvelope(envelope);
      const envelopeRunPath = path.join(runDirAbs, 'envelope.yaml');
      writeYamlFile(envelopeRunPath, publicEnvelope);

      // Time limit: envelope/task minutes, unless an operator override is set.
      const overrideMs = participant.config.time_limit_ms_override;
      const timeLimitMs = overrideMs || task.time_limit_minutes * 60 * 1000;
      const timeLimitSource = overrideMs
        ? 'runner config time_limit_ms_override (operator/test override)'
        : 'round manifest task time_limit_minutes';

      const startedAt = isoNow();
      const seed = `${runId}-live-runner`;
      const substitutionValues = {
        envelope: envelopeRunPath,
        run_dir: runDirAbs,
        agent_id: participant.manifest.agent_id,
        run_id: runId,
        task_id: task.task_id,
        round_id: manifest.round_id,
        time_limit_minutes: task.time_limit_minutes,
        seed,
      };
      const command = substituteCommand(participant.config.command, substitutionValues);

      // Identity layer 2: optional runtime attestation probe (before the
      // main transport). Inconsistent/failed probes are recorded warnings.
      const attestation = runRuntimeAttestation(participant.config, substitutionValues);
      const runWarnings = [];
      if (attestation.warning) {
        runWarnings.push(attestation.warning);
        console.warn(`  ⚠ ${runId}: ${attestation.warning}`);
      }

      const credentials = buildCredentialRecord(participant.config);
      const dispatchRecord = buildDispatchRecord({
        manifest, manifestPath, task, participant, runId, command, timeLimitMs, envelope,
        credentials,
        runnerId: config.runner_id,
        sourceRevision,
        startedAt,
        strippedFields: stripped,
        timeLimitSource,
        runtimeIdentity: participant.runtimeIdentity,
        runtimeAttestation: attestation.record,
      });
      writeYamlFile(path.join(runDirAbs, 'dispatch-record.yaml'), dispatchRecord);

      // Run lifecycle manifest (round.js conventions).
      const runManifest = {
        schema_version: 1,
        run_id: runId,
        round_id: manifest.round_id,
        task_id: task.task_id,
        agent_id: participant.manifest.agent_id,
        runtime: participant.manifest.runtime,
        created_at: startedAt,
        lifecycle: 'running',
        envelope_ref: task.envelope_path,
        fixture_ref: task.fixture_bundle_ref,
        status_history: [{ status: 'running', timestamp: startedAt, note: 'dispatched by live-runner' }],
      };
      writeRunManifest(runDirAbs, runManifest);

      console.log(`\n  Dispatching ${runId}`);
      console.log(`    participant=${participant.config.participant_id} adapter=${participant.config.adapter} profile=${participant.config.execution_profile}`);
      console.log(`    time limit: ${timeLimitMs}ms (${timeLimitSource})`);
      if (options.verbose) console.log(`    argv: ${JSON.stringify(command)}`);

      const envExtra = {
        AGENT_OLYMPICS_RUN_ID: runId,
        AGENT_OLYMPICS_TASK_ID: task.task_id,
        AGENT_OLYMPICS_RUN_DIR: runDirAbs,
        AGENT_OLYMPICS_TIME_LIMIT_MS: String(timeLimitMs),
      };
      if (credentials.credential_class !== 'none' && credentials.credential_ref) {
        // Reference/handle only — the runner never resolves or reads values.
        envExtra.AGENT_OLYMPICS_CREDENTIAL_REF = credentials.credential_ref;
        envExtra.AGENT_OLYMPICS_CREDENTIAL_CLASS = credentials.credential_class;
      }

      const outcome = await spawnTransport(command, runDirAbs, timeLimitMs, envExtra);

      // §6: redact captured stdout/stderr BEFORE writing anything to disk.
      const rawCapture = `=== transport stdout ===\n${outcome.stdout}\n=== transport stderr ===\n${outcome.stderr}\n`;
      const { text: redactedCapture, appliedRules } = redactText(rawCapture);
      fs.writeFileSync(path.join(runDirAbs, 'runner-transport.log'), redactedCapture, 'utf8');
      writeYamlFile(path.join(runDirAbs, 'redaction-report.yaml'), {
        schema_version: 1,
        report_kind: 'agent-olympics.live-runner.redaction-report',
        run_id: runId,
        generated_at: isoNow(),
        targets: [
          {
            file: 'runner-transport.log',
            source: 'transport stdout/stderr captured by the runner',
            applied_rules: appliedRules,
            total_redactions: appliedRules.reduce((s, r) => s + r.match_count, 0),
          },
        ],
        policy: 'Redaction metadata records rule id and reason only — original values are never preserved.',
      });

      // §3: map the raw outcome to a packet status.
      let { status, note } = mapOutcomeToStatus(outcome, runDirAbs);

      // Escalations (§3 disqualified row): secret exposure or oracle leak in
      // the transport output; exit 0 without a result packet (fabrication).
      const secretHits = scanTextForSecrets(rawCapture);
      const oracleHits = scanTextForOracleReferences(rawCapture);
      if (secretHits.length > 0) {
        status = 'disqualified';
        note = `secret exposure detected in transport output (rules: ${secretHits.join(', ')}) — values redacted in stored logs`;
      } else if (oracleHits.length > 0) {
        status = 'disqualified';
        note = `oracle/hidden-judge-material reference detected in transport output (${oracleHits.join(', ')})`;
      } else if (status === 'completed' && !fs.existsSync(path.join(runDirAbs, 'result-packet.yaml'))) {
        status = 'disqualified';
        note = 'transport exited 0 but produced no result packet — possible fabrication';
      }

      // Finalize lifecycle + dispatch record.
      const endedAt = isoNow();
      const manifestInfo = finalizeRunManifest(runDirAbs, runManifest, status, note);
      dispatchRecord.status = status;
      dispatchRecord.ended_at = endedAt;
      dispatchRecord.exit_code = outcome.exitCode;
      dispatchRecord.timed_out = outcome.timedOut;
      dispatchRecord.cancelled = outcome.cancelled;
      dispatchRecord.spawn_error = outcome.spawnError ? (outcome.spawnError.code || outcome.spawnError.message) : null;
      dispatchRecord.duration_ms = outcome.durationMs;
      dispatchRecord.status_history.push({ status, timestamp: endedAt, note });
      writeYamlFile(path.join(runDirAbs, 'dispatch-record.yaml'), dispatchRecord);

      // §4: capture report.
      const captureReport = buildCaptureReport(runDirAbs, runId, status, note, manifestInfo);
      writeYamlFile(path.join(runDirAbs, 'capture-report.yaml'), captureReport);

      console.log(`    → ${status} (${note})`);
      runResults.push({
        run_id: runId,
        run_dir: path.relative(ROOT, runDirAbs),
        participant_id: participant.config.participant_id,
        task_id: task.task_id,
        status,
        exit_code: outcome.exitCode,
        timed_out: outcome.timedOut,
        note,
        warnings: runWarnings,
      });
    }
  }

  if (options.runIdFilter && runResults.length === 0 && skippedByFilter > 0) {
    console.warn(`\n  No runs matched --run-id "${options.runIdFilter}" (${skippedByFilter} combos skipped).`);
  }

  const report = {
    schema_version: 1,
    report_kind: 'agent-olympics.live-runner.dispatch-report',
    runner_id: config.runner_id,
    runner_version: RUNNER_VERSION,
    round_id: manifest.round_id,
    round_manifest: manifestPath,
    run_directory: path.relative(ROOT, runDirBaseAbs),
    generated_at: isoNow(),
    source_revision: sourceRevision,
    cancelled: cancelState.cancelled,
    gates,
    gate_failures: gateFailures,
    runs: runResults,
  };
  writeYamlFile(path.join(runDirBaseAbs, 'dispatch-report.yaml'), report);

  console.log(`\n=== Dispatch summary (${manifest.round_id}) ===`);
  for (const g of gates) console.log(`  gate ${g.gate.padEnd(18)} ${g.status.toUpperCase().padEnd(5)} ${g.target}`);
  for (const r of runResults) console.log(`  run  ${r.run_id} → ${r.status}`);
  for (const f of gateFailures) console.log(`  REFUSED ${f.execution_profile === 'live' ? 'live ' : ''}dispatch for ${f.participant_id}: ${f.reasons.join('; ')}`);
  if (cancelState.cancelled) console.log('  CANCELLED by operator — remaining runs were not dispatched.');

  return { manifest, report, runDirBaseAbs, gateBlocked: gateFailures.length > 0 };
}

// ---------------------------------------------------------------------------
// Fan-in + judge handoff (contract §5 + §7)
// ---------------------------------------------------------------------------

function collectDispatchedRuns(runDirBaseAbs) {
  if (!fs.existsSync(runDirBaseAbs)) return [];
  const runs = [];
  for (const entry of fs.readdirSync(runDirBaseAbs)) {
    if (!entry.startsWith('run-')) continue;
    const dirAbs = path.join(runDirBaseAbs, entry);
    if (!fs.statSync(dirAbs).isDirectory()) continue;
    const dispatchPath = path.join(dirAbs, 'dispatch-record.yaml');
    if (!fs.existsSync(dispatchPath)) {
      console.warn(`  ⚠ ${entry}/ has no dispatch-record.yaml — skipping (not a live-runner run)`);
      continue;
    }
    runs.push({ runId: entry, dirAbs, dispatch: yaml.load(fs.readFileSync(dispatchPath, 'utf8')) });
  }
  return runs;
}

const PARTICIPANT_FACING_FILES = [
  'result-packet.yaml', 'trace.yaml', 'evidence-bundle.yaml',
  'envelope.yaml', 'envelope-copy.yaml', 'adapter.log', 'runner-transport.log',
];

/**
 * Fan-in checks for one run.
 * Returns { reasons, warnings, escalateDisqualified, packet }.
 * reasons quarantine the run; warnings are recorded in the fan-in report
 * (severity aligned with competition-validity.js, which treats missing
 * content_ref files from the simulation adapters as WARN).
 */
function faninCheckRun(run) {
  const { dirAbs, dispatch } = run;
  const reasons = [];
  const warnings = [];
  let escalateDisqualified = false;

  const packetPath = path.join(dirAbs, 'result-packet.yaml');
  const tracePath = path.join(dirAbs, 'trace.yaml');
  const bundlePath = path.join(dirAbs, 'evidence-bundle.yaml');

  // 0. Disqualified runs (forbidden action, oracle leak, secret exposure)
  //    never proceed to judging, even when their on-disk artifacts are clean.
  if (dispatch.status === 'disqualified') {
    reasons.push(`run was disqualified at dispatch/capture time: ${lastStatusNote(dispatch)}`);
  }

  // 1. Missing result packet (explained absences still do not pass fan-in).
  if (!fs.existsSync(packetPath)) {
    reasons.push(`missing result packet (run status "${dispatch.status}": ${lastStatusNote(dispatch)})`);
    return { reasons, warnings, escalateDisqualified, packet: null };
  }

  // 2. Schema validation of packet, trace, evidence bundle (artifact
  //    validation gate before judge handoff).
  for (const [label, filePath, required] of [
    ['result packet', packetPath, true],
    ['trace record', tracePath, true],
    ['evidence bundle', bundlePath, true],
  ]) {
    if (!fs.existsSync(filePath)) {
      if (required) reasons.push(`missing ${label}`);
      continue;
    }
    const result = spawnValidate(filePath);
    if (!result.ok) {
      reasons.push(`${label} failed schema validation`);
    }
  }

  let packet = null;
  let trace = null;
  let bundle = null;
  try { packet = yaml.load(fs.readFileSync(packetPath, 'utf8')); } catch { reasons.push('result packet is not parseable YAML'); }
  try { trace = fs.existsSync(tracePath) ? yaml.load(fs.readFileSync(tracePath, 'utf8')) : null; } catch { reasons.push('trace record is not parseable YAML'); }
  try { bundle = fs.existsSync(bundlePath) ? yaml.load(fs.readFileSync(bundlePath, 'utf8')) : null; } catch { reasons.push('evidence bundle is not parseable YAML'); }

  // 3. Identity consistency vs the dispatch record.
  if (packet) {
    if (packet.task_id !== dispatch.task_id) {
      reasons.push(`task_id mismatch: packet "${packet.task_id}" vs dispatch "${dispatch.task_id}"`);
    }
    if (packet.agent_id !== dispatch.agent_id) {
      reasons.push(`agent_id mismatch: packet "${packet.agent_id}" vs dispatch "${dispatch.agent_id}"`);
    }
    // Runtime identity (same severity as agent_id): the packet's declared
    // runtime/adapter labels must match the adapter the runner dispatched.
    const dispatchAdapter = String(dispatch.adapter || '').toLowerCase();
    if (packet.runtime !== undefined && String(packet.runtime).toLowerCase() !== dispatchAdapter) {
      reasons.push(`runtime mismatch: packet runtime "${packet.runtime}" vs dispatch adapter "${dispatch.adapter}"`);
    }
    if (packet.adapter !== undefined && String(packet.adapter).toLowerCase() !== dispatchAdapter) {
      reasons.push(`runtime mismatch: packet adapter "${packet.adapter}" vs dispatch adapter "${dispatch.adapter}"`);
    }
  }
  if (trace && trace.agent_id !== dispatch.agent_id) {
    reasons.push(`agent_id mismatch: trace "${trace.agent_id}" vs dispatch "${dispatch.agent_id}"`);
  }
  if (bundle && bundle.agent_id !== undefined && bundle.agent_id !== dispatch.agent_id) {
    reasons.push(`agent_id mismatch: evidence bundle "${bundle.agent_id}" vs dispatch "${dispatch.agent_id}"`);
  }
  if (trace && bundle && trace.run_id !== bundle.run_id) {
    reasons.push(`run_id mismatch between trace ("${trace.run_id}") and evidence bundle ("${bundle.run_id}")`);
  }

  // 4. Participant-facing oracle references.
  for (const file of PARTICIPANT_FACING_FILES) {
    const filePath = path.join(dirAbs, file);
    if (!fs.existsSync(filePath)) continue;
    const hits = scanTextForOracleReferences(fs.readFileSync(filePath, 'utf8'));
    if (hits.length > 0) {
      reasons.push(`participant-facing oracle reference in ${file} (${hits.join(', ')})`);
      escalateDisqualified = true;
    }
  }

  // 5. Secret-bearing fields or values.
  for (const file of PARTICIPANT_FACING_FILES) {
    const filePath = path.join(dirAbs, file);
    if (!fs.existsSync(filePath)) continue;
    const text = fs.readFileSync(filePath, 'utf8');
    const valueHits = scanTextForSecrets(text);
    if (valueHits.length > 0) {
      reasons.push(`secret value detected in ${file} (rules: ${valueHits.join(', ')})`);
      escalateDisqualified = true;
    }
  }
  for (const [label, doc] of [['result packet', packet], ['trace record', trace], ['evidence bundle', bundle]]) {
    if (!doc) continue;
    const fieldHits = scanObjectForSecretFields(doc);
    if (fieldHits.length > 0) {
      reasons.push(`secret-bearing field in ${label}: ${fieldHits.join(', ')}`);
      escalateDisqualified = true;
    }
  }

  // 6. Evidence references must resolve. Trace evidence_refs resolve against
  //    the union of packet evidence ids and bundle item ids (same resolution
  //    base as competition-validity.js). Unresolved id references quarantine
  //    the run; missing content_ref FILES are warnings (the committed
  //    simulation adapters describe runtime evidence files they do not
  //    materialize — competition-validity.js also treats this as WARN).
  const packetEvidenceIds = new Set(((packet && packet.evidence) || []).map((e) => e && e.id).filter(Boolean));
  if (packet) {
    for (const [i, finding] of (packet.findings || []).entries()) {
      for (const ref of (finding && finding.evidence) || []) {
        if (!packetEvidenceIds.has(ref)) reasons.push(`findings[${i}] references unknown evidence id "${ref}"`);
      }
    }
  }
  if (trace) {
    const knownIds = new Set([
      ...packetEvidenceIds,
      ...((bundle && bundle.items) || []).map((it) => it && it.id).filter(Boolean),
    ]);
    for (const entry of trace.entries || []) {
      if (entry && entry.evidence_ref && !knownIds.has(entry.evidence_ref)) {
        reasons.push(`trace entry seq ${entry.seq} references unknown evidence id "${entry.evidence_ref}"`);
      }
    }
  }
  if (bundle) {
    for (const item of bundle.items || []) {
      if (!item || !item.content_ref) continue;
      if (/^https?:\/\//.test(item.content_ref) || /^data:/.test(item.content_ref)) continue;
      if (path.isAbsolute(item.content_ref) || item.content_ref.startsWith('..')) {
        reasons.push(`evidence item "${item.id}" content_ref escapes the run directory: ${item.content_ref}`);
        continue;
      }
      if (!fs.existsSync(path.join(dirAbs, item.content_ref))) {
        warnings.push(`evidence item "${item.id}" content_ref does not resolve to a file: ${item.content_ref}`);
      }
    }
  }

  // 7. Runtime identity warnings (layers 1–3 surfaced at fan-in):
  //    - an operator-allowed declaration mismatch recorded at dispatch,
  //    - an inconsistent/failed runtime attestation probe,
  //    - a heuristic artifact fingerprint that disagrees with the declared
  //      adapter (warning, never quarantine — fingerprints are heuristic).
  if (dispatch.runtime_identity && dispatch.runtime_identity.consistent === false) {
    warnings.push(`runtime declaration mismatch was operator-allowed at dispatch: config adapter "${dispatch.runtime_identity.declared_adapter}" vs manifest runtime "${dispatch.runtime_identity.declared_runtime}"`);
  }
  const attestation = dispatch.runtime_attestation;
  if (attestation && attestation.command_ran === true && attestation.consistent !== true) {
    warnings.push(`runtime attestation probe did not confirm the declared adapter "${attestation.declared_adapter}" (exit ${attestation.exit_code}; excerpt: ${JSON.stringify(String(attestation.output_excerpt || '').slice(0, 120))})`);
  }
  let fingerprint = null;
  if (packet) {
    fingerprint = fingerprintRuntime(packet, trace);
    const declaredAdapter = String(dispatch.adapter || '').toLowerCase();
    if (fingerprint.detected !== 'unknown' && fingerprint.detected !== declaredAdapter) {
      warnings.push(`runtime fingerprint mismatch: artifacts look ${fingerprint.detected}-shaped (confidence ${fingerprint.confidence}) but the declared adapter is "${dispatch.adapter}" — heuristic, flagged for judge review`);
    }
  }

  return { reasons, warnings, escalateDisqualified, packet, fingerprint };
}

function lastStatusNote(dispatch) {
  const history = dispatch.status_history || [];
  return history.length > 0 ? history[history.length - 1].note : 'no status note';
}

function quarantineRun(run, runDirBaseAbs, reasons) {
  const quarantineBase = path.join(runDirBaseAbs, 'quarantine');
  fs.mkdirSync(quarantineBase, { recursive: true });
  const dest = path.join(quarantineBase, run.runId);
  fs.renameSync(run.dirAbs, dest);
  writeYamlFile(path.join(dest, 'quarantine-reason.yaml'), {
    schema_version: 1,
    report_kind: 'agent-olympics.live-runner.quarantine-reason',
    run_id: run.runId,
    quarantined_at: isoNow(),
    original_path: path.relative(ROOT, run.dirAbs),
    run_status: run.dispatch.status,
    reasons,                            // unchanged free text, for humans
    categories: categorizeReasons(reasons), // taxonomy classification (additive)
  });
  return path.relative(ROOT, dest);
}

/** §7: assemble the judge handoff package for a clean run. */
function buildJudgeHandoff(run, packet, warnings = [], fingerprint = null) {
  const { dirAbs, dispatch } = run;
  const handoffDir = path.join(dirAbs, 'judge-handoff');
  fs.rmSync(handoffDir, { recursive: true, force: true });
  fs.mkdirSync(handoffDir, { recursive: true });

  const copies = [
    ['result-packet.yaml', 'result-packet.yaml'],
    ['trace.yaml', 'trace.yaml'],
    ['evidence-bundle.yaml', 'evidence-bundle.yaml'],
    ['envelope.yaml', 'envelope-public.yaml'], // public fields only (sanitized at dispatch)
    ['redaction-report.yaml', 'redaction-report.yaml'],
  ];
  const contents = [];
  for (const [src, dest] of copies) {
    const srcPath = path.join(dirAbs, src);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(handoffDir, dest));
      contents.push(dest);
    }
  }
  // Evidence content files referenced by the bundle.
  const evidenceDir = path.join(dirAbs, 'evidence');
  if (fs.existsSync(evidenceDir) && fs.readdirSync(evidenceDir).length > 0) {
    fs.cpSync(evidenceDir, path.join(handoffDir, 'evidence'), { recursive: true });
    contents.push('evidence/');
  }
  // Run metadata: adapter run.yaml when present, else a runner summary.
  const runMetaPath = path.join(dirAbs, 'run.yaml');
  if (fs.existsSync(runMetaPath)) {
    fs.copyFileSync(runMetaPath, path.join(handoffDir, 'run-metadata.yaml'));
  } else {
    writeYamlFile(path.join(handoffDir, 'run-metadata.yaml'), {
      schema_version: 1,
      run_id: dispatch.run_id,
      task_id: dispatch.task_id,
      agent_id: dispatch.agent_id,
      runtime: dispatch.runtime,
      status: dispatch.status,
      started_at: dispatch.started_at,
      ended_at: dispatch.ended_at || null,
      notes: 'Generated by live-runner (adapter emitted no run.yaml).',
    });
  }
  contents.push('run-metadata.yaml');

  const handoffManifest = {
    schema_version: 1,
    report_kind: 'agent-olympics.live-runner.judge-handoff',
    generated_at: isoNow(),
    run_id: dispatch.run_id,
    round_id: dispatch.round_id,
    task_id: dispatch.task_id,
    agent_id: dispatch.agent_id,
    adapter: dispatch.adapter,
    runner_status: dispatch.status,
    packet_status: packet ? packet.status : null,
    runner_status_note: dispatch.status !== (packet && packet.status)
      ? `runner-enforced status "${dispatch.status}" overrides the packet's self-reported status for scoring lifecycle purposes`
      : null,
    rubric_ref: dispatch.scoring_rubric,
    envelope_public_fields: 'envelope-public.yaml',
    judge_reference_source: {
      round_manifest: dispatch.round_manifest,
      note: 'Oracle and judge-notes references live in the round manifest task entry (judge tooling only). They are intentionally not copied into run directories or participant-facing artifacts.',
    },
    dispatch_record_ref: '../dispatch-record.yaml',
    capture_report_ref: '../capture-report.yaml',
    fanin_warnings: warnings,
    runtime_fingerprint: fingerprint
      ? {
          detected: fingerprint.detected,
          confidence: fingerprint.confidence,
          signals: fingerprint.signals,
          declared_adapter: dispatch.adapter,
          note: 'Heuristic artifact-shape fingerprint (layer 3). Catches honest misconfiguration only — a malicious wrapper can fake these signals.',
        }
      : null,
    contents: [...contents, 'handoff-manifest.yaml'],
  };
  writeYamlFile(path.join(handoffDir, 'handoff-manifest.yaml'), handoffManifest);

  // Redaction/credential check on the handoff package (gate before
  // publication/judging): no secret values anywhere in the package.
  const leaks = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir)) {
      const p = path.join(dir, entry);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      const hits = scanTextForSecrets(fs.readFileSync(p, 'utf8'));
      if (hits.length > 0) leaks.push(`${path.relative(dirAbs, p)} (rules: ${hits.join(', ')})`);
    }
  };
  walk(handoffDir);
  if (leaks.length > 0) {
    fs.rmSync(handoffDir, { recursive: true, force: true });
    return { ok: false, leaks };
  }
  return { ok: true, handoffDir: path.relative(ROOT, handoffDir) };
}

/**
 * Aggregate per-run category entries into a round-level failure summary:
 * { categories: [{code, kind, count}], by_kind: {kind: count}, total }.
 * `results` entries carry a `categories` array (from categorizeReasons).
 */
function aggregateFailureSummary(results) {
  const counts = new Map(); // code -> { kind, count }
  let total = 0;
  for (const run of results) {
    for (const cat of run.categories || []) {
      if (!counts.has(cat.code)) counts.set(cat.code, { kind: cat.kind, count: 0 });
      counts.get(cat.code).count += cat.count;
      total += cat.count;
    }
  }
  // Order by taxonomy declaration order for stable, readable output.
  const order = new Map(FAILURE_CATEGORIES.map((c, i) => [c.code, i]));
  const categories = [...counts.entries()]
    .map(([code, v]) => ({ code, kind: v.kind, count: v.count }))
    .sort((a, b) => (order.get(a.code) ?? 999) - (order.get(b.code) ?? 999));
  const byKind = {};
  for (const c of categories) byKind[c.kind] = (byKind[c.kind] || 0) + c.count;
  return { total, categories, by_kind: byKind };
}

function faninRound(runDirBaseAbs, options = {}) {
  const runs = collectDispatchedRuns(runDirBaseAbs);
  if (runs.length === 0) {
    console.log(`No dispatched runs found under ${path.relative(ROOT, runDirBaseAbs) || runDirBaseAbs}`);
    return { runs: [], clean: 0, quarantined: 0 };
  }

  console.log(`\n=== Fan-in: ${runs.length} run(s) under ${path.relative(ROOT, runDirBaseAbs)} ===`);
  const results = [];

  for (const run of runs) {
    const { reasons, warnings, escalateDisqualified, packet, fingerprint } = faninCheckRun(run);

    if (escalateDisqualified && run.dispatch.status !== 'disqualified') {
      run.dispatch.status = 'disqualified';
      run.dispatch.status_history = run.dispatch.status_history || [];
      run.dispatch.status_history.push({
        status: 'disqualified',
        timestamp: isoNow(),
        note: `fan-in safety check escalation: ${reasons.join('; ')}`,
      });
      writeYamlFile(path.join(run.dirAbs, 'dispatch-record.yaml'), run.dispatch);
      const manifestPath = path.join(run.dirAbs, 'manifest.yaml');
      try {
        const rm = yaml.load(fs.readFileSync(manifestPath, 'utf8'));
        if (isRunnerRunManifest(rm)) {
          rm.lifecycle = 'disqualified';
          rm.updated_at = isoNow();
          (rm.status_history = rm.status_history || []).push({
            status: 'disqualified', timestamp: rm.updated_at, note: 'fan-in safety escalation',
          });
          fs.writeFileSync(manifestPath, yaml.dump(rm, { indent: 2, lineWidth: 120 }));
        }
      } catch { /* manifest replaced by adapter artifact manifest */ }
    }

    const fingerprintSummary = fingerprint
      ? { detected: fingerprint.detected, confidence: fingerprint.confidence, declared_adapter: run.dispatch.adapter }
      : null;

    const warningCategories = categorizeWarnings(warnings);

    if (reasons.length > 0) {
      const dest = quarantineRun(run, runDirBaseAbs, reasons);
      const categories = categorizeReasons(reasons);
      console.log(`  ✘ ${run.runId} → QUARANTINED (${dest})`);
      for (const r of reasons) console.log(`      - ${r}`);
      results.push({ run_id: run.runId, participant_id: run.dispatch.participant_id, decision: 'quarantined', status: run.dispatch.status, reasons, categories, warnings, warning_categories: warningCategories, runtime_fingerprint: fingerprintSummary, quarantine_path: dest });
      continue;
    }

    const handoff = buildJudgeHandoff(run, packet, warnings, fingerprint);
    if (!handoff.ok) {
      const leakReasons = handoff.leaks.map((l) => `secret detected while assembling judge handoff: ${l}`);
      const dest = quarantineRun(run, runDirBaseAbs, leakReasons);
      const categories = categorizeReasons(leakReasons);
      console.log(`  ✘ ${run.runId} → QUARANTINED at handoff (${dest})`);
      results.push({ run_id: run.runId, participant_id: run.dispatch.participant_id, decision: 'quarantined', status: run.dispatch.status, reasons: leakReasons, categories, warnings, warning_categories: warningCategories, runtime_fingerprint: fingerprintSummary, quarantine_path: dest });
      continue;
    }

    console.log(`  ✓ ${run.runId} → clean (judge handoff: ${handoff.handoffDir})`);
    for (const w of warnings) console.log(`      ⚠ ${w}`);
    results.push({ run_id: run.runId, participant_id: run.dispatch.participant_id, decision: 'clean', status: run.dispatch.status, reasons: [], categories: [], warnings, warning_categories: warningCategories, runtime_fingerprint: fingerprintSummary, handoff: handoff.handoffDir });
  }

  const clean = results.filter((r) => r.decision === 'clean').length;
  const quarantined = results.filter((r) => r.decision === 'quarantined').length;

  // Aggregate rejection categories across all quarantined runs in the round.
  const failureSummary = aggregateFailureSummary(results);

  writeYamlFile(path.join(runDirBaseAbs, 'fanin-report.yaml'), {
    schema_version: 1,
    report_kind: 'agent-olympics.live-runner.fanin-report',
    generated_at: isoNow(),
    run_directory: path.relative(ROOT, runDirBaseAbs),
    runs: results,
    summary: { total: results.length, clean, quarantined },
    failure_summary: failureSummary,
  });

  console.log(`\n  Fan-in summary: ${clean} clean, ${quarantined} quarantined (fanin-report.yaml written)`);
  if (failureSummary.categories.length > 0) {
    const breakdown = failureSummary.categories.map((c) => `${c.code}×${c.count}`).join(', ');
    console.log(`  Rejections by category: ${breakdown}`);
  }
  return { runs: results, clean, quarantined, failureSummary };
}

// ---------------------------------------------------------------------------
// CLI commands
// ---------------------------------------------------------------------------

function usage() {
  console.log(`
Agent Olympics Live Runner (Season 001, local_exec transport)

Usage:
  node scripts/live-runner.js run      <round-manifest> --config <runner-config> [options]
  node scripts/live-runner.js dispatch <round-manifest> --config <runner-config> [options]
  node scripts/live-runner.js fanin          <round-runs-dir>
  node scripts/live-runner.js failure-report <round-runs-dir>
  node scripts/live-runner.js fixtures

Commands:
  run             Full pipeline: gates → dispatch → artifact capture → fan-in → judge handoff
  dispatch        Gates → dispatch → artifact capture only (no fan-in)
  fanin           Fan-in + judge handoff over an existing round runs directory
  failure-report  Read-only diagnostic: tabulate quarantine/disqualification
                  rejections by failure-taxonomy code (code/kind/count/runs).
                  Reads fanin-report.yaml if present, else scans quarantine/.
                  Always exits 0 (informational).
  fixtures        Run the fixture suite under fixtures/live-runner/ (non-zero exit on
                  unexpected outcomes)

Options:
  --config <file>        Runner config YAML (see schemas/runner-config.schema.json)
  --run-directory <dir>  Override the run directory from config/manifest
  --run-id <substr>      Dispatch only runs whose generated run id contains <substr>
  --dry-run-only         Skip live-profile participants entirely
  --allow-runtime-mismatch
                         Downgrade the runtime_identity gate (config adapter must
                         match the manifest participant's runtime) from refusal to
                         a recorded warning. Operator escape hatch only.
  --verbose, -v          Verbose output
  --help, -h             Show this help

Exit codes:
  0    success
  1    validation or runtime error
  2    a lifecycle/approval gate refused dispatch
  130  cancelled by operator (SIGINT)

Boundaries:
  - Only the local_exec transport is implemented (argv spawn, never a shell).
  - Credentials are referenced by class/handle only; values are never read,
    stored, or logged. Live profiles are gate-blocked without operator
    approval AND a passing live-runner-readiness declaration.
  - Oracle files and hidden judge notes never enter run directories or
    participant-facing artifacts.

See docs/live-runner.md for the full contract mapping.
`);
}

function parseCliArgs(argv) {
  const options = {
    positional: [],
    config: null,
    runDirectory: null,
    runIdFilter: null,
    dryRunOnly: false,
    allowRuntimeMismatch: false,
    verbose: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--config': options.config = argv[++i]; break;
      case '--run-directory': options.runDirectory = argv[++i]; break;
      case '--run-id': options.runIdFilter = argv[++i]; break;
      case '--dry-run-only': options.dryRunOnly = true; break;
      case '--allow-runtime-mismatch': options.allowRuntimeMismatch = true; break;
      case '--verbose': case '-v': options.verbose = true; break;
      case '--help': case '-h': options.help = true; break;
      default:
        if (arg.startsWith('--')) throw new RunnerError(`Unknown option: ${arg}`);
        options.positional.push(arg);
    }
  }
  return options;
}

async function cmdDispatch(options, withFanin) {
  const manifestPath = options.positional[0];
  if (!manifestPath || !options.config) {
    console.error(`Usage: node scripts/live-runner.js ${withFanin ? 'run' : 'dispatch'} <round-manifest> --config <runner-config>`);
    process.exitCode = EXIT_ERROR;
    return;
  }
  const config = validateRunnerConfig(loadYamlFile(options.config), options.config);
  const result = await dispatchRound(manifestPath, config, options);

  if (withFanin && !cancelState.cancelled) {
    faninRound(result.runDirBaseAbs);
  }
  if (cancelState.cancelled) {
    process.exitCode = EXIT_CANCELLED;
  } else if (result.gateBlocked) {
    process.exitCode = EXIT_GATE_BLOCKED;
  }
}

function cmdFanin(options) {
  const runsDir = options.positional[0];
  if (!runsDir) {
    console.error('Usage: node scripts/live-runner.js fanin <round-runs-dir>');
    process.exitCode = EXIT_ERROR;
    return;
  }
  const abs = path.isAbsolute(runsDir) ? runsDir : repoPath(runsDir);
  if (!fs.existsSync(abs)) throw new RunnerError(`Runs directory not found: ${runsDir}`);
  faninRound(abs);
}

/**
 * Build the diagnostic failure report for a round runs directory. Prefers an
 * existing fanin-report.yaml (so it is a cheap read-only view of an already
 * fanned-in round); otherwise scans quarantine/*​/quarantine-reason.yaml files
 * directly. Returns { categories: [{code, kind, count, runs:[{run_id,
 * participant_id}]}], total, sourced_from }.
 */
function buildFailureReport(runDirBaseAbs) {
  // code -> { kind, count, runs: Set("run_id|participant_id") }
  const byCode = new Map();
  const bump = (code, kind, runId, participantId, count) => {
    if (!byCode.has(code)) byCode.set(code, { kind, count: 0, runs: new Map() });
    const e = byCode.get(code);
    e.count += count;
    const key = runId || '(unknown)';
    if (!e.runs.has(key)) e.runs.set(key, { run_id: runId || null, participant_id: participantId || null });
  };

  let sourcedFrom = 'none';
  const faninPath = path.join(runDirBaseAbs, 'fanin-report.yaml');
  if (fs.existsSync(faninPath)) {
    sourcedFrom = 'fanin-report.yaml';
    const report = yaml.load(fs.readFileSync(faninPath, 'utf8')) || {};
    for (const run of report.runs || []) {
      for (const cat of run.categories || []) {
        bump(cat.code, cat.kind, run.run_id, run.participant_id, cat.count || 1);
      }
    }
  } else {
    sourcedFrom = 'quarantine-reason.yaml scan';
    const quarantineBase = path.join(runDirBaseAbs, 'quarantine');
    if (fs.existsSync(quarantineBase)) {
      for (const entry of fs.readdirSync(quarantineBase)) {
        const reasonPath = path.join(quarantineBase, entry, 'quarantine-reason.yaml');
        if (!fs.existsSync(reasonPath)) continue;
        const doc = yaml.load(fs.readFileSync(reasonPath, 'utf8')) || {};
        // Prefer recorded categories; fall back to classifying reasons live.
        const cats = (doc.categories && doc.categories.length > 0)
          ? doc.categories
          : categorizeReasons(doc.reasons || []);
        for (const cat of cats) bump(cat.code, cat.kind, doc.run_id || entry, null, cat.count || 1);
      }
    }
  }

  const order = new Map(FAILURE_CATEGORIES.map((c, i) => [c.code, i]));
  const categories = [...byCode.entries()]
    .map(([code, v]) => ({ code, kind: v.kind, count: v.count, runs: [...v.runs.values()] }))
    .sort((a, b) => (order.get(a.code) ?? 999) - (order.get(b.code) ?? 999));
  const total = categories.reduce((s, c) => s + c.count, 0);
  return { categories, total, sourced_from: sourcedFrom };
}

/** Read-only diagnostic leaderboard surface. Always exits 0 (informational). */
function cmdFailureReport(options) {
  const runsDir = options.positional[0];
  if (!runsDir) {
    console.error('Usage: node scripts/live-runner.js failure-report <round-runs-dir>');
    process.exitCode = EXIT_ERROR;
    return;
  }
  // Read-only command: resolve relative to ROOT without the escape guard so
  // it works on temp/out-of-tree run dirs too. Never fails the shell.
  const abs = path.isAbsolute(runsDir) ? runsDir : path.resolve(ROOT, runsDir);
  if (!fs.existsSync(abs)) {
    console.error(`Runs directory not found: ${runsDir}`);
    return; // informational command — do not fail the operator's shell
  }

  const report = buildFailureReport(abs);
  console.log(`\n=== Failure taxonomy report: ${path.relative(ROOT, abs) || abs} ===`);
  console.log(`(source: ${report.sourced_from})`);
  if (report.categories.length === 0) {
    console.log('  No rejections recorded — all runs clean (or no fan-in yet).');
    return;
  }

  const titleByCode = new Map(FAILURE_CATEGORIES.map((c) => [c.code, c.title]));
  const codeW = Math.max(4, ...report.categories.map((c) => c.code.length));
  const kindW = Math.max(4, ...report.categories.map((c) => c.kind.length));
  console.log(`  ${'CODE'.padEnd(codeW)}  ${'KIND'.padEnd(kindW)}  COUNT  RUNS`);
  for (const c of report.categories) {
    const runs = c.runs
      .map((r) => (r.participant_id ? `${r.participant_id}(${r.run_id})` : r.run_id))
      .join(', ');
    console.log(`  ${c.code.padEnd(codeW)}  ${c.kind.padEnd(kindW)}  ${String(c.count).padStart(5)}  ${runs}`);
    console.log(`  ${' '.repeat(codeW)}  ${titleByCode.get(c.code) || ''}`);
  }
  console.log(`\n  Total rejections: ${report.total} across ${report.categories.length} categor${report.categories.length === 1 ? 'y' : 'ies'}.`);
}

// ---------------------------------------------------------------------------
// Fixture suite
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.join(ROOT, 'fixtures', 'live-runner');

async function runFixtures() {
  let pass = 0;
  let fail = 0;
  const report = (ok, label, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
    if (ok) pass += 1; else fail += 1;
  };

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'live-runner-fixtures-'));

  try {
    // -----------------------------------------------------------------
    // 1. Happy path: dry-run dispatch → fan-in → handoff on the fixture
    //    round manifest with hermes + openclaw + stub local_exec transports.
    // -----------------------------------------------------------------
    console.log('\n--- fixture: dry-run happy path (hermes + openclaw + stub) ---');
    {
      const runDir = path.join(tmpBase, 'dryrun');
      const config = validateRunnerConfig(
        loadYamlFile('fixtures/live-runner/runner-config-dryrun.yaml'),
        'fixtures/live-runner/runner-config-dryrun.yaml'
      );
      const dispatch = await dispatchRound('fixtures/live-runner/round-live-runner-fixture.yaml', config, {
        runDirectory: runDir, dryRunOnly: false, verbose: false,
      });
      const statuses = dispatch.report.runs.map((r) => r.status);
      report(
        dispatch.report.runs.length === 6 && statuses.every((s) => s === 'completed') && !dispatch.gateBlocked,
        'dry-run dispatch: 6 runs (3 participants x 2 tasks) all completed',
        `statuses: ${statuses.join(', ')}`
      );
      report(
        dispatch.report.gates.some((g) => g.gate === 'schema_validation' && g.status === 'pass')
          && dispatch.report.gates.some((g) => g.gate === 'stub_smoke' && g.status === 'pass'),
        'dry-run dispatch: schema_validation and stub_smoke gates passed before dispatch'
      );

      // Dispatch record contents (contract §1 + §2).
      const firstRun = dispatch.report.runs[0];
      const record = yaml.load(fs.readFileSync(path.join(ROOT, firstRun.run_dir, 'dispatch-record.yaml'), 'utf8'));
      const recordOk = record.round_id === 'season-001-round-901'
        && record.run_id === firstRun.run_id
        && record.task_id && record.participant_id && record.adapter
        && typeof record.source_revision === 'string'
        && record.started_at && record.time_limit_minutes
        && Array.isArray(record.action_boundary.allowed_actions) && record.action_boundary.allowed_actions.length > 0
        && Array.isArray(record.action_boundary.forbidden_actions) && record.action_boundary.forbidden_actions.length > 0;
      report(recordOk, 'dispatch record carries round/run/task/participant ids, source revision, start time, time limit, action boundary');
      report(
        record.credentials.credential_class === 'none' && record.credentials.approver === null
          && Array.isArray(record.credentials.redaction_rules) && record.credentials.redaction_rules.length > 0
          && record.credentials.redaction_rules.every((r) => r.rule_id && r.reason && !r.value),
        'dry_run dispatch record: credential_class none + value-free redaction rules');

      // Runtime identity layers 1 + 2 on the happy path: declarations agree
      // and sogyo's identify_command probe attests the declared adapter.
      report(
        record.runtime_identity && record.runtime_identity.consistent === true
          && record.runtime_attestation && record.runtime_attestation.command_ran === true
          && record.runtime_attestation.exit_code === 0
          && record.runtime_attestation.consistent === true
          && /hermes/i.test(record.runtime_attestation.output_excerpt || ''),
        'dispatch record carries a consistent runtime_identity block and a consistent runtime attestation (identify_command)');
      const nosukRun = dispatch.report.runs.find((r) => r.participant_id === 'nosuk');
      const nosukRecord = yaml.load(fs.readFileSync(path.join(ROOT, nosukRun.run_dir, 'dispatch-record.yaml'), 'utf8'));
      report(
        nosukRecord.runtime_attestation && nosukRecord.runtime_attestation.command_ran === false
          && (nosukRun.warnings || []).length === 0,
        'participant without identify_command records runtime_attestation.command_ran: false and no warning (opt-in)');

      // Capture report (contract §4).
      const capture = yaml.load(fs.readFileSync(path.join(ROOT, firstRun.run_dir, 'capture-report.yaml'), 'utf8'));
      const expectedKinds = ['result_packet', 'trace_record', 'evidence_bundle', 'artifact_manifest',
        'envelope_copy', 'run_manifest', 'adapter_stdout_stderr_summary', 'safe_logs', 'dispatch_record', 'redaction_report'];
      report(
        expectedKinds.every((k) => capture.artifacts.some((a) => a.artifact === k && (a.present || a.note))),
        'capture report verifies presence or explained absence of every contract artifact');

      // Sanitized participant envelope.
      const envText = fs.readFileSync(path.join(ROOT, firstRun.run_dir, 'envelope.yaml'), 'utf8');
      report(
        !/hidden_judge_notes|oracle_ref|judge_notes_ref/.test(envText),
        'participant-facing envelope copy is stripped of hidden_judge_notes / oracle_ref / judge_notes_ref');

      const fanin = faninRound(dispatch.runDirBaseAbs);
      report(fanin.clean === 6 && fanin.quarantined === 0, 'fan-in: all 6 runs clean, none quarantined',
        `clean=${fanin.clean} quarantined=${fanin.quarantined}`);

      const handoffDir = path.join(ROOT, fanin.runs[0].handoff);
      const handoffFiles = fs.readdirSync(handoffDir);
      const required = ['result-packet.yaml', 'trace.yaml', 'evidence-bundle.yaml', 'envelope-public.yaml',
        'run-metadata.yaml', 'redaction-report.yaml', 'handoff-manifest.yaml'];
      report(required.every((f) => handoffFiles.includes(f)),
        'judge handoff contains packet, trace, evidence bundle, public envelope, run metadata, redaction report, manifest',
        `contents: ${handoffFiles.join(', ')}`);
      const handoffManifest = yaml.load(fs.readFileSync(path.join(handoffDir, 'handoff-manifest.yaml'), 'utf8'));
      report(!!handoffManifest.rubric_ref, 'judge handoff manifest carries the rubric reference', `rubric_ref: ${handoffManifest.rubric_ref}`);
      const handoffEnvText = fs.readFileSync(path.join(handoffDir, 'envelope-public.yaml'), 'utf8');
      report(!/hidden_judge_notes|oracle_ref|judge_notes_ref/.test(handoffEnvText),
        'judge handoff envelope contains public fields only');
    }

    // -----------------------------------------------------------------
    // 2. Committed round manifest e2e (hermes + openclaw on v2 envelopes).
    // -----------------------------------------------------------------
    console.log('\n--- fixture: committed round manifest dry-run (season-001-round-001) ---');
    {
      const runDir = path.join(tmpBase, 'season-001');
      const config = validateRunnerConfig(
        loadYamlFile('fixtures/live-runner/runner-config-season-001-dryrun.yaml'),
        'fixtures/live-runner/runner-config-season-001-dryrun.yaml'
      );
      const dispatch = await dispatchRound('rounds/season-001-round-001.yaml', config, {
        runDirectory: runDir, dryRunOnly: false, verbose: false,
      });
      const fanin = faninRound(dispatch.runDirBaseAbs);
      report(
        dispatch.report.runs.length === 3 && dispatch.report.runs.every((r) => r.status === 'completed')
          && fanin.clean === 3 && fanin.quarantined === 0,
        'committed manifest: dispatch → fan-in → handoff clean for sogyo + seoseo + nosuk (all hermes)',
        `runs: ${dispatch.report.runs.map((r) => `${r.run_id}=${r.status}`).join(', ')}`);
      report(
        dispatch.report.gates.filter((g) => g.gate === 'runtime_identity').length === 3
          && dispatch.report.gates.filter((g) => g.gate === 'runtime_identity').every((g) => g.status === 'pass'),
        'committed manifest: runtime_identity gate passes for all three participants (config adapters match manifest runtimes)');
    }

    // -----------------------------------------------------------------
    // 3. Negative: live profile without approval → gate-blocked BEFORE dispatch.
    //    Exercised through the real CLI so the exit code is asserted too.
    // -----------------------------------------------------------------
    console.log('\n--- fixture: live profile without approval (gate-blocked) ---');
    {
      const runDir = path.join(tmpBase, 'live-blocked');
      const cp = spawnSync(
        process.execPath,
        [
          __filename, 'dispatch', 'fixtures/live-runner/round-live-runner-fixture.yaml',
          '--config', 'fixtures/live-runner/runner-config-live-blocked.yaml',
          '--run-directory', runDir,
        ],
        { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', timeout: 120000 }
      );
      const out = `${cp.stdout || ''}${cp.stderr || ''}`;
      report(cp.status === EXIT_GATE_BLOCKED, 'live dispatch without approval exits with gate-blocked code 2', `exit=${cp.status}`);
      report(/GATE BLOCKED/.test(out) && /approval/.test(out), 'gate failure message names the missing operator approval');
      const dispatched = fs.existsSync(runDir)
        ? fs.readdirSync(runDir).filter((e) => e.startsWith('run-'))
        : [];
      report(dispatched.length === 0, 'no run was dispatched for the gate-blocked live participant', `run dirs: ${dispatched.length}`);
      const reportDoc = yaml.load(fs.readFileSync(path.join(runDir, 'dispatch-report.yaml'), 'utf8'));
      report(
        reportDoc.gate_failures.length === 1 && reportDoc.gate_failures[0].refused === true,
        'dispatch report records the refused live participant with reasons',
        reportDoc.gate_failures[0] ? reportDoc.gate_failures[0].reasons.join('; ') : 'none');
    }

    // -----------------------------------------------------------------
    // 4. Negative transports: identity mismatch, secret in stdout,
    //    timeout (partial + failed), unreachable transport (ENOENT).
    // -----------------------------------------------------------------
    console.log('\n--- fixture: negative transports (mismatch / secret / timeout / unreachable) ---');
    {
      const runDir = path.join(tmpBase, 'negative');
      const config = validateRunnerConfig(
        loadYamlFile('fixtures/live-runner/runner-config-negative.yaml'),
        'fixtures/live-runner/runner-config-negative.yaml'
      );
      const dispatch = await dispatchRound('fixtures/live-runner/round-live-runner-fixture.yaml', config, {
        runDirectory: runDir, dryRunOnly: false, verbose: false,
      });
      const byParticipant = new Map(dispatch.report.runs.map((r) => [r.participant_id, r]));

      // (b) mismatched agent_id → dispatched fine, quarantined at fan-in.
      const imposter = byParticipant.get('imposter-target');
      report(!!imposter && imposter.status === 'completed', 'mismatched-identity transport completes at dispatch time',
        imposter ? `status=${imposter.status}` : 'run missing');

      // (c) secret in stdout → redacted log + metadata + disqualified.
      const secretRun = byParticipant.get('secret-echo');
      report(!!secretRun && secretRun.status === 'disqualified',
        'transport printing a secret is mapped to disqualified (secret exposure)',
        secretRun ? `status=${secretRun.status}` : 'run missing');
      if (secretRun) {
        const logText = fs.readFileSync(path.join(ROOT, secretRun.run_dir, 'runner-transport.log'), 'utf8');
        report(/\[REDACTED:rv-openai-style-key\]/.test(logText) && !/sk-[a-zA-Z0-9]{20,}/.test(logText),
          'captured transport log is redacted (no secret value, rule marker present)');
        const redactionReport = yaml.load(fs.readFileSync(path.join(ROOT, secretRun.run_dir, 'redaction-report.yaml'), 'utf8'));
        const rules = redactionReport.targets[0].applied_rules;
        report(rules.some((r) => r.rule_id === 'rv-openai-style-key' && r.reason && r.match_count > 0)
          && !JSON.stringify(redactionReport).match(/sk-[a-zA-Z0-9]{20,}/),
          'redaction report records rule id + reason without the original value');
      }

      // (d) timeout with usable partial output → partial.
      const partialRun = byParticipant.get('sleeper-partial');
      report(!!partialRun && partialRun.status === 'partial' && partialRun.timed_out === true,
        'timeout with usable partial output maps to partial', partialRun ? `status=${partialRun.status}` : 'run missing');

      // (d) timeout without usable output → failed.
      const failedRun = byParticipant.get('sleeper-failed');
      report(!!failedRun && failedRun.status === 'failed' && failedRun.timed_out === true,
        'timeout without usable output maps to failed', failedRun ? `status=${failedRun.status}` : 'run missing');

      // unreachable runtime (ENOENT) → blocked.
      const blockedRun = byParticipant.get('missing-binary');
      report(!!blockedRun && blockedRun.status === 'blocked',
        'unspawnable transport (ENOENT) maps to blocked', blockedRun ? `status=${blockedRun.status}` : 'run missing');

      // Fan-in decisions.
      const fanin = faninRound(dispatch.runDirBaseAbs);
      const decisions = new Map(fanin.runs.map((r) => [r.run_id, r]));
      const findDecision = (participantId) => {
        const run = byParticipant.get(participantId);
        return run ? decisions.get(run.run_id) : null;
      };

      const imposterDecision = findDecision('imposter-target');
      report(!!imposterDecision && imposterDecision.decision === 'quarantined'
          && imposterDecision.reasons.some((r) => /agent_id mismatch/.test(r)),
        'fan-in quarantines the mismatched agent_id packet with a reason file',
        imposterDecision ? imposterDecision.reasons.join('; ') : 'missing');
      if (imposterDecision) {
        const reasonFile = path.join(ROOT, imposterDecision.quarantine_path, 'quarantine-reason.yaml');
        report(fs.existsSync(reasonFile), 'quarantined run carries quarantine-reason.yaml in quarantine/');
        // Taxonomy: agent_id mismatch → IDENTITY_MISMATCH (integrity).
        const reasonDoc = yaml.load(fs.readFileSync(reasonFile, 'utf8'));
        report(
          Array.isArray(reasonDoc.categories)
            && reasonDoc.categories.some((c) => c.code === 'IDENTITY_MISMATCH' && c.kind === 'integrity')
            && Array.isArray(reasonDoc.reasons),
          'quarantine-reason.yaml carries categories (IDENTITY_MISMATCH/integrity) alongside the human reasons',
          reasonDoc.categories ? JSON.stringify(reasonDoc.categories) : 'no categories');
        report(
          (imposterDecision.categories || []).some((c) => c.code === 'IDENTITY_MISMATCH'),
          'fan-in run entry carries the IDENTITY_MISMATCH category');
      }

      const secretDecision = findDecision('secret-echo');
      report(!!secretDecision && secretDecision.decision === 'quarantined',
        'fan-in quarantines the disqualified secret-exposure run');
      if (secretDecision) {
        const secretReasonDoc = yaml.load(fs.readFileSync(
          path.join(ROOT, secretDecision.quarantine_path, 'quarantine-reason.yaml'), 'utf8'));
        report(
          (secretReasonDoc.categories || []).some((c) => c.code === 'SECRET_EXPOSURE' && c.kind === 'safety'),
          'secret-echo quarantine-reason.yaml classified as SECRET_EXPOSURE/safety',
          JSON.stringify(secretReasonDoc.categories));
      }

      const partialDecision = findDecision('sleeper-partial');
      report(!!partialDecision && partialDecision.decision === 'clean' && !!partialDecision.handoff,
        'partial (timed-out but usable) run passes fan-in and gets a judge handoff');

      const failedDecision = findDecision('sleeper-failed');
      report(!!failedDecision && failedDecision.decision === 'quarantined'
          && failedDecision.reasons.some((r) => /missing result packet/.test(r)),
        'fan-in rejects the timed-out run with no packet (explained absence recorded)');

      const blockedDecision = findDecision('missing-binary');
      report(!!blockedDecision && blockedDecision.decision === 'quarantined'
          && blockedDecision.reasons.some((r) => /missing result packet/.test(r)),
        'fan-in rejects the unreachable-transport run (no packet, explained)');
      if (blockedDecision) {
        report(
          (blockedDecision.categories || []).some((c) => c.code === 'BACKEND_TIMEOUT' && c.kind === 'stack_reliability'),
          'missing-packet (unreachable transport) classified as BACKEND_TIMEOUT/stack_reliability',
          JSON.stringify(blockedDecision.categories));
      }

      // fanin-report.yaml carries the round-level failure_summary aggregation.
      const faninDoc = yaml.load(fs.readFileSync(path.join(dispatch.runDirBaseAbs, 'fanin-report.yaml'), 'utf8'));
      report(
        faninDoc.failure_summary
          && Array.isArray(faninDoc.failure_summary.categories)
          && faninDoc.failure_summary.categories.length > 0
          && faninDoc.failure_summary.categories.some((c) => c.code === 'IDENTITY_MISMATCH')
          && faninDoc.failure_summary.categories.some((c) => c.code === 'BACKEND_TIMEOUT')
          && faninDoc.failure_summary.total >= 3
          && faninDoc.failure_summary.by_kind
          && typeof faninDoc.failure_summary.by_kind.stack_reliability === 'number',
        'fanin-report.yaml has a failure_summary aggregating categories + by_kind across rejected runs',
        faninDoc.failure_summary ? JSON.stringify(faninDoc.failure_summary.categories) : 'no failure_summary');

      // failure-report command (read-only diagnostic) over the same runs dir.
      const failCp = spawnSync(
        process.execPath,
        [__filename, 'failure-report', dispatch.runDirBaseAbs],
        { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', timeout: 60000 }
      );
      const failOut = `${failCp.stdout || ''}${failCp.stderr || ''}`;
      report(
        failCp.status === 0
          && /Failure taxonomy report/.test(failOut)
          && /IDENTITY_MISMATCH/.test(failOut)
          && /BACKEND_TIMEOUT/.test(failOut)
          && /Total rejections:/.test(failOut),
        'failure-report command exits 0 and prints a taxonomy table (IDENTITY_MISMATCH, BACKEND_TIMEOUT)',
        `exit=${failCp.status}`);

      // Direct classifyReason unit checks against the observed live reasons.
      const { classifyReason } = require('./lib/failure-taxonomy');
      const expectations = [
        ['missing result packet (run status "partial": transport timed out)', 'BACKEND_TIMEOUT'],
        ['findings[2] references unknown evidence id "ev-bogus"', 'EVIDENCE_DISCIPLINE'],
        ['participant-facing oracle reference in result-packet.yaml (oracle/)', 'ORACLE_BOUNDARY'],
        ['secret value detected in trace.yaml (rules: rv-openai-style-key)', 'SECRET_EXPOSURE'],
        ['secret-bearing field in result packet: credentials.token', 'SECRET_EXPOSURE'],
        ['agent_id mismatch: packet "x" vs dispatch "y"', 'IDENTITY_MISMATCH'],
        ['runtime mismatch: packet runtime "cli" vs dispatch adapter "stub"', 'IDENTITY_MISMATCH'],
        ['result packet is not parseable YAML', 'MALFORMED_OUTPUT'],
        ['result packet failed schema validation', 'SCHEMA_INVALID'],
        ['evidence item "ev-1" content_ref does not resolve to a file: a/b.txt', 'CONTENT_RESOLUTION'],
        ['missing trace record', 'MISSING_ARTIFACT'],
        ['something the taxonomy has never seen', 'UNCLASSIFIED'],
      ];
      const wrong = expectations.filter(([reason, code]) => classifyReason(reason) !== code)
        .map(([reason, code]) => `${JSON.stringify(reason)} → expected ${code} got ${classifyReason(reason)}`);
      report(wrong.length === 0,
        'classifyReason maps each observed live reason to its taxonomy code',
        wrong.join(' | '));
    }

    // -----------------------------------------------------------------
    // 5. Runtime identity layer 1: config adapter ≠ manifest runtime →
    //    runtime_identity gate refuses dispatch (exit 2); the operator
    //    escape hatch --allow-runtime-mismatch downgrades to a recorded
    //    warning and the run completes with the mismatch noted everywhere.
    // -----------------------------------------------------------------
    console.log('\n--- fixture: runtime declaration mismatch (gate-refused / operator override) ---');
    {
      const runDir = path.join(tmpBase, 'runtime-mismatch');
      const cp = spawnSync(
        process.execPath,
        [
          __filename, 'dispatch', 'fixtures/live-runner/round-live-runner-fixture.yaml',
          '--config', 'fixtures/live-runner/runner-config-runtime-mismatch.yaml',
          '--run-directory', runDir,
        ],
        { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', timeout: 120000 }
      );
      const out = `${cp.stdout || ''}${cp.stderr || ''}`;
      report(cp.status === EXIT_GATE_BLOCKED, 'adapter ≠ manifest runtime is gate-refused with exit code 2', `exit=${cp.status}`);
      report(/GATE BLOCKED/.test(out) && /runtime identity mismatch/.test(out),
        'gate failure message names the runtime identity mismatch');
      const dispatched = fs.existsSync(runDir) ? fs.readdirSync(runDir).filter((e) => e.startsWith('run-')) : [];
      report(dispatched.length === 0, 'no run was dispatched for the runtime-mismatched participant', `run dirs: ${dispatched.length}`);
      const blockedReport = yaml.load(fs.readFileSync(path.join(runDir, 'dispatch-report.yaml'), 'utf8'));
      report(
        blockedReport.gates.some((g) => g.gate === 'runtime_identity' && g.status === 'fail')
          && blockedReport.gate_failures.length === 1
          && blockedReport.gate_failures[0].refused === true
          && blockedReport.gate_failures[0].reasons.some((r) => /runtime identity mismatch/.test(r)),
        'dispatch report records the failed runtime_identity gate and the refused participant');

      // Operator escape hatch: same config, --allow-runtime-mismatch.
      const overrideDir = path.join(tmpBase, 'runtime-mismatch-allowed');
      const cp2 = spawnSync(
        process.execPath,
        [
          __filename, 'run', 'fixtures/live-runner/round-live-runner-fixture.yaml',
          '--config', 'fixtures/live-runner/runner-config-runtime-mismatch.yaml',
          '--run-directory', overrideDir,
          '--allow-runtime-mismatch',
        ],
        { cwd: ROOT, stdio: 'pipe', encoding: 'utf8', timeout: 120000 }
      );
      report(cp2.status === EXIT_OK, '--allow-runtime-mismatch downgrades the refusal and the run proceeds', `exit=${cp2.status}`);
      const overrideReport = yaml.load(fs.readFileSync(path.join(overrideDir, 'dispatch-report.yaml'), 'utf8'));
      report(
        overrideReport.gates.some((g) => g.gate === 'runtime_identity' && g.status === 'warn')
          && overrideReport.gate_failures.length === 0
          && overrideReport.runs.length === 1 && overrideReport.runs[0].status === 'completed',
        'override run: runtime_identity gate records status warn, no gate failures, run completed');
      const overrideRunDir = path.join(ROOT, overrideReport.runs[0].run_dir);
      const overrideRecord = yaml.load(fs.readFileSync(path.join(overrideRunDir, 'dispatch-record.yaml'), 'utf8'));
      report(
        overrideRecord.runtime_identity && overrideRecord.runtime_identity.consistent === false
          && overrideRecord.runtime_identity.mismatch_allowed === true
          && /OPERATOR OVERRIDE/.test(overrideRecord.runtime_identity.note || ''),
        'override dispatch record notes the operator-allowed runtime mismatch');
      const overrideFanin = yaml.load(fs.readFileSync(path.join(overrideDir, 'fanin-report.yaml'), 'utf8'));
      report(
        overrideFanin.runs.length === 1 && overrideFanin.runs[0].decision === 'clean'
          && overrideFanin.runs[0].warnings.some((w) => /runtime declaration mismatch was operator-allowed/.test(w)),
        'fan-in keeps the override run clean but surfaces the allowed mismatch as a warning');
    }

    // -----------------------------------------------------------------
    // 6. Runtime identity layers 1–3 at fan-in: packet runtime label
    //    mismatch (quarantine), inconsistent attestation probe (warning),
    //    hermes-shaped artifacts declared as stub (fingerprint warning).
    // -----------------------------------------------------------------
    console.log('\n--- fixture: runtime identity fan-in (packet label / attestation / fingerprint) ---');
    {
      const runDir = path.join(tmpBase, 'identity');
      const config = validateRunnerConfig(
        loadYamlFile('fixtures/live-runner/runner-config-identity.yaml'),
        'fixtures/live-runner/runner-config-identity.yaml'
      );
      const dispatch = await dispatchRound('fixtures/live-runner/round-live-runner-fixture.yaml', config, {
        runDirectory: runDir, dryRunOnly: false, verbose: false,
      });
      const byParticipant = new Map(dispatch.report.runs.map((r) => [r.participant_id, r]));
      report(
        dispatch.report.runs.length === 3 && dispatch.report.runs.every((r) => r.status === 'completed') && !dispatch.gateBlocked,
        'identity fixtures: all 3 transports complete at dispatch time',
        `statuses: ${dispatch.report.runs.map((r) => r.status).join(', ')}`);

      // (c) inconsistent attestation probe → recorded warning, not refusal.
      const attestRun = byParticipant.get('attest-probe');
      const attestRecord = yaml.load(fs.readFileSync(path.join(ROOT, attestRun.run_dir, 'dispatch-record.yaml'), 'utf8'));
      report(
        attestRecord.runtime_attestation && attestRecord.runtime_attestation.command_ran === true
          && attestRecord.runtime_attestation.consistent === false
          && attestRecord.runtime_attestation.declared_adapter === 'stub'
          && (attestRun.warnings || []).some((w) => /runtime attestation/.test(w)),
        'inconsistent identify_command probe is recorded in the dispatch record + dispatch report warning (no refusal)');

      const fanin = faninRound(dispatch.runDirBaseAbs);
      const decisions = new Map(fanin.runs.map((r) => [r.run_id, r]));
      const findDecision = (participantId) => {
        const run = byParticipant.get(participantId);
        return run ? decisions.get(run.run_id) : null;
      };

      // (b) packet runtime label ≠ dispatched adapter → quarantined.
      const imposterDecision = findDecision('runtime-imposter');
      report(!!imposterDecision && imposterDecision.decision === 'quarantined'
          && imposterDecision.reasons.some((r) => /runtime mismatch: packet runtime "cli" vs dispatch adapter "stub"/.test(r)),
        'fan-in quarantines a packet whose runtime label differs from the dispatched adapter (identity severity)',
        imposterDecision ? imposterDecision.reasons.join('; ') : 'missing');

      // (c) attestation warning surfaces in the fan-in report; run stays clean.
      const attestDecision = findDecision('attest-probe');
      report(!!attestDecision && attestDecision.decision === 'clean'
          && attestDecision.warnings.some((w) => /runtime attestation probe did not confirm/.test(w)),
        'fan-in surfaces the inconsistent attestation as a warning on a clean run',
        attestDecision ? attestDecision.warnings.join('; ') : 'missing');

      // (d) hermes-shaped artifacts declared as stub → fingerprint WARNING
      //     (clean, not quarantined) + judge handoff metadata.
      const shifterDecision = findDecision('shape-shifter');
      report(!!shifterDecision && shifterDecision.decision === 'clean'
          && shifterDecision.warnings.some((w) => /runtime fingerprint mismatch: artifacts look hermes-shaped/.test(w))
          && shifterDecision.runtime_fingerprint && shifterDecision.runtime_fingerprint.detected === 'hermes',
        'fingerprint mismatch (declared stub, hermes-shaped artifacts) is a fan-in warning, not a quarantine',
        shifterDecision ? `${JSON.stringify(shifterDecision.runtime_fingerprint)} ${shifterDecision.warnings.join('; ')}` : 'missing');
      if (shifterDecision) {
        const handoffManifest = yaml.load(fs.readFileSync(path.join(ROOT, shifterDecision.handoff, 'handoff-manifest.yaml'), 'utf8'));
        report(
          handoffManifest.runtime_fingerprint && handoffManifest.runtime_fingerprint.detected === 'hermes'
            && handoffManifest.runtime_fingerprint.declared_adapter === 'stub'
            && Array.isArray(handoffManifest.runtime_fingerprint.signals)
            && handoffManifest.runtime_fingerprint.signals.length >= 2
            && handoffManifest.fanin_warnings.some((w) => /fingerprint/.test(w)),
          'judge handoff manifest carries the fingerprint verdict + signals so judges see the discrepancy');
      }
    }
  } finally {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.error('Live runner fixtures FAILED.');
    process.exitCode = EXIT_ERROR;
  } else {
    console.log('Live runner fixtures passed.');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  let options;
  try {
    options = parseCliArgs(rest);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exitCode = EXIT_ERROR;
    return;
  }

  if (!command || options.help || command === 'help') {
    usage();
    if (!command) process.exitCode = EXIT_ERROR;
    return;
  }

  try {
    switch (command) {
      case 'run':
        await cmdDispatch(options, true);
        break;
      case 'dispatch':
        await cmdDispatch(options, false);
        break;
      case 'fanin':
        cmdFanin(options);
        break;
      case 'failure-report':
        cmdFailureReport(options);
        break;
      case 'fixtures':
        await runFixtures();
        break;
      default:
        console.error(`Unknown command: "${command}"`);
        usage();
        process.exitCode = EXIT_ERROR;
    }
  } catch (err) {
    if (err instanceof GateError) {
      console.error(`\n${err.message}`);
      process.exitCode = EXIT_GATE_BLOCKED;
    } else if (err instanceof RunnerError) {
      console.error(`ERROR: ${err.message}`);
      process.exitCode = EXIT_ERROR;
    } else {
      console.error(`Fatal error: ${err.stack || err.message}`);
      process.exitCode = EXIT_ERROR;
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  validateRunnerConfig,
  sanitizeEnvelope,
  redactText,
  mapOutcomeToStatus,
  faninRound,
  dispatchRound,
  // Shared safety scans reused by the coordination-round orchestrator so the
  // worker-findings injection path is checked with the SAME oracle-reference
  // and secret scans the runner applies to participant-facing artifacts.
  scanTextForOracleReferences,
  scanObjectForSecretFields,
  scanTextForSecrets,
  ORACLE_REFERENCE_PATTERNS,
};
