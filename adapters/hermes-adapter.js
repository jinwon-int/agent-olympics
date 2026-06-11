#!/usr/bin/env node
/**
 * Agent Olympics Hermes Adapter
 *
 * Accepts a Task Envelope, decomposes it into a multi-step workflow plan,
 * simulates Hermes orchestration with worker assignments and memory
 * retrieval, and produces:
 *   - result-packet.yaml   (with aggregated hierarchical execution data)
 *   - trace.yaml           (orchestrator-level session journal)
 *   - evidence-bundle.yaml (workflow plan, worker traces, memory summaries)
 *   - manifest.yaml        (artifact manifest per manifest schema)
 *   - run.yaml             (run metadata)
 *   - envelope-copy.yaml   (input copy)
 *   - adapter.log          (captured output)
 *
 * The Hermes adapter is an **orchestrator** — it decomposes a single task
 * into sub-tasks, assigns workers, collects results, and synthesizes a
 * coherent result.  Core differentiators from the OpenClaw runtime adapter:
 *   - Hierarchical evidence merging from multiple workers
 *   - Contradictory evidence resolution
 *   - Worker-level tool traces and memory retrieval summaries
 *   - Workflow plan as first-class artifact
 *
 * Usage:
 *   node adapters/hermes-adapter.js <envelope-path>                # one shot
 *   node adapters/hermes-adapter.js <envelope-path> --run-dir /tmp/run
 *   node adapters/hermes-adapter.js <envelope-path> --event-family ops
 *   node adapters/hermes-adapter.js <envelope-path> --mode orchestrator
 *
 * Exit codes (aligned with adapter-execution-contract):
 *   0  — success (completed)
 *   1  — execution failure (failed)
 *   2  — timeout / partial result (partial)
 *   3  — argument or prereq error (blocked)
 *
 * Adapter Execution Contract version: 1 (§10 addenda: Hermes)
 */

'use strict';

const path = require('path');

const {
  STATUS_MAP,
  RUNTIME_ADAPTER_OPTIONS,
  isoNow,
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
  buildOutputs: buildCommonOutputs,
  generateRunMetadata: generateCommonRunMetadata,
  validateOutput: validateCommonOutput,
  printAdapterMetadataSummary,
} = require('./lib/adapter-common');

// ---------------------------------------------------------------------------
// ADAPTER METADATA
// ---------------------------------------------------------------------------
// These constants make Hermes workflow orchestration data first-class.
// See docs/hermes-adapter.md for the complete metadata spec.
// ---------------------------------------------------------------------------

const ADAPTER_METADATA = Object.freeze({
  /** Adapter identity */
  adapter: 'hermes',
  adapter_version: '1.0.0',
  adapter_vendor: 'agent-olympics',
  adapter_type: 'orchestrator',

  /** Supported contract and schema versions */
  supported_envelope_versions: [1, 2],
  supported_result_packet_versions: [1, 2],
  supported_trace_versions: [1],
  supported_evidence_bundle_versions: [1],
  supported_manifest_version: 1,

  /** Event families this adapter can process */
  supported_event_families: [
    'ops',           // Operations relay — diagnostics, response, monitoring
    'code',          // Code assist — writing, reviewing, debugging
    'smoke',         // Smoke test — readiness verification, capability reports
    'node',          // Node readiness — hardware/software capability matrix
    'wiki',          // Wiki/runbook — durable knowledge capture
    'general',       // General purpose agent tasks
    'coord',         // Coordination drills — multi-agent orchestration
  ],

  /** Required environment variables (described, not exposed) */
  required_environment_variables: [
    'HERMES_ORCHESTRATOR_URL',    // Hermes orchestrator endpoint
    'HERMES_API_KEY',             // Hermes orchestrator API key (REDACTED)
    'AGENT_OLYMPICS_TASK_DIR',    // Task envelope and fixture directory
  ],

  /** Optional environment variables with safe descriptions */
  optional_environment_variables: [
    'HERMES_WORKER_TIMEOUT_SECONDS',   // Max per-worker runtime (default: 300)
    'HERMES_MAX_CONCURRENT_WORKERS',   // Max parallel workers (default: 3)
    'HERMES_WORKER_POOL',              // Worker pool config ref (default: stub)
    'AGENT_OLYMPICS_RUN_DIR',          // Override output directory
  ],

  /** Redaction rules applied by this adapter */
  redaction_rules: [
    {
      id: 'rr-hermes-001',
      pattern_description: 'Credential-like strings in worker command output or API response',
      reason: 'hermes_credential_in_worker_output',
      scope: 'worker_output',
    },
    {
      id: 'rr-hermes-002',
      pattern_description: 'Private memory content in retrieval summaries',
      reason: 'hermes_memory_content',
      scope: 'memory_retrieval',
    },
    {
      id: 'rr-hermes-003',
      pattern_description: 'Sensitive parameter values in workflow invocation arguments',
      reason: 'hermes_workflow_arguments',
      scope: 'workflow_arguments',
    },
    {
      id: 'rr-hermes-004',
      pattern_description: 'Worker session tokens and credentials in trace entries',
      reason: 'prevent_worker_credential_exposure_in_trace',
      scope: 'worker_trace',
    },
  ],

  /** Evidence kinds this adapter can produce */
  evidence_capabilities: [
    { kind: 'workflow_plan',       description: 'Task decomposition plan with worker assignments' },
    { kind: 'worker_trace',        description: 'Individual worker trace with tool calls' },
    { kind: 'memory_summary',      description: 'Memory retrieval summary per worker (redacted)' },
    { kind: 'commander_report',    description: 'Synthesized findings after all workers complete' },
    { kind: 'contradiction_log',   description: 'Log of contradictory worker evidence and resolution' },
    { kind: 'worker_assignment',   description: 'Worker identifier and assigned subtask' },
    { kind: 'workflow_state',      description: 'Workflow state transitions (pending → running → completed)' },
    { kind: 'config_snippet',      description: 'Configuration snippet (no secrets)' },
    { kind: 'probe_result',        description: 'Workflow or worker readiness probe result' },
    { kind: 'artifact_hash',       description: 'Content hash for tamper detection' },
  ],

  /** Timeout handling */
  timeout_handling: Object.freeze({
    default_timeout_seconds: 900,
    max_timeout_seconds: 3600,
    timeout_status: 'partial',
    timeout_grace_seconds: 60,
    timeout_evidence_kind: 'workflow_state',
    timeout_action: 'force_terminate_all_workers_and_capture_partial_results',
  }),

  /** Adapter modes */
  modes: Object.freeze({
    orchestrator: {
      description: 'Orchestrator mode — full workflow decomposition with worker dispatch and result synthesis',
      default_worker_count: 3,
      allowed_worker_profiles: ['stub-small-vps', 'stub-medium-vps'],
      required_evidence: ['workflow_plan', 'worker_assignment', 'commander_report'],
    },
    coordinator: {
      description: 'Coordinator mode — simplified dispatch without hierarchical evidence merging',
      default_worker_count: 2,
      allowed_worker_profiles: ['stub-small-vps'],
      required_evidence: ['workflow_plan', 'worker_assignment'],
    },
    simulation: {
      description: 'Simulation mode — deterministic output using fixture data without live workers',
      default_worker_count: 1,
      allowed_worker_profiles: ['stub-small-vps'],
      required_evidence: ['workflow_plan', 'commander_report'],
    },
  }),
});

// ---------------------------------------------------------------------------
// EVENT FAMILY × ADAPTER MODE CAPABILITY MATRIX
// ---------------------------------------------------------------------------
// Maps each supported event family to the adapter modes and result statuses
// it can produce, along with required evidence kinds per task type.
// See docs/hermes-adapter.md → "Supported Task/Result Capabilities"
// ---------------------------------------------------------------------------

const CAPABILITY_MATRIX = Object.freeze({
  ops: {
    description: 'Operations relay — diagnostics, incident response, monitoring',
    supported_modes: ['orchestrator', 'coordinator', 'simulation'],
    mode_defaults: { orchestrator: {}, coordinator: {}, simulation: {} },
    applicable_statuses: ['completed', 'partial', 'failed', 'blocked', 'disqualified'],
    required_evidence_per_status: Object.freeze({
      completed:     ['workflow_plan', 'worker_trace', 'commander_report', 'memory_summary', 'config_snippet'],
      partial:       ['workflow_plan', 'worker_trace', 'commander_report', 'workflow_state'],
      failed:        ['workflow_plan', 'worker_trace', 'contradiction_log'],
      blocked:       ['workflow_plan', 'workflow_state'],
      disqualified:  ['workflow_plan', 'contradiction_log', 'workflow_state'],
    }),
  },
  code: {
    description: 'Code assist — writing, reviewing, debugging',
    supported_modes: ['orchestrator', 'simulation'],
    mode_defaults: { orchestrator: {}, simulation: {} },
    applicable_statuses: ['completed', 'partial', 'failed'],
    required_evidence_per_status: Object.freeze({
      completed: ['workflow_plan', 'worker_trace', 'commander_report', 'memory_summary', 'artifact_hash'],
      partial:   ['workflow_plan', 'worker_trace', 'commander_report'],
      failed:    ['workflow_plan', 'worker_trace', 'contradiction_log'],
    }),
  },
  smoke: {
    description: 'Smoke test — readiness verification, capability reports',
    supported_modes: ['orchestrator', 'simulation'],
    mode_defaults: { orchestrator: {}, simulation: {} },
    applicable_statuses: ['completed', 'failed'],
    required_evidence_per_status: Object.freeze({
      completed: ['workflow_plan', 'commander_report', 'probe_result', 'config_snippet'],
      failed:    ['workflow_plan', 'commander_report', 'contradiction_log'],
    }),
  },
  node: {
    description: 'Node readiness — hardware/software capability matrix',
    supported_modes: ['orchestrator', 'simulation'],
    mode_defaults: { orchestrator: {}, simulation: {} },
    applicable_statuses: ['completed', 'failed'],
    required_evidence_per_status: Object.freeze({
      completed: ['workflow_plan', 'commander_report', 'config_snippet', 'probe_result'],
      failed:    ['workflow_plan', 'worker_trace', 'contradiction_log'],
    }),
  },
  wiki: {
    description: 'Wiki/runbook — durable knowledge capture',
    supported_modes: ['orchestrator', 'simulation'],
    mode_defaults: { orchestrator: {}, simulation: {} },
    applicable_statuses: ['completed', 'partial', 'failed'],
    required_evidence_per_status: Object.freeze({
      completed: ['workflow_plan', 'worker_trace', 'commander_report', 'memory_summary', 'artifact_hash'],
      partial:   ['workflow_plan', 'worker_trace', 'commander_report', 'workflow_state'],
      failed:    ['workflow_plan', 'worker_trace', 'contradiction_log'],
    }),
  },
  general: {
    description: 'General purpose agent tasks',
    supported_modes: ['orchestrator', 'coordinator', 'simulation'],
    mode_defaults: { orchestrator: {}, coordinator: {}, simulation: {} },
    applicable_statuses: ['completed', 'partial', 'failed', 'blocked'],
    required_evidence_per_status: Object.freeze({
      completed: ['workflow_plan', 'worker_trace', 'commander_report', 'memory_summary'],
      partial:   ['workflow_plan', 'worker_trace', 'workflow_state'],
      failed:    ['workflow_plan', 'worker_trace', 'contradiction_log'],
      blocked:   ['workflow_plan', 'workflow_state'],
    }),
  },
  coord: {
    description: 'Coordination drills — multi-agent orchestration',
    supported_modes: ['orchestrator', 'coordinator'],
    mode_defaults: { orchestrator: {}, coordinator: {} },
    applicable_statuses: ['completed', 'partial', 'failed', 'disqualified'],
    required_evidence_per_status: Object.freeze({
      completed:     ['workflow_plan', 'worker_trace', 'commander_report', 'memory_summary', 'contradiction_log'],
      partial:       ['workflow_plan', 'worker_trace', 'commander_report', 'workflow_state'],
      failed:        ['workflow_plan', 'worker_trace', 'contradiction_log'],
      disqualified:  ['workflow_plan', 'contradiction_log', 'workflow_state'],
    }),
  },
});

// ---------------------------------------------------------------------------
// STATUS MAPPING
// ---------------------------------------------------------------------------
// Exit-code → status and status → exit-code maps (STATUS_MAP,
// RUNNER_EXIT_MAP) are shared scaffolding in adapters/lib/adapter-common.js.

// ---------------------------------------------------------------------------
// HERMES INTERNAL STATUS MAPPING
// ---------------------------------------------------------------------------
// Maps Hermes workflow states to standard result packet statuses.

const HERMES_STATUS_MAP = Object.freeze({
  workflow_completed_all_outputs_present: 'completed',
  workflow_completed_some_outputs_missing: 'partial',
  workflow_timed_out: 'partial',
  workflow_blocked_worker_assignment: 'blocked',
  workflow_blocked_memory_retrieval: 'blocked',
  workflow_blocked_missing_plugin: 'blocked',
  workflow_produced_wrong_result: 'failed',
  workflow_contradictory_unresolved: 'failed',
  value_exposure_detected: 'disqualified',
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// isoNow / shortId / generateRunId live in adapters/lib/adapter-common.js.

function generateWorkflowId(taskId, agentId, seed, timestamp) {
  return generatePrefixedId('wf', taskId, agentId, seed, timestamp);
}

function parseArgs() {
  return parseAdapterArgs({
    usage: [
      'Usage: node adapters/hermes-adapter.js <envelope-path> [options]',
      '',
      'Options:',
      '  --run-dir <path>          Output directory (default: auto-created)',
      '  --agent-id <string>       Agent identifier (default: sogyo)',
      '  --runtime <string>        Runtime identifier (default: hermes)',
      '  --runtime-version <str>   Hermes runtime version (default: 1.0.0)',
      '  --mode <mode>             Adapter mode: orchestrator, coordinator, simulation',
      '  --event-family <family>   Event family: ops, code, smoke, node, wiki, general, coord',
      '  --model <name>            Model name (default: gpt-5.x)',
      '  --model-provider <name>   Model provider (default: openai)',
      '  --exit <code>             Simulated exit code: 0|1|2|3 (default: 0)',
      '  --seed <string>           Deterministic seed for stable output IDs',
      '  --timestamp <time>        ISO timestamp override',
      '  --publishable             Mark result as publishable (default: false)',
      '  --contradictory           Simulate contradictory worker evidence (default: false)',
    ],
    defaults: {
      exitCode: 0, agentId: 'sogyo', runtime: 'hermes', runtimeVersion: '1.0.0',
      mode: 'orchestrator', eventFamily: 'ops', model: 'gpt-5.x', modelProvider: 'openai',
      seed: null, timestamp: null, runDir: null, publishable: false, contradictory: false,
    },
    options: {
      ...RUNTIME_ADAPTER_OPTIONS,
      '--contradictory': { key: 'contradictory', kind: 'flag' },
    },
  });
}

// ---------------------------------------------------------------------------
// HERMES RUN ARTIFACT MAPPING
// ---------------------------------------------------------------------------
// These functions map Hermes workflow orchestration concepts to the standard
// Agent Olympics result-packet / trace / evidence-bundle / manifest formats.
// Each mapping is documented in adapters/hermes-adapter.js and in
// docs/hermes-adapter.md.
// ---------------------------------------------------------------------------

/**
 * HERMES → RESULT PACKET MAPPING
 *
 * Hermes runtime data              → Result Packet field
 * ────────────────────────────────────────────────────────
 * Workflow ID                      → outputs.workflow.workflow_id
 * Runtime release version          → runtime_version
 * Worker count and profiles        → raw_measurements.worker_count
 * Workflow plan steps              → outputs.workflow.step_count
 * Orchestrator started at          → started_at
 * Orchestrator ended at            → ended_at
 * Worker readiness probe           → raw_measurements.worker_ready_seconds
 * Worker dispatches                → actions[] (aggregated)
 * Memory retrieval summaries       → evidence[].kind=memory_summary
 * Contradictions log               → evidence[].kind=contradiction_log
 * Final synthesized report         → findings[].claim (commander synthesis)
 * Workflow outcome                 → status
 * Redacted data notes              → actions[].redacted, actions[].redaction_reason
 */
function generateResultPacket(envelope, runId, agentId, runtime, runtimeVersion,
  mode, eventFamily, model, modelProvider, status, startedAt, endedAt,
  seed, publishable, contradictory) {

  const taskId = envelope.task_id || 'unknown-task';
  const workflowId = generateWorkflowId(taskId, agentId, seed, startedAt);
  const division = {
    orchestrator: 'open_stack',
    coordinator: 'closed_stack',
    simulation: 'open_stack',
  }[mode] || 'open_stack';
  const validity = {
    completed: 'valid',
    partial: 'partial_valid',
    blocked: 'partial_valid',
    failed: 'invalid',
    disqualified: 'disqualified',
  }[status] || 'invalid';

  // Build workflow plan summary
  const stepCount = getStepCountForFamily(eventFamily);
  const workerCount = getWorkerCountForMode(mode, eventFamily);

  // Capture Hermes-specific raw measurements
  const rawMeasurements = {
    wall_time_seconds: Math.round((new Date(endedAt) - new Date(startedAt)) / 1000),
    workflow_step_count: stepCount,
    worker_count: workerCount,
    workers_completed: workerCount,
    workers_failed: contradictory ? 1 : 0,
    memory_retrievals: stepCount * 2,
    memory_cache_hit_ratio: 0.5,
    tool_invocations_total: stepCount * 3,
    retries: contradictory ? 1 : 0,
    errors: contradictory ? 1 : 0,
    contradictions_detected: contradictory ? 2 : 0,
    contradictions_resolved: 0,
    delivery_probes_attempted: 1,
    delivery_probes_succeeded: 1,
  };

  // Build tool use profile from the mode
  const toolUseProfile = buildToolUseProfile(mode);

  // Build actions (orchestrator-level) with redaction status
  const actions = buildActions(mode, eventFamily, status, contradictory);

  // Build evidence items including workflow plan, worker traces, memory summaries
  const evidence = buildEvidence(mode, eventFamily, runId, workflowId, status, contradictory, stepCount);

  // Build findings
  const findings = buildFindings(taskId, workflowId, status, eventFamily, contradictory);

  // Build outputs
  const outputs = buildOutputs(envelope, mode, eventFamily, status);

  // Workflow orchestration summary lives in outputs — the v2 result packet
  // schema does not allow extra blocks inside comparable_metadata.
  outputs.workflow = {
    workflow_id: workflowId,
    step_count: stepCount,
    worker_count: workerCount,
    worker_profiles: getWorkerProfilesForMode(mode),
  };

  // Build comparable metadata
  const comparableMetadata = {
    participant: {
      agent_id: agentId,
      adapter: 'hermes',
    },
    runtime: {
      name: 'hermes',
      version: runtimeVersion,
    },
    model: {
      name: model,
      provider: modelProvider,
    },
    node: {
      profile_ref: 'orchestrator-node',
      hardware_profile: {
        cpu_class: 'medium-vps',
        memory_gb: 4,
        storage_class: 'nvme-shared',
        os_family: 'linux',
      },
    },
    config: {
      profile_ref: mode === 'coordinator' ? 'coordinator-default' : 'orchestrator-default',
      details: {
        adapter_mode: mode,
        event_family: eventFamily,
        timeout_seconds: ADAPTER_METADATA.timeout_handling.default_timeout_seconds,
        max_concurrent_workers: ADAPTER_METADATA.modes[mode].default_worker_count,
      },
    },
    task: {
      task_id: taskId,
      task_version: `v${envelope.schema_version || 2}`,
    },
    artifact_hashes: {
      result_packet: `sha256:${pseudoHash(`${runId}-rp`)}`,
      trace_record: `sha256:${pseudoHash(`${runId}-tr`)}`,
      evidence_bundle: `sha256:${pseudoHash(`${runId}-eb`)}`,
    },
  };

  return {
    schema_version: envelope.schema_version || 2,
    task_id: taskId,
    agent_id: agentId,
    adapter: 'hermes',
    runtime: 'hermes',
    runtime_version: runtimeVersion,
    model: model,
    model_provider: modelProvider,
    node: 'orchestrator-node',
    hardware_profile: {
      cpu_class: 'medium-vps',
      memory_gb: 4,
      storage_class: 'nvme-shared',
      os_family: 'linux',
    },
    configuration_profile: {
      model_routing: mode === 'coordinator' ? 'fixed' : 'documented',
      liveness: 'hermes-orchestrator',
      resource_limits: 'configured',
      adapter_mode: mode,
      event_family: eventFamily,
      worker_count: workerCount,
      max_concurrent_workers: ADAPTER_METADATA.modes[mode].default_worker_count,
    },
    tool_use_profile: toolUseProfile,
    operating_policy: {
      approval_boundaries: 'documented',
      secret_handling: 'redacted',
      destructive_action_rules: 'destructive_actions_forbidden_without_explicit_approval',
      progress_reporting: 'required_for_long_tasks',
      delegation_policy: 'worker_dispatched',
      timeout_handling: `timeout_after_${ADAPTER_METADATA.timeout_handling.default_timeout_seconds}s_status_${ADAPTER_METADATA.timeout_handling.timeout_status}`,
      contradiction_resolution: contradictory ? 'requires_human_in_loop' : 'automated_resolved',
    },
    delegation_profile: {
      subagents_used: true,
      background_jobs_used: false,
      human_assistance: false,
      a2a_workers: getWorkerProfilesForMode(mode),
      supported_by: [],
      notes: `Hermes orchestrator dispatched ${workerCount} workers across ${stepCount} workflow steps.`,
    },
    started_at: startedAt,
    ended_at: endedAt,
    status: status,
    division: division,
    validity: validity,
    publishable: publishable,
    comparable_metadata: comparableMetadata,
    raw_measurements: rawMeasurements,
    summary: `Hermes adapter run for task "${taskId}". Adapter mode: ${mode}. Event family: ${eventFamily}. Status: ${status}. Workers: ${workerCount}. Steps: ${stepCount}. ${contradictory ? 'Contradictions detected (unresolved).' : 'All worker evidence merged cleanly.'}`,
    actions: actions,
    evidence: evidence,
    findings: findings,
    outputs: outputs,
    risks: [
      `Worker evidence merging may fail when workers return contradictory results (mitigation: contradiction log with resolution status)`,
      `Memory retrieval summaries may inadvertently contain private content if redaction rules are not fully applied`,
      `Workflow plan may require human review for complex multi-step coordination tasks`,
    ],
  };
}

function getStepCountForFamily(eventFamily) {
  const counts = { ops: 4, code: 3, smoke: 2, node: 2, wiki: 3, general: 3, coord: 4 };
  return counts[eventFamily] || 3;
}

function getWorkerCountForMode(mode, eventFamily) {
  const base = ADAPTER_METADATA.modes[mode] ? ADAPTER_METADATA.modes[mode].default_worker_count : 2;
  // Coordination tasks need more workers
  if (eventFamily === 'coord' && mode === 'orchestrator') return Math.max(base, 4);
  return base;
}

function getWorkerProfilesForMode(mode) {
  return ADAPTER_METADATA.modes[mode] ? ADAPTER_METADATA.modes[mode].allowed_worker_profiles : ['stub-small-vps'];
}

function buildToolUseProfile(mode) {
  const profiles = {
    orchestrator: {
      allowed: ['read', 'write', 'exec', 'message', 'api_call', 'web_search', 'web_fetch', 'delegate', 'sessions_spawn'],
      used: ['read', 'write', 'exec', 'message', 'web_search', 'web_fetch', 'delegate', 'sessions_spawn'],
      notes: 'Orchestrator mode allows broad tool classes under the adapter safety policy. Intentionally avoided: manual.',
    },
    coordinator: {
      allowed: ['read', 'write', 'message', 'delegate'],
      used: ['read', 'write', 'message', 'delegate'],
      notes: 'Coordinator mode. Intentionally avoided: exec, image, web_search.',
    },
    simulation: {
      allowed: ['read', 'write'],
      used: ['read', 'write'],
      notes: 'Simulation mode. Intentionally avoided: all real execution tools.',
    },
  };
  return profiles[mode] || profiles.simulation;
}

function buildActions(mode, eventFamily, status, contradictory) {
  const actions = [
    {
      id: 'act-001',
      type: 'read',
      target: 'task_envelope',
      command_summary: 'Parse task envelope from file',
      redacted: false,
      duration_seconds: 0.045,
      evidence_id: 'ev-session-input',
    },
    {
      id: 'act-002',
      type: 'api_call',
      target: 'hermes_orchestrator',
      command_summary: 'Create Hermes orchestrator session',
      redacted: true,
      redaction_reason: 'hermes_credential_in_worker_output',
      duration_seconds: 0.35,
      evidence_id: 'ev-orchestrator-session',
    },
    {
      id: 'act-003',
      type: 'plan',
      target: 'workflow',
      command_summary: `Decompose task "${eventFamily}" into ${getStepCountForFamily(eventFamily)}-step workflow plan`,
      redacted: false,
      duration_seconds: 1.2,
      evidence_id: 'ev-workflow-plan',
    },
    {
      id: 'act-004',
      type: 'delegate',
      target: 'worker_pool',
      command_summary: `Dispatch ${getWorkerCountForMode(mode, eventFamily)} workers with assigned subtasks`,
      redacted: true,
      redaction_reason: 'hermes_workflow_arguments',
      duration_seconds: 0.8,
      evidence_id: 'ev-worker-assignments',
    },
    {
      id: 'act-005',
      type: 'api_call',
      target: 'worker_readiness',
      command_summary: 'Probe worker readiness and memory cache availability',
      redacted: true,
      redaction_reason: 'prevent_worker_credential_exposure_in_trace',
      duration_seconds: 0.6,
      evidence_id: 'ev-probe-result',
    },
    {
      id: 'act-006',
      type: 'collect',
      target: 'worker_results',
      command_summary: 'Collect tool traces and memory summaries from workers',
      redacted: false,
      duration_seconds: 0.9,
      evidence_id: 'ev-worker-traces',
    },
  ];

  if (contradictory) {
    actions.push({
      id: 'act-007',
      type: 'analyze',
      target: 'contradiction',
      command_summary: 'Detect contradictory evidence between worker results',
      redacted: false,
      duration_seconds: 0.4,
      evidence_id: 'ev-contradiction-log',
    });
  }

  if (status === 'completed') {
    actions.push({
      id: 'act-008',
      type: 'synthesize',
      target: 'commander_report',
      command_summary: 'Synthesize final commander report from all worker results',
      redacted: false,
      duration_seconds: 1.1,
      evidence_id: 'ev-commander-report',
    });
  }

  return actions;
}

function buildEvidence(mode, eventFamily, runId, workflowId, status, contradictory, stepCount) {
  const evidence = [
    {
      id: 'ev-session-input',
      kind: 'config_snippet',
      source: 'task envelope',
      summary: `Input task envelope for event family "${eventFamily}"`,
      content_ref: 'envelope-copy.yaml',
      content_type: 'application/x-yaml',
      redacted: false,
    },
    {
      id: 'ev-orchestrator-session',
      kind: 'log',
      source: 'hermes orchestrator journal',
      summary: 'Orchestrator session created and authenticated successfully',
      redacted: true,
      redaction_reason: 'hermes_credential_in_worker_output',
    },
    {
      id: 'ev-workflow-plan',
      kind: 'workflow_plan',
      source: 'hermes workflow engine',
      summary: `Workflow plan with ${stepCount} steps for event family "${eventFamily}"`,
      content_ref: 'evidence/workflow-plan.yaml',
      content_type: 'application/x-yaml',
      redacted: false,
    },
    {
      id: 'ev-worker-assignments',
      kind: 'worker_assignment',
      source: 'hermes worker pool',
      summary: `Worker assignments for ${getWorkerCountForMode(mode, eventFamily)} workers`,
      redacted: false,
    },
    {
      id: 'ev-probe-result',
      kind: 'probe_result',
      source: 'worker readiness probe',
      summary: 'Worker readiness confirmed for all selected profiles',
      redacted: false,
    },
    {
      id: 'ev-worker-traces',
      kind: 'worker_trace',
      source: 'worker execution traces',
      summary: `Consolidated tool traces from ${getWorkerCountForMode(mode, eventFamily)} workers with redaction applied to sensitive outputs`,
      content_ref: 'evidence/worker-traces.yaml',
      content_type: 'application/x-yaml',
      redacted: false,
    },
    {
      id: 'ev-memory-summary',
      kind: 'memory_summary',
      source: 'worker memory retrieval',
      summary: 'Memory retrieval summaries from each worker (redacted for private content)',
      content_ref: 'evidence/memory-summary.yaml',
      content_type: 'application/x-yaml',
      redacted: true,
      redaction_reason: 'hermes_memory_content',
    },
  ];

  if (contradictory) {
    evidence.push({
      id: 'ev-contradiction-log',
      kind: 'contradiction_log',
      source: 'hermes evidence merger',
      summary: 'Contradictory evidence detected between workers s2 and s3: config hash mismatch',
      content_ref: 'evidence/contradiction-log.yaml',
      content_type: 'application/x-yaml',
      redacted: false,
    });
  }

  if (status === 'completed') {
    evidence.push({
      id: 'ev-commander-report',
      kind: 'commander_report',
      source: 'hermes commander',
      summary: 'Synthesized commander report from all worker results',
      content_ref: 'evidence/commander-report.yaml',
      content_type: 'application/x-yaml',
      redacted: false,
    });
  }

  return evidence;
}

function buildFindings(taskId, workflowId, status, eventFamily, contradictory) {
  const findings = [
    {
      claim: `Hermes adapter executed workflow "${workflowId}" for task "${taskId}" with status "${status}" in ${eventFamily} mode.`,
      evidence: ['ev-orchestrator-session', 'ev-workflow-plan'],
      confidence: 'high',
    },
    {
      claim: `Workflow plan created with ${getStepCountForFamily(eventFamily)} steps and worker probes confirmed.`,
      evidence: ['ev-workflow-plan', 'ev-probe-result'],
      confidence: 'high',
    },
  ];

  if (contradictory) {
    findings.push({
      claim: `Contradictory evidence detected between workers and requires human-in-the-loop resolution. Config hash values did not match between step 2 and step 3 workers.`,
      evidence: ['ev-contradiction-log', 'ev-worker-traces'],
      confidence: 'medium',
    });
    findings.push({
      claim: `Memory retrieval across workers was partially successful (cache hit ratio: 0.5). Some workers lacked prior context.`,
      evidence: ['ev-memory-summary'],
      confidence: 'medium',
    });
  } else if (status === 'completed') {
    findings.push({
      claim: `All worker results synthesized into coherent commander report. No contradictions detected. Worker memory retrieval summaries captured.`,
      evidence: ['ev-commander-report', 'ev-worker-traces', 'ev-memory-summary'],
      confidence: 'high',
    });
  }

  return findings;
}

function buildOutputs(envelope, mode, eventFamily, status) {
  const outputs = buildCommonOutputs(envelope, 'hermes', mode, eventFamily, status,
    ' Commander report synthesized.');
  if (Object.keys(outputs).length === 0) {
    outputs.commander_report = `[hermes-adapter:${mode}/${eventFamily}] Commander report. Status: ${status}.`;
  }
  return outputs;
}

/**
 * HERMES → TRACE RECORD MAPPING
 *
 * Hermes runtime data             → Trace Record entry
 * ───────────────────────────────────────────────────────
 * Orchestrator event log          → entries[].seq, entries[].timestamp
 * Worker dispatch                 → entries[].action=delegate
 * Worker result collection        → entries[].action=collect
 * Workflow plan creation          → entries[].action=plan
 * Contradiction analysis          → entries[].action=analyze
 * Commander synthesis             → entries[].action=synthesize
 * File read/write                 → entries[].action=read/write
 * Orchestrator API call           → entries[].action=api_call
 * Redacted entries                → entries[].redacted=true + redaction_reason
 * Evidence cross-ref              → entries[].evidence_ref
 * Duration per action             → entries[].duration_ms
 */
function generateTraceRecord(envelope, runId, agentId, startedAt, endedAt, mode, eventFamily, status, contradictory) {
  const now = isoNow();
  const entries = [
    {
      seq: 0,
      timestamp: startedAt,
      action: 'read',
      target: 'task_envelope',
      summary: `Read task envelope "${envelope.task_id || 'unknown'}" from disk`,
      duration_ms: 45,
      result_summary: `Loaded envelope for event family "${eventFamily}"`,
      evidence_ref: 'ev-session-input',
    },
    {
      seq: 1,
      timestamp: startedAt,
      action: 'api_call',
      target: 'hermes_orchestrator',
      summary: 'Create Hermes orchestrator session',
      redacted: true,
      redaction_reason: 'hermes_credential_in_worker_output',
      duration_ms: 350,
      result_summary: 'Orchestrator session created and authenticated',
      evidence_ref: 'ev-orchestrator-session',
    },
    {
      seq: 2,
      timestamp: startedAt,
      action: 'plan',
      target: 'workflow',
      summary: `Decompose task into ${getStepCountForFamily(eventFamily)}-step workflow plan`,
      duration_ms: 1200,
      result_summary: `Workflow plan created for ${eventFamily} with step dependencies mapped`,
      evidence_ref: 'ev-workflow-plan',
    },
    {
      seq: 3,
      timestamp: startedAt,
      action: 'delegate',
      target: 'worker_pool',
      summary: `Dispatch ${getWorkerCountForMode(mode, eventFamily)} workers with assigned subtasks`,
      redacted: true,
      redaction_reason: 'hermes_workflow_arguments',
      duration_ms: 800,
      result_summary: `Workers dispatched: ${getWorkerProfilesForMode(mode).join(', ')}`,
      evidence_ref: 'ev-worker-assignments',
    },
    {
      seq: 4,
      timestamp: startedAt,
      action: 'api_call',
      target: 'worker_readiness',
      summary: 'Probe worker readiness and memory cache availability',
      redacted: true,
      redaction_reason: 'prevent_worker_credential_exposure_in_trace',
      duration_ms: 600,
      result_summary: 'All workers ready, memory cache hit ratio: 0.5',
      evidence_ref: 'ev-probe-result',
    },
    {
      seq: 5,
      timestamp: startedAt,
      action: 'collect',
      target: 'worker_results',
      summary: 'Collect tool traces and memory summaries from all workers',
      duration_ms: 900,
      result_summary: 'All worker traces collected, redaction applied to sensitive outputs',
      evidence_ref: 'ev-worker-traces',
    },
    {
      seq: 6,
      timestamp: startedAt,
      action: 'collect',
      target: 'memory_summaries',
      summary: 'Aggregate memory retrieval summaries from each worker',
      redacted: true,
      redaction_reason: 'hermes_memory_content',
      duration_ms: 400,
      result_summary: 'Memory summaries collected, private content redacted',
      evidence_ref: 'ev-memory-summary',
    },
  ];

  if (contradictory) {
    entries.push({
      seq: entries.length,
      timestamp: startedAt,
      action: 'analyze',
      target: 'contradiction',
      summary: 'Detect and log contradictory evidence between worker results',
      duration_ms: 400,
      result_summary: 'Contradiction detected: config hash mismatch between workers s2 and s3',
      evidence_ref: 'ev-contradiction-log',
    });
  }

  if (status === 'completed') {
    entries.push({
      seq: entries.length,
      timestamp: startedAt,
      action: 'synthesize',
      target: 'commander_report',
      summary: 'Synthesize final commander report from all worker results',
      duration_ms: 1100,
      result_summary: 'Commander report synthesized with merged evidence from all workers',
      evidence_ref: 'ev-commander-report',
    });
  }

  entries.push({
    seq: entries.length,
    timestamp: endedAt,
    action: 'write',
    target: 'result_packet',
    summary: 'Write all output artifacts to run directory',
    duration_ms: 50,
    result_summary: 'All output artifacts written',
  });

  return {
    schema_version: 1,
    trace_id: `tr-hermes-${runId}`,
    run_id: runId,
    agent_id: agentId,
    runtime: 'hermes',
    generated_at: endedAt,
    adapter_mode: mode,
    event_family: eventFamily,
    entries: entries,
    redaction_policy: {
      applied_rules: [
        {
          rule_id: 'rr-hermes-001',
          pattern_description: 'Credential-like strings in worker command output or API response',
          reason: 'hermes_credential_in_worker_output',
        },
        {
          rule_id: 'rr-hermes-002',
          pattern_description: 'Private memory content in retrieval summaries',
          reason: 'hermes_memory_content',
        },
        {
          rule_id: 'rr-hermes-003',
          pattern_description: 'Sensitive parameter values in workflow invocation arguments',
          reason: 'hermes_workflow_arguments',
        },
        {
          rule_id: 'rr-hermes-004',
          pattern_description: 'Worker session tokens and credentials in trace entries',
          reason: 'prevent_worker_credential_exposure_in_trace',
        },
      ],
      default_reason: 'sensitive_value_redacted',
    },
  };
}

/**
 * HERMES → EVIDENCE BUNDLE MAPPING
 *
 * Hermes runtime data          → Evidence Bundle item
 * ─────────────────────────────────────────────────
 * Workflow plan YAML           → items[].kind=workflow_plan
 * Worker trace YAML            → items[].kind=worker_trace
 * Memory summary YAML          → items[].kind=memory_summary
 * Contradiction log YAML       → items[].kind=contradiction_log
 * Commander report YAML        → items[].kind=commander_report
 */
function generateEvidenceBundle(envelope, runId, agentId, endedAt, mode, eventFamily, status, contradictory, workflowId) {
  const items = [
    {
      id: 'ev-session-input',
      kind: 'config_snippet',
      source: 'task envelope',
      summary: 'Copy of input task envelope for event family "' + eventFamily + '"',
      content_ref: 'envelope-copy.yaml',
      content_type: 'application/x-yaml',
      size_bytes: 2048,
      checksum: {
        algorithm: 'sha256',
        value: `aaa${pseudoHash(`${runId}-ev0`, 61)}`,
      },
      redacted: false,
    },
    {
      id: 'ev-workflow-plan',
      kind: 'workflow_plan',
      source: 'hermes workflow engine',
      summary: 'Workflow plan with ' + getStepCountForFamily(eventFamily) + ' steps for event family "' + eventFamily + '"',
      content_ref: 'evidence/workflow-plan.yaml',
      content_type: 'application/x-yaml',
      size_bytes: 2560,
      checksum: {
        algorithm: 'sha256',
        value: `bbb${pseudoHash(`${runId}-ev1`, 61)}`,
      },
      redacted: false,
    },
    {
      id: 'ev-worker-traces',
      kind: 'worker_trace',
      source: 'worker execution traces',
      summary: 'Consolidated tool traces from ' + getWorkerCountForMode(mode, eventFamily) + ' workers',
      content_ref: 'evidence/worker-traces.yaml',
      content_type: 'application/x-yaml',
      size_bytes: 4096,
      checksum: {
        algorithm: 'sha256',
        value: `ccc${pseudoHash(`${runId}-ev2`, 61)}`,
      },
      redacted: false,
    },
    {
      id: 'ev-memory-summary',
      kind: 'memory_summary',
      source: 'worker memory retrieval',
      summary: 'Memory retrieval summaries from each worker (redacted for private content)',
      content_ref: 'evidence/memory-summary.yaml',
      content_type: 'application/x-yaml',
      size_bytes: 2048,
      checksum: {
        algorithm: 'sha256',
        value: `ddd${pseudoHash(`${runId}-ev3`, 61)}`,
      },
      redacted: true,
      redaction_rule: 'hermes_memory_content',
      metadata: {
        total_keys_requested: 4,
        total_keys_found: 2,
        cache_hit_ratio: 0.5,
      },
    },
  ];

  if (contradictory) {
    items.push({
      id: 'ev-contradiction-log',
      kind: 'contradiction_log',
      source: 'hermes evidence merger',
      summary: 'Contradictory evidence detected between workers: config hash mismatch',
      content_ref: 'evidence/contradiction-log.yaml',
      content_type: 'application/x-yaml',
      size_bytes: 1024,
      checksum: {
        algorithm: 'sha256',
        value: `eee${pseudoHash(`${runId}-ev4`, 61)}`,
      },
      redacted: false,
    });
  }

  if (status === 'completed') {
    items.push({
      id: 'ev-commander-report',
      kind: 'commander_report',
      source: 'hermes commander',
      summary: 'Synthesized commander report from all worker results',
      content_ref: 'evidence/commander-report.yaml',
      content_type: 'application/x-yaml',
      size_bytes: 3072,
      checksum: {
        algorithm: 'sha256',
        value: `fff${pseudoHash(`${runId}-ev5`, 61)}`,
      },
      redacted: false,
    });
  }

  return {
    schema_version: 1,
    bundle_id: `eb-${runId}`,
    run_id: runId,
    agent_id: agentId,
    runtime: 'hermes',
    generated_at: endedAt,
    adapter_mode: mode,
    event_family: eventFamily,
    items: items,
  };
}

/**
 * HERMES → ARTIFACT MANIFEST MAPPING
 *
 * Hermes runtime data            → Manifest field
 * ─────────────────────────────────────────────────────
 * Run directory structure        → artifacts[].path
 * Run output file types          → artifacts[].kind
 * File integrity hashes          → artifacts[].checksum
 * Run lifecycle states           → status_history[]
 * Retention policy               → retention_policy
 * Runner metadata                → run_metadata
 */
function generateManifest(runId, taskId, agentId, envelope, status, startedAt, endedAt, mode, eventFamily) {
  return {
    schema_version: 1,
    manifest_id: `am-${runId}`,
    run_id: runId,
    round_id: envelope.round_id || 'season-001-round-001',
    task_id: taskId,
    agent_id: agentId,
    status: status,
    created_at: startedAt,
    updated_at: endedAt,
    status_history: [
      { status: 'pending',   timestamp: startedAt, note: 'Run directory created' },
      { status: 'running',   timestamp: startedAt, note: `Hermes adapter execution started (mode: ${mode}, event: ${eventFamily})` },
      { status: status,      timestamp: endedAt,   note: `Hermes adapter completed: ${status}` },
    ],
    artifacts: [
      {
        path: 'result-packet.yaml',
        kind: 'result_packet',
        content_type: 'text/yaml',
        size_bytes: 5120,
        checksum: { algorithm: 'sha256', value: `${pseudoHash(`${runId}-rp`)}` },
        retention: 'season',
        redacted: false,
        generated_by: 'agent',
      },
      {
        path: 'trace.yaml',
        kind: 'trace',
        content_type: 'text/yaml',
        size_bytes: 6144,
        checksum: { algorithm: 'sha256', value: `${pseudoHash(`${runId}-tr`)}` },
        retention: 'season',
        redacted: false,
        generated_by: 'agent',
      },
      {
        path: 'evidence-bundle.yaml',
        kind: 'evidence_bundle',
        content_type: 'text/yaml',
        size_bytes: 4096,
        checksum: { algorithm: 'sha256', value: `${pseudoHash(`${runId}-eb`)}` },
        retention: 'permanent',
        redacted: false,
        generated_by: 'agent',
      },
      {
        path: 'manifest.yaml',
        kind: 'run_manifest',
        content_type: 'text/yaml',
        size_bytes: 2400,
        checksum: { algorithm: 'sha256', value: `${pseudoHash(`${runId}-mf`)}` },
        retention: 'season',
        redacted: false,
        generated_by: 'agent',
      },
      {
        path: 'evidence/workflow-plan.yaml',
        kind: 'evidence_file',
        content_type: 'text/yaml',
        size_bytes: 2560,
        checksum: { algorithm: 'sha256', value: `${pseudoHash(`${runId}-ev1`)}` },
        retention: 'round',
        redacted: false,
        generated_by: 'agent',
      },
      {
        path: 'evidence/worker-traces.yaml',
        kind: 'evidence_file',
        content_type: 'text/yaml',
        size_bytes: 4096,
        checksum: { algorithm: 'sha256', value: `${pseudoHash(`${runId}-ev2`)}` },
        retention: 'round',
        redacted: false,
        generated_by: 'agent',
      },
      {
        path: 'evidence/memory-summary.yaml',
        kind: 'evidence_file',
        content_type: 'text/yaml',
        size_bytes: 2048,
        checksum: { algorithm: 'sha256', value: `${pseudoHash(`${runId}-ev3`)}` },
        retention: 'round',
        redacted: true,
        generated_by: 'agent',
      },
    ],
    references: {
      result_packet_path: 'result-packet.yaml',
      evidence_bundle_path: 'evidence-bundle.yaml',
      trace_path: 'trace.yaml',
      evidence_dir: 'evidence/',
    },
    retention_policy: {
      default_retention: 'season',
      cleanup_after_days: 90,
      scrubbing_required: true,
    },
    run_metadata: {
      runner: 'a2a-runner-v1',
      runner_version: '1.0.0',
      adapter: 'hermes',
      adapter_version: ADAPTER_METADATA.adapter_version,
      adapter_mode: mode,
      event_family: eventFamily,
      duration_seconds: Math.round((new Date(endedAt) - new Date(startedAt)) / 1000),
    },
  };
}

function generateRunMetadata(envelopePath, envelope, runId, agentId, runtime, status, exitCode,
  startedAt, endedAt, mode, eventFamily, runtimeVersion, artifactPaths) {
  return generateCommonRunMetadata(envelopePath, envelope, runId, agentId, runtime, status, exitCode,
    startedAt, endedAt, mode, eventFamily, runtimeVersion, artifactPaths, {
      adapterType: 'hermes-orchestrator',
      adapterVersion: ADAPTER_METADATA.adapter_version,
      notes: `Hermes adapter run for lane 1/3 (sogyo). Adapter metadata, artifact mapping, capabilities, workflow plan, and validation examples. Mode: ${mode}, Event family: ${eventFamily}.`,
    });
}

/**
 * Generate workflow plan evidence file content using fixture patterns
 */
function generateWorkflowPlanContent(eventFamily, workflowId, stepCount) {
  const stepTemplates = {
    ops: [
      { step_id: 's1-connectivity', description: 'Check gateway connectivity and TLS certificate validity', worker_count: 1, worker_profile: 'stub-small-vps', expected_duration_seconds: 30, depends_on: [] },
      { step_id: 's2-config-integrity', description: 'Fetch and hash the current gateway configuration file', worker_count: 1, worker_profile: 'stub-medium-vps', expected_duration_seconds: 15, depends_on: ['s1-connectivity'] },
      { step_id: 's3-log-inspection', description: 'Inspect gateway logs for 5xx errors in last 24 hours', worker_count: 2, worker_profile: 'stub-medium-vps', expected_duration_seconds: 60, depends_on: ['s1-connectivity'] },
      { step_id: 's4-synthesis', description: 'Merge results from all prior steps into final report', worker_count: 1, worker_profile: 'stub-small-vps', expected_duration_seconds: 10, depends_on: ['s2-config-integrity', 's3-log-inspection'] },
    ],
    code: [
      { step_id: 's1-analysis', description: 'Analyze codebase structure and identify regression points', worker_count: 1, worker_profile: 'stub-medium-vps', expected_duration_seconds: 45, depends_on: [] },
      { step_id: 's2-fix', description: 'Apply regression fixes to identified test files', worker_count: 2, worker_profile: 'stub-medium-vps', expected_duration_seconds: 120, depends_on: ['s1-analysis'] },
      { step_id: 's3-verify', description: 'Run type-checking and test suite to verify fixes', worker_count: 1, worker_profile: 'stub-small-vps', expected_duration_seconds: 60, depends_on: ['s2-fix'] },
    ],
    coord: [
      { step_id: 's1-commander-brief', description: 'Commander agent receives and parses task objective', worker_count: 1, worker_profile: 'stub-small-vps', expected_duration_seconds: 20, depends_on: [] },
      { step_id: 's2-subtask-scatter', description: 'Decompose objective into parallel subtask assignments', worker_count: 1, worker_profile: 'stub-medium-vps', expected_duration_seconds: 30, depends_on: ['s1-commander-brief'] },
      { step_id: 's3-worker-execution', description: 'Workers execute assigned subtasks in parallel', worker_count: 3, worker_profile: 'stub-medium-vps', expected_duration_seconds: 180, depends_on: ['s2-subtask-scatter'] },
      { step_id: 's4-gather-report', description: 'Commander gathers results and produces final report', worker_count: 1, worker_profile: 'stub-small-vps', expected_duration_seconds: 30, depends_on: ['s3-worker-execution'] },
    ],
  };

  const steps = stepTemplates[eventFamily] || stepTemplates.ops;
  const selectedSteps = steps.slice(0, stepCount);

  return {
    schema_version: 1,
    workflow_id: workflowId,
    source_envelope_id: `env-${eventFamily}-demo`,
    created_at: isoNow(),
    objective: `Hermes workflow for event family "${eventFamily}" via adapter mode`,
    steps: selectedSteps,
    parallelism: {
      max_concurrent_workers: 2,
      strategy: 'eager',
    },
    timeout_seconds: ADAPTER_METADATA.timeout_handling.default_timeout_seconds,
  };
}

/**
 * Generate worker traces evidence file content
 */
function generateWorkerTracesContent(eventFamily, workerCount) {
  const workers = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push({
      trace_id: `trc-s1-worker-${String.fromCharCode(97 + i)}`,
      parent_workflow_id: 'wf-demo',
      step_id: `s1-${eventFamily}`,
      worker_id: `worker-${String.fromCharCode(97 + i)}`,
      timeline: [
        { event: 'task_received', timestamp: isoNow(), detail: { envelope_ref: 'env-demo', step_description: `Worker ${i + 1} task for ${eventFamily}` } },
        { event: 'tool_invocation_start', timestamp: isoNow(), detail: { tool_name: 'read_file', arguments: { path: '/var/log/sample.log' } } },
        { event: 'tool_invocation_end', timestamp: isoNow(), detail: { tool_name: 'read_file', status: 'success', bytes_read: 8192 } },
        { event: 'result_produced', timestamp: isoNow(), detail: { output_ref: `s1-${eventFamily}`, evidence_ref: `ev-worker-${i}` } },
      ],
      classification: 'complete',
    });
  }
  return { workers: workers };
}

/**
 * Generate memory summary evidence file content
 */
function generateMemorySummaryContent(workerCount) {
  const summaries = [];
  for (let i = 0; i < workerCount; i++) {
    const wid = String.fromCharCode(97 + i);
    summaries.push({
      memory_summary_id: `mem-s1-worker-${wid}`,
      worker_id: `worker-${wid}`,
      workflow_id: 'wf-demo',
      retrieved_at: isoNow(),
      memory_sources_consulted: [
        { source: 'worker_session_cache', keys_requested: ['previous_results', 'known_patterns'], keys_found: ['known_patterns'], keys_not_found: ['previous_results'] },
        { source: 'shared_workflow_memory', keys_requested: ['config_paths'], keys_found: ['config_paths'], keys_not_found: [] },
      ],
      memory_content_retrieved: [
        { key: 'known_patterns', summary: 'Common patterns for this task type', value_type: 'reference_knowledge', approximate_size_chars: 1024 },
        { key: 'config_paths', summary: 'Standard configuration paths', value_type: 'reference_knowledge', approximate_size_chars: 512 },
      ],
      usage_notes: { total_keys_requested: 3, total_keys_found: 2, cache_hit_ratio: 0.67, notes: 'Memory partially cached' },
    });
  }
  return { memory_summaries: summaries };
}

/**
 * Generate contradiction log evidence file content
 */
function generateContradictionLog() {
  return {
    schema_version: 1,
    contradictions: [
      {
        contradiction_id: 'c-001',
        description: 'Config hash values reported by worker s2 and worker s3 do not match',
        worker_a: 'worker-beta',
        worker_b: 'worker-gamma',
        evidence_a: { key: 'config_hash', value: 'abc123def456' },
        evidence_b: { key: 'config_hash', value: '789ghi012jkl' },
        resolution_status: 'unresolved',
        resolution_notes: 'Workers inspected different config file versions or deployment slots. Requires human operator to verify which is current.',
      },
      {
        contradiction_id: 'c-002',
        description: 'Memory retrieval timestamp for config path differs between workers',
        worker_a: 'worker-beta',
        worker_b: 'worker-gamma',
        evidence_a: { key: 'config_path_timestamp', value: '2026-05-28T22:00:00Z' },
        evidence_b: { key: 'config_path_timestamp', value: '2026-05-29T08:00:00Z' },
        resolution_status: 'unresolved',
        resolution_notes: 'Timestamp discrepancy suggests memory cache invalidation between worker dispatches.',
      },
    ],
  };
}

/**
 * Generate commander report evidence file content
 */
function generateCommanderReport(eventFamily, workerCount, contradictory) {
  return {
    schema_version: 1,
    report_id: `cr-wf-demo-${isoNow().replace(/[:.]/g, '-')}`,
    synthesized_at: isoNow(),
    workers_contributing: workerCount,
    contradictions_detected: contradictory ? 2 : 0,
    contradictions_resolved: 0,
    summary: `Commander synthesis for ${eventFamily} task. ${contradictory ? 'Contradictions detected and logged for human resolution.' : 'All worker results merged cleanly.'}`,
    merged_findings: [
      { finding_id: 'f-001', source_worker: 'all', description: 'Task-level analysis complete across all workers', confidence: contradictory ? 'medium' : 'high' },
      { finding_id: 'f-002', source_worker: 'worker-alpha', description: 'Initial connectivity and configuration inspected', confidence: 'high' },
    ],
    recommendations: contradictory
      ? ['Resolve config hash contradiction before proceeding', 'Verify active deployment slot', 'Check memory cache invalidation policy']
      : ['All checks passed', 'No action required'],
  };
}

// ---------------------------------------------------------------------------
// Validation wrapper
// ---------------------------------------------------------------------------

function validateOutput(runDir) {
  return validateCommonOutput(runDir, { logPrefix: 'hermes-adapter' });
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
  const runtimeVersion = opts.runtimeVersion;
  const mode = opts.mode;
  const eventFamily = opts.eventFamily;
  const model = opts.model;
  const modelProvider = opts.modelProvider;
  const exitCode = opts.exitCode;
  const seed = opts.seed;
  const overrideTimestamp = opts.timestamp;
  const publishable = opts.publishable;
  const contradictory = opts.contradictory;

  // Validate mode / event family / mode-family combination
  validateModeAndFamily(mode, eventFamily, ADAPTER_METADATA, CAPABILITY_MATRIX);

  const startedAt = overrideTimestamp || isoNow();
  const runId = generateRunId(taskId, agentId, seed, startedAt);
  const workflowId = generateWorkflowId(taskId, agentId, seed, startedAt);

  // --- Determine output directory (with evidence subdirectory) ---
  const runDir = opts.runDir || path.resolve(__dirname, '..', 'results', `hermes-${taskId}-${runId}`);
  ensureRunDir(runDir, true);

  // --- Capture stdout/stderr ---
  const capture = captureConsole();

  // Determine status from exit code
  const status = STATUS_MAP[exitCode] || 'blocked';
  const endedAt = overrideTimestamp || isoNow();

  // --- Generate output artifacts ---
  const resultPacket = generateResultPacket(envelope, runId, agentId, runtime, runtimeVersion,
    mode, eventFamily, model, modelProvider, status, startedAt, endedAt,
    seed, publishable, contradictory);
  const traceRecord = generateTraceRecord(envelope, runId, agentId, startedAt, endedAt,
    mode, eventFamily, status, contradictory);
  const evidenceBundle = generateEvidenceBundle(envelope, runId, agentId, endedAt,
    mode, eventFamily, status, contradictory, workflowId);
  const manifest = generateManifest(runId, taskId, agentId, envelope, status, startedAt, endedAt,
    mode, eventFamily);
  const runMeta = generateRunMetadata(envelopePath, envelope, runId, agentId, runtime, status, exitCode,
    startedAt, endedAt, mode, eventFamily, runtimeVersion,
    ['envelope-copy.yaml', 'result-packet.yaml', 'trace.yaml', 'evidence-bundle.yaml',
      'manifest.yaml', 'run.yaml', 'adapter.log']);

  // Generate evidence sub-files
  const stepCount = getStepCountForFamily(eventFamily);
  const workerCount = getWorkerCountForMode(mode, eventFamily);

  // Workflow plan evidence
  const workflowPlanContent = generateWorkflowPlanContent(eventFamily, workflowId, stepCount);

  // Worker traces evidence
  const workerTracesContent = generateWorkerTracesContent(eventFamily, workerCount);

  // Memory summary evidence
  const memorySummaryContent = generateMemorySummaryContent(workerCount);

  // --- Write artifacts ---
  const writeYaml = makeWriteYaml(runDir);

  // Write evidence sub-files
  writeYaml('evidence/workflow-plan.yaml', workflowPlanContent);
  writeYaml('evidence/worker-traces.yaml', workerTracesContent);
  writeYaml('evidence/memory-summary.yaml', memorySummaryContent);

  if (contradictory) {
    writeYaml('evidence/contradiction-log.yaml', generateContradictionLog());
  }

  if (status === 'completed') {
    writeYaml('evidence/commander-report.yaml', generateCommanderReport(eventFamily, workerCount, contradictory));
  }

  writeYaml('envelope-copy.yaml', envelope);
  writeYaml('result-packet.yaml', resultPacket);
  writeYaml('trace.yaml', traceRecord);
  writeYaml('evidence-bundle.yaml', evidenceBundle);
  writeYaml('manifest.yaml', manifest);
  writeYaml('run.yaml', runMeta);

  // --- Self-validate (still captured into the adapter log) ---
  const validatePassed = validateOutput(runDir);

  // --- Summary ---
  console.log('');
  console.log('=== Hermes Adapter Run Complete ===');
  console.log(`  Run ID:            ${runId}`);
  console.log(`  Workflow ID:       ${workflowId}`);
  console.log(`  Task:              ${taskId} (${envelope.title || 'no title'})`);
  console.log(`  Agent:             ${agentId}`);
  console.log(`  Runtime:           ${runtime} ${runtimeVersion}`);
  console.log(`  Mode:              ${mode}`);
  console.log(`  Event family:      ${eventFamily}`);
  console.log(`  Model:             ${model} (${modelProvider})`);
  console.log(`  Status:            ${status}`);
  console.log(`  Exit code:         ${exitCode}`);
  console.log(`  Workers:           ${workerCount}`);
  console.log(`  Steps:             ${stepCount}`);
  console.log(`  Contradictory:     ${contradictory}`);
  console.log(`  Run dir:           ${runDir}`);
  console.log(`  Duration:          ${runMeta.duration_seconds}s`);
  console.log(`  Validate:          ${validatePassed ? 'PASSED' : 'WARNINGS'}`);
  console.log(`  Adapter version:   ${ADAPTER_METADATA.adapter_version}`);
  console.log(`  Publishable:       ${publishable}`);
  console.log('');
  printAdapterMetadataSummary(ADAPTER_METADATA);

  // Restore console and write the adapter log (now that all output happened)
  writeAdapterLog(runDir, capture);

  // Exit with the requested code
  process.exit(exitCode);
}

main();
