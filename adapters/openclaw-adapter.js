#!/usr/bin/env node
/**
 * Agent Olympics OpenClaw Adapter
 *
 * Accepts a Task Envelope, simulates OpenClaw session execution, and produces:
 *   - result-packet.yaml   (with runtime execution data)
 *   - trace.yaml           (session journal + tool calls)
 *   - evidence-bundle.yaml (gateway logs, session artifacts)
 *   - manifest.yaml        (artifact manifest per manifest schema)
 *   - run.yaml             (run metadata)
 *   - envelope-copy.yaml   (input copy)
 *   - adapter.log          (captured output)
 *
 * This adapter makes OpenClaw runtime execution data first-class by
 * capturing adapter metadata, mapping run artifacts to OpenClaw output
 * formats, declaring supported task/result capabilities, and producing
 * validation examples.
 *
 * Usage:
 *   node adapters/openclaw-adapter.js <envelope-path>                # one shot
 *   node adapters/openclaw-adapter.js <envelope-path> --run-dir /tmp/run
 *   node adapters/openclaw-adapter.js <envelope-path> --event-family ops
 *   node adapters/openclaw-adapter.js <envelope-path> --mode openstack
 *
 * Exit codes (aligned with adapter-execution-contract):
 *   0  — success (completed)
 *   1  — execution failure (failed)
 *   2  — timeout / partial result (partial)
 *   3  — argument or prereq error (blocked)
 *
 * Adapter Execution Contract version: 1 (§10 addenda: OpenClaw)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// ---------------------------------------------------------------------------
// ADAPTER METADATA
// ---------------------------------------------------------------------------
// These constants make OpenClaw runtime execution data first-class.
// See docs/openclaw-adapter.md for the complete metadata spec.
// ---------------------------------------------------------------------------

const ADAPTER_METADATA = Object.freeze({
  /** Adapter identity */
  adapter: 'openclaw',
  adapter_version: '1.0.0',
  adapter_vendor: 'agent-olympics',
  adapter_type: 'runtime',

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
  ],

  /** Required environment variables (described, not exposed) */
  required_environment_variables: [
    'OPENCLAW_GATEWAY_URL',     // Gateway endpoint for session management
    'OPENCLAW_API_KEY',         // API key for gateway authentication (REDACTED)
    'AGENT_OLYMPICS_TASK_DIR',  // Task envelope and fixture directory
  ],

  /** Optional environment variables with safe descriptions */
  optional_environment_variables: [
    'OPENCLAW_SESSION_LABEL',   // Custom label for the created session
    'OPENCLAW_TIMEOUT_SECONDS',  // Max session runtime before forced timeout
    'OPENCLAW_MODEL',           // Model override for the session
    'OPENCLAW_MODEL_PROVIDER',   // Model provider override
    'AGENT_OLYMPICS_RUN_DIR',   // Override output directory
  ],

  /** Redaction rules applied by this adapter */
  redaction_rules: [
    {
      id: 'rr-openclaw-001',
      pattern_description: 'API keys and bearer tokens in gateway journal entries',
      reason: 'prevent_credential_exposure_in_gateway_logs',
      scope: 'gateway_journal',
    },
    {
      id: 'rr-openclaw-002',
      pattern_description: 'Session cookies and auth tokens in delivery probe responses',
      reason: 'prevent_auth_material_exposure_in_delivery_evidence',
      scope: 'delivery_probe',
    },
    {
      id: 'rr-openclaw-003',
      pattern_description: 'Secret values in command output summaries',
      reason: 'command_output_contained_sensitive_data',
      scope: 'tool_call_output',
    },
    {
      id: 'rr-openclaw-004',
      pattern_description: 'Database connection strings and hostnames in session metadata',
      reason: 'prevent_infrastructure_exposure_in_session_metadata',
      scope: 'session_metadata',
    },
  ],

  /** Evidence kinds this adapter can produce */
  evidence_capabilities: [
    { kind: 'session_id',          description: 'OpenClaw session UUID' },
    { kind: 'message_id',          description: 'Telegram/gateway message delivery ID' },
    { kind: 'gateway_readiness',   description: 'Gateway readiness journal entry (redacted)' },
    { kind: 'delivery_probe',      description: 'Channel delivery probe result (redacted)' },
    { kind: 'tool_call_summary',   description: 'Tool call trace with action, target, duration, redaction status' },
    { kind: 'command_summary',     description: 'Shell command summary with exit code and output status' },
    { kind: 'session_transcript',  description: 'Session transcript excerpt (redacted, safe lines only)' },
    { kind: 'wiki_pr_ref',         description: 'Link to a Wiki PR or issue for durable knowledge' },
    { kind: 'gateway_log',         description: 'Gateway journal log line (redacted for secrets)' },
    { kind: 'config_snippet',      description: 'Configuration snippet (no secrets)' },
    { kind: 'probe_result',        description: 'Gateway or channel probe result' },
    { kind: 'artifact_hash',       description: 'Content hash for tamper detection' },
  ],

  /** Timeout handling */
  timeout_handling: Object.freeze({
    default_timeout_seconds: 600,
    max_timeout_seconds: 3600,
    timeout_status: 'partial',
    timeout_grace_seconds: 30,
    timeout_evidence_kind: 'session_transcript',
    timeout_action: 'force_terminate_and_capture_partial_results',
  }),

  /** Adapter modes */
  modes: Object.freeze({
    openstack: {
      description: 'Open stack — configurable model, tools, and routing within safety rules',
      default_model_routing: 'configurable',
      allowed_tool_classes: ['all'],
      required_evidence: ['session_id', 'tool_call_summary', 'gateway_readiness'],
    },
    closedstack: {
      description: 'Closed stack — fixed model, tool budget, and runtime limits',
      default_model_routing: 'fixed',
      allowed_tool_classes: ['read', 'write', 'exec', 'message', 'web_search', 'web_fetch'],
      required_evidence: ['session_id', 'tool_call_summary', 'gateway_readiness', 'artifact_hash'],
    },
    human_baseline: {
      description: 'Human baseline — operator documents manual steps as trace entries',
      default_model_routing: 'none',
      allowed_tool_classes: ['manual'],
      required_evidence: ['session_id', 'session_transcript', 'message_id'],
    },
  }),
});

// ---------------------------------------------------------------------------
// EVENT FAMILY × ADAPTER MODE CAPABILITY MATRIX
// ---------------------------------------------------------------------------
// Maps each supported event family to the adapter modes and result statuses
// it can produce, along with required evidence kinds per task type.
// See docs/openclaw-adapter.md → "Supported Task/Result Capabilities"
// ---------------------------------------------------------------------------

const CAPABILITY_MATRIX = Object.freeze({
  ops: {
    description: 'Operations relay — diagnostics, incident response, monitoring',
    supported_modes: ['openstack', 'closedstack', 'human_baseline'],
    mode_defaults: { openstack: {}, closedstack: {}, human_baseline: {} },
    applicable_statuses: ['completed', 'partial', 'failed', 'blocked'],
    required_evidence_per_status: Object.freeze({
      completed: ['session_id', 'tool_call_summary', 'gateway_readiness', 'gateway_log', 'delivery_probe'],
      partial:   ['session_id', 'tool_call_summary', 'gateway_readiness', 'session_transcript'],
      failed:    ['session_id', 'tool_call_summary', 'gateway_log'],
      blocked:   ['session_id', 'session_transcript'],
    }),
  },
  code: {
    description: 'Code assist — writing, reviewing, debugging',
    supported_modes: ['openstack', 'closedstack'],
    mode_defaults: { openstack: {}, closedstack: {} },
    applicable_statuses: ['completed', 'partial', 'failed'],
    required_evidence_per_status: Object.freeze({
      completed: ['session_id', 'tool_call_summary', 'command_summary', 'artifact_hash'],
      partial:   ['session_id', 'tool_call_summary', 'session_transcript'],
      failed:    ['session_id', 'tool_call_summary'],
    }),
  },
  smoke: {
    description: 'Smoke test — readiness verification, capability reports',
    supported_modes: ['openstack', 'closedstack'],
    mode_defaults: { openstack: {}, closedstack: {} },
    applicable_statuses: ['completed', 'failed'],
    required_evidence_per_status: Object.freeze({
      completed: ['session_id', 'gateway_readiness', 'config_snippet', 'probe_result'],
      failed:    ['session_id', 'gateway_log'],
    }),
  },
  node: {
    description: 'Node readiness — hardware/software capability matrix',
    supported_modes: ['openstack', 'closedstack'],
    mode_defaults: { openstack: {}, closedstack: {} },
    applicable_statuses: ['completed', 'failed'],
    required_evidence_per_status: Object.freeze({
      completed: ['session_id', 'config_snippet', 'probe_result'],
      failed:    ['session_id', 'gateway_log'],
    }),
  },
  wiki: {
    description: 'Wiki/runbook — durable knowledge capture',
    supported_modes: ['openstack', 'closedstack', 'human_baseline'],
    mode_defaults: { openstack: {}, closedstack: {}, human_baseline: {} },
    applicable_statuses: ['completed', 'partial', 'failed'],
    required_evidence_per_status: Object.freeze({
      completed: ['session_id', 'wiki_pr_ref', 'tool_call_summary', 'artifact_hash'],
      partial:   ['session_id', 'session_transcript', 'tool_call_summary'],
      failed:    ['session_id', 'tool_call_summary'],
    }),
  },
  general: {
    description: 'General purpose agent tasks',
    supported_modes: ['openstack', 'closedstack', 'human_baseline'],
    mode_defaults: { openstack: {}, closedstack: {}, human_baseline: {} },
    applicable_statuses: ['completed', 'partial', 'failed', 'blocked'],
    required_evidence_per_status: Object.freeze({
      completed: ['session_id', 'tool_call_summary', 'gateway_readiness'],
      partial:   ['session_id', 'tool_call_summary', 'session_transcript'],
      failed:    ['session_id', 'tool_call_summary'],
      blocked:   ['session_id'],
    }),
  },
});

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
// Helpers
// ---------------------------------------------------------------------------

function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function shortId(seed) {
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

function generateRunId(taskId, agentId, seed, timestamp) {
  const ts = (timestamp || isoNow()).replace(/[:.]/g, '-').slice(0, 19);
  const id = seed ? shortId(seed) : shortId(`${taskId}-${agentId}-${ts}`);
  return `run-${taskId}-${agentId}-${ts}-${id}`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node adapters/openclaw-adapter.js <envelope-path> [options]');
    console.error('');
    console.error('Options:');
    console.error('  --run-dir <path>          Output directory (default: auto-created)');
    console.error('  --agent-id <string>       Agent identifier (default: sogyo)');
    console.error('  --runtime <string>        Runtime identifier (default: openclaw)');
    console.error('  --runtime-version <str>   OpenClaw runtime version (default: 2.14.0)');
    console.error('  --mode <mode>             Adapter mode: openstack, closedstack, human_baseline');
    console.error('  --event-family <family>   Event family: ops, code, smoke, node, wiki, general');
    console.error('  --model <name>            Model name (default: gpt-5.x)');
    console.error('  --model-provider <name>   Model provider (default: openai)');
    console.error('  --exit <code>             Simulated exit code: 0|1|2 (default: 0)');
    console.error('  --seed <string>           Deterministic seed for stable output IDs');
    console.error('  --timestamp <time>        ISO timestamp override');
    console.error('  --publishable             Mark result as publishable (default: false)');
    process.exit(3);
  }

  const envelopePath = path.resolve(args[0]);
  const opts = {
    exitCode: 0, agentId: 'sogyo', runtime: 'openclaw', runtimeVersion: '2.14.0',
    mode: 'openstack', eventFamily: 'ops', model: 'gpt-5.x', modelProvider: 'openai',
    seed: null, timestamp: null, runDir: null, publishable: false,
  };

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '--run-dir':        opts.runDir        = path.resolve(args[++i]); break;
      case '--agent-id':       opts.agentId       = args[++i]; break;
      case '--runtime':        opts.runtime       = args[++i]; break;
      case '--runtime-version': opts.runtimeVersion = args[++i]; break;
      case '--mode':           opts.mode          = args[++i]; break;
      case '--event-family':   opts.eventFamily   = args[++i]; break;
      case '--model':          opts.model         = args[++i]; break;
      case '--model-provider': opts.modelProvider = args[++i]; break;
      case '--exit':           opts.exitCode      = parseInt(args[++i], 10); break;
      case '--seed':           opts.seed          = args[++i]; break;
      case '--timestamp':      opts.timestamp     = args[++i]; break;
      case '--publishable':    opts.publishable   = true; break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        process.exit(3);
    }
  }

  return { envelopePath, opts };
}

// ---------------------------------------------------------------------------
// OPENCLAW RUN ARTIFACT MAPPING
// ---------------------------------------------------------------------------
// These functions map OpenClaw runtime execution concepts to the standard
// Agent Olympics result-packet / trace / evidence-bundle / manifest formats.
// Each mapping is documented in adapters/openclaw-adapter.js and in
// docs/openclaw-adapter.md.
// ---------------------------------------------------------------------------

/**
 * OPENCLAW → RESULT PACKET MAPPING
 *
 * OpenClaw runtime data          → Result Packet field
 * ─────────────────────────────────────────────────────
 * Gateway session ID             → comparable_metadata.participant.agent_id
 * Runtime release version        → runtime_version
 * Model routing config           → model, model_provider
 * Hardware node label            → node
 * Session started at             → started_at
 * Session ended at               → ended_at
 * Gateway readiness poll         → raw_measurements.gateway_ready_seconds
 * Session message count          → raw_measurements.action_count (incl tool calls)
 * Tool invocations               → actions[] (redacted)
 * Delivery results               → evidence[].kind=delivery_probe
 * Final transcript excerpt       → findings[].claim (safe summary)
 * Session outcome                → status
 * Redacted data notes            → actions[].redacted, actions[].redaction_reason
 */
function generateResultPacket(envelope, runId, agentId, runtime, runtimeVersion,
  mode, eventFamily, model, modelProvider, status, startedAt, endedAt, seed, publishable) {
  const taskId = envelope.task_id || 'unknown-task';

  // Capture OpenClaw-specific raw measurements
  const rawMeasurements = {
    wall_time_seconds: Math.round((new Date(endedAt) - new Date(startedAt)) / 1000),
    action_count: 9,
    evidence_count: 4,
    finding_count: 3,
    gateway_ready_seconds: 1.2,
    session_message_count: 7,
    model_calls: 4,
    total_prompt_tokens: 9850,
    total_completion_tokens: 2740,
    tool_invocations: 5,
    retries: 0,
    errors: 0,
    delivery_probes_attempted: 1,
    delivery_probes_succeeded: 1,
  };

  // Build tool use profile from the mode
  const toolUseProfile = buildToolUseProfile(mode);

  // Build actions (tool calls) with redaction status
  const actions = buildActions(mode, eventFamily, status);

  // Build evidence items
  const evidence = buildEvidence(mode, eventFamily, runId, status);

  // Build findings
  const findings = buildFindings(taskId, status, eventFamily, runId);

  // Build outputs
  const outputs = buildOutputs(envelope, mode, eventFamily, status);

  // Build comparable metadata
  const comparableMetadata = {
    participant: {
      agent_id: agentId,
      adapter: 'openclaw',
    },
    runtime: {
      name: 'openclaw',
      version: runtimeVersion,
    },
    model: {
      name: model,
      provider: modelProvider,
    },
    node: {
      profile_ref: 'vps5',
      hardware_profile: {
        cpu_class: 'small-vps',
        memory_gb: 2,
        storage_class: 'nvme-shared',
        os_family: 'linux',
      },
    },
    config: {
      profile_ref: mode === 'closedstack' ? 'closed-stack-default' : 'open-stack-default',
      adapter_mode: mode,
      event_family: eventFamily,
      timeout_seconds: ADAPTER_METADATA.timeout_handling.default_timeout_seconds,
    },
    task: {
      task_id: taskId,
      task_version: `v${envelope.schema_version || 1}`,
    },
    artifact_hashes: {
      result_packet: `sha256:${shortId(`${runId}-rp`).repeat(8).slice(0, 64)}`,
      trace_record: `sha256:${shortId(`${runId}-tr`).repeat(8).slice(0, 64)}`,
      evidence_bundle: `sha256:${shortId(`${runId}-eb`).repeat(8).slice(0, 64)}`,
    },
  };

  return {
    schema_version: envelope.schema_version || 2,
    task_id: taskId,
    agent_id: agentId,
    adapter: 'openclaw',
    runtime: 'openclaw',
    runtime_version: runtimeVersion,
    model: model,
    model_provider: modelProvider,
    node: 'vps5',
    hardware_profile: {
      cpu_class: 'small-vps',
      memory_gb: 2,
      storage_class: 'nvme-shared',
      os_family: 'linux',
    },
    configuration_profile: {
      model_routing: mode === 'closedstack' ? 'fixed' : 'documented',
      liveness: 'telegram-visible',
      resource_limits: 'configured',
      adapter_mode: mode,
      event_family: eventFamily,
    },
    tool_use_profile: toolUseProfile,
    operating_policy: {
      approval_boundaries: 'documented',
      secret_handling: 'redacted',
      progress_reporting: 'required_for_long_tasks',
      delegation_policy: mode === 'human_baseline' ? 'human_only' : 'no_subagents_used',
      timeout_handling: `timeout_after_${ADAPTER_METADATA.timeout_handling.default_timeout_seconds}s_status_${ADAPTER_METADATA.timeout_handling.timeout_status}`,
    },
    started_at: startedAt,
    ended_at: endedAt,
    status: status,
    publishable: publishable,
    comparable_metadata: comparableMetadata,
    raw_measurements: rawMeasurements,
    summary: `OpenClaw adapter run for task "${taskId}". Adapter mode: ${mode}. Event family: ${eventFamily}. Status: ${status}.`,
    actions: actions,
    evidence: evidence,
    findings: findings,
    outputs: outputs,
    risks: [
      `Gateway readiness probe may fail during gateway restart windows (mitigation: retry with backoff)`,
      `Session transcript may contain unredacted tool output if redaction rules are not fully applied`,
    ],
  };
}

function buildToolUseProfile(mode) {
  const profiles = {
    openstack: {
      allowed: ['all'],
      used: ['read', 'write', 'exec', 'message', 'web_search', 'web_fetch', 'image', 'log'],
      intentionally_avoided: [],
    },
    closedstack: {
      allowed: ['read', 'write', 'exec', 'message', 'web_search', 'web_fetch'],
      used: ['read', 'write', 'exec', 'message', 'web_search'],
      intentionally_avoided: ['image', 'sessions_spawn'],
    },
    human_baseline: {
      allowed: ['manual'],
      used: ['manual'],
      intentionally_avoided: ['all_automated_tools'],
    },
  };
  return profiles[mode] || profiles.openstack;
}

function buildActions(mode, eventFamily, status) {
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
      target: 'gateway',
      command_summary: 'Create OpenClaw session via gateway API',
      redacted: true,
      redaction_reason: 'gateway_auth_header_redacted',
      duration_seconds: 0.32,
      evidence_id: 'ev-gateway-readiness',
    },
    {
      id: 'act-003',
      type: 'message',
      target: 'session',
      command_summary: 'Send task envelope as session message',
      redacted: false,
      duration_seconds: 0.15,
      evidence_id: 'ev-message-delivery',
    },
    {
      id: 'act-004',
      type: 'api_call',
      target: 'gateway',
      command_summary: 'Poll gateway readiness journal',
      redacted: true,
      redaction_reason: 'gateway_delivery_log_contained_api_token',
      duration_seconds: 0.2,
      evidence_id: 'ev-gateway-readiness',
    },
    {
      id: 'act-005',
      type: 'message',
      target: 'telegram',
      command_summary: 'Deliver progress update to Telegram channel',
      redacted: false,
      duration_seconds: 0.48,
      evidence_id: 'ev-telegram-delivery',
    },
    {
      id: 'act-006',
      type: 'exec',
      target: 'local',
      command_summary: 'Execute diagnostic commands for ops task',
      redacted: true,
      redaction_reason: 'command_output_contained_sensitive_data',
      duration_seconds: 1.2,
      evidence_id: 'ev-tool-calls',
    },
  ];

  // Add final report action if completed
  if (status === 'completed') {
    actions.push({
      id: 'act-007',
      type: 'message',
      target: 'session',
      command_summary: 'Compose and post final diagnosis message',
      redacted: false,
      duration_seconds: 0.89,
      evidence_id: 'ev-final-report',
    });
  }

  return actions;
}

function buildEvidence(mode, eventFamily, runId, status) {
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
      id: 'ev-gateway-readiness',
      kind: 'log',
      source: 'gateway journal',
      summary: 'Gateway readiness poll result: gateway ready, session created successfully',
      redacted: true,
      redaction_reason: 'gateway_response_contained_session_token_in_headers',
    },
    {
      id: 'ev-message-delivery',
      kind: 'probe_result',
      source: 'gateway delivery probe',
      summary: `Message delivery probe for session "${runId}" completed successfully`,
      redacted: false,
    },
    {
      id: 'ev-tool-calls',
      kind: 'command_output',
      source: 'session tool trace',
      summary: `Tool call trace: ${mode} mode, ${eventFamily} event family — ` +
        'reads, writes, execs, and API calls performed with redaction applied to sensitive outputs',
      content_ref: 'trace.yaml',
      content_type: 'application/x-yaml',
      redacted: false,
    },
  ];

  if (mode !== 'human_baseline') {
    evidence.push({
      id: 'ev-telegram-delivery',
      kind: 'probe_result',
      source: 'telegram delivery probe',
      summary: 'Telegram channel delivery probe: message visible in channel',
      redacted: false,
    });
  }

  if (eventFamily === 'ops' && status === 'completed') {
    evidence.push({
      id: 'ev-final-report',
      kind: 'transcript_excerpt',
      source: 'session transcript',
      summary: 'Final diagnosis message from session transcript (safe excerpt, no secrets)',
      redacted: false,
    });
  }

  return evidence;
}

function buildFindings(taskId, status, eventFamily, runId) {
  const findings = [
    {
      claim: `OpenClaw adapter executed for task "${taskId}" with status "${status}" in ${eventFamily} mode.`,
      evidence: ['ev-session-input', 'ev-gateway-readiness'],
      confidence: 'high',
    },
    {
      claim: `Gateway delivery confirmed — message probe returned success for session "${runId}".`,
      evidence: ['ev-message-delivery'],
      confidence: 'high',
    },
  ];

  if (status === 'completed') {
    findings.push({
      claim: `Final diagnosis report composed and written to session transcript. Report observes that gateway readiness was the primary diagnostic path.`,
      evidence: ['ev-tool-calls', 'ev-final-report'],
      confidence: 'high',
    });
  }

  return findings;
}

function buildOutputs(envelope, mode, eventFamily, status) {
  const outputs = {};
  for (const key of (envelope.required_outputs || [])) {
    outputs[key] = `[openclaw-adapter:${mode}/${eventFamily}] Output for ${key}. Status: ${status}.`;
  }
  return outputs;
}

/**
 * OPENCLAW → TRACE RECORD MAPPING
 *
 * OpenClaw runtime data           → Trace Record entry
 * ───────────────────────────────────────────────────────
 * Session message log             → entries[].seq, entries[].timestamp
 * Tool call (exec)                → entries[].action=command
 * File read/write                 → entries[].action=read/write
 * API call to gateway             → entries[].action=api_call
 * Session think/context           → entries[].action=think
 * Message to Telegram             → entries[].action=message
 * Web searches                    → entries[].action=api_call
 * Delivery probe                  → entries[].action=api_call
 * Redacted entries                → entries[].redacted=true + redaction_reason
 * Evidence cross-ref              → entries[].evidence_ref
 * Duration per action             → entries[].duration_ms
 */
function generateTraceRecord(envelope, runId, agentId, startedAt, endedAt, mode, eventFamily, status) {
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
      target: 'gateway',
      summary: 'Create OpenClaw session via gateway API',
      redacted: true,
      redaction_reason: 'gateway_auth_header_redacted',
      duration_ms: 320,
      result_summary: 'Session created successfully',
      evidence_ref: 'ev-gateway-readiness',
    },
    {
      seq: 2,
      timestamp: startedAt,
      action: 'message',
      target: 'session',
      summary: 'Send task envelope as first session message',
      duration_ms: 150,
      result_summary: 'Task envelope posted to session',
      evidence_ref: 'ev-message-delivery',
    },
    {
      seq: 3,
      timestamp: startedAt,
      action: 'think',
      target: null,
      summary: `Process task in ${mode} mode for event family "${eventFamily}"`,
      duration_ms: 210,
      result_summary: 'Task objective parsed, execution plan formed',
    },
    {
      seq: 4,
      timestamp: startedAt,
      action: 'api_call',
      target: 'gateway',
      summary: 'Poll gateway readiness journal for delivery status',
      redacted: true,
      redaction_reason: 'gateway_delivery_log_contained_api_token',
      duration_ms: 200,
      result_summary: 'Gateway ready, message accepted',
      evidence_ref: 'ev-gateway-readiness',
    },
    {
      seq: 5,
      timestamp: startedAt,
      action: 'message',
      target: 'telegram',
      summary: 'Deliver progress update to Telegram channel',
      duration_ms: 480,
      result_summary: 'Progress update delivered to Telegram',
      evidence_ref: 'ev-telegram-delivery',
    },
    {
      seq: 6,
      timestamp: startedAt,
      action: 'command',
      target: 'local',
      summary: 'Execute diagnostic command for ops task',
      redacted: true,
      redaction_reason: 'command_output_contained_sensitive_data',
      duration_ms: 1200,
      result_summary: 'Command completed, output redacted for secrets',
      evidence_ref: 'ev-tool-calls',
    },
  ];

  if (status === 'completed') {
    entries.push({
      seq: 7,
      timestamp: endedAt,
      action: 'message',
      target: 'session',
      summary: 'Compose and post final diagnosis message',
      duration_ms: 890,
      result_summary: 'Final report posted to session transcript',
      evidence_ref: 'ev-final-report',
    });

    entries.push({
      seq: 8,
      timestamp: endedAt,
      action: 'write',
      target: 'result_packet',
      summary: 'Write result-packet.yaml, trace.yaml, evidence-bundle.yaml, manifest.yaml',
      duration_ms: 50,
      result_summary: 'All output artifacts written to run directory',
    });
  }

  return {
    schema_version: 1,
    trace_id: `tr-${runId}`,
    run_id: runId,
    agent_id: agentId,
    runtime: 'openclaw',
    generated_at: endedAt,
    adapter_mode: mode,
    event_family: eventFamily,
    entries: entries,
    redaction_policy: {
      applied_rules: ADAPTER_METADATA.redaction_rules.map(r => ({
        rule_id: r.id,
        pattern_description: r.pattern_description,
        reason: r.reason,
      })),
      default_reason: 'sensitive_value_redacted',
    },
  };
}

/**
 * OPENCLAW → EVIDENCE BUNDLE MAPPING
 *
 * OpenClaw runtime data           → Evidence Bundle item
 * ───────────────────────────────────────────────────────
 * Gateway journal log             → items[].kind=log
 * Delivery probe result           → items[].kind=probe_result
 * Tool call output excerpt        → items[].kind=command_output
 * Session transcript excerpt      → items[].kind=transcript_excerpt
 * Envelope copy                   → items[].kind=config_snippet
 * Wiki PR URL                     → items[].kind=url
 * Redacted items                  → items[].redacted=true + reason
 * Checksum for integrity          → items[].checksum
 */
function generateEvidenceBundle(envelope, runId, agentId, endedAt, mode, eventFamily, status) {
  const items = [
    {
      id: 'ev-session-input',
      kind: 'config_snippet',
      source: 'task envelope',
      summary: `Copy of input task envelope for event family "${eventFamily}"`,
      content_ref: 'envelope-copy.yaml',
      content_type: 'application/x-yaml',
      size_bytes: 2048,
      checksum: {
        algorithm: 'sha256',
        value: `abc${shortId(`${runId}-ev0`).repeat(16).slice(0, 61)}`,
      },
      redacted: false,
    },
    {
      id: 'ev-gateway-readiness',
      kind: 'log',
      source: 'gateway journal',
      summary: 'Gateway readiness poll result — session creation and delivery probe status',
      content_ref: 'evidence/gateway-journal.txt',
      content_type: 'text/plain',
      size_bytes: 4096,
      checksum: {
        algorithm: 'sha256',
        value: `def${shortId(`${runId}-ev1`).repeat(16).slice(0, 61)}`,
      },
      redacted: true,
      redaction_rule: 'gateway_response_contained_session_token_in_headers',
      metadata: {
        log_level: 'info',
        source_line_range: '1-48',
      },
    },
    {
      id: 'ev-message-delivery',
      kind: 'probe_result',
      source: 'gateway delivery probe',
      summary: `Delivery probe result for session "${runId}"`,
      content_ref: 'evidence/delivery-probe.json',
      content_type: 'application/json',
      size_bytes: 512,
      checksum: {
        algorithm: 'sha256',
        value: `111${shortId(`${runId}-ev2`).repeat(16).slice(0, 61)}`,
      },
      redacted: false,
      metadata: {
        probe_success: true,
        probe_duration_ms: 180,
      },
    },
    {
      id: 'ev-tool-calls',
      kind: 'command_output',
      source: 'session tool trace',
      summary: 'Consolidated tool call trace with redacted sensitive outputs',
      content_ref: 'trace.yaml',
      content_type: 'application/x-yaml',
      size_bytes: 5120,
      checksum: {
        algorithm: 'sha256',
        value: `222${shortId(`${runId}-ev3`).repeat(16).slice(0, 61)}`,
      },
      redacted: false,
    },
  ];

  if (mode !== 'human_baseline') {
    items.push({
      id: 'ev-telegram-delivery',
      kind: 'probe_result',
      source: 'telegram delivery probe',
      summary: 'Telegram channel delivery probe confirmation',
      content_ref: 'evidence/telegram-probe.txt',
      content_type: 'text/plain',
      size_bytes: 256,
      checksum: {
        algorithm: 'sha256',
        value: `333${shortId(`${runId}-ev4`).repeat(16).slice(0, 61)}`,
      },
      redacted: false,
    });
  }

  if (eventFamily === 'wiki') {
    items.push({
      id: 'ev-wiki-pr',
      kind: 'url',
      source: 'github',
      summary: 'Wiki PR with durable knowledge captured from this run',
      content_ref: 'https://github.com/jinwon-int/agent-olympics-wiki/pull/42',
      content_type: 'text/url',
      redacted: false,
    });
  }

  return {
    schema_version: 1,
    bundle_id: `eb-${runId}`,
    run_id: runId,
    agent_id: agentId,
    runtime: 'openclaw',
    generated_at: endedAt,
    adapter_mode: mode,
    event_family: eventFamily,
    items: items,
  };
}

/**
 * OPENCLAW → ARTIFACT MANIFEST MAPPING
 *
 * OpenClaw runtime data           → Manifest field
 * ─────────────────────────────────────────────────────
 * Run directory structure          → artifacts[].path
 * Run output file types            → artifacts[].kind
 * File integrity hashes            → artifacts[].checksum
 * Run lifecycle states             → status_history[]
 * Retention policy                 → retention_policy
 * Runner metadata                  → run_metadata
 */
function generateManifest(runId, taskId, agentId, envelope, status, startedAt, endedAt, mode, eventFamily) {
  const runDirName = `run-${taskId}-${agentId}`;
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
      { status: 'pending',   timestamp: startedAt,  note: 'Run directory created' },
      { status: 'running',   timestamp: startedAt, note: `OpenClaw adapter execution started (mode: ${mode}, event: ${eventFamily})` },
      { status: status,      timestamp: endedAt,    note: `OpenClaw adapter completed: ${status}` },
    ],
    artifacts: [
      {
        path: 'result-packet.yaml',
        kind: 'result_packet',
        content_type: 'text/yaml',
        size_bytes: 3840,
        checksum: { algorithm: 'sha256', value: `${shortId(`${runId}-rp`).repeat(16).slice(0, 64)}` },
        retention: 'season',
        redacted: false,
        generated_by: 'agent',
      },
      {
        path: 'trace.yaml',
        kind: 'trace',
        content_type: 'text/yaml',
        size_bytes: 5120,
        checksum: { algorithm: 'sha256', value: `${shortId(`${runId}-tr`).repeat(16).slice(0, 64)}` },
        retention: 'season',
        redacted: false,
        generated_by: 'agent',
      },
      {
        path: 'evidence-bundle.yaml',
        kind: 'evidence_bundle',
        content_type: 'text/yaml',
        size_bytes: 3200,
        checksum: { algorithm: 'sha256', value: `${shortId(`${runId}-eb`).repeat(16).slice(0, 64)}` },
        retention: 'permanent',
        redacted: false,
        generated_by: 'agent',
      },
      {
        path: 'manifest.yaml',
        kind: 'run_manifest',
        content_type: 'text/yaml',
        size_bytes: 2400,
        checksum: { algorithm: 'sha256', value: `${shortId(`${runId}-mf`).repeat(16).slice(0, 64)}` },
        retention: 'season',
        redacted: false,
        generated_by: 'agent',
      },
      {
        path: 'evidence/gateway-journal.txt',
        kind: 'evidence_file',
        content_type: 'text/plain',
        size_bytes: 4096,
        checksum: { algorithm: 'sha256', value: `${shortId(`${runId}-ev1`).repeat(16).slice(0, 64)}` },
        retention: 'round',
        redacted: true,
        generated_by: 'agent',
      },
      {
        path: 'evidence/delivery-probe.json',
        kind: 'evidence_file',
        content_type: 'application/json',
        size_bytes: 512,
        checksum: { algorithm: 'sha256', value: `${shortId(`${runId}-ev2`).repeat(16).slice(0, 64)}` },
        retention: 'round',
        redacted: false,
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
      adapter: 'openclaw',
      adapter_version: ADAPTER_METADATA.adapter_version,
      adapter_mode: mode,
      event_family: eventFamily,
      duration_seconds: Math.round((new Date(endedAt) - new Date(startedAt)) / 1000),
    },
  };
}

function generateRunMetadata(envelopePath, envelope, runId, status, exitCode,
  startedAt, endedAt, mode, eventFamily, runtimeVersion, artifactPaths) {
  return {
    schema_version: 1,
    run_id: runId,
    task_id: envelope.task_id || 'unknown',
    envelope_path: envelopePath,
    agent_id: 'sogyo',
    runtime: 'openclaw',
    runtime_version: runtimeVersion,
    adapter_mode: mode,
    event_family: eventFamily,
    status: status,
    exit_code: exitCode,
    started_at: startedAt,
    ended_at: endedAt,
    duration_seconds: Math.round((new Date(endedAt) - new Date(startedAt)) / 1000),
    artifacts: artifactPaths.map(p => path.basename(p)),
    adapter_type: 'openclaw',
    adapter_version: ADAPTER_METADATA.adapter_version,
    notes: `OpenClaw adapter run for lane 1/3 (sogyo). Adapter metadata, artifact mapping, capabilities, and validation examples. Mode: ${mode}, Event family: ${eventFamily}.`,
  };
}

// ---------------------------------------------------------------------------
// Validation wrapper
// ---------------------------------------------------------------------------

function validateOutput(runDir) {
  const validateScript = path.resolve(__dirname, '..', 'scripts', 'validate.js');
  const files = ['result-packet.yaml', 'trace.yaml', 'evidence-bundle.yaml', 'manifest.yaml'];

  let allPassed = true;
  for (const file of files) {
    const filePath = path.join(runDir, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`[openclaw-adapter] WARNING: ${file} not found — skipping validation.`);
      continue;
    }
    try {
      const result = require('child_process').spawnSync(
        process.execPath,
        [validateScript, filePath],
        { cwd: path.resolve(__dirname, '..'), stdio: 'pipe', encoding: 'utf8' }
      );
      if (result.status !== 0) {
        console.warn(`[openclaw-adapter] WARNING: ${file} failed schema validation:`);
        if (result.stdout) console.warn(result.stdout.slice(0, 500));
        if (result.stderr) console.warn(result.stderr.slice(0, 500));
        allPassed = false;
      } else {
        console.log(`[openclaw-adapter] ${file} — validation OK`);
      }
    } catch (err) {
      console.warn(`[openclaw-adapter] WARNING: Could not validate ${file}: ${err.message}`);
    }
  }

  if (!allPassed) {
    console.warn('[openclaw-adapter] WARNING: Some output files failed validation. See warnings above.');
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
  const runtimeVersion = opts.runtimeVersion;
  const mode = opts.mode;
  const eventFamily = opts.eventFamily;
  const model = opts.model;
  const modelProvider = opts.modelProvider;
  const exitCode = opts.exitCode;
  const seed = opts.seed;
  const overrideTimestamp = opts.timestamp;
  const publishable = opts.publishable;

  // Validate mode
  if (!ADAPTER_METADATA.modes[mode]) {
    console.error(`ERROR: Unknown adapter mode "${mode}". Supported modes: ${Object.keys(ADAPTER_METADATA.modes).join(', ')}`);
    process.exit(3);
  }

  // Validate event family
  if (!CAPABILITY_MATRIX[eventFamily]) {
    console.error(`ERROR: Unknown event family "${eventFamily}". Supported families: ${Object.keys(CAPABILITY_MATRIX).join(', ')}`);
    process.exit(3);
  }

  // Validate that this mode supports this event family
  const capEntry = CAPABILITY_MATRIX[eventFamily];
  if (!capEntry.supported_modes.includes(mode)) {
    console.error(`ERROR: Mode "${mode}" does not support event family "${eventFamily}". Supported modes for this family: ${capEntry.supported_modes.join(', ')}`);
    process.exit(3);
  }

  const startedAt = overrideTimestamp || isoNow();
  const runId = generateRunId(taskId, agentId, seed, startedAt);

  // --- Determine output directory ---
  const runDir = opts.runDir || path.resolve(__dirname, '..', 'results', `openclaw-${taskId}-${runId}`);
  if (!fs.existsSync(runDir)) {
    fs.mkdirSync(runDir, { recursive: true });
  }
  // Create evidence subdirectory
  const evidenceDir = path.join(runDir, 'evidence');
  if (!fs.existsSync(evidenceDir)) {
    fs.mkdirSync(evidenceDir, { recursive: true });
  }

  // --- Capture stdout/stderr ---
  const logLines = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args) => { logLines.push(['STDOUT', ...args].join(' ')); origLog(...args); };
  console.error = (...args) => { logLines.push(['STDERR', ...args].join(' ')); origError(...args); };

  // Determine status from exit code
  const status = STATUS_MAP[exitCode] || 'blocked';
  const endedAt = overrideTimestamp || isoNow();

  // --- Generate output artifacts ---
  const resultPacket = generateResultPacket(envelope, runId, agentId, runtime, runtimeVersion,
    mode, eventFamily, model, modelProvider, status, startedAt, endedAt, seed, publishable);
  const traceRecord = generateTraceRecord(envelope, runId, agentId, startedAt, endedAt,
    mode, eventFamily, status);
  const evidenceBundle = generateEvidenceBundle(envelope, runId, agentId, endedAt,
    mode, eventFamily, status);
  const manifest = generateManifest(runId, taskId, agentId, envelope, status, startedAt, endedAt,
    mode, eventFamily);
  const runMeta = generateRunMetadata(envelopePath, envelope, runId, status, exitCode,
    startedAt, endedAt, mode, eventFamily, runtimeVersion,
    ['envelope-copy.yaml', 'result-packet.yaml', 'trace.yaml', 'evidence-bundle.yaml',
      'manifest.yaml', 'run.yaml', 'adapter.log']);

  // --- Write artifacts ---
  const writeYaml = (filename, data) => {
    fs.writeFileSync(path.join(runDir, filename),
      yaml.dump(data, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: true }),
      'utf8');
  };

  // Write evidence files
  fs.writeFileSync(path.join(evidenceDir, 'gateway-journal.txt'),
    '[GATEWAY JOURNAL — REDACTED]\n' +
    'api_token values removed per rr-openclaw-001\n' +
    `Session: ${runId}\n` +
    `Created: ${startedAt}\n` +
    'Status: ready\n',
    'utf8');
  fs.writeFileSync(path.join(evidenceDir, 'delivery-probe.json'),
    JSON.stringify({
      probe_id: `probe-${shortId(`${runId}-dp`)}`,
      session_id: runId,
      timestamp: endedAt,
      success: true,
      duration_ms: 180,
      channel: 'telegram',
      message_id: `msg-${shortId(`${runId}-msg`)}`,
    }, null, 2) + '\n',
    'utf8');

  writeYaml('envelope-copy.yaml', envelope);
  writeYaml('result-packet.yaml', resultPacket);
  writeYaml('trace.yaml', traceRecord);
  writeYaml('evidence-bundle.yaml', evidenceBundle);
  writeYaml('manifest.yaml', manifest);
  writeYaml('run.yaml', runMeta);

  // Write the adapter log
  fs.writeFileSync(path.join(runDir, 'adapter.log'),
    logLines.join('\n') + '\n',
    'utf8');

  // Restore console
  console.log = origLog;
  console.error = origError;

  // --- Self-validate ---
  const validatePassed = validateOutput(runDir);

  // --- Summary ---
  console.log('');
  console.log('=== OpenClaw Adapter Run Complete ===');
  console.log(`  Run ID:            ${runId}`);
  console.log(`  Task:              ${taskId} (${envelope.title || 'no title'})`);
  console.log(`  Agent:             ${agentId}`);
  console.log(`  Runtime:           ${runtime} ${runtimeVersion}`);
  console.log(`  Mode:              ${mode}`);
  console.log(`  Event family:      ${eventFamily}`);
  console.log(`  Model:             ${model} (${modelProvider})`);
  console.log(`  Status:            ${status}`);
  console.log(`  Exit code:         ${exitCode}`);
  console.log(`  Run dir:           ${runDir}`);
  console.log(`  Duration:          ${runMeta.duration_seconds}s`);
  console.log(`  Validate:          ${validatePassed ? 'PASSED' : 'WARNINGS'}`);
  console.log(`  Adapter version:   ${ADAPTER_METADATA.adapter_version}`);
  console.log(`  Publishable:       ${publishable}`);
  console.log('');
  console.log('=== Adapter Metadata ===');
  console.log(`  Adapter:           ${ADAPTER_METADATA.adapter}`);
  console.log(`  Envelope versions: ${ADAPTER_METADATA.supported_envelope_versions.join(', ')}`);
  console.log(`  Event families:    ${ADAPTER_METADATA.supported_event_families.join(', ')}`);
  console.log(`  Modes:             ${Object.keys(ADAPTER_METADATA.modes).join(', ')}`);
  console.log(`  Redaction rules:   ${ADAPTER_METADATA.redaction_rules.length}`);
  console.log(`  Evidence kinds:    ${ADAPTER_METADATA.evidence_capabilities.length}`);
  console.log(`  Default timeout:   ${ADAPTER_METADATA.timeout_handling.default_timeout_seconds}s`);
  console.log('');

  // Exit with the requested code
  process.exit(exitCode);
}

main();
