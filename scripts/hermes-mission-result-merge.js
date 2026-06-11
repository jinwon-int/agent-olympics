#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');

function usage() {
  console.error('Usage: node scripts/hermes-mission-result-merge.js <envelope> <run_dir> <mission_output> <hermes_exit>');
  process.exit(3);
}

const [envelopePath, runDir, outputPath, hermesExitRaw] = process.argv.slice(2);
if (!envelopePath || !runDir || !outputPath) usage();

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

function normalizeEvidenceItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item, i) => {
    if (typeof item === 'string') {
      return { id: `mission-ev-${i + 1}`, summary: item };
    }
    return {
      id: item.id || `mission-ev-${i + 1}`,
      source: item.source || item.file || 'Hermes mission analysis',
      summary: item.summary || item.claim || JSON.stringify(item),
    };
  });
}

const envelope = yaml.load(readText(envelopePath));
const resultPacketPath = path.join(runDir, 'result-packet.yaml');
const evidenceBundlePath = path.join(runDir, 'evidence-bundle.yaml');
const tracePath = path.join(runDir, 'trace.yaml');
const raw = readText(outputPath);
const parsed = extractMissionJson(raw);
const hermesExit = Number.parseInt(hermesExitRaw || '0', 10);
const taskId = envelope.task_id || 'unknown-task';

const fallbackSummary = oneLine(raw, 500) || `Hermes CLI produced no parseable mission output for ${taskId}.`;
const mission = parsed || {
  summary: `Hermes CLI mission output captured but JSON markers were not parseable. ${fallbackSummary}`,
  diagnosis: fallbackSummary,
  evidence: [{ source: outputPath, summary: 'Raw Hermes CLI output captured in evidence/worker-traces.yaml' }],
  risk_assessment: 'Mission output required fallback parsing; human review recommended before competitive scoring.',
  next_action: 'Inspect evidence/worker-traces.yaml and rerun wrapper if structured JSON is required.',
  durable_memory_decision: 'No durable memory should be written from fallback parsing alone.',
  findings: [],
};

const evidenceItems = normalizeEvidenceItems(mission.evidence);
const now = new Date().toISOString();

const rp = yaml.load(readText(resultPacketPath));
rp.summary = oneLine(mission.summary || mission.diagnosis || fallbackSummary, 900);
rp.outputs = rp.outputs || {};
rp.outputs.diagnosis = String(mission.diagnosis || mission.summary || fallbackSummary);
rp.outputs.evidence = evidenceItems.map((e) => `${e.source || e.id}: ${e.summary}`).join('\n');
rp.outputs.risk_assessment = String(mission.risk_assessment || 'No additional risk assessment returned by Hermes.');
rp.outputs.next_action = String(mission.next_action || 'Review the captured mission evidence and apply the proposed fix.');
rp.outputs.durable_memory_decision = String(mission.durable_memory_decision || 'No durable memory update recommended.');

const findings = Array.isArray(mission.findings) && mission.findings.length
  ? mission.findings
  : [
      { claim: rp.outputs.diagnosis, confidence: 'high' },
      { claim: rp.outputs.next_action, confidence: 'medium' },
    ];
rp.findings = findings.slice(0, 8).map((f) => {
  const validEvidenceRefs = Array.isArray(f.evidence)
    ? f.evidence.filter((ref) => typeof ref === 'string' && ref.startsWith('ev-'))
    : [];
  const sourceRefs = Array.isArray(f.evidence)
    ? f.evidence.filter((ref) => typeof ref === 'string' && !ref.startsWith('ev-'))
    : [];
  const claim = String(f.claim || f.summary || f);
  return {
    claim: sourceRefs.length ? `${claim} Sources: ${sourceRefs.join('; ')}` : claim,
    evidence: validEvidenceRefs.length ? validEvidenceRefs : ['ev-commander-report', 'ev-worker-traces'],
    confidence: f.confidence || 'medium',
  };
});

for (const item of rp.evidence || []) {
  if (item.id === 'ev-commander-report') item.summary = `Actual Hermes CLI mission report: ${oneLine(mission.summary || mission.diagnosis, 220)}`;
  if (item.id === 'ev-worker-traces') item.summary = `Nested Hermes CLI execution captured with exit code ${hermesExit}; parsed_json=${Boolean(parsed)}`;
  if (item.id === 'ev-probe-result') item.summary = `Hermes CLI invoked locally by wrapper; exit code ${hermesExit}; output_sha256=${sha256(raw).slice(0, 16)}`;
}

writeYaml(resultPacketPath, rp);

const commanderReport = {
  schema_version: 1,
  generated_at: now,
  task_id: taskId,
  source: 'nested hermes chat -q invocation',
  parsed_json: Boolean(parsed),
  hermes_exit_code: hermesExit,
  summary: mission.summary || fallbackSummary,
  diagnosis: mission.diagnosis || mission.summary || fallbackSummary,
  risk_assessment: mission.risk_assessment || null,
  next_action: mission.next_action || null,
  durable_memory_decision: mission.durable_memory_decision || null,
  findings: rp.findings,
  evidence: evidenceItems,
};
writeYaml(path.join(runDir, 'evidence', 'commander-report.yaml'), commanderReport);

const workerTrace = {
  schema_version: 1,
  generated_at: now,
  task_id: taskId,
  worker: 'local-hermes-cli',
  command: 'hermes chat -Q -q <generated mission prompt> --toolsets file',
  exit_code: hermesExit,
  parsed_result_json: Boolean(parsed),
  output_sha256: sha256(raw),
  output_excerpt: truncate(raw, 12000),
};
writeYaml(path.join(runDir, 'evidence', 'worker-traces.yaml'), workerTrace);

writeYaml(path.join(runDir, 'evidence', 'workflow-plan.yaml'), {
  schema_version: 1,
  generated_at: now,
  task_id: taskId,
  steps: [
    'Generate schema-valid Hermes adapter artifacts as a baseline.',
    'Invoke the local Hermes CLI with the public task envelope and participant-facing fixture paths.',
    'Parse the mission JSON returned by Hermes or preserve raw output for review.',
    'Merge diagnosis/evidence/next action into result-packet.yaml and validate before returning to the live runner.',
  ],
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
  note: 'Private Hermes memory content is not copied into Agent Olympics artifacts.',
  redacted: true,
});

writeYaml(path.join(runDir, 'mission-result.json'), mission);
writeText(path.join(runDir, 'mission-result.raw.txt'), raw);

try {
  const eb = yaml.load(readText(evidenceBundlePath));
  for (const item of eb.items || []) {
    if (item.id === 'ev-commander-report') item.summary = oneLine(mission.summary || mission.diagnosis, 220);
    if (item.id === 'ev-worker-traces') item.summary = `Nested Hermes CLI output captured; parsed_json=${Boolean(parsed)}; exit_code=${hermesExit}`;
    if (item.id === 'ev-memory-summary') item.summary = 'Durable memory decision captured without private memory content.';
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
    target: 'nested_hermes_cli_result',
    summary: 'Merged actual Hermes CLI mission output into Agent Olympics artifacts',
    result_summary: rp.summary,
    evidence_ref: 'ev-commander-report',
  });
  writeYaml(tracePath, tr);
} catch (err) {
  // Non-fatal; validate.js will catch schema problems if this mattered.
}

console.log(`Merged Hermes mission output into ${resultPacketPath}`);
console.log(`parsed_json=${Boolean(parsed)} hermes_exit=${hermesExit} output_sha256=${sha256(raw)}`);
