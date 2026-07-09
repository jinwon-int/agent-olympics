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

const path = require('path');

const {
  STATUS_MAP,
  COMMON_OPTIONS,
  isoNow,
  generateRunId,
  parseAdapterArgs,
  loadEnvelope,
  ensureRunDir,
  captureConsole,
  writeAdapterLog,
  makeWriteYaml,
  validateOutput: validateCommonOutput,
} = require('../adapters/lib/adapter-common');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// isoNow / shortId / generateRunId live in adapters/lib/adapter-common.js.

function repoRelative(filePath) {
  const root = path.resolve(__dirname, '..');
  const relative = path.relative(root, filePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : filePath;
}

function parseArgs() {
  return parseAdapterArgs({
    usage: [
      'Usage: node scripts/stub-adapter.js <envelope-path> [options]',
      '',
      'Options:',
      '  --run-dir <path>     Output directory (default: auto-created in results/)',
      '  --agent-id <string>  Agent identifier (default: stub-adapter)',
      '  --runtime <string>   Runtime identifier (default: cli)',
      '  --exit <code>        Simulate exit code: 0=success, 1=fail, 2=timeout, 3=blocked (default: 0)',
      '  --seed <string>      Deterministic seed for stable output ids',
      '  --timestamp <time>   ISO timestamp override for all timestamps',
    ],
    defaults: {
      exitCode: 0,
      agentId: 'stub-adapter',
      runtime: 'cli',
      seed: null,
      timestamp: null,
      runDir: null,
    },
    options: COMMON_OPTIONS,
  });
}

// ---------------------------------------------------------------------------
// Core logic — deterministic stub generation
// ---------------------------------------------------------------------------

function generateResultPacket(
  envelope,
  runId,
  agentId,
  runtime,
  status,
  startedAt,
  endedAt,
  _seed
) {
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
  for (const key of envelope.required_outputs || []) {
    outputs[key] =
      `[stub] Placeholder output for "${key}". Replace with real output from the participant adapter.`;
  }

  const schemaVersion = envelope.schema_version || 1;

  const packet = {
    schema_version: schemaVersion,
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

  // v2 result packets require the comparability / governance blocks. The stub
  // fills them with honest "deterministic stub" defaults so the artifact passes
  // the strict v2 schema without pretending real work happened.
  if (schemaVersion >= 2) {
    packet.division = 'closed_stack';
    packet.validity = 'valid';
    packet.publishable = false;
    packet.tool_use_profile = {
      classes_allowed: ['read'],
      classes_used: ['read'],
      allowed: ['read'],
      used: ['read'],
      disclosure_level: 'full',
      notes:
        'Deterministic stub adapter — only read the input envelope; no live tools were invoked.',
    };
    packet.operating_policy = {
      approval_boundaries: 'not_applicable',
      secret_handling: 'redacted',
      destructive_action_rules: 'destructive_actions_forbidden_without_explicit_approval',
      progress_reporting: 'not_applicable',
      delegation_policy: 'no_subagents_used',
      notes: 'Stub adapter does not execute a real operating policy.',
    };
    packet.delegation_profile = {
      subagents_used: false,
      background_jobs_used: false,
      human_assistance: false,
      a2a_workers: [],
      supported_by: [],
      notes: 'Deterministic stub run — no delegation.',
    };
    packet.comparable_metadata = {
      participant: { agent_id: agentId },
      runtime: { name: runtime },
      model: { provider: 'stub', name: 'deterministic-stub' },
      node: { profile_ref: 'stub' },
      task: { task_id: taskId },
    };
  }

  return packet;
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
        summary:
          'Stub adapter: generating deterministic result artifacts. No live execution performed.',
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

function generateRunMetadata(
  envelopePath,
  envelope,
  runId,
  agentId,
  runtime,
  status,
  exitCode,
  startedAt,
  endedAt,
  artifactPaths
) {
  return {
    schema_version: 1,
    run_id: runId,
    task_id: envelope.task_id || 'unknown',
    envelope_path: repoRelative(envelopePath),
    agent_id: agentId,
    runtime: runtime,
    status: status,
    exit_code: exitCode,
    started_at: startedAt,
    ended_at: endedAt,
    duration_seconds: Math.round((new Date(endedAt) - new Date(startedAt)) / 1000),
    artifacts: artifactPaths.map((p) => path.basename(p)),
    adapter_type: 'stub',
    notes:
      'This is a deterministic stub adapter result. No live participant executed. Use for runner integration tests and CI validation.',
  };
}

// ---------------------------------------------------------------------------
// Validation wrapper
// ---------------------------------------------------------------------------

function validateOutput(runDir) {
  return validateCommonOutput(runDir, {
    logPrefix: 'stub-adapter',
    files: ['result-packet.yaml', 'trace.yaml', 'evidence-bundle.yaml'],
    truncateOutput: false,
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const { envelopePath, opts } = parseArgs();

  // --- Validate input ---
  const envelope = loadEnvelope(envelopePath);

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
  ensureRunDir(runDir);

  // --- Capture stdout/stderr ---
  const capture = captureConsole();

  // Determine status from exit code
  const status = STATUS_MAP[exitCode] || 'blocked';
  const endedAt = overrideTimestamp || isoNow();

  // --- Generate output artifacts ---
  const resultPacket = generateResultPacket(
    envelope,
    runId,
    agentId,
    runtime,
    status,
    startedAt,
    endedAt,
    seed
  );
  const traceRecord = generateTraceRecord(envelope, runId, agentId, startedAt, endedAt);
  const evidenceBundle = generateEvidenceBundle(envelope, runId, agentId, endedAt);
  const runMeta = generateRunMetadata(
    envelopePath,
    envelope,
    runId,
    agentId,
    runtime,
    status,
    exitCode,
    startedAt,
    endedAt,
    [
      'envelope-copy.yaml',
      'result-packet.yaml',
      'trace.yaml',
      'evidence-bundle.yaml',
      'run.yaml',
      'adapter.log',
    ]
  );

  // --- Write artifacts ---
  const writeYaml = makeWriteYaml(runDir);

  writeYaml('envelope-copy.yaml', envelope);
  writeYaml('result-packet.yaml', resultPacket);
  writeYaml('trace.yaml', traceRecord);
  writeYaml('evidence-bundle.yaml', evidenceBundle);

  // --- Self-validate (still captured into the adapter log) ---
  const validatePassed = validateOutput(runDir);

  // run.yaml is written after validation so the outcome can be recorded
  // alongside the run metadata (run.yaml itself is not schema-validated).
  runMeta.validation_passed = validatePassed;
  writeYaml('run.yaml', runMeta);

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

  // Restore console and write the adapter log (now that all output happened)
  writeAdapterLog(runDir, capture);

  // Exit with the requested code so the runner can observe the mapping
  process.exit(exitCode);
}

main();
