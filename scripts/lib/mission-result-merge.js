'use strict';

/**
 * Shared mission-output → result-packet merge logic for the live-runner local
 * wrappers (Hermes and CLI). The Hermes and CLI wrappers both:
 *
 *   1. bootstrap a schema-valid skeleton packet with an adapter,
 *   2. invoke a nested agent (the Hermes CLI / a coding-agent CLI) with a
 *      marker-wrapped-JSON mission prompt,
 *   3. merge the captured mission output into the skeleton,
 *   4. validate + apply the parse-fallback → partial discipline.
 *
 * Step 3 is identical except for runtime-specific labels and the evidence-id
 * set the skeleton uses. This module parameterizes those into a PROFILE so the
 * two wrappers share one merge implementation (DRY) instead of forking it.
 *
 * A profile declares:
 *   - runtime/agent display labels,
 *   - the env var prefix for attestation values (HERMES_* / CLI_*),
 *   - the evidence-id mapping: which ids carry the agent report / transcript /
 *     probe, and the default finding-evidence fallback pair,
 *   - the execution shape (a2a_workers, worker labels) — a nested Hermes CLI
 *     session for hermes, a solo CLI session for cli.
 *
 * Recently-merged behavior preserved for BOTH profiles:
 *   - secrets are redacted before any captured output is persisted,
 *   - hallucinated evidence ids in findings are normalized against the
 *     packet's real evidence set (PR #228 fix — not regressed),
 *   - a parse-fallback packet is downgraded to `partial`.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');
const {
  SECRET_KEY_PATTERNS,
  SECRET_VALUE_PATTERNS,
  looksLikeSecretValue,
} = require('./secret-patterns');

// Value-free redaction of captured CLI output, applied BEFORE any of it is
// persisted. Mirrors the live runner's redaction: shared
// SECRET_VALUE_PATTERNS plus secret-named "key: value" / "KEY=value" lines.
// Only rule ids are recorded — original values are never preserved.
const VALUE_RULE_IDS = [
  'rv-openai-style-key',
  'rv-github-pat',
  'rv-github-pat-org',
  'rv-github-finegrained-pat',
  'rv-slack-token',
  'rv-pem-private-key',
  'rv-jwt',
];
const KEY_RULE_ID = 'rk-secret-named-field';

function redactSecrets(rawText) {
  let text = String(rawText);
  const appliedRuleIds = [];
  SECRET_VALUE_PATTERNS.forEach((pattern, i) => {
    const ruleId = VALUE_RULE_IDS[i] || `rv-${i}`;
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    let count = 0;
    text = text.replace(global, () => {
      count += 1;
      return `[REDACTED:${ruleId}]`;
    });
    if (count > 0) appliedRuleIds.push(ruleId);
  });
  let keyCount = 0;
  text = text.replace(/^(\s*"?([A-Za-z0-9_-]+)"?\s*[:=]\s*)(\S.*)$/gm, (line, prefix, key, value) => {
    if (SECRET_KEY_PATTERNS.some((p) => p.test(key)) && looksLikeSecretValue(value.trim())) {
      keyCount += 1;
      return `${prefix}[REDACTED:${KEY_RULE_ID}]`;
    }
    return line;
  });
  if (keyCount > 0) appliedRuleIds.push(KEY_RULE_ID);
  return { text, appliedRuleIds };
}

function readText(file, fallback = '') {
  try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; }
}

function writeYaml(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, yaml.dump(obj, { lineWidth: 110, noRefs: true, sortKeys: false }), 'utf8');
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function truncate(text, max = 6000) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + `\n...[truncated ${text.length - max} chars]` : text;
}

function oneLine(text, max = 300) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function extractMissionJson(raw) {
  const marked = raw.match(/AGENT_OLYMPICS_RESULT_JSON_BEGIN\s*([\s\S]*?)\s*AGENT_OLYMPICS_RESULT_JSON_END/);
  const candidates = [];
  if (marked) candidates.push(marked[1]);
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(raw.slice(firstBrace, lastBrace + 1));
  for (const c of candidates) {
    try { return JSON.parse(c.trim()); } catch { /* try next */ }
  }
  return null;
}

function normalizeEvidenceItems(items, analysisSource) {
  if (!Array.isArray(items)) return [];
  return items.map((item, i) => {
    if (typeof item === 'string') {
      return { id: `mission-ev-${i + 1}`, summary: item };
    }
    return {
      id: item.id || `mission-ev-${i + 1}`,
      source: item.source || item.file || analysisSource,
      summary: item.summary || item.claim || JSON.stringify(item),
    };
  });
}

/**
 * Merge captured mission output into the skeleton artifacts in `runDir`.
 *
 * @param {object} args
 *   - envelopePath, runDir, outputPath, agentExitRaw
 *   - profile: see PROFILES below
 *   - env: process.env (read for attestation values)
 * @returns {{ parsed: boolean, agentExit: number, sha256: string,
 *             redactionRuleIds: string[] }}
 */
function mergeMissionResult({ envelopePath, runDir, outputPath, agentExitRaw, profile, env }) {
  const envelope = yaml.load(readText(envelopePath));
  const resultPacketPath = path.join(runDir, 'result-packet.yaml');
  const evidenceBundlePath = path.join(runDir, 'evidence-bundle.yaml');
  const tracePath = path.join(runDir, 'trace.yaml');
  const raw = readText(outputPath);
  // Redact BEFORE anything derived from the raw output is written to disk.
  const { text: redactedRaw, appliedRuleIds: redactionRuleIds } = redactSecrets(raw);
  const parsed = extractMissionJson(raw);
  const agentExit = Number.parseInt(agentExitRaw || '0', 10);
  const taskId = envelope.task_id || 'unknown-task';

  const ev = profile.evidence_ids;
  const labels = profile.labels;
  const ep = profile.env_prefix;
  const getEnv = (suffix) => env[`${ep}_${suffix}`];

  const fallbackSummary = oneLine(raw, 500) || `${labels.runtime_display} produced no parseable mission output for ${taskId}.`;
  const mission = parsed || {
    summary: `${labels.runtime_display} mission output captured but JSON markers were not parseable. ${fallbackSummary}`,
    diagnosis: fallbackSummary,
    evidence: [{ source: outputPath, summary: `Raw ${labels.runtime_display} output captured in ${labels.transcript_file}` }],
    risk_assessment: 'Mission output required fallback parsing; human review recommended before competitive scoring.',
    next_action: `Inspect ${labels.transcript_file} and rerun wrapper if structured JSON is required.`,
    durable_memory_decision: 'No durable memory should be written from fallback parsing alone.',
    findings: [],
  };

  const evidenceItems = normalizeEvidenceItems(mission.evidence, `${labels.runtime_display} mission analysis`);
  const now = new Date().toISOString();

  const rp = yaml.load(readText(resultPacketPath));
  rp.summary = oneLine(mission.summary || mission.diagnosis || fallbackSummary, 900);
  rp.outputs = rp.outputs || {};
  // A fallback packet is not a real mission answer: mark it machine-readably
  // and downgrade the packet status so it cannot pass as a clean completed
  // run into judging (the wrapper exits 2 → the runner maps the run to
  // partial, keeping run status and packet status consistent).
  rp.outputs.mission_parse_fallback = !parsed;
  if (!parsed && rp.status === 'completed') {
    rp.status = 'partial';
    if (rp.validity === 'valid') rp.validity = 'partial_valid';
  }
  rp.outputs.diagnosis = String(mission.diagnosis || mission.summary || fallbackSummary);
  rp.outputs.evidence = evidenceItems.map((e) => `${e.source || e.id}: ${e.summary}`).join('\n');
  rp.outputs.risk_assessment = String(mission.risk_assessment || `No additional risk assessment returned by ${labels.runtime_display}.`);
  rp.outputs.next_action = String(mission.next_action || 'Review the captured mission evidence and apply the proposed fix.');
  rp.outputs.durable_memory_decision = String(mission.durable_memory_decision || 'No durable memory update recommended.');
  // Envelope-declared required outputs: the mission prompt asks the model to
  // fill outputs.<key> for every envelope required_output, and we copy
  // EXACTLY those declared keys (never arbitrary model keys) into the packet,
  // redacted, so family-specific outputs (changed_files, test_results,
  // confirmed_facts, ...) carry real mission content instead of the adapter
  // skeleton's placeholder text. Legacy missions without an outputs object
  // are unaffected.
  const requiredOutputKeys = Array.isArray(envelope.required_outputs) ? envelope.required_outputs : [];
  const missionOutputs = mission.outputs && typeof mission.outputs === 'object' && !Array.isArray(mission.outputs)
    ? mission.outputs
    : {};
  for (const key of requiredOutputKeys) {
    const value = missionOutputs[key];
    if (value === undefined || value === null) continue;
    const rawValue = typeof value === 'string' ? value : JSON.stringify(value);
    const { text: redactedValue, appliedRuleIds: outputRuleIds } = redactSecrets(rawValue);
    for (const id of outputRuleIds) {
      if (!redactionRuleIds.includes(id)) redactionRuleIds.push(id);
    }
    rp.outputs[key] = redactedValue;
  }

  const findings = Array.isArray(mission.findings) && mission.findings.length
    ? mission.findings
    : [
        { claim: rp.outputs.diagnosis, confidence: 'high' },
        { claim: rp.outputs.next_action, confidence: 'medium' },
      ];
  // Findings may cite evidence ids the model invented (e.g. ev-config-diff).
  // Only ids that actually exist in the packet's evidence list may become
  // machine links; everything else — file paths AND hallucinated ev-* ids —
  // is preserved verbatim in the claim text instead, so the citation stays
  // honest without creating dangling references (fan-in quarantines those).
  // (Do NOT regress PR #228.)
  const knownEvidenceIds = new Set((rp.evidence || []).map((e) => e && e.id).filter(Boolean));
  rp.findings = findings.slice(0, 8).map((f) => {
    const validEvidenceRefs = Array.isArray(f.evidence)
      ? f.evidence.filter((ref) => typeof ref === 'string' && knownEvidenceIds.has(ref))
      : [];
    const sourceRefs = Array.isArray(f.evidence)
      ? f.evidence.filter((ref) => typeof ref === 'string' && !knownEvidenceIds.has(ref))
      : [];
    const claim = String(f.claim || f.summary || f);
    return {
      claim: sourceRefs.length ? `${claim} Sources: ${sourceRefs.join('; ')}` : claim,
      evidence: validEvidenceRefs.length ? validEvidenceRefs : profile.default_finding_evidence,
      confidence: f.confidence || 'medium',
    };
  });

  // Toolset attestation (judge-notes §3.5): the wrapper reports which
  // toolsets the nested session ACTUALLY had and how they were derived, so
  // the judge can apply or lift the file-only evidence ceiling from the
  // packet alone. Absent env (legacy callers / CLI profile) records nothing
  // rather than a fabricated default.
  const toolsetsUsed = getEnv('TOOLSETS_USED') || null;
  const toolsetsSource = getEnv('TOOLSETS_SOURCE') || 'unknown';
  const toolsetSuffix = toolsetsUsed ? `; toolsets=${toolsetsUsed} (${toolsetsSource})` : '';

  for (const item of rp.evidence || []) {
    if (item.id === ev.report) item.summary = `Actual ${labels.runtime_display} mission report: ${oneLine(mission.summary || mission.diagnosis, 220)}`;
    if (item.id === ev.transcript) item.summary = `Nested ${labels.runtime_display} execution captured with exit code ${agentExit}; parsed_json=${Boolean(parsed)}`;
    if (item.id === ev.probe) item.summary = `${labels.runtime_display} invoked locally by wrapper; exit code ${agentExit}; output_sha256=${sha256(redactedRaw).slice(0, 16)} (redacted output); model_source=${getEnv('MODEL_SOURCE') || 'unknown'}${toolsetSuffix}`;
  }

  // Replace adapter-skeleton comparable metadata with real values. The model
  // label comes from the wrapper's attestation probe with the operator env as
  // fallback; "unknown" is recorded instead of a fabricated default.
  // <PREFIX>_MODEL_SOURCE records which path won.
  const realModel = getEnv('MODEL') || 'unknown';
  const realProvider = getEnv('MODEL_PROVIDER') || 'unknown';
  const realNode = getEnv('NODE') || 'unknown';
  const modelSource = getEnv('MODEL_SOURCE') || 'unknown';
  const wallSeconds = Number.parseInt(getEnv('WALL_SECONDS') || '', 10);

  rp.model = realModel;
  rp.model_provider = realProvider;
  rp.node = realNode;
  if (rp.comparable_metadata && rp.comparable_metadata.model) {
    rp.comparable_metadata.model.name = realModel;
    rp.comparable_metadata.model.provider = realProvider;
  }
  if (rp.comparable_metadata && rp.comparable_metadata.node) {
    rp.comparable_metadata.node.profile_ref = realNode;
  }
  if (rp.raw_measurements && Number.isInteger(wallSeconds) && wallSeconds >= 0) {
    rp.raw_measurements.wall_time_seconds = wallSeconds;
  }

  // The wrapper's real execution shape (profile-specific): a single nested
  // Hermes CLI session, or a solo coding-agent CLI session.
  if (rp.delegation_profile) {
    rp.delegation_profile.a2a_workers = profile.a2a_workers.slice();
    rp.delegation_profile.notes = labels.delegation_notes;
  }
  if (rp.raw_measurements) {
    if ('worker_count' in rp.raw_measurements) rp.raw_measurements.worker_count = profile.worker_count;
    if ('workers_completed' in rp.raw_measurements) rp.raw_measurements.workers_completed = agentExit === 0 || parsed ? profile.worker_count : 0;
    if ('workers_failed' in rp.raw_measurements) rp.raw_measurements.workers_failed = agentExit === 0 || parsed ? 0 : profile.worker_count;
  }
  if (rp.outputs.workflow) {
    rp.outputs.workflow.worker_count = profile.worker_count;
    rp.outputs.workflow.worker_profiles = profile.worker_profiles.slice();
  }
  if (rp.configuration_profile && 'worker_count' in rp.configuration_profile) {
    rp.configuration_profile.worker_count = profile.worker_count;
  }

  writeYaml(resultPacketPath, rp);

  const commanderReport = {
    schema_version: 1,
    generated_at: now,
    task_id: taskId,
    source: labels.report_source,
    parsed_json: Boolean(parsed),
    agent_exit_code: agentExit,
    model_attestation: { model: realModel, provider: realProvider, source: modelSource },
    summary: mission.summary || fallbackSummary,
    diagnosis: mission.diagnosis || mission.summary || fallbackSummary,
    risk_assessment: mission.risk_assessment || null,
    next_action: mission.next_action || null,
    durable_memory_decision: mission.durable_memory_decision || null,
    findings: rp.findings,
    evidence: evidenceItems,
  };
  writeYaml(path.join(runDir, profile.report_file), commanderReport);

  // `<toolsets>` in the command label is replaced with the attested toolset
  // list; "file" is the pre-attestation legacy default for old callers.
  const commandSummary = labels.command_summary.replace('<toolsets>', toolsetsUsed || 'file');

  const workerTrace = {
    schema_version: 1,
    generated_at: now,
    task_id: taskId,
    worker: profile.worker_profiles[0],
    command: commandSummary,
    ...(toolsetsUsed ? { toolsets: { list: toolsetsUsed, source: toolsetsSource } } : {}),
    exit_code: agentExit,
    parsed_result_json: Boolean(parsed),
    output_sha256: sha256(redactedRaw),
    output_excerpt: truncate(redactedRaw, 12000),
    redaction: {
      applied: redactionRuleIds.length > 0,
      rules: redactionRuleIds,
      note: `output_excerpt and output_sha256 are computed from the redacted ${labels.runtime_display} output (shared secret-patterns; rule ids only, values never preserved).`,
    },
  };
  writeYaml(path.join(runDir, profile.transcript_file), workerTrace);

  writeYaml(path.join(runDir, 'evidence', 'workflow-plan.yaml'), {
    schema_version: 1,
    generated_at: now,
    task_id: taskId,
    steps: labels.workflow_steps,
    public_inputs: {
      envelope: path.relative(process.cwd(), envelopePath),
      fixtures: envelope.fixtures || [],
    },
  });

  writeYaml(path.join(runDir, 'evidence', 'memory-summary.yaml'), {
    schema_version: 1,
    generated_at: now,
    task_id: taskId,
    durable_memory_decision: mission.durable_memory_decision || 'No durable memory update recommended.',
    note: `Private ${labels.runtime_display} memory content is not copied into Agent Olympics artifacts.`,
    redacted: true,
  });

  writeYaml(path.join(runDir, 'mission-result.json'), mission);
  const rawHeader = [
    `# mission-result.raw.txt — raw ${labels.runtime_display} output, secret-redacted before writing.`,
    `# redaction applied: ${redactionRuleIds.length > 0 ? `yes (rules: ${redactionRuleIds.join(', ')})` : 'no matches'} — rule ids only, original values never preserved.`,
    '',
  ].join('\n');
  writeText(path.join(runDir, 'mission-result.raw.txt'), rawHeader + redactedRaw);

  try {
    const eb = yaml.load(readText(evidenceBundlePath));
    for (const item of eb.items || []) {
      if (item.id === ev.report) item.summary = oneLine(mission.summary || mission.diagnosis, 220);
      if (item.id === ev.transcript) item.summary = `Nested ${labels.runtime_display} output captured; parsed_json=${Boolean(parsed)}; exit_code=${agentExit}`;
      if (item.id === ev.memory) item.summary = 'Durable memory decision captured without private memory content.';
    }
    writeYaml(evidenceBundlePath, eb);
  } catch (err) {
    // Keep result-packet validation as the authoritative gate.
  }

  try {
    const tr = yaml.load(readText(tracePath));
    tr.entries = tr.entries || [];
    tr.entries.push({
      seq: tr.entries.length,
      timestamp: now,
      action: 'synthesize',
      target: labels.synthesize_target,
      summary: `Merged actual ${labels.runtime_display} mission output into Agent Olympics artifacts`,
      result_summary: rp.summary,
      evidence_ref: ev.report,
    });
    writeYaml(tracePath, tr);
  } catch (err) {
    // Non-fatal; validate.js will catch schema problems if this mattered.
  }

  return { parsed: Boolean(parsed), agentExit, sha256: sha256(redactedRaw), redactionRuleIds };
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

const PROFILES = {
  hermes: {
    env_prefix: 'HERMES',
    evidence_ids: {
      report: 'ev-commander-report',
      transcript: 'ev-worker-traces',
      probe: 'ev-probe-result',
      memory: 'ev-memory-summary',
    },
    default_finding_evidence: ['ev-commander-report', 'ev-worker-traces'],
    a2a_workers: ['local-hermes-cli'],
    worker_profiles: ['local-hermes-cli'],
    worker_count: 1,
    report_file: path.join('evidence', 'commander-report.yaml'),
    transcript_file: path.join('evidence', 'worker-traces.yaml'),
    labels: {
      runtime_display: 'Hermes CLI',
      transcript_file: 'evidence/worker-traces.yaml',
      report_source: 'nested hermes chat -q invocation',
      command_summary: 'hermes chat -Q -q <generated mission prompt> --toolsets <toolsets>',
      delegation_notes: 'Mission executed by a single nested local Hermes CLI session invoked by the wrapper.',
      synthesize_target: 'nested_hermes_cli_result',
      workflow_steps: [
        'Generate schema-valid Hermes adapter artifacts as a baseline.',
        'Invoke the local Hermes CLI with the public task envelope and participant-facing fixture paths.',
        'Parse the mission JSON returned by Hermes or preserve raw output for review.',
        'Merge diagnosis/evidence/next action into result-packet.yaml and validate before returning to the live runner.',
      ],
    },
  },
  cli: {
    env_prefix: 'CLI',
    evidence_ids: {
      report: 'ev-cli-report',
      transcript: 'ev-cli-transcript',
      probe: 'ev-cli-probe',
      memory: 'ev-cli-memory',
    },
    default_finding_evidence: ['ev-cli-report', 'ev-cli-transcript'],
    a2a_workers: [],
    worker_profiles: ['local-cli-agent'],
    worker_count: 1,
    report_file: path.join('evidence', 'cli-report.yaml'),
    transcript_file: path.join('evidence', 'cli-transcript.yaml'),
    labels: {
      runtime_display: 'CLI agent',
      transcript_file: 'evidence/cli-transcript.yaml',
      report_source: 'nested coding-agent CLI invocation',
      command_summary: '<cli-agent-bin> <run args> <generated mission prompt>',
      delegation_notes: 'Mission executed by a single solo coding-agent CLI session invoked by the wrapper (no subagents, no A2A workers).',
      synthesize_target: 'nested_cli_agent_result',
      workflow_steps: [
        'Generate schema-valid CLI adapter artifacts as a baseline.',
        'Invoke the coding-agent CLI with the public task envelope and participant-facing fixture paths.',
        'Parse the mission JSON returned by the CLI agent or preserve raw output for review.',
        'Merge diagnosis/evidence/next action into result-packet.yaml and validate before returning to the live runner.',
      ],
    },
  },
};

module.exports = { mergeMissionResult, redactSecrets, extractMissionJson, sha256, PROFILES };
