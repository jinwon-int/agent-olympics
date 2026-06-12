#!/usr/bin/env node
/**
 * Agent Olympics CLI Adapter (skeleton generator)
 *
 * Produces a schema-valid **result-packet v2** baseline for a task envelope,
 * matching the CLI adapter capability declaration
 * (fixtures/adapters/capabilities/cli.yaml). It is the CLI analogue of
 * adapters/hermes-adapter.js: it bootstraps a clean v2 packet + trace +
 * evidence bundle that the CLI mission wrapper
 * (adapters/wrappers/cli-mission-wrapper.sh) then merges real coding-agent CLI
 * output into.
 *
 * Unlike Hermes (an orchestrator that dispatches A2A workers), a bare CLI
 * coding agent is SOLO: delegation_profile.subagents_used is false and there
 * are no a2a_workers. The runtime/adapter labels are `cli` so the live
 * runner's runtime_identity gate and the layer-3 artifact fingerprint treat it
 * as a CLI participant — never hermes.
 *
 * Evidence kinds are CLI-native (command_output / log / file_diff /
 * config_snippet / transcript_excerpt), matching cli.yaml.
 *
 * Usage:
 *   node scripts/cli-adapter.js <envelope-path>                 # one shot
 *   node scripts/cli-adapter.js <envelope-path> --run-dir /tmp/run
 *   node scripts/cli-adapter.js <envelope-path> --agent-id claude-code
 *   node scripts/cli-adapter.js <envelope-path> --model claude-opus-4 \
 *     --model-provider anthropic --runtime-version 1.2.3
 *
 * Exit codes (aligned with adapter-execution-contract):
 *   0  — success (completed)
 *   1  — execution failure (failed)
 *   2  — timeout / partial result (partial)
 *   3  — argument or prereq error (blocked)
 */

'use strict';

const path = require('path');

const {
  STATUS_MAP,
  RUNTIME_ADAPTER_OPTIONS,
  isoNow,
  generateRunId,
  pseudoHash,
  parseAdapterArgs,
  loadEnvelope,
  ensureRunDir,
  captureConsole,
  writeAdapterLog,
  makeWriteYaml,
  buildOutputs: buildCommonOutputs,
  generateRunMetadata: generateCommonRunMetadata,
  validateOutput: validateCommonOutput,
} = require('../adapters/lib/adapter-common');

// ---------------------------------------------------------------------------
// CLI evidence id set — shared with the merge script so both the skeleton and
// the merge agree on which ids carry the agent answer / transcript / probe.
// (scripts/cli-mission-result-merge.js imports CLI_EVIDENCE_IDS from here.)
// ---------------------------------------------------------------------------

const CLI_EVIDENCE_IDS = Object.freeze({
  report: 'ev-cli-report',          // the agent's synthesized answer (commander-report analogue)
  transcript: 'ev-cli-transcript',  // captured terminal transcript (worker-traces analogue)
  probe: 'ev-cli-probe',            // CLI invocation probe (exit code, model attestation)
  input: 'ev-cli-input',            // task envelope copy
  command: 'ev-cli-command',        // command log
});

function parseArgs() {
  return parseAdapterArgs({
    usage: [
      'Usage: node scripts/cli-adapter.js <envelope-path> [options]',
      '',
      'Options:',
      '  --run-dir <path>          Output directory (default: auto-created)',
      '  --agent-id <string>       Agent identifier (default: cli-agent)',
      '  --runtime <string>        Runtime identifier (default: cli)',
      '  --runtime-version <str>   CLI agent version (default: unknown)',
      '  --model <name>            Model name (default: unknown)',
      '  --model-provider <name>   Model provider (default: unknown)',
      '  --exit <code>             Simulated exit code: 0|1|2|3 (default: 0)',
      '  --seed <string>           Deterministic seed for stable output IDs',
      '  --timestamp <time>        ISO timestamp override',
      '  --publishable             Mark result as publishable (default: false)',
    ],
    defaults: {
      exitCode: 0, agentId: 'cli-agent', runtime: 'cli', runtimeVersion: 'unknown',
      model: 'unknown', modelProvider: 'unknown',
      seed: null, timestamp: null, runDir: null, publishable: false,
      // mode/eventFamily are accepted for symmetry with the runtime adapters
      // but the CLI adapter is single-shot; they only flavour summaries.
      mode: 'cli', eventFamily: 'ops',
    },
    options: RUNTIME_ADAPTER_OPTIONS,
  });
}

// ---------------------------------------------------------------------------
// CLI → RESULT PACKET (v2) MAPPING
// ---------------------------------------------------------------------------

function generateResultPacket(envelope, runId, agentId, runtime, runtimeVersion,
  model, modelProvider, status, startedAt, endedAt, publishable) {

  const taskId = envelope.task_id || 'unknown-task';
  const division = 'open_stack';
  const validity = {
    completed: 'valid',
    partial: 'partial_valid',
    blocked: 'partial_valid',
    failed: 'invalid',
    disqualified: 'disqualified',
  }[status] || 'invalid';

  const evidence = [
    {
      id: CLI_EVIDENCE_IDS.input,
      kind: 'config_snippet',
      source: 'task envelope',
      summary: `Input task envelope for task "${taskId}".`,
      content_ref: 'envelope-copy.yaml',
      content_type: 'application/x-yaml',
      redacted: false,
    },
    {
      id: CLI_EVIDENCE_IDS.command,
      kind: 'log',
      source: 'cli adapter',
      summary: 'Command log for the CLI agent invocation (workspace-local, read-only inspection).',
      content_ref: 'adapter.log',
      content_type: 'text/plain',
      redacted: false,
    },
    {
      id: CLI_EVIDENCE_IDS.transcript,
      kind: 'transcript_excerpt',
      source: 'cli terminal transcript',
      summary: 'Captured terminal transcript of the coding-agent CLI session (redaction applied before persisting).',
      content_ref: 'evidence/cli-transcript.yaml',
      content_type: 'application/x-yaml',
      redacted: false,
    },
    {
      id: CLI_EVIDENCE_IDS.probe,
      kind: 'command_output',
      source: 'cli invocation probe',
      summary: 'CLI invocation result: exit code, wall time, and model attestation source.',
      redacted: false,
    },
    {
      id: CLI_EVIDENCE_IDS.report,
      kind: 'command_output',
      source: 'cli agent answer',
      summary: 'Synthesized CLI agent answer (mission diagnosis / outputs).',
      content_ref: 'evidence/cli-report.yaml',
      content_type: 'application/x-yaml',
      redacted: false,
    },
  ];

  const findings = [
    {
      claim: `CLI agent "${agentId}" executed task "${taskId}" with status "${status}" as a solo coding-agent session.`,
      evidence: [CLI_EVIDENCE_IDS.report, CLI_EVIDENCE_IDS.probe],
      confidence: 'high',
    },
    {
      claim: 'Terminal transcript captured for the run; no subagents or A2A workers were used.',
      evidence: [CLI_EVIDENCE_IDS.transcript],
      confidence: 'medium',
    },
  ];

  const outputs = buildCommonOutputs(envelope, 'cli', 'cli', 'ops', status, ' CLI agent answer captured.');
  if (Object.keys(outputs).length === 0) {
    outputs.cli_report = `[cli-adapter] CLI agent answer. Status: ${status}.`;
  }

  const comparableMetadata = {
    participant: { agent_id: agentId, adapter: 'cli' },
    runtime: { name: 'cli', version: runtimeVersion },
    model: { name: model, provider: modelProvider },
    node: {
      profile_ref: 'cli-workspace-node',
      hardware_profile: {
        cpu_class: 'workstation',
        memory_gb: 8,
        storage_class: 'local-ssd',
        os_family: 'linux',
      },
    },
    config: {
      profile_ref: 'cli-default',
      details: {
        adapter_mode: 'cli',
        liveness: 'local-cli',
        model_routing: 'cli_config',
      },
    },
    task: {
      task_id: taskId,
      task_version: `v${envelope.schema_version || 1}`,
    },
    artifact_hashes: {
      result_packet: `sha256:${pseudoHash(`${runId}-rp`)}`,
      trace_record: `sha256:${pseudoHash(`${runId}-tr`)}`,
      evidence_bundle: `sha256:${pseudoHash(`${runId}-eb`)}`,
    },
  };

  return {
    schema_version: 2,
    task_id: taskId,
    agent_id: agentId,
    adapter: 'cli',
    runtime: 'cli',
    runtime_version: runtimeVersion,
    model: model,
    model_provider: modelProvider,
    node: 'cli-workspace-node',
    hardware_profile: {
      cpu_class: 'workstation',
      memory_gb: 8,
      storage_class: 'local-ssd',
      os_family: 'linux',
    },
    configuration_profile: {
      model_routing: 'cli_config',
      liveness: 'local-cli',
      resource_limits: 'workspace-scoped',
      adapter_mode: 'cli',
      sandbox_mode: 'workspace_only',
    },
    tool_use_profile: {
      allowed: ['read', 'write', 'exec'],
      used: ['read', 'exec'],
      notes: 'Bare coding-agent CLI: workspace-local read/exec. Intentionally avoided: delegate, message, web_search.',
    },
    operating_policy: {
      approval_boundaries: 'documented',
      secret_handling: 'redacted',
      destructive_action_rules: 'destructive_actions_forbidden_without_explicit_approval',
      progress_reporting: 'required_for_long_tasks',
      delegation_policy: 'no_subagents_used',
    },
    delegation_profile: {
      subagents_used: false,
      background_jobs_used: false,
      human_assistance: false,
      a2a_workers: [],
      supported_by: [],
      notes: 'Bare CLI coding agent — a single solo session with no subagents or A2A workers.',
    },
    started_at: startedAt,
    ended_at: endedAt,
    status: status,
    division: division,
    validity: validity,
    publishable: publishable,
    comparable_metadata: comparableMetadata,
    raw_measurements: {
      wall_time_seconds: Math.round((new Date(endedAt) - new Date(startedAt)) / 1000),
      action_count: 3,
      evidence_count: evidence.length,
      finding_count: findings.length,
      retries: 0,
      errors: 0,
    },
    summary: `CLI adapter run for task "${taskId}". Solo coding-agent CLI session. Status: ${status}.`,
    actions: [
      { id: 'act-001', type: 'read', target: 'task_envelope', command_summary: 'Read task envelope from file', redacted: false, duration_seconds: 0.02, evidence_id: CLI_EVIDENCE_IDS.input },
      { id: 'act-002', type: 'exec', target: 'cli_agent', command_summary: 'Invoke the coding-agent CLI with the public task envelope', redacted: false, duration_seconds: 0.5, evidence_id: CLI_EVIDENCE_IDS.probe },
      { id: 'act-003', type: 'read', target: 'cli_report', command_summary: 'Capture the CLI agent answer into the result packet', redacted: false, duration_seconds: 0.1, evidence_id: CLI_EVIDENCE_IDS.report },
    ],
    evidence: evidence,
    findings: findings,
    outputs: outputs,
    risks: [
      'CLI transcript may contain credential-like strings; redaction is applied before any transcript is persisted.',
      'A bare CLI agent has no built-in approval-boundary enforcement; boundaries are enforced by the runner.',
    ],
  };
}

function generateTraceRecord(envelope, runId, agentId, startedAt, endedAt) {
  return {
    schema_version: 1,
    trace_id: `tr-cli-${runId}`,
    run_id: runId,
    agent_id: agentId,
    runtime: 'cli',
    generated_at: endedAt,
    adapter_mode: 'cli',
    entries: [
      {
        seq: 0,
        timestamp: startedAt,
        action: 'read',
        target: 'task_envelope',
        summary: `Read task envelope "${envelope.task_id || 'unknown'}" from disk.`,
        duration_ms: 20,
        result_summary: `Loaded envelope: ${envelope.title || envelope.task_id || 'unknown'}`,
        evidence_ref: CLI_EVIDENCE_IDS.input,
      },
      {
        seq: 1,
        timestamp: startedAt,
        action: 'exec',
        target: 'cli_agent',
        summary: 'Invoke the coding-agent CLI with the public task envelope and participant-facing fixture paths.',
        duration_ms: 500,
        result_summary: 'CLI agent session executed; transcript captured.',
        evidence_ref: CLI_EVIDENCE_IDS.probe,
      },
      {
        seq: 2,
        timestamp: endedAt,
        action: 'synthesize',
        target: 'cli_report',
        summary: 'Capture the CLI agent answer and write result artifacts to the run directory.',
        duration_ms: 100,
        result_summary: `Artifacts written for run ${runId}.`,
        evidence_ref: CLI_EVIDENCE_IDS.report,
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
    runtime: 'cli',
    generated_at: endedAt,
    adapter_mode: 'cli',
    items: [
      {
        id: CLI_EVIDENCE_IDS.input,
        kind: 'config_snippet',
        source: 'task envelope',
        summary: `Copy of the input task envelope "${envelope.task_id || 'unknown'}".`,
        content_ref: 'envelope-copy.yaml',
        content_type: 'application/x-yaml',
        redacted: false,
      },
      {
        id: CLI_EVIDENCE_IDS.transcript,
        kind: 'transcript_excerpt',
        source: 'cli terminal transcript',
        summary: 'Captured terminal transcript of the coding-agent CLI session (redacted before persisting).',
        content_ref: 'evidence/cli-transcript.yaml',
        content_type: 'application/x-yaml',
        redacted: false,
      },
      {
        id: CLI_EVIDENCE_IDS.report,
        kind: 'command_output',
        source: 'cli agent answer',
        summary: 'Synthesized CLI agent answer (mission diagnosis / outputs).',
        content_ref: 'evidence/cli-report.yaml',
        content_type: 'application/x-yaml',
        redacted: false,
      },
    ],
  };
}

function validateOutput(runDir) {
  return validateCommonOutput(runDir, {
    logPrefix: 'cli-adapter',
    files: ['result-packet.yaml', 'trace.yaml', 'evidence-bundle.yaml'],
  });
}

function main() {
  const { envelopePath, opts } = parseArgs();
  const envelope = loadEnvelope(envelopePath);

  const taskId = envelope.task_id;
  const agentId = opts.agentId;
  const runtime = opts.runtime;
  const runtimeVersion = opts.runtimeVersion;
  const model = opts.model;
  const modelProvider = opts.modelProvider;
  const exitCode = opts.exitCode;
  const seed = opts.seed;
  const overrideTimestamp = opts.timestamp;
  const publishable = opts.publishable;

  const startedAt = overrideTimestamp || isoNow();
  const runId = generateRunId(taskId, agentId, seed, startedAt);

  const runDir = opts.runDir || path.resolve(__dirname, '..', 'results', `cli-${taskId}-${runId}`);
  ensureRunDir(runDir, true);

  const capture = captureConsole();

  const status = STATUS_MAP[exitCode] || 'blocked';
  const endedAt = overrideTimestamp || isoNow();

  const resultPacket = generateResultPacket(envelope, runId, agentId, runtime, runtimeVersion,
    model, modelProvider, status, startedAt, endedAt, publishable);
  const traceRecord = generateTraceRecord(envelope, runId, agentId, startedAt, endedAt);
  const evidenceBundle = generateEvidenceBundle(envelope, runId, agentId, endedAt);
  const runMeta = generateCommonRunMetadata(envelopePath, envelope, runId, agentId, runtime, status, exitCode,
    startedAt, endedAt, 'cli', 'ops', runtimeVersion,
    ['envelope-copy.yaml', 'result-packet.yaml', 'trace.yaml', 'evidence-bundle.yaml', 'run.yaml', 'adapter.log'],
    {
      adapterType: 'cli',
      adapterVersion: '1.0.0',
      notes: 'CLI adapter skeleton. Solo coding-agent CLI session. The mission wrapper merges real CLI output into these artifacts.',
    });

  const writeYaml = makeWriteYaml(runDir);

  // Seed evidence sub-file content so the skeleton validates standalone; the
  // merge script overwrites these with the real CLI session content.
  writeYaml('evidence/cli-transcript.yaml', {
    schema_version: 1,
    generated_at: endedAt,
    task_id: taskId,
    worker: 'local-cli-agent',
    note: 'Skeleton transcript placeholder — replaced by the mission wrapper with the redacted CLI session transcript.',
  });
  writeYaml('evidence/cli-report.yaml', {
    schema_version: 1,
    generated_at: endedAt,
    task_id: taskId,
    source: 'cli adapter skeleton',
    note: 'Skeleton report placeholder — replaced by the mission wrapper with the real CLI agent answer.',
  });

  writeYaml('envelope-copy.yaml', envelope);
  writeYaml('result-packet.yaml', resultPacket);
  writeYaml('trace.yaml', traceRecord);
  writeYaml('evidence-bundle.yaml', evidenceBundle);

  const validatePassed = validateOutput(runDir);
  runMeta.validation_passed = validatePassed;
  writeYaml('run.yaml', runMeta);

  console.log('');
  console.log('=== CLI Adapter Run Complete ===');
  console.log(`  Run ID:          ${runId}`);
  console.log(`  Task:            ${taskId} (${envelope.title || 'no title'})`);
  console.log(`  Agent:           ${agentId}`);
  console.log(`  Runtime:         ${runtime} ${runtimeVersion}`);
  console.log(`  Model:           ${model} (${modelProvider})`);
  console.log(`  Status:          ${status}`);
  console.log(`  Exit code:       ${exitCode}`);
  console.log(`  Run dir:         ${runDir}`);
  console.log(`  Validate:        ${validatePassed ? 'PASSED' : 'WARNINGS'}`);
  console.log('');

  writeAdapterLog(runDir, capture);
  process.exit(exitCode);
}

if (require.main === module) {
  main();
}

module.exports = { CLI_EVIDENCE_IDS };
