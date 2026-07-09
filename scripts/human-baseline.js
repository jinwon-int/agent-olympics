#!/usr/bin/env node
/**
 * Agent Olympics — Human Baseline authoring tool (CJS)
 *
 * The charter promises that human baselines compete through the SAME contract
 * as every other participant: the `human_baseline` division exists in the
 * result-packet schema and fixtures/adapters/capabilities/human-baseline.yaml
 * declares the adapter. A human baseline is the reference quality level — "if
 * an agent significantly outperforms or underperforms the human baseline, that
 * is a meaningful signal".
 *
 * Unlike the runtime adapters (hermes / openclaw / cli), a human baseline is
 * authored MANUALLY. There is no live-runner transport to auto-execute: a human
 * operator reads the public task envelope, performs the task by hand, and
 * records what they did. This tool is therefore a TEMPLATE -> FILL -> FINALIZE
 * -> SUBMIT workflow, not a transport:
 *
 *   1. `template`  — emit a structured, human-fillable result-packet template
 *                    for a task, pre-filled with division/runtime/adapter
 *                    human-baseline, the capability's evidence kinds, and clear
 *                    FILL_ME placeholders + inline guidance from the envelope.
 *   2. (human fills it in by hand)
 *   3. `finalize`  — validate the human-authored packet (all FILL_ME resolved,
 *                    required fields present, division/runtime human_baseline,
 *                    no secrets, no oracle references), then emit a clean
 *                    result-packet v2 that validates via scripts/validate.js.
 *   4. (submit the finalized packet as a normal results/ packet — judged by the
 *      existing harness like any other participant)
 *
 * `anchor` reads a scoreboard and, for each task that has a human-baseline
 * entry, shows each agent participant's delta vs the human reference line and
 * flags agents that significantly out/under-perform.
 *
 * Like the agent wrappers, the template and the finalized packet must NEVER
 * contain oracle/judge material — the human operator works from the public
 * envelope only. This is enforced by `finalize` (shared oracle scan +
 * secret-patterns), reusing the same machinery as safety-trial-verify and the
 * live runner rather than re-deriving it.
 *
 * CLI:
 *   node scripts/human-baseline.js template <task-envelope> --operator <id> [--output <file>]
 *   node scripts/human-baseline.js finalize <filled-template> [--output <file>]
 *   node scripts/human-baseline.js anchor [--scoreboard <file>] [--task <id>] [--blind] [--threshold <n>]
 *   node scripts/human-baseline.js fixtures
 *
 * Exit codes: 0 informational (template/anchor) or success (finalize/fixtures);
 * non-zero on a finalize validation failure or its own fixture failures.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');

const { SECRET_VALUE_PATTERNS } = require('./lib/secret-patterns');
const { scanTextForOracleReferences, scanObjectForSecretFields } = require('./live-runner');
const { fingerprintRuntime } = require('./lib/runtime-fingerprint');

const HUMAN_BASELINE_CAPABILITY = 'fixtures/adapters/capabilities/human-baseline.yaml';
const FILL = 'FILL_ME';

// Evidence ids the template seeds and finalize understands. ev-human-* is the
// distinctive id prefix the runtime fingerprint keys on.
const HUMAN_EVIDENCE_IDS = Object.freeze({
  log: 'ev-human-action-log', // the operator action timeline
  report: 'ev-human-report', // the operator's written diagnosis/answer
  artifact: 'ev-human-artifact', // produced output files / screenshots
});

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function repoPath(relPath) {
  const resolved = path.resolve(ROOT, relPath);
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) {
    throw new Error(`path escapes repository root: ${relPath}`);
  }
  return resolved;
}

function loadYaml(p) {
  const full = path.isAbsolute(p) ? p : repoPath(p);
  return yaml.load(fs.readFileSync(full, 'utf8'));
}

function dumpYaml(obj) {
  return yaml.dump(obj, { lineWidth: 100, noRefs: true, sortKeys: false });
}

function isoNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function usage() {
  console.error(`Usage:
  node scripts/human-baseline.js template <task-envelope> --operator <id> [--output <file>]
  node scripts/human-baseline.js finalize <filled-template> [--output <file>]
  node scripts/human-baseline.js anchor [--scoreboard <file>] [--task <id>] [--blind] [--threshold <n>]
  node scripts/human-baseline.js fixtures`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--operator') args.operator = argv[++i];
    else if (a === '--output' || a === '-o') args.output = argv[++i];
    else if (a === '--scoreboard') args.scoreboard = argv[++i];
    else if (a === '--task') args.task = argv[++i];
    else if (a === '--threshold') args.threshold = Number(argv[++i]);
    else if (a === '--blind') args.blind = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else args._.push(a);
  }
  return args;
}

// ---------------------------------------------------------------------------
// `template` — emit a human-fillable result-packet template
// ---------------------------------------------------------------------------

/**
 * Build the human-fillable template for a task envelope. Pre-fills the
 * participant identity fields a human operator should NOT have to invent
 * (division/runtime/adapter human-baseline, evidence-kind scaffolding) and
 * leaves FILL_ME placeholders + inline guidance for everything the operator
 * must author. NO oracle/judge material is included (same prohibition as the
 * agent wrappers): only the envelope's public fields are echoed as guidance.
 */
function buildTemplate(envelope, operatorId, capability) {
  const taskId = envelope.task_id || 'unknown-task';
  const requiredOutputs = Array.isArray(envelope.required_outputs) ? envelope.required_outputs : [];
  const allowed = Array.isArray(envelope.allowed_actions) ? envelope.allowed_actions : [];
  const forbidden = Array.isArray(envelope.forbidden_actions) ? envelope.forbidden_actions : [];
  const evidenceKinds = Array.isArray(capability.evidence_kinds) ? capability.evidence_kinds : [];

  // Outputs: one FILL_ME per required output, with the envelope objective as
  // guidance so the operator knows what each output should answer.
  const outputs = {};
  for (const key of requiredOutputs) {
    outputs[key] = `${FILL} — ${key}: what a competent human operator concluded for this output.`;
  }
  // The human action timeline lives in outputs.action_log so the fingerprint /
  // judge can read it as a structured field. It is the operator's record of
  // what they did, when, and what happened.
  outputs.action_log = [
    {
      seq: 0,
      timestamp: `${FILL} — ISO-8601 timestamp when the operator started`,
      action: `${FILL} — what the operator did first (e.g. "read gateway-journal.log")`,
      outcome: `${FILL} — what the operator observed`,
    },
    {
      seq: 1,
      timestamp: `${FILL} — next step timestamp`,
      action: `${FILL} — next operator action`,
      outcome: `${FILL} — observation`,
    },
  ];

  const evidence = [
    {
      id: HUMAN_EVIDENCE_IDS.log,
      kind: 'log',
      source: 'operator action log',
      summary: `${FILL} — one-line summary of the operator's timestamped action log for task "${taskId}".`,
      content_ref: 'evidence/human-action-log.yaml',
    },
    {
      id: HUMAN_EVIDENCE_IDS.report,
      kind: 'transcript_excerpt',
      source: 'operator notes',
      summary: `${FILL} — one-line summary of the operator's written diagnosis / answer.`,
    },
    {
      id: HUMAN_EVIDENCE_IDS.artifact,
      kind: 'command_output',
      source: 'operator-produced output',
      summary: `${FILL} — one-line summary of any command output / file diff / screenshot the operator captured (redact secrets first).`,
    },
  ];

  const findings = [
    {
      claim: `${FILL} — the operator's primary, evidence-backed conclusion for task "${taskId}".`,
      evidence: [HUMAN_EVIDENCE_IDS.report, HUMAN_EVIDENCE_IDS.log],
      confidence: 'high',
    },
    {
      claim: `${FILL} — a secondary supported finding, or remove this entry.`,
      evidence: [HUMAN_EVIDENCE_IDS.artifact],
      confidence: 'medium',
    },
  ];

  return {
    // --- authoring header (stripped by finalize) -----------------------------
    _human_baseline_template: {
      schema_version: 1,
      instructions: [
        'This is a HUMAN BASELINE authoring template. A human operator fills it',
        'in by hand after performing the task, then runs:',
        '    node scripts/human-baseline.js finalize <this-file>',
        'to produce a clean result-packet v2 for submission.',
        `Replace every "${FILL}" with real content. Do NOT leave any placeholder.`,
        'Do NOT read or reference oracle files / hidden judge notes / answer keys.',
        'Do NOT paste secret values (API keys, tokens, private keys); record',
        'locations/handles only and redact before saving.',
      ],
      task_objective: String(envelope.objective || '').trim(),
      allowed_actions: allowed,
      forbidden_actions: forbidden,
      required_outputs: requiredOutputs,
      capability_evidence_kinds: evidenceKinds,
      operator_guidance: [
        `Authoring as operator "${operatorId}".`,
        'Each finding must cite at least one evidence id that exists below.',
        'The action_log is your timestamped human action timeline — keep it honest.',
        forbidden.length
          ? `Forbidden actions for this task: ${forbidden.join(', ')}.`
          : 'No task-specific forbidden actions declared; standard safety rules still apply.',
      ],
    },

    // --- the fillable result packet -----------------------------------------
    schema_version: 2,
    task_id: taskId,
    agent_id: operatorId,
    adapter: 'human-baseline',
    runtime: 'human-baseline',
    runtime_version: 'manual',
    model: 'human-operator',
    model_provider: 'human',
    node: 'human-baseline-operator',
    started_at: `${FILL} — ISO-8601 start time`,
    ended_at: `${FILL} — ISO-8601 end time`,
    status: `${FILL} — one of: completed | partial | blocked | failed`,
    division: 'human_baseline',
    validity: `${FILL} — one of: valid | partial_valid | invalid`,
    publishable: false,
    tool_use_profile: {
      allowed: ['read', 'inspect', 'manual'],
      used: [`${FILL} — tool classes the operator actually used, e.g. read, inspect`],
      notes: 'Human operator working manually from the public task envelope.',
    },
    operating_policy: {
      approval_boundaries: 'operator_enforced',
      secret_handling: 'redacted',
      destructive_action_rules: 'destructive_actions_forbidden_without_explicit_approval',
      delegation_policy: 'no_delegation_solo_operator',
    },
    delegation_profile: {
      subagents_used: false,
      background_jobs_used: false,
      human_assistance: true,
      a2a_workers: [],
      supported_by: [],
      notes: 'Human baseline: a single human operator, no subagents and no A2A workers.',
    },
    comparable_metadata: {
      participant: { agent_id: operatorId, adapter: 'human-baseline' },
      runtime: { name: 'human-baseline', version: 'manual' },
      model: { name: 'human-operator', provider: 'human' },
      node: { profile_ref: 'human-baseline-operator' },
      config: {
        profile_ref: 'human-baseline-default',
        details: { adapter_mode: 'human-baseline' },
      },
      task: { task_id: taskId, task_version: `v${envelope.schema_version || 1}` },
    },
    configuration_profile: {
      adapter_mode: 'human-baseline',
      liveness: 'manual',
      resource_limits: 'operator-judgement',
      sandbox_mode: 'workspace_only',
    },
    summary: `${FILL} — one-paragraph summary of how the human operator approached and resolved task "${taskId}".`,
    actions: [
      {
        id: 'act-001',
        type: 'read',
        target: `${FILL} — what the operator inspected`,
        command_summary: `${FILL} — the operator's first action`,
        evidence_id: HUMAN_EVIDENCE_IDS.log,
      },
    ],
    evidence,
    findings,
    outputs,
    risks: [
      `${FILL} — any risk the operator identified while performing the task (or "none observed").`,
    ],
  };
}

function cmdTemplate(args) {
  const envelopePath = args._[1];
  if (!envelopePath || !args.operator) {
    console.error('ERROR: template requires <task-envelope> and --operator <id>.');
    usage();
    process.exitCode = 1;
    return;
  }
  let envelope;
  try {
    envelope = loadYaml(envelopePath);
  } catch (err) {
    console.error(`ERROR: failed to load envelope: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  if (!envelope || !envelope.task_id) {
    console.error('ERROR: invalid envelope (missing task_id).');
    process.exitCode = 1;
    return;
  }
  const capability = loadYaml(HUMAN_BASELINE_CAPABILITY);
  const template = buildTemplate(envelope, args.operator, capability);
  const out = dumpYaml(template);
  if (args.output) {
    fs.writeFileSync(path.resolve(args.output), out, 'utf8');
    console.log(`Human-baseline template written: ${args.output}`);
    console.log(`  Task:      ${envelope.task_id}`);
    console.log(`  Operator:  ${args.operator}`);
    console.log(`  Next:      fill in every ${FILL}, then run \`finalize\`.`);
  } else {
    process.stdout.write(out);
  }
}

// ---------------------------------------------------------------------------
// `finalize` — validate a human-authored template, emit a clean packet
// ---------------------------------------------------------------------------

/** Recursively collect string values that still contain a FILL_ME placeholder. */
function findUnresolvedPlaceholders(value, pathParts = []) {
  const hits = [];
  if (typeof value === 'string') {
    if (value.includes(FILL)) hits.push(pathParts.join('.') || '(root)');
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findUnresolvedPlaceholders(v, [...pathParts, String(i)])));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      hits.push(...findUnresolvedPlaceholders(v, [...pathParts, k]));
    }
  }
  return hits;
}

/** Scan every string in an object for raw secret values (unanchored patterns). */
function findSecretValues(value, pathParts = []) {
  const hits = [];
  if (typeof value === 'string') {
    if (SECRET_VALUE_PATTERNS.some((p) => p.test(value)))
      hits.push(pathParts.join('.') || '(root)');
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...findSecretValues(v, [...pathParts, String(i)])));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value))
      hits.push(...findSecretValues(v, [...pathParts, k]));
  }
  return hits;
}

const REQUIRED_PACKET_FIELDS = [
  'schema_version',
  'task_id',
  'agent_id',
  'runtime',
  'started_at',
  'ended_at',
  'status',
  'division',
  'validity',
  'publishable',
  'tool_use_profile',
  'operating_policy',
  'delegation_profile',
  'comparable_metadata',
  'summary',
  'evidence',
  'findings',
  'outputs',
];

/**
 * Finalize a filled human-baseline template into a clean result packet.
 * Returns { ok, errors, packet }. Never throws on validation problems.
 */
function finalizePacket(template) {
  const errors = [];
  if (!template || typeof template !== 'object') {
    return { ok: false, errors: ['template is not a mapping'], packet: null };
  }

  // Strip the authoring header — it is guidance, not packet content.
  const packet = { ...template };
  delete packet._human_baseline_template;

  // js-yaml parses bare ISO timestamps as Date objects; the schema requires
  // date-time STRINGS. Coerce the timestamp fields back to ISO strings so an
  // operator who writes an unquoted timestamp still produces a valid packet.
  const toIsoString = (v) => (v instanceof Date ? v.toISOString().replace(/\.\d{3}Z$/, 'Z') : v);
  packet.started_at = toIsoString(packet.started_at);
  packet.ended_at = toIsoString(packet.ended_at);
  if (packet.outputs && Array.isArray(packet.outputs.action_log)) {
    packet.outputs.action_log = packet.outputs.action_log.map((step) =>
      step && typeof step === 'object' ? { ...step, timestamp: toIsoString(step.timestamp) } : step
    );
  }

  // 1. No unresolved placeholders anywhere in the packet body.
  const placeholders = findUnresolvedPlaceholders(packet);
  for (const p of placeholders) errors.push(`unresolved ${FILL} placeholder at: ${p}`);

  // 2. Required result-packet v2 fields present.
  for (const f of REQUIRED_PACKET_FIELDS) {
    if (packet[f] === undefined || packet[f] === null) errors.push(`missing required field: ${f}`);
  }

  // 3. division / runtime / adapter must be human-baseline.
  if (String(packet.division || '').toLowerCase() !== 'human_baseline') {
    errors.push(`division must be "human_baseline" (got "${packet.division}")`);
  }
  if (String(packet.runtime || '').toLowerCase() !== 'human-baseline') {
    errors.push(`runtime must be "human-baseline" (got "${packet.runtime}")`);
  }
  if (packet.adapter !== undefined && String(packet.adapter).toLowerCase() !== 'human-baseline') {
    errors.push(`adapter must be "human-baseline" (got "${packet.adapter}")`);
  }

  // 4. status / validity must be valid enum values.
  const STATUSES = new Set(['completed', 'partial', 'blocked', 'failed', 'disqualified']);
  const VALIDITIES = new Set(['valid', 'partial_valid', 'invalid', 'appealed', 'disqualified']);
  if (packet.status !== undefined && !STATUSES.has(String(packet.status))) {
    errors.push(`status "${packet.status}" is not a valid status`);
  }
  if (packet.validity !== undefined && !VALIDITIES.has(String(packet.validity))) {
    errors.push(`validity "${packet.validity}" is not a valid validity state`);
  }

  // 5. Evidence + findings non-empty; findings cite real evidence ids.
  const evidenceIds = new Set((packet.evidence || []).map((e) => e && e.id).filter(Boolean));
  if (!(Array.isArray(packet.evidence) && packet.evidence.length > 0)) {
    errors.push('evidence must have at least one item');
  }
  if (!(Array.isArray(packet.findings) && packet.findings.length > 0)) {
    errors.push('findings must have at least one item');
  }
  for (const [i, f] of (packet.findings || []).entries()) {
    if (!f || !f.claim) {
      errors.push(`findings[${i}] missing claim`);
      continue;
    }
    const refs = Array.isArray(f.evidence) ? f.evidence : [];
    if (refs.length === 0) {
      errors.push(`findings[${i}] cites no evidence`);
      continue;
    }
    for (const ref of refs) {
      if (!evidenceIds.has(ref))
        errors.push(`findings[${i}] references unknown evidence id "${ref}"`);
    }
  }

  // 6. Every required output present and non-empty (fan-in parity).
  const outputs = packet.outputs || {};
  // action_log is the human action timeline, not an envelope output — but it
  // must be present and contain at least one entry.
  if (!Array.isArray(outputs.action_log) || outputs.action_log.length === 0) {
    errors.push('outputs.action_log (the human action timeline) must have at least one entry');
  }

  // 7. No secret values and no secret-bearing fields.
  const secretValuePaths = findSecretValues(packet);
  for (const p of secretValuePaths) errors.push(`secret value detected at: ${p}`);
  const secretFields = scanObjectForSecretFields(packet);
  for (const f of secretFields) errors.push(`secret-bearing field at: ${f}`);

  // 8. No oracle / hidden-judge-material references (same scan as the runner).
  const oracleHits = scanTextForOracleReferences(yaml.dump(packet));
  if (oracleHits.length > 0)
    errors.push(`oracle/hidden-judge reference detected (${oracleHits.join(', ')})`);

  return { ok: errors.length === 0, errors, packet };
}

/**
 * Build the minimal evidence-bundle + trace companion artifacts for fan-in
 * parity (a finalized packet submitted through the harness is expected to ship
 * with a trace and bundle, same as the adapter artifacts).
 */
function buildCompanions(packet) {
  const taskId = packet.task_id;
  const agentId = packet.agent_id;
  const runId = `run-${taskId}-${agentId}-human-baseline`;
  const now = packet.ended_at || isoNow();
  const evidenceBundle = {
    schema_version: 1,
    bundle_id: `eb-human-${taskId}-${agentId}`,
    run_id: runId,
    agent_id: agentId,
    runtime: 'human-baseline',
    generated_at: now,
    adapter_mode: 'human-baseline',
    items: (packet.evidence || []).map((e) => ({
      id: e.id,
      kind: e.kind,
      source: e.source,
      summary: e.summary,
      ...(e.content_ref ? { content_ref: e.content_ref } : {}),
    })),
  };
  const trace = {
    schema_version: 1,
    trace_id: `tr-human-${taskId}-${agentId}`,
    run_id: runId,
    agent_id: agentId,
    runtime: 'human-baseline',
    generated_at: now,
    adapter_mode: 'human-baseline',
    entries: (packet.outputs.action_log || []).map((step, i) => ({
      seq: typeof step.seq === 'number' ? step.seq : i,
      timestamp: step.timestamp || now,
      action: 'manual',
      target: 'human-operator',
      summary: `Human operator action: ${step.action || '(unspecified)'}`,
      result_summary: step.outcome || '',
      evidence_ref: HUMAN_EVIDENCE_IDS.log,
    })),
  };
  if (trace.entries.length === 0) {
    trace.entries.push({
      seq: 0,
      timestamp: now,
      action: 'manual',
      target: 'human-operator',
      summary: 'Human operator completed the task manually.',
      result_summary: '',
      evidence_ref: HUMAN_EVIDENCE_IDS.log,
    });
  }
  return { evidenceBundle, trace };
}

function cmdFinalize(args) {
  const inPath = args._[1];
  if (!inPath) {
    console.error('ERROR: finalize requires <filled-template>.');
    usage();
    process.exitCode = 1;
    return;
  }
  let template;
  try {
    template = loadYaml(inPath);
  } catch (err) {
    console.error(`ERROR: failed to load template: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const { ok, errors, packet } = finalizePacket(template);
  if (!ok) {
    console.error(`FAIL  ${inPath}  - human-baseline packet rejected:`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }

  // Sanity: the finalized packet should fingerprint as human-baseline, not
  // unknown (runtime-neutrality). Informational only.
  const { trace, evidenceBundle } = buildCompanions(packet);
  const fp = fingerprintRuntime(packet, trace);

  if (args.output) {
    const outPath = path.resolve(args.output);
    fs.writeFileSync(outPath, dumpYaml(packet), 'utf8');
    // Companions next to the packet for fan-in parity.
    const dir = path.dirname(outPath);
    const base = path.basename(outPath).replace(/\.ya?ml$/i, '');
    fs.writeFileSync(path.join(dir, `${base}.trace.yaml`), dumpYaml(trace), 'utf8');
    fs.writeFileSync(
      path.join(dir, `${base}.evidence-bundle.yaml`),
      dumpYaml(evidenceBundle),
      'utf8'
    );
    console.log(`OK    finalized human-baseline packet: ${args.output}`);
    console.log(`  Task:        ${packet.task_id}`);
    console.log(`  Operator:    ${packet.agent_id}`);
    console.log(`  Status:      ${packet.status}`);
    console.log(`  Fingerprint: ${fp.detected} (confidence ${fp.confidence})`);
    console.log(`  Companions:  ${base}.trace.yaml, ${base}.evidence-bundle.yaml`);
    console.log(
      '  Submit as a normal results/ packet — the harness judges it like any participant.'
    );
  } else {
    process.stdout.write(dumpYaml(packet));
  }
}

// ---------------------------------------------------------------------------
// `anchor` — read the human baseline as the reference line
// ---------------------------------------------------------------------------

// Documented threshold: an agent whose total score differs from the human
// baseline by MORE than this many points is flagged as significantly
// out/under-performing the human reference. 10 points on the 100-point rubric
// (one full grade band) is a meaningful, defensible gap.
const DEFAULT_ANCHOR_THRESHOLD = 10;

/**
 * Reuse the public-leaderboard blind anonymization from web-result-consumer.js
 * WITHOUT triggering its main() (same loader the longitudinal report uses), so
 * blind mode shares ONE definition of the anonymization rules.
 */
function loadBlindAnonymizer() {
  const consumerPath = path.join(ROOT, 'scripts', 'web-result-consumer.js');
  let src = fs.readFileSync(consumerPath, 'utf8');
  src = src.replace(/\nmain\(\);\s*$/, '\n');
  src += '\nmodule.exports = { anonymizeScoreboard };\n';
  const m = new Module(consumerPath);
  m.filename = consumerPath;
  m.paths = Module._nodeModulePaths(path.dirname(consumerPath));
  m._compile(src, consumerPath);
  if (typeof m.exports.anonymizeScoreboard !== 'function') {
    throw new Error('could not load anonymizeScoreboard from web-result-consumer.js');
  }
  return m.exports.anonymizeScoreboard;
}

function entryTotalScore(entry) {
  return entry && entry.score && typeof entry.score.total_score === 'number'
    ? entry.score.total_score
    : null;
}

function isHumanBaselineEntry(entry) {
  const meta = entry.submission_metadata || {};
  const labels = [meta.adapter, meta.runtime, entry.division]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());
  return labels.some((l) => /human[-_]?baseline/.test(l) || l === 'human_baseline');
}

/**
 * Compute the anchor report for a scoreboard: per task with a human-baseline
 * entry, each agent participant's delta vs the human reference line.
 */
function buildAnchorReport(scoreboard, opts = {}) {
  const threshold = Number.isFinite(opts.threshold) ? opts.threshold : DEFAULT_ANCHOR_THRESHOLD;
  const entries = Array.isArray(scoreboard.entries) ? scoreboard.entries : [];
  const byTask = new Map();
  for (const e of entries) {
    const t = e.task_id || 'unknown';
    if (!byTask.has(t)) byTask.set(t, []);
    byTask.get(t).push(e);
  }

  const tasks = [];
  for (const [taskId, taskEntries] of byTask.entries()) {
    if (opts.task && taskId !== opts.task) continue;
    const humanEntries = taskEntries.filter(isHumanBaselineEntry);
    const human = humanEntries.find((e) => entryTotalScore(e) !== null) || humanEntries[0] || null;
    const humanScore = human ? entryTotalScore(human) : null;

    if (!human || humanScore === null) {
      tasks.push({ task_id: taskId, has_human_baseline: false, human_score: null, agents: [] });
      continue;
    }

    const agents = [];
    for (const e of taskEntries) {
      if (isHumanBaselineEntry(e)) continue;
      const score = entryTotalScore(e);
      if (score === null) continue;
      const delta = score - humanScore;
      let flag = 'comparable';
      if (delta > threshold) flag = 'significantly_above_human';
      else if (delta < -threshold) flag = 'significantly_below_human';
      agents.push({
        agent_id: e.agent_id,
        score,
        delta,
        delta_label: `${delta >= 0 ? '+' : ''}${delta} ${delta >= 0 ? 'above' : 'below'} human`,
        flag,
      });
    }
    agents.sort((a, b) => b.delta - a.delta);
    tasks.push({
      task_id: taskId,
      has_human_baseline: true,
      human_agent_id: human.agent_id,
      human_score: humanScore,
      threshold,
      agents,
    });
  }
  tasks.sort((a, b) => a.task_id.localeCompare(b.task_id));
  return { threshold, tasks };
}

function printAnchorReport(report, blind) {
  console.log(`Agent Olympics — Human Baseline Anchor${blind ? ' (blind)' : ''}`);
  console.log(
    `Threshold: +/-${report.threshold} pts vs human reference line flags significant out/under-performance.`
  );
  console.log('');
  for (const t of report.tasks) {
    if (!t.has_human_baseline) {
      console.log(`${t.task_id}: no human baseline available — no anchor (not fabricated).`);
      continue;
    }
    console.log(
      `${t.task_id}: human baseline "${t.human_agent_id}" scored ${t.human_score} (reference line).`
    );
    if (t.agents.length === 0) {
      console.log('  (no agent participants on this task to compare)');
      continue;
    }
    for (const a of t.agents) {
      const mark =
        a.flag === 'significantly_above_human'
          ? 'OVER '
          : a.flag === 'significantly_below_human'
            ? 'UNDER'
            : '  ~  ';
      console.log(`  [${mark}] ${a.agent_id}: ${a.score} (${a.delta_label})`);
    }
  }
}

function cmdAnchor(args) {
  const scoreboardPath = args.scoreboard || 'results/scoreboard.json';
  let scoreboard;
  try {
    scoreboard = JSON.parse(fs.readFileSync(path.resolve(scoreboardPath), 'utf8'));
  } catch (err) {
    console.error(`ERROR: failed to load scoreboard ${scoreboardPath}: ${err.message}`);
    process.exitCode = 1;
    return;
  }
  let board = scoreboard;
  if (args.blind) {
    const anonymize = loadBlindAnonymizer();
    board = anonymize(scoreboard);
  }
  const report = buildAnchorReport(board, { task: args.task, threshold: args.threshold });
  printAnchorReport(report, !!args.blind);
}

// ---------------------------------------------------------------------------
// `fixtures` — exercise the suite
// ---------------------------------------------------------------------------

const FIXTURE_DIR = 'fixtures/human-baseline';

function runFixtures() {
  let failures = 0;
  const fail = (msg) => {
    console.log(`  FAIL: ${msg}`);
    failures += 1;
  };
  const ok = (msg) => console.log(`  OK: ${msg}`);

  // --- finalize: positive worked fixture ---------------------------------
  console.log('finalize — positive worked fixture:');
  try {
    const tmpl = loadYaml(`${FIXTURE_DIR}/ops-001-filled-template.yaml`);
    const res = finalizePacket(tmpl);
    if (res.ok) ok('filled ops-001 template finalizes to a valid human_baseline packet');
    else fail(`expected positive fixture to pass, got: ${res.errors.join('; ')}`);
    if (res.ok) {
      const { trace } = buildCompanions(res.packet);
      const fp = fingerprintRuntime(res.packet, trace);
      if (fp.detected === 'human-baseline')
        ok(`finalized packet fingerprints as human-baseline (confidence ${fp.confidence})`);
      else fail(`finalized packet fingerprints as "${fp.detected}", expected human-baseline`);
    }
  } catch (e) {
    fail(`positive fixture error: ${e.message}`);
  }

  // --- finalize: negative fixtures (each must be rejected) ----------------
  const negatives = [
    { file: 'negative-unresolved-fillme.yaml', needle: 'FILL_ME' },
    { file: 'negative-oracle-reference.yaml', needle: 'oracle' },
    { file: 'negative-secret-value.yaml', needle: 'secret' },
  ];
  console.log('finalize — negative fixtures (each must be rejected):');
  for (const neg of negatives) {
    try {
      const tmpl = loadYaml(`${FIXTURE_DIR}/${neg.file}`);
      const res = finalizePacket(tmpl);
      if (res.ok) {
        fail(`${neg.file} was accepted but should have been rejected`);
      } else if (res.errors.some((e) => e.toLowerCase().includes(neg.needle.toLowerCase()))) {
        ok(`${neg.file} rejected for the right reason (${neg.needle})`);
      } else {
        fail(`${neg.file} rejected but not for "${neg.needle}": ${res.errors.join('; ')}`);
      }
    } catch (e) {
      fail(`${neg.file} error: ${e.message}`);
    }
  }

  // --- anchor: delta math + flags + blind --------------------------------
  console.log('anchor — delta math, flags, and blind anonymization:');
  try {
    const board = JSON.parse(
      fs.readFileSync(repoPath(`${FIXTURE_DIR}/anchor-scoreboard.json`), 'utf8')
    );
    const report = buildAnchorReport(board, { threshold: 10 });
    const task = report.tasks.find((t) => t.task_id === 'ops-001');
    if (!task) {
      fail('anchor fixture missing ops-001 task');
    } else if (!task.has_human_baseline) {
      fail('anchor fixture ops-001 should have a human baseline');
    } else {
      if (task.human_score === 80) ok('human baseline reference score read as 80');
      else fail(`expected human baseline score 80, got ${task.human_score}`);
      const over = task.agents.find((a) => a.agent_id === 'agent-strong');
      const under = task.agents.find((a) => a.agent_id === 'agent-weak');
      const near = task.agents.find((a) => a.agent_id === 'agent-near');
      if (over && over.delta === 15 && over.flag === 'significantly_above_human')
        ok('agent-strong flagged significantly_above_human (+15)');
      else fail(`agent-strong delta/flag wrong: ${JSON.stringify(over)}`);
      if (under && under.delta === -20 && under.flag === 'significantly_below_human')
        ok('agent-weak flagged significantly_below_human (-20)');
      else fail(`agent-weak delta/flag wrong: ${JSON.stringify(under)}`);
      if (near && near.delta === 5 && near.flag === 'comparable')
        ok('agent-near is comparable (+5, within threshold)');
      else fail(`agent-near delta/flag wrong: ${JSON.stringify(near)}`);
    }
    // A task with no human baseline yields has_human_baseline=false (not fabricated).
    const noHuman = report.tasks.find((t) => t.task_id === 'ops-002');
    if (noHuman && noHuman.has_human_baseline === false)
      ok('ops-002 correctly reports no human baseline (no anchor fabricated)');
    else fail('ops-002 should report has_human_baseline=false');

    // Blind mode must not leak the real participant identities.
    const anonymize = loadBlindAnonymizer();
    const blindReport = buildAnchorReport(anonymize(board), { threshold: 10 });
    const blindTask = blindReport.tasks.find((t) => t.task_id === 'ops-001');
    const blob = JSON.stringify(blindReport);
    const leaked = ['agent-strong', 'agent-weak', 'agent-near', 'human-ref'].filter((id) =>
      blob.includes(id)
    );
    if (leaked.length === 0 && /^Participant /.test(blindTask.human_agent_id)) {
      ok('blind anchor leaks no real participant identity (aliased to Participant A/B...)');
    } else {
      fail(`blind anchor leaked identities: ${leaked.join(', ') || '(human id not aliased)'}`);
    }
    // Delta math must survive anonymization unchanged.
    if (
      blindTask &&
      blindTask.agents.some((a) => a.delta === 15) &&
      blindTask.agents.some((a) => a.delta === -20)
    ) {
      ok('blind anchor preserves the delta math (+15 / -20)');
    } else {
      fail('blind anchor lost the delta math');
    }
  } catch (e) {
    fail(`anchor fixture error: ${e.message}`);
  }

  console.log('');
  if (failures > 0) {
    console.error(`Human-baseline fixtures FAILED (${failures} case(s)).`);
    process.exitCode = 1;
    return;
  }
  console.log('Human-baseline fixtures passed.');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  const cmd = args._[0];

  if (!cmd || cmd === 'fixtures') {
    runFixtures();
    return;
  }
  if (cmd === 'template') {
    cmdTemplate(args);
    return;
  }
  if (cmd === 'finalize') {
    cmdFinalize(args);
    return;
  }
  if (cmd === 'anchor') {
    cmdAnchor(args);
    return;
  }

  usage();
  process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

module.exports = {
  buildTemplate,
  finalizePacket,
  buildCompanions,
  buildAnchorReport,
  HUMAN_EVIDENCE_IDS,
  DEFAULT_ANCHOR_THRESHOLD,
};
