/**
 * Agent Olympics Adapter Common Scaffolding
 *
 * Shared helpers for the adapter CLIs:
 *   - adapters/hermes-adapter.js
 *   - adapters/openclaw-adapter.js
 *   - scripts/stub-adapter.js
 *
 * This module extracts the scaffolding that every adapter duplicates —
 * id generation, exit-code → status mapping, argument parsing, envelope
 * loading, run-directory setup, console capture into adapter.log, YAML
 * artifact writing, and the schema-validation wrapper — parameterized on
 * adapter-specific config (adapter name, defaults, log prefix, option set).
 *
 * Adapter-specific logic (packet content builders, evidence/action/trace
 * builders, capability matrices, tool profiles) intentionally stays in the
 * adapter files.
 *
 * Exit codes (aligned with adapter-execution-contract):
 *   0  — success (completed)
 *   1  — execution failure (failed)
 *   2  — timeout / partial result (partial)
 *   3  — argument or prereq error (blocked)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// STATUS MAPPING
// ---------------------------------------------------------------------------
// Maps adapter exit codes and runtime states to result packet statuses.

const STATUS_MAP = Object.freeze({
  0: 'completed',
  1: 'failed',
  2: 'partial',
  3: 'blocked',
});

const RUNNER_EXIT_MAP = Object.freeze({
  completed: 0,
  failed: 1,
  partial: 2,
  blocked: 3,
});

// ---------------------------------------------------------------------------
// Id helpers
// ---------------------------------------------------------------------------

function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function shortId(seed) {
  // Deterministic suffix from seed (6 hex chars)
  if (seed) {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      const chr = seed.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0;
    }
    return (Math.abs(hash) % 0xFFFFFF).toString(16).padStart(6, '0');
  }
  return Math.random().toString(16).slice(2, 8);
}

function generatePrefixedId(prefix, taskId, agentId, seed, timestamp) {
  const ts = (timestamp || isoNow()).replace(/[:.]/g, '-').slice(0, 19);
  const id = seed ? shortId(seed) : shortId(`${taskId}-${agentId}-${ts}`);
  return `${prefix}-${taskId}-${agentId}-${ts}-${id}`;
}

function generateRunId(taskId, agentId, seed, timestamp) {
  return generatePrefixedId('run', taskId, agentId, seed, timestamp);
}

/**
 * Deterministic pseudo content hash derived from a seed: 6 hex chars from
 * shortId repeated and sliced to the requested length (default 64, the
 * length of a real sha256 hex digest).
 */
function pseudoHash(seed, length = 64) {
  return shortId(seed).repeat(16).slice(0, length);
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
// Option specs map a CLI flag to the opts key it sets and how its value is
// parsed: 'path' (resolved), 'string', 'int' (base 10), or 'flag' (boolean,
// no value consumed).

/** Options shared by every adapter (including the stub adapter). */
const COMMON_OPTIONS = Object.freeze({
  '--run-dir':   { key: 'runDir',    kind: 'path' },
  '--agent-id':  { key: 'agentId',   kind: 'string' },
  '--runtime':   { key: 'runtime',   kind: 'string' },
  '--exit':      { key: 'exitCode',  kind: 'int' },
  '--seed':      { key: 'seed',      kind: 'string' },
  '--timestamp': { key: 'timestamp', kind: 'string' },
});

/** Options shared by the full runtime adapters (hermes, openclaw). */
const RUNTIME_ADAPTER_OPTIONS = Object.freeze({
  ...COMMON_OPTIONS,
  '--runtime-version': { key: 'runtimeVersion', kind: 'string' },
  '--mode':            { key: 'mode',           kind: 'string' },
  '--event-family':    { key: 'eventFamily',    kind: 'string' },
  '--model':           { key: 'model',          kind: 'string' },
  '--model-provider':  { key: 'modelProvider',  kind: 'string' },
  '--publishable':     { key: 'publishable',    kind: 'flag' },
});

/**
 * Parse adapter CLI arguments.
 *
 * config:
 *   usage   — array of usage/help lines printed (to stderr) when no args given
 *   defaults — default opts object (cloned, not mutated)
 *   options  — map of flag → { key, kind } (see COMMON_OPTIONS)
 *
 * Exits 3 on missing args, unknown options, or an invalid --exit value.
 * Returns { envelopePath, opts }.
 */
function parseAdapterArgs(config) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    for (const line of config.usage) {
      console.error(line);
    }
    process.exit(3);
  }

  const envelopePath = path.resolve(args[0]);
  const opts = Object.assign({}, config.defaults);

  for (let i = 1; i < args.length; i++) {
    const spec = config.options[args[i]];
    if (!spec) {
      console.error(`Unknown option: ${args[i]}`);
      process.exit(3);
    }
    switch (spec.kind) {
      case 'path':   opts[spec.key] = path.resolve(args[++i]); break;
      case 'int':    opts[spec.key] = parseInt(args[++i], 10); break;
      case 'flag':   opts[spec.key] = true; break;
      default:       opts[spec.key] = args[++i]; break;
    }
  }

  if (!Number.isInteger(opts.exitCode) || STATUS_MAP[opts.exitCode] === undefined) {
    console.error(`Invalid --exit value: must be one of ${Object.keys(STATUS_MAP).join(', ')}`);
    process.exit(3);
  }

  return { envelopePath, opts };
}

// ---------------------------------------------------------------------------
// Envelope loading and run-directory setup
// ---------------------------------------------------------------------------

/** Load and sanity-check a task envelope; exits 3 on any prereq error. */
function loadEnvelope(envelopePath) {
  if (!fs.existsSync(envelopePath)) {
    console.error(`ERROR: Envelope not found: ${envelopePath}`);
    process.exit(3);
  }

  let envelope;
  try {
    const raw = fs.readFileSync(envelopePath, 'utf8');
    envelope = yaml.load(raw);
  } catch (err) {
    console.error(`ERROR: Failed to parse envelope: ${err.message}`);
    process.exit(3);
  }

  if (!envelope || !envelope.task_id) {
    console.error('ERROR: Invalid envelope: missing task_id');
    process.exit(3);
  }

  return envelope;
}

/**
 * Validate the requested adapter mode and event family against the adapter
 * metadata and capability matrix; exits 3 with a descriptive error if the
 * combination is unsupported.
 */
function validateModeAndFamily(mode, eventFamily, adapterMetadata, capabilityMatrix) {
  // Validate mode
  if (!adapterMetadata.modes[mode]) {
    console.error(`ERROR: Unknown adapter mode "${mode}". Supported modes: ${Object.keys(adapterMetadata.modes).join(', ')}`);
    process.exit(3);
  }

  // Validate event family
  if (!capabilityMatrix[eventFamily]) {
    console.error(`ERROR: Unknown event family "${eventFamily}". Supported families: ${Object.keys(capabilityMatrix).join(', ')}`);
    process.exit(3);
  }

  // Validate that this mode supports this event family
  const capEntry = capabilityMatrix[eventFamily];
  if (!capEntry.supported_modes.includes(mode)) {
    console.error(`ERROR: Mode "${mode}" does not support event family "${eventFamily}". Supported modes for this family: ${capEntry.supported_modes.join(', ')}`);
    process.exit(3);
  }
}

/**
 * Ensure the run directory (and optionally its evidence/ subdirectory)
 * exists. Returns the evidence directory path when requested, else null.
 */
function ensureRunDir(runDir, withEvidenceDir) {
  if (!fs.existsSync(runDir)) {
    fs.mkdirSync(runDir, { recursive: true });
  }
  if (!withEvidenceDir) return null;
  const evidenceDir = path.join(runDir, 'evidence');
  if (!fs.existsSync(evidenceDir)) {
    fs.mkdirSync(evidenceDir, { recursive: true });
  }
  return evidenceDir;
}

// ---------------------------------------------------------------------------
// Console capture → adapter.log
// ---------------------------------------------------------------------------

/**
 * Redirect console.log/console.error into a log-line buffer (while still
 * echoing to the original streams). Returns { logLines, restore }.
 */
function captureConsole() {
  const logLines = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args) => { logLines.push(['STDOUT', ...args].join(' ')); origLog(...args); };
  console.error = (...args) => { logLines.push(['STDERR', ...args].join(' ')); origError(...args); };
  return {
    logLines,
    restore() {
      console.log = origLog;
      console.error = origError;
    },
  };
}

/**
 * Restore the console and write the captured output to <runDir>/adapter.log
 * (now that all output happened).
 */
function writeAdapterLog(runDir, capture) {
  capture.restore();
  fs.writeFileSync(path.join(runDir, 'adapter.log'),
    capture.logLines.join('\n') + '\n',
    'utf8');
}

// ---------------------------------------------------------------------------
// Artifact writing
// ---------------------------------------------------------------------------

/** Returns a writeYaml(filename, data) function bound to the run directory. */
function makeWriteYaml(runDir) {
  return (filename, data) => {
    fs.writeFileSync(path.join(runDir, filename),
      yaml.dump(data, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: true }),
      'utf8');
  };
}

/**
 * Build the result-packet outputs map from envelope.required_outputs.
 * `suffix` is appended after the standard "Output for <key>. Status: …"
 * sentence (adapter-specific flavour text).
 */
function buildOutputs(envelope, adapter, mode, eventFamily, status, suffix = '') {
  const outputs = {};
  for (const key of (envelope.required_outputs || [])) {
    outputs[key] = `[${adapter}-adapter:${mode}/${eventFamily}] Output for ${key}. Status: ${status}.${suffix}`;
  }
  return outputs;
}

/**
 * Build the run.yaml metadata record shared by the runtime adapters.
 * config: { adapterType, adapterVersion, notes }
 */
function generateRunMetadata(envelopePath, envelope, runId, agentId, runtime, status, exitCode,
  startedAt, endedAt, mode, eventFamily, runtimeVersion, artifactPaths, config) {
  return {
    schema_version: 1,
    run_id: runId,
    task_id: envelope.task_id || 'unknown',
    envelope_path: envelopePath,
    agent_id: agentId,
    runtime: runtime,
    runtime_version: runtimeVersion,
    adapter_mode: mode,
    event_family: eventFamily,
    status: status,
    exit_code: exitCode,
    started_at: startedAt,
    ended_at: endedAt,
    duration_seconds: Math.round((new Date(endedAt) - new Date(startedAt)) / 1000),
    artifacts: artifactPaths.map(p => path.basename(p)),
    adapter_type: config.adapterType,
    adapter_version: config.adapterVersion,
    notes: config.notes,
  };
}

// ---------------------------------------------------------------------------
// Validation wrapper
// ---------------------------------------------------------------------------

const DEFAULT_VALIDATED_FILES = Object.freeze([
  'result-packet.yaml', 'trace.yaml', 'evidence-bundle.yaml', 'manifest.yaml',
]);

/**
 * Run scripts/validate.js over the generated artifacts in runDir.
 * options:
 *   logPrefix      — adapter name used in log/warning lines
 *   files          — artifact filenames to validate (default: packet, trace,
 *                    evidence bundle, manifest)
 *   truncateOutput — truncate validator output to 500 chars on failure
 *                    (default true; the stub adapter prints it in full)
 */
function validateOutput(runDir, options) {
  const { logPrefix, files = DEFAULT_VALIDATED_FILES, truncateOutput = true } = options;
  const validateScript = path.join(REPO_ROOT, 'scripts', 'validate.js');

  let allPassed = true;
  for (const file of files) {
    const filePath = path.join(runDir, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`[${logPrefix}] WARNING: ${file} not found — skipping validation.`);
      continue;
    }
    try {
      const result = require('child_process').spawnSync(
        process.execPath,
        [validateScript, filePath],
        { cwd: REPO_ROOT, stdio: 'pipe', encoding: 'utf8' }
      );
      if (result.status !== 0) {
        console.warn(`[${logPrefix}] WARNING: ${file} failed schema validation:`);
        if (truncateOutput) {
          if (result.stdout) console.warn(result.stdout.slice(0, 500));
          if (result.stderr) console.warn(result.stderr.slice(0, 500));
        } else {
          console.warn(result.stdout);
          if (result.stderr) console.warn(result.stderr);
        }
        allPassed = false;
      } else {
        console.log(`[${logPrefix}] ${file} — validation OK`);
      }
    } catch (err) {
      console.warn(`[${logPrefix}] WARNING: Could not validate ${file}: ${err.message}`);
    }
  }

  if (!allPassed) {
    console.warn(`[${logPrefix}] WARNING: Some output files failed validation. See warnings above.`);
  }
  return allPassed;
}

// ---------------------------------------------------------------------------
// Run summary helpers
// ---------------------------------------------------------------------------

/** Print the "=== Adapter Metadata ===" block shared by the runtime adapters. */
function printAdapterMetadataSummary(adapterMetadata) {
  console.log('=== Adapter Metadata ===');
  console.log(`  Adapter:           ${adapterMetadata.adapter}`);
  console.log(`  Envelope versions: ${adapterMetadata.supported_envelope_versions.join(', ')}`);
  console.log(`  Event families:    ${adapterMetadata.supported_event_families.join(', ')}`);
  console.log(`  Modes:             ${Object.keys(adapterMetadata.modes).join(', ')}`);
  console.log(`  Redaction rules:   ${adapterMetadata.redaction_rules.length}`);
  console.log(`  Evidence kinds:    ${adapterMetadata.evidence_capabilities.length}`);
  console.log(`  Default timeout:   ${adapterMetadata.timeout_handling.default_timeout_seconds}s`);
  console.log('');
}

module.exports = {
  STATUS_MAP,
  RUNNER_EXIT_MAP,
  COMMON_OPTIONS,
  RUNTIME_ADAPTER_OPTIONS,
  isoNow,
  shortId,
  generatePrefixedId,
  generateRunId,
  pseudoHash,
  parseAdapterArgs,
  loadEnvelope,
  validateModeAndFamily,
  ensureRunDir,
  captureConsole,
  writeAdapterLog,
  makeWriteYaml,
  buildOutputs,
  generateRunMetadata,
  validateOutput,
  printAdapterMetadataSummary,
};
