/**
 * Agent Olympics — runtime artifact fingerprinting (heuristic, CJS module)
 *
 * Layer 3 of the live-runner runtime identity checks: inspects the SHAPE of a
 * run's artifacts (result packet + trace) and guesses which known adapter
 * runtime produced them, independently of the operator-declared
 * `runtime`/`adapter` labels.
 *
 * Detected runtimes and their structural signals:
 *
 *   hermes   — orchestrator artifacts: delegation_profile.a2a_workers
 *              non-empty, evidence kinds workflow_plan / worker_trace /
 *              commander_report / worker_assignment / contradiction_log /
 *              memory_summary / workflow_state, adapter mode
 *              orchestrator|coordinator, worker/workflow trace activity.
 *   openclaw — gateway/session artifacts: evidence kinds session_id /
 *              gateway_readiness / gateway_log / tool_call_summary /
 *              delivery_probe / message_id / session_transcript, adapter mode
 *              openstack|closedstack|human_baseline, gateway/telegram
 *              evidence ids (the simulation adapter emits ev-gateway-readiness
 *              / ev-telegram-delivery with generic v1 kinds).
 *   stub     — scripts/stub-adapter.js artifacts: ev-stub-* evidence ids,
 *              "Stub adapter run ... deterministic placeholder" summary,
 *              stub agent/runtime labels.
 *   cli      — scripts/cli-adapter.js + cli-mission-wrapper artifacts: CLI-
 *              native evidence kinds (transcript_excerpt / file_diff /
 *              command_output), ev-cli-* evidence ids, adapter mode cli, and a
 *              SOLO delegation_profile (subagents_used false AND empty
 *              a2a_workers) — the distinguishing shape of a bare coding-agent
 *              CLI vs an orchestrator.
 *
 * A non-unknown verdict requires at least MIN_SIGNALS (2) distinct signals
 * for one runtime AND strictly more signals than any other candidate
 * (ties → unknown).
 *
 * HONESTY: this is a heuristic that catches honest misconfiguration
 * (mislabeled adapters, wrong runner-config entries). It does NOT defend
 * against adversarial spoofing — a malicious wrapper can fabricate every
 * signal below. Cryptographically attested runtimes are out of scope.
 */

'use strict';

const MIN_SIGNALS = 2;

const HERMES_EVIDENCE_KINDS = new Set([
  'workflow_plan', 'worker_trace', 'commander_report', 'worker_assignment',
  'memory_summary', 'contradiction_log', 'workflow_state',
]);
const HERMES_MODES = new Set(['orchestrator', 'coordinator']);

const OPENCLAW_EVIDENCE_KINDS = new Set([
  'session_id', 'gateway_readiness', 'gateway_log', 'tool_call_summary',
  'delivery_probe', 'message_id', 'session_transcript', 'wiki_pr_ref',
]);
const OPENCLAW_MODES = new Set(['openstack', 'closedstack', 'human_baseline']);
// The committed OpenClaw simulation adapter emits generic v1 evidence kinds
// (log / probe_result / transcript_excerpt) but characteristic gateway /
// telegram evidence ids.
const OPENCLAW_EVIDENCE_ID_PATTERN = /gateway|telegram/i;

const STUB_EVIDENCE_ID_PATTERN = /^ev-stub-/i;
const STUB_SUMMARY_PATTERN = /stub adapter run|deterministic placeholder|deterministic stub/i;

// CLI-native evidence kinds (cli.yaml). transcript_excerpt / file_diff /
// config_snippet are characteristic of a terminal coding-agent session.
// command_output and log are shared with the stub, so they are NOT used as
// cli signals on their own — the cli verdict leans on the distinctive kinds,
// the ev-cli-* ids, the cli adapter mode, and the solo delegation shape.
const CLI_EVIDENCE_KINDS = new Set(['transcript_excerpt', 'file_diff']);
const CLI_EVIDENCE_ID_PATTERN = /^ev-cli-/i;
const CLI_MODES = new Set(['cli']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function adapterMode(packet) {
  if (!packet || typeof packet !== 'object') return null;
  const fromProfile = packet.configuration_profile && packet.configuration_profile.adapter_mode;
  const fromMeta = packet.comparable_metadata
    && packet.comparable_metadata.config
    && packet.comparable_metadata.config.details
    && packet.comparable_metadata.config.details.adapter_mode;
  return (fromProfile || fromMeta || null);
}

function traceText(trace) {
  if (!trace || typeof trace !== 'object') return '';
  return asArray(trace.entries)
    .map((e) => `${(e && e.target) || ''} ${(e && e.summary) || ''}`)
    .join('\n');
}

/**
 * Fingerprint the runtime that (probably) produced a result packet + trace.
 *
 * @param {object|null} packet result-packet document (parsed YAML)
 * @param {object|null} trace  trace record document (parsed YAML), optional
 * @returns {{ detected: 'hermes'|'openclaw'|'stub'|'cli'|'unknown',
 *             confidence: 'high'|'medium'|'low'|'none',
 *             signals: string[] }}
 */
function fingerprintRuntime(packet, trace) {
  const signals = { hermes: new Set(), openclaw: new Set(), stub: new Set(), cli: new Set() };

  const evidence = asArray(packet && packet.evidence);
  const evidenceKinds = new Set(evidence.map((e) => e && e.kind).filter(Boolean));
  const evidenceIds = evidence.map((e) => e && e.id).filter(Boolean);
  const mode = adapterMode(packet);
  const traceBody = traceText(trace);

  // --- hermes ---
  const delegation = (packet && packet.delegation_profile) || {};
  if (asArray(delegation.a2a_workers).length > 0) {
    signals.hermes.add('delegation_profile.a2a_workers non-empty');
  }
  for (const kind of evidenceKinds) {
    if (HERMES_EVIDENCE_KINDS.has(kind)) signals.hermes.add(`evidence kind "${kind}"`);
  }
  if (mode && HERMES_MODES.has(String(mode).toLowerCase())) {
    signals.hermes.add(`adapter mode "${mode}"`);
  }
  if (/\bworkflow\b|\bworker\b/i.test(traceBody)) {
    signals.hermes.add('worker/workflow activity in trace entries');
  }

  // --- openclaw ---
  for (const kind of evidenceKinds) {
    if (OPENCLAW_EVIDENCE_KINDS.has(kind)) signals.openclaw.add(`evidence kind "${kind}"`);
  }
  if (mode && OPENCLAW_MODES.has(String(mode).toLowerCase())) {
    signals.openclaw.add(`adapter mode "${mode}"`);
  }
  for (const id of evidenceIds) {
    if (OPENCLAW_EVIDENCE_ID_PATTERN.test(id)) signals.openclaw.add(`evidence id "${id}"`);
  }
  if (/\bgateway\b/i.test(traceBody)) {
    signals.openclaw.add('gateway activity in trace entries');
  }

  // --- stub ---
  for (const id of evidenceIds) {
    if (STUB_EVIDENCE_ID_PATTERN.test(id)) signals.stub.add(`evidence id "${id}"`);
  }
  if (packet && STUB_SUMMARY_PATTERN.test(String(packet.summary || ''))) {
    signals.stub.add('stub adapter summary marker');
  }
  const labels = [packet && packet.agent_id, packet && packet.runtime].filter(Boolean).map(String);
  if (labels.some((l) => /stub/i.test(l))) {
    signals.stub.add('stub agent/runtime label');
  }
  if (/stub adapter/i.test(traceBody)) {
    signals.stub.add('stub adapter marker in trace entries');
  }

  // --- cli ---
  for (const kind of evidenceKinds) {
    if (CLI_EVIDENCE_KINDS.has(kind)) signals.cli.add(`evidence kind "${kind}"`);
  }
  for (const id of evidenceIds) {
    if (CLI_EVIDENCE_ID_PATTERN.test(id)) signals.cli.add(`evidence id "${id}"`);
  }
  if (mode && CLI_MODES.has(String(mode).toLowerCase())) {
    signals.cli.add(`adapter mode "${mode}"`);
  }
  // A bare CLI coding agent is solo: subagents_used false AND no a2a_workers.
  // (Hermes/openclaw both populate a2a_workers or set subagents_used true.)
  if (delegation && delegation.subagents_used === false
      && asArray(delegation.a2a_workers).length === 0) {
    signals.cli.add('solo delegation_profile (no subagents, no a2a_workers)');
  }
  if (/\bcli agent\b|coding-agent cli/i.test(traceBody)) {
    signals.cli.add('cli agent activity in trace entries');
  }

  // --- verdict: ≥ MIN_SIGNALS distinct signals AND a strict maximum ---
  const ranked = Object.entries(signals)
    .map(([runtime, set]) => ({ runtime, count: set.size }))
    .sort((a, b) => b.count - a.count);
  const [top, second] = ranked;

  let detected = 'unknown';
  if (top.count >= MIN_SIGNALS && top.count > (second ? second.count : 0)) {
    detected = top.runtime;
  }

  const confidence = detected === 'unknown'
    ? 'none'
    : (top.count >= 4 ? 'high' : (top.count === 3 ? 'medium' : 'low'));

  const allSignals = [];
  for (const [runtime, set] of Object.entries(signals)) {
    for (const signal of set) allSignals.push(`${runtime}: ${signal}`);
  }

  return { detected, confidence, signals: allSignals };
}

module.exports = { fingerprintRuntime, MIN_SIGNALS };
