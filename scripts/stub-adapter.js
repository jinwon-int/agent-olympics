#!/usr/bin/env node
/**
 * Agent Olympics Stub Participant Adapter (CLI)
 *
 * Deterministic adapter runner for testing and CI: accepts a task envelope,
 * emits a result packet + trace + evidence bundle, and records run metadata.
 * No live credentials or runtime required.
 *
 * Usage:
 *   node scripts/stub-adapter.js <envelope-path>           # one shot
 *   node scripts/stub-adapter.js <envelope-path> --run-dir /tmp/my-run
 *   node scripts/stub-adapter.js <envelope-path> --exit 1  # simulate failure
 *   node scripts/stub-adapter.js <envelope-path> --seed fixed-seed
 *
 * Output (in --run-dir or results/stub-<task_id>-<ts>/):
 *   result-packet.yaml     - v1 result packet
 *   trace.yaml             - v1 trace record
 *   evidence-bundle.yaml   - v1 evidence bundle
 *   run.yaml               - run metadata (envelope, exit code, artifacts)
 *   envelope-copy.yaml     - copy of the input envelope
 *   adapter.log            - stdout/stderr captured during run
 *
 * Exit codes:
 *   0  - success (completed)
 *   1  - simulated failure (failed)
 *   2  - simulated timeout (partial)
 *   3  - argument / prereq error (blocked)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// ---------------------------------------------------------------------------
// Helpers
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

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node scripts/stub-adapter.js <envelope-path> [options]');
    console.error('');
    console.error('Options:');
    console.error('  --run-dir <path>     Output directory (default: auto-created in results/)');
    console.error('  --agent-id <string>  Agent identifier (default: stub-adapter)');
    console.error('  --runtime <string>   Runtime identifier (default: cli)');
    console.error('  --exit <code>        Simulate exit code: 0=success, 1=fail, 2=timeout (default: 0)');
    console.error('  --seed <string>      Deterministic seed for stable output ids');
    console.error('  --timestamp <time>   ISO timestamp override for all timestamps');
    process.exit(3);
  }

  const envelopePath = path.resolve(args[0]);
  const opts = { exitCode: 0, agentId: 'stub-adapter', runtime: 'cli', seed: null, timestamp: null, runDir: null };

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '--run-dir':    opts.runDir   = path.resolve(args[++i]); break;
      case '--agent-id':   opts.agentId  = args[++i]; break;
      case '--runtime':    opts.runtime  = args[++i]; break;
      case '--exit':       opts.exitCode = parseInt(args[++i], 10); break;
      case '--seed':       opts.seed     = args[++i]; break;
      case '--timestamp':  opts.timestamp = args[++i]; break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        process.exit(3);
    }
  }

  return { envelopePath, opts };
}

// ---------------------------------------------------------------------------
// Core logic — deterministic stub generation
// ---------------------------------------------------------------------------

function determineStatus(exitCode) {
  switch (exitCode) {
    case 0:     return 'completed';
    case 1:     return 'failed';
    case 2:     return 'partial';
    default:    return 'blocked';
  }
}

function generateRunId(taskId, agentId, seed, timestamp) {
  const ts = (timestamp || isoNow()).replace(/[:.]/g, '-').slice(0, 19);
  const id = seed ? shortId(seed) : shortId(`${taskId}-${agentId}-${ts}`);
  return `run-${taskId}-${agentId}-${ts}-${id}`;
}

function generateResultPacket(envelope, runId, agentId, runtime, status, startedAt, endedAt, seed) {
  const taskId = envelope.task_id || 'unknown-task';

  // Build evidence items based on task context
  const evidence = [
    {
      id: 'ev-stub-input',
      kind: 'config_snippet',
      source: 'task envelope',
      summary: `Input task envelope: "${envelope.title || taskId}". Objective: ${(envelope.objective || '').slice(0, 120)}`,
      content_ref: 'envelope-copy.yaml',
      content_type: 'application/x-yaml',
    },
    {
      id: 'ev-stub-run',
      kind: 'command_output',
      source: 'stub adapter',
      summary: `Stub adapter executed with exit code ${process.exitCode === undefined ? 0 : process.exitCode} (mapped status: ${status}). No live commands were run.`,
      content_ref: 'adapter.log',
      content_type: 'text/plain',
    },
  ];

  // If a specific task was requested, add a task-specific evidence stub
  if (taskId) {
    evidence.push({
      id: 'ev-stub-task',
      kind: 'log',
      source: 'stub adapter',
      summary: `Task ${taskId} processed. Required outputs: ${(envelope.required_outputs || []).join(', ')}. Stub adapter does not produce real outputs.`,
      content_ref: '',
      content_type: 'text/plain',
    });
  }

  const findings = [
    {
      claim: 'Stub adapter executed successfully (deterministic stub).',
      evidence: ['ev-stub-input', 'ev-stub-run'],
      confidence: 'high',
    },
    {
      claim: `Produced result packet for task "${taskId}" with status "${status}". No real work was performed.`,
      evidence: ['ev-stub-run'],
      confidence: 'medium',
    },
  ];

  const outputs = {};
  for (const key of (envelope.required_outputs || [])) {
    outputs[key] = `[stub] Placeholder output for "${key}". Replace with real output from the participant adapter.`;
  }

  return {
    schema_version: envelope.schema_version || 1,
    task_id: taskId,
    agent_id: agentId,
    runtime: runtime,
    started_at: startedAt,
    ended_at: endedAt,
    status: status,
    summary: `Stub adapter run for task "${taskId}". Status: ${status}. This is a deterministic placeholder — no live participant executed.`,
    evidence,
    findings,
    outputs,
  };
}

function generateTraceRecord(envelope, runId, agentId, startedAt, endedAt, entries) {
  return {
    schema_version: 1,
    trace_id: `tr-${runId}`,
    run_id: runId,
    agent_id: agentId,
    generated_at: endedAt,
    entries: entries || [
      {
        seq: 0,
        timestamp: startedAt,
        action: 'read',
        target: 'task_envelope',
        summary: `Read task envelope "${envelope.task_id || 'unknown'}" from disk.`,
        duration_ms: 50,
        result_summary: `Loaded envelope: ${envelope.title || envelope.task_id || 'unknown'}`,
      },
      {
        seq: 1,
        timestamp: startedAt,
        action: 'think',
        target: null,
        summary: 'Stub adapter: generating deterministic result artifacts. No live execution performed.',
        duration_ms: 10,
        result_summary: 'Result packet, trace, and evidence bundle generated.',
      },
      {
        seq: 2,
        timestamp: endedAt,
        action: 'write',
        target: 'result_packet',
        summary: 'Wrote result packet, trace record, and evidence bundle to run directory.',
        duration_ms: 30,
        result_summary: `Artifacts written for run ${runId}`,
      },
    ],
  };
}

function generateEvidenceBundle(envelope, runId, agentId, endedAt) {
  return {
    schema_version: 1,
    bundle_id: `eb-${runId}`,
    run_id: runId,
    agent_id: agentId,
    generated_at: endedAt,
    items: [
      {
        id: 'ev-stub-input',
        kind: 'config_snippet',
        source: 'task envelope',
        summary: `Copy of the input task envelope "${envelope.task_id || 'unknown'}".`,
        content_ref: 'envelope-copy.yaml',
        content_type: 'application/x-yaml',
        redacted: false,
      },
      {
        id: 'ev-stub-run',
        kind: 'command_output',
        source: 'stub adapter',
        summary: 'Stub adapter execution log and exit status.',
        content_ref: 'adapter.log',
        content_type: 'text/plain',
        redacted: false,
      },
    ],
  };
}

function generateRunMetadata(envelopePath, envelope, runId, status, exitCode, startedAt, endedAt, artifactPaths) {
  return {
    schema_version: 1,
    run_id: runId,
    task_id: envelope.task_id || 'unknown',
    envelope_path: envelopePath,
    agent_id: 'stub-adapter',
    runtime: 'cli',
    status: status,
    exit_code: exitCode,
    started_at: startedAt,
    ended_at: endedAt,
    duration_seconds: Math.round((new Date(endedAt) - new Date(startedAt)) / 1000),
    artifacts: artifactPaths.map(p => path.basename(p)),
    adapter_type: 'stub',
    notes: 'This is a deterministic stub adapter result. No live participant executed. Use for runner integration tests and CI validation.',
  };
}

// ---------------------------------------------------------------------------
// Validation wrapper
// ---------------------------------------------------------------------------

function validateOutput(runDir) {
  const validateScript = path.resolve(__dirname, 'validate.js');
  const files = ['result-packet.yaml', 'trace.yaml', 'evidence-bundle.yaml'];

  let allPassed = true;
  for (const file of files) {
    const filePath = path.join(runDir, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`[stub-adapter] WARNING: ${file} not found — skipping validation.`);
      continue;
    }
    try {
      const result = require('child_process').spawnSync(
        process.execPath,
        [validateScript, filePath],
        { cwd: path.resolve(__dirname, '..'), stdio: 'pipe', encoding: 'utf8' }
      );
      if (result.status !== 0) {
        console.warn(`[stub-adapter] WARNING: ${file} failed schema validation:`);
        console.warn(result.stdout);
        if (result.stderr) console.warn(result.stderr);
        allPassed = false;
      } else {
        console.log(`[stub-adapter] ${file} — validation OK`);
      }
    } catch (err) {
      console.warn(`[stub-adapter] WARNING: Could not validate ${file}: ${err.message}`);
    }
  }

  if (!allPassed) {
    console.warn('[stub-adapter] WARNING: Some output files failed validation. See warnings above.');
  }
  return allPassed;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const { envelopePath, opts } = parseArgs();

  // --- Validate input ---
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

  const taskId = envelope.task_id;
  const agentId = opts.agentId;
  const runtime = opts.runtime;
  const exitCode = opts.exitCode;
  const seed = opts.seed;
  const overrideTimestamp = opts.timestamp;

  const startedAt = overrideTimestamp || isoNow();
  const runId = generateRunId(taskId, agentId, seed, startedAt);

  // --- Determine output directory ---
  const runDir = opts.runDir || path.resolve(__dirname, '..', 'results', `stub-${taskId}-${runId}`);
  if (!fs.existsSync(runDir)) {
    fs.mkdirSync(runDir, { recursive: true });
  }

  // --- Capture stdout/stderr ---
  const logLines = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args) => { logLines.push(['STDOUT', ...args].join(' ')); origLog(...args); };
  console.error = (...args) => { logLines.push(['STDERR', ...args].join(' ')); origError(...args); };

  // Determine status from exit code
  const status = determineStatus(exitCode);
  const endedAt = overrideTimestamp || isoNow();

  // --- Generate output artifacts ---
  const resultPacket = generateResultPacket(envelope, runId, agentId, runtime, status, startedAt, endedAt, seed);
  const traceRecord = generateTraceRecord(envelope, runId, agentId, startedAt, endedAt);
  const evidenceBundle = generateEvidenceBundle(envelope, runId, agentId, endedAt);
  const runMeta = generateRunMetadata(envelopePath, envelope, runId, status, exitCode, startedAt, endedAt,
    ['envelope-copy.yaml', 'result-packet.yaml', 'trace.yaml', 'evidence-bundle.yaml', 'run.yaml', 'adapter.log']);

  // --- Write artifacts ---
  const writeYaml = (filename, data) => {
    fs.writeFileSync(path.join(runDir, filename),
      yaml.dump(data, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: true }),
      'utf8');
  };

  writeYaml('envelope-copy.yaml', envelope);
  writeYaml('result-packet.yaml', resultPacket);
  writeYaml('trace.yaml', traceRecord);
  writeYaml('evidence-bundle.yaml', evidenceBundle);
  writeYaml('run.yaml', runMeta);

  // Write the adapter log
  fs.writeFileSync(path.join(runDir, 'adapter.log'),
    logLines.join('\n') + '\n',
    'utf8');

  // --- Self-validate ---
  console.log = origLog;
  console.error = origError;

  const validatePassed = validateOutput(runDir);

  // --- Summary ---
  console.log('');
  console.log('=== Stub Adapter Run Complete ===');
  console.log(`  Run ID:      ${runId}`);
  console.log(`  Task:        ${taskId} (${envelope.title || 'no title'})`);
  console.log(`  Agent:       ${agentId}`);
  console.log(`  Runtime:     ${runtime}`);
  console.log(`  Status:      ${status}`);
  console.log(`  Exit code:   ${exitCode}`);
  console.log(`  Run dir:     ${runDir}`);
  console.log(`  Duration:    ${runMeta.duration_seconds}s`);
  console.log(`  Validate:    ${validatePassed ? 'PASSED' : 'WARNINGS'}`);
  console.log('');

  // Exit with the requested code so the runner can observe the mapping
  process.exit(exitCode);
}

main();
