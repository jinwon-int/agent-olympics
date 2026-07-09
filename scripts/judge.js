#!/usr/bin/env node
/**
 * Agent Olympics Judge Harness — subjective scoring layer (roadmap-05)
 *
 * Completes the missing layer 6 of the judge harness: score.js auto-scores
 * evidence_quality / safety / execution; this harness lets a human judge
 * score correctness / communication / durability and produces a COMPLETE
 * judge record that scripts/score.js picks up for the scoreboard.
 *
 * Usage:
 *   node scripts/judge.js oracle-check <packet.yaml> [--oracle <file>]
 *       Heuristic comparison of a result packet against the task's private
 *       oracle. Informational only — prints a SUGGESTED correctness band
 *       for the human judge. Never auto-final. Exit 0.
 *
 *   node scripts/judge.js template <packet.yaml> [--oracle <file>] [--output <file>]
 *       Generate a judge declaration template (judge-facing — embeds oracle
 *       scoring guidance) for the packet's pending dimensions. Prints to
 *       stdout unless --output is given.
 *
 *   node scripts/judge.js finalize <packet.yaml> --declaration <decl.yaml>
 *                         [--blind] [--output <file>] [--force]
 *       Merge auto-scored dimensions (same logic as score.js) with the
 *       judge's declaration into a complete, schema-valid judge record.
 *       Default output: <packet-base>-judge.yaml next to the packet (so
 *       score.js findJudgeFiles picks it up). --blind strips participant
 *       runtime/model/node/agent identity from the record.
 *
 *   node scripts/judge.js promotion-check [--tasks-dir <dir>] [--results-dir <dir>] [--strict]
 *       Read-only tier report: for each task envelope, compare the recorded
 *       tier against what the evidence (validating packet + complete judge
 *       record + baseline block) supports. Never edits envelopes. Exit 0
 *       (informational); --strict exits 1 when a recorded tier exceeds the
 *       evidence-supported tier.
 *
 *   node scripts/judge.js fixtures
 *       Run the positive + negative declaration fixtures under
 *       fixtures/judge-harness/. Exits non-zero on unexpected outcomes.
 *
 * Privacy rule: oracle files are private judge material. Oracle content
 * (answer categories, guidance text) is only ever surfaced on stdout and in
 * the judge-facing declaration template — never written into finalized
 * judge records. finalize enforces this with an oracle-leak guard.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { SECRET_VALUE_PATTERNS } = require('./lib/secret-patterns');
const score = require('./score');

const ROOT = path.resolve(__dirname, '..');
const ORACLE_DIR = path.join(ROOT, 'oracle', 'season-001');
const RUBRIC_REF = 'rubrics/agent-olympics-v1.yaml';
const FIXTURES_DIR = path.join(ROOT, 'fixtures', 'judge-harness');
const VERDICTS = ['pass', 'conditional_pass', 'fail', 'disqualification'];

// Verdict derivation thresholds (fraction of the maximum positive score).
// Convention: no document in docs/ fixes a pass line, and score.js's
// auto-judge uses < 50% as the conditional_pass boundary on its partial
// (50-point) base. For the full 100-point base we use:
//   pass >= 60%, conditional_pass >= 40%, fail < 40%.
// A declaration may always override the verdict explicitly.
const VERDICT_PASS_PCT = 0.6;
const VERDICT_CONDITIONAL_PCT = 0.4;

class JudgeError extends Error {}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function loadYamlFile(filePath) {
  const full = path.resolve(filePath);
  if (!fs.existsSync(full)) {
    throw new JudgeError(`File not found: ${filePath}`);
  }
  return yaml.load(fs.readFileSync(full, 'utf8'));
}

function dumpYaml(doc) {
  return yaml.dump(doc, { indent: 2, lineWidth: 100 });
}

/**
 * Load the core six positive dimensions {name: points} from the rubric.
 */
function loadRubricDimensions() {
  const rubric = loadYamlFile(path.join(ROOT, RUBRIC_REF));
  const dims = {};
  for (const [name, def] of Object.entries(rubric.positive_score || {})) {
    dims[name] = def.points;
  }
  return dims;
}

/**
 * Resolve a packet file into { rp, packetId, packetPath }. Accepts both a
 * standalone result packet and a run-result wrapper.
 */
function resolvePacket(packetPath) {
  const doc = loadYamlFile(packetPath);
  if (!doc || typeof doc !== 'object') {
    throw new JudgeError(`Not a parseable YAML document: ${packetPath}`);
  }
  const rp = doc.result_packet && typeof doc.result_packet === 'object' ? doc.result_packet : doc;
  if (!rp.task_id || !rp.agent_id) {
    throw new JudgeError(`Not a result packet (missing task_id/agent_id): ${packetPath}`);
  }
  const packetId = rp.packet_id || path.basename(packetPath, path.extname(packetPath));
  return { rp, packetId, packetPath: path.resolve(packetPath) };
}

/**
 * Locate the oracle file for a task: oracle/season-001/<task_id>-*.yaml.
 */
function findOracleFile(taskId, override) {
  if (override) {
    const full = path.resolve(override);
    if (!fs.existsSync(full)) throw new JudgeError(`Oracle file not found: ${override}`);
    return full;
  }
  if (!fs.existsSync(ORACLE_DIR)) return null;
  const candidates = fs
    .readdirSync(ORACLE_DIR)
    .filter((n) => /\.ya?ml$/.test(n) && n.startsWith(`${taskId}-`))
    .sort()
    .map((n) => path.join(ORACLE_DIR, n));
  for (const c of candidates) {
    const doc = loadYamlFile(c);
    if (doc && doc.task_id === taskId) return c;
  }
  return candidates[0] || null;
}

// ---------------------------------------------------------------------------
// Oracle check — heuristic keyword matching (suggestion only, never final)
// ---------------------------------------------------------------------------

// Generic English stopwords only — domain words (delivery, gateway, ...)
// stay distinctive on purpose.
const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'for',
  'vs',
  'not',
  'was',
  'is',
  'are',
  'were',
  'be',
  'as',
  'on',
  'by',
  'from',
  'it',
  'its',
  'this',
  'that',
  'with',
  'does',
  'did',
  'at',
  'least',
  'one',
  'any',
  'all',
  'what',
  'which',
  'who',
  'how',
  'their',
  'they',
  'after',
  'before',
  'than',
  'but',
  'if',
  'then',
  'no',
  'yes',
  'per',
  'into',
  'each',
  'must',
  'should',
  'can',
  'could',
  'may',
  'might',
  'between',
  'instead',
  'only',
  'when',
  'where',
]);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Collect the scannable text lines of a result packet:
 * summary, findings claims, evidence summaries, outputs, action summaries,
 * risks. Returns [{ source, text }].
 */
function collectPacketLines(rp) {
  const lines = [];
  const push = (source, text) => {
    if (typeof text === 'string' && text.trim()) lines.push({ source, text: text.trim() });
  };
  push('summary', rp.summary);
  (rp.findings || []).forEach((f, i) => push(`findings[${i}].claim`, f.claim));
  (rp.evidence || []).forEach((e) => {
    push(`evidence[${e.id || '?'}].summary`, e.summary);
    push(`evidence[${e.id || '?'}].kind`, e.kind);
    push(`evidence[${e.id || '?'}].source`, e.source);
  });
  (rp.actions || []).forEach((a) =>
    push(`actions[${a.id || '?'}].command_summary`, a.command_summary)
  );
  (rp.risks || []).forEach((r, i) => push(`risks[${i}]`, r));
  const walkOutputs = (obj, prefix) => {
    if (typeof obj === 'string') {
      push(prefix, obj);
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach((v, i) => walkOutputs(v, `${prefix}[${i}]`));
      return;
    }
    if (obj && typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) walkOutputs(v, `${prefix}.${k}`);
    }
  };
  walkOutputs(rp.outputs || {}, 'outputs');
  return lines;
}

/**
 * Match a set of tokens against packet lines.
 * Returns { matched, hitTokens, sampleLine }. A keyword set matches when at
 * least two distinct tokens hit (or one, when only one token exists).
 */
function matchTokens(tokens, lines) {
  const unique = [...new Set(tokens)];
  const hitTokens = [];
  let sampleLine = null;
  for (const tok of unique) {
    const hit = lines.find((l) => l.text.toLowerCase().includes(tok));
    if (hit) {
      hitTokens.push(tok);
      if (!sampleLine) sampleLine = hit;
    }
  }
  const needed = Math.min(2, unique.length);
  return { matched: hitTokens.length >= needed && unique.length > 0, hitTokens, sampleLine };
}

/**
 * Run the heuristic oracle comparison. Returns a structured report:
 * { oracleFile, categories, checks, markers, suggestion }.
 * The suggestion is informational only — it never finalizes a score.
 */
function runOracleCheck(rp, oracle, oracleFile) {
  const lines = collectPacketLines(rp);

  // 1. Expected answer categories: id tokens + distinctive label words.
  const categories = (oracle.expected_answer_categories || []).map((cat) => {
    const tokens = tokenize(cat.id.replace(/-/g, ' ')).concat(tokenize(cat.label));
    const m = matchTokens(tokens, lines);
    return {
      id: cat.id,
      label: cat.label,
      matched: m.matched,
      hitTokens: m.hitTokens,
      sampleLine: m.sampleLine,
    };
  });
  const matchedCategoryIds = new Set(categories.filter((c) => c.matched).map((c) => c.id));

  // 2. answer_key_checks: "{id-a, id-b}" lists resolve via category matches;
  //    free-text expectations fall back to keyword matching.
  const checks = (oracle.answer_key_checks || []).map((check) => {
    const braceMatch = /\{([^}]+)\}/.exec(check.expected || '');
    if (braceMatch) {
      const ids = braceMatch[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const hits = ids.filter((id) => matchedCategoryIds.has(id));
      const sample = hits.length > 0 ? categories.find((c) => c.id === hits[0]).sampleLine : null;
      return {
        question_id: check.question_id,
        question: check.question,
        matched: hits.length > 0,
        via: hits.length > 0 ? `category ${hits.join(', ')}` : 'no expected category matched',
        sampleLine: sample,
      };
    }
    const m = matchTokens(tokenize(check.expected), lines);
    return {
      question_id: check.question_id,
      question: check.question,
      matched: m.matched,
      via: m.matched
        ? `keywords: ${m.hitTokens.join(', ')}`
        : m.hitTokens.length > 0
          ? `insufficient keyword overlap (only: ${m.hitTokens.join(', ')})`
          : 'no keyword overlap',
      sampleLine: m.matched ? m.sampleLine : null,
    };
  });

  // 3. strong_answer_markers: strings or { marker_id: text } objects.
  const markers = (oracle.strong_answer_markers || []).map((marker) => {
    let id;
    let text;
    if (typeof marker === 'string') {
      id = marker;
      text = marker;
    } else {
      id = Object.keys(marker)[0];
      text = marker[id];
    }
    const tokens = tokenize(id.replace(/_/g, ' ')).concat(tokenize(text));
    const m = matchTokens(tokens, lines);
    return {
      id,
      matched: m.matched,
      hitTokens: m.hitTokens,
      sampleLine: m.matched ? m.sampleLine : null,
    };
  });

  // 4. Suggested correctness band — heuristic, judge decides.
  const matchedChecks = checks.filter((c) => c.matched).length;
  let band = 'zero';
  if (matchedCategoryIds.size >= 1 && checks.length > 0 && matchedChecks === checks.length) {
    band = 'full';
  } else if (
    matchedCategoryIds.size >= 1 ||
    (checks.length > 0 && matchedChecks * 2 >= checks.length)
  ) {
    band = 'partial';
  }
  const suggestion = {
    suggested_correctness_band: band,
    rationale:
      `${matchedCategoryIds.size}/${categories.length} expected categories and ` +
      `${matchedChecks}/${checks.length} answer-key checks matched (keyword heuristic).`,
  };

  return { oracleFile, categories, checks, markers, suggestion };
}

function truncate(text, n) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function printOracleCheck(rp, packetId, report) {
  console.log(`Oracle check — heuristic, informational only`);
  console.log(`Packet: ${packetId} (task ${rp.task_id})`);
  console.log(`Oracle: ${path.relative(ROOT, report.oracleFile)}\n`);

  console.log('Expected answer categories:');
  for (const c of report.categories) {
    const mark = c.matched ? 'MATCH ' : 'MISS  ';
    console.log(`  ${mark} ${c.id}`);
    if (c.matched) {
      console.log(`         tokens: ${c.hitTokens.join(', ')}`);
      console.log(`         line:   ${c.sampleLine.source}: "${truncate(c.sampleLine.text, 80)}"`);
    }
  }

  console.log('\nAnswer-key checks:');
  for (const c of report.checks) {
    const mark = c.matched ? 'MATCH ' : 'MISS  ';
    console.log(`  ${mark} ${c.question_id} — ${c.question}`);
    console.log(`         via: ${c.via}`);
    if (c.sampleLine)
      console.log(`         line: ${c.sampleLine.source}: "${truncate(c.sampleLine.text, 80)}"`);
  }

  console.log('\nStrong answer markers:');
  for (const m of report.markers) {
    const mark = m.matched ? 'MATCH ' : 'MISS  ';
    console.log(`  ${mark} ${m.id}`);
    if (m.sampleLine)
      console.log(`         line: ${m.sampleLine.source}: "${truncate(m.sampleLine.text, 80)}"`);
  }

  console.log(`\nSUGGESTION (not a final score — human judge decides):`);
  console.log(`  suggested correctness band: ${report.suggestion.suggested_correctness_band}`);
  console.log(`  rationale: ${report.suggestion.rationale}`);
}

// ---------------------------------------------------------------------------
// template — judge declaration generation
// ---------------------------------------------------------------------------

const TEMPLATE_HEADER = `# Agent Olympics — Judge Declaration (judge-facing, PRIVATE while unscored)
#
# Fill every "score: null" and empty "reason" below, set judge_identity, and
# write judge_notes. Then finalize with:
#   node scripts/judge.js finalize <packet.yaml> --declaration <this-file>
#
# - Scores must be within [0, max]; every scored dimension needs a short
#   non-empty reason.
# - "guidance" blocks quote the PRIVATE oracle. They are for your eyes only
#   and are never copied into the finalized judge record.
# - oracle_suggestion is a keyword heuristic — a starting point, never final.
# - penalties: optional list of {kind, amount (negative), reason} using the
#   penalty kinds from ${RUBRIC_REF}.
# - auto_dimension_overrides: optionally replace the machine score for
#   evidence_quality / safety / execution with {score, reason}.
`;

function buildDeclaration(rp, packetId, oracle, oracleReport) {
  const rubricDims = loadRubricDimensions();
  const pendingDims = score.getPendingDimensions();
  const guidance = (oracle && oracle.scoring_guidance) || {};
  // The oracle uses "evidence" for evidence_quality; pending dims map 1:1.
  const dimensions = {};
  for (const dim of pendingDims) {
    const g = guidance[dim] || {};
    const entry = {
      score: null,
      max: rubricDims[dim],
      reason: '',
    };
    const gText = {};
    for (const key of ['full', 'partial', 'zero', 'penalty', 'deduction']) {
      if (g[key]) gText[key] = String(g[key]).trim();
    }
    if (Object.keys(gText).length > 0) entry.guidance = gText;
    dimensions[dim] = entry;
  }

  const decl = {
    declaration_schema_version: 1,
    declaration_id: `decl-${rp.task_id}-${packetId}-${new Date().toISOString().slice(0, 10)}`,
    task_id: rp.task_id,
    packet_id: packetId,
    scoring_rubric: RUBRIC_REF,
    judge_identity: '',
    judge_type: 'human',
    dimensions,
    auto_dimension_overrides: {},
    penalties: [],
    verdict: null,
    judge_notes: '',
  };

  if (oracleReport) {
    decl.oracle_suggestion = {
      note: 'SUGGESTION ONLY — keyword heuristic from oracle-check; the human judge decides the final score.',
      suggested_correctness_band: oracleReport.suggestion.suggested_correctness_band,
      rationale: oracleReport.suggestion.rationale,
      matched_categories: oracleReport.categories.filter((c) => c.matched).map((c) => c.id),
      unmatched_checks: oracleReport.checks.filter((c) => !c.matched).map((c) => c.question_id),
    };
  }

  return TEMPLATE_HEADER + '\n' + dumpYaml(decl);
}

// ---------------------------------------------------------------------------
// finalize — declaration validation + complete judge record
// ---------------------------------------------------------------------------

/**
 * Validate a judge declaration against the packet and the rubric.
 * Throws JudgeError listing every problem found.
 */
function validateDeclaration(decl, rp, packetId) {
  const errors = [];
  const rubricDims = loadRubricDimensions();
  const pendingDims = score.getPendingDimensions();
  const autoDims = score.getAutomaticDimensions();

  if (!decl || typeof decl !== 'object') {
    throw new JudgeError('Declaration is empty or not a YAML mapping');
  }

  if (decl.task_id !== rp.task_id) {
    errors.push(
      `declaration task_id "${decl.task_id}" does not match packet task_id "${rp.task_id}"`
    );
  }
  if (decl.packet_id !== packetId) {
    errors.push(`declaration packet_id "${decl.packet_id}" does not match packet_id "${packetId}"`);
  }
  if (!decl.judge_identity || !String(decl.judge_identity).trim()) {
    errors.push('judge_identity is required (who scored this packet?)');
  }
  if (!decl.judge_notes || !String(decl.judge_notes).trim()) {
    errors.push('judge_notes is required (overall judge summary)');
  }
  if (decl.judge_type && !['human', 'llm-assisted'].includes(decl.judge_type)) {
    errors.push(`judge_type "${decl.judge_type}" — declarations must be "human" or "llm-assisted"`);
  }
  if (decl.verdict != null && !VERDICTS.includes(decl.verdict)) {
    errors.push(`verdict "${decl.verdict}" is not one of ${VERDICTS.join(', ')}`);
  }

  const dims = decl.dimensions || {};
  for (const dim of pendingDims) {
    const d = dims[dim];
    if (!d || typeof d !== 'object') {
      errors.push(`dimensions.${dim} is missing`);
      continue;
    }
    if (typeof d.score !== 'number' || !Number.isFinite(d.score)) {
      errors.push(`dimensions.${dim}.score must be a number (got ${JSON.stringify(d.score)})`);
    } else {
      if (d.score < 0) errors.push(`dimensions.${dim}.score ${d.score} is below 0`);
      if (d.score > rubricDims[dim]) {
        errors.push(`dimensions.${dim}.score ${d.score} exceeds rubric max ${rubricDims[dim]}`);
      }
    }
    if (d.max != null && d.max !== rubricDims[dim]) {
      errors.push(`dimensions.${dim}.max ${d.max} does not match rubric max ${rubricDims[dim]}`);
    }
    if (!d.reason || !String(d.reason).trim()) {
      errors.push(`dimensions.${dim}.reason is required (short reason for the score)`);
    }
  }
  for (const dim of Object.keys(dims)) {
    if (!pendingDims.includes(dim)) {
      errors.push(
        `dimensions.${dim} is not a human-judged dimension (use auto_dimension_overrides for ${autoDims.join('/')})`
      );
    }
  }

  const overrides = decl.auto_dimension_overrides || {};
  for (const [dim, d] of Object.entries(overrides)) {
    if (!autoDims.includes(dim)) {
      errors.push(
        `auto_dimension_overrides.${dim} is not an automatic dimension (${autoDims.join(', ')})`
      );
      continue;
    }
    if (
      !d ||
      typeof d.score !== 'number' ||
      !Number.isFinite(d.score) ||
      d.score < 0 ||
      d.score > rubricDims[dim]
    ) {
      errors.push(
        `auto_dimension_overrides.${dim}.score must be a number within [0, ${rubricDims[dim]}]`
      );
    }
    if (!d || !d.reason || !String(d.reason).trim()) {
      errors.push(`auto_dimension_overrides.${dim}.reason is required`);
    }
  }

  const penalties = decl.penalties || [];
  if (!Array.isArray(penalties)) {
    errors.push('penalties must be a list of {kind, amount, reason}');
  } else {
    penalties.forEach((p, i) => {
      if (!p || !p.kind || !String(p.kind).trim()) errors.push(`penalties[${i}].kind is required`);
      if (!p || typeof p.amount !== 'number' || !Number.isFinite(p.amount) || p.amount >= 0) {
        errors.push(`penalties[${i}].amount must be a negative number`);
      }
      if (!p || !p.reason || !String(p.reason).trim())
        errors.push(`penalties[${i}].reason is required`);
    });
  }

  if (errors.length > 0) {
    throw new JudgeError(`Declaration invalid:\n  - ${errors.join('\n  - ')}`);
  }
}

/**
 * Guard: a finalized judge record must never contain oracle material.
 * Compares normalized oracle guidance strings against the record text and
 * throws when a long verbatim fragment leaks.
 */
function assertNoOracleLeak(record, oracle) {
  if (!oracle) return;
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
  const recordText = norm(JSON.stringify(record));
  const fragments = [];
  for (const g of Object.values(oracle.scoring_guidance || {})) {
    for (const v of Object.values(g)) {
      if (typeof v === 'string') fragments.push(v);
    }
  }
  for (const cat of oracle.expected_answer_categories || []) {
    if (cat.description) fragments.push(cat.description);
    if (cat.common_trigger) fragments.push(cat.common_trigger);
    for (const hint of cat.evidence_hints || []) fragments.push(hint);
  }
  for (const marker of oracle.strong_answer_markers || []) {
    if (typeof marker === 'string') fragments.push(marker);
    else for (const v of Object.values(marker)) fragments.push(v);
  }
  for (const frag of fragments) {
    const probe = norm(frag).slice(0, 60);
    if (probe.length >= 40 && recordText.includes(probe)) {
      throw new JudgeError(
        `Oracle leak: the judge record contains verbatim oracle text ("${probe.slice(0, 50)}…"). ` +
          'Oracle guidance must stay in the judge-facing declaration only.'
      );
    }
  }
}

/**
 * Guard for --blind: the record must not contain participant identity
 * (agent id, runtime, model, node) anywhere in its serialized form.
 */
function assertBlindClean(record, rp) {
  const recordText = JSON.stringify(record).toLowerCase();
  const identity = {
    agent_id: rp.agent_id,
    runtime: rp.runtime,
    model: rp.model,
    model_provider: rp.model_provider,
    node: rp.node,
  };
  for (const [field, value] of Object.entries(identity)) {
    if (
      typeof value === 'string' &&
      value.length >= 3 &&
      recordText.includes(value.toLowerCase())
    ) {
      throw new JudgeError(
        `Blind violation: record contains the packet's ${field} ("${value}"). ` +
          'Remove participant identity from declaration reasons/notes before blind finalize.'
      );
    }
  }
}

function assertNoSecretLeak(record) {
  const text = JSON.stringify(record);
  for (const pat of SECRET_VALUE_PATTERNS) {
    if (pat.test(text)) {
      throw new JudgeError('Secret pattern detected in judge record — refusing to write.');
    }
  }
}

/**
 * Build the complete judge record from packet + declaration.
 *
 * judge_type decision (documented): the finalized record is "hybrid" because
 * it mixes machine-scored dimensions (evidence_quality/safety/execution from
 * score.js logic) with human-scored dimensions. It becomes "human" only when
 * the declaration overrides all three automatic dimensions AND declares
 * judge_type: human. Both values are inside the judge-record schema enum.
 */
function buildJudgeRecord(rp, packetId, decl, { blind = false } = {}) {
  const rubricDims = loadRubricDimensions();
  const autoDims = score.getAutomaticDimensions();
  const pendingDims = score.getPendingDimensions();
  const semanticIssues = score.semanticPacketChecks(rp);

  const autoScores = {
    evidence_quality: {
      ...score.autoScoreEvidenceQuality(rp, semanticIssues),
      reason:
        'Auto-scored: evidence presence, finding references, reference integrity, redaction metadata.',
    },
    safety: {
      ...score.autoScoreSafety(rp),
      reason:
        'Auto-scored: secret-pattern scan, redaction practice, destructive-action keyword check.',
    },
    execution: {
      ...score.autoScoreExecution(rp),
      reason: 'Auto-scored: action evidence, timestamp validity, finding confidence.',
    },
  };

  const overrides = decl.auto_dimension_overrides || {};
  const dims = {};
  let overriddenCount = 0;
  for (const dimName of Object.keys(rubricDims)) {
    if (autoDims.includes(dimName)) {
      const ov = overrides[dimName];
      if (ov) {
        overriddenCount += 1;
        dims[dimName] = {
          score: ov.score,
          max: rubricDims[dimName],
          reason: `${String(ov.reason).trim()} (human override of auto score ${autoScores[dimName].score})`,
        };
      } else {
        dims[dimName] = {
          score: autoScores[dimName].score,
          max: rubricDims[dimName],
          reason: autoScores[dimName].reason,
        };
      }
    } else if (pendingDims.includes(dimName)) {
      const d = decl.dimensions[dimName];
      dims[dimName] = {
        score: d.score,
        max: rubricDims[dimName],
        reason: String(d.reason).trim(),
      };
    }
  }

  // Penalties: automatic semantic errors (same mapping as score.js
  // generateAutoJudge) + judge-declared penalties.
  const penalties = [];
  for (const issue of semanticIssues.filter((i) => i.severity === score.SEVERITY.error)) {
    penalties.push({
      kind: issue.msg.includes('Duplicate') ? 'unsupported_claim' : 'missing_required_output',
      amount: -5,
      reason: `${issue.msg} (automatic semantic check)`,
    });
  }
  for (const p of decl.penalties || []) {
    penalties.push({ kind: p.kind, amount: p.amount, reason: String(p.reason).trim() });
  }

  const positiveTotal = Object.values(dims).reduce((s, d) => s + d.score, 0);
  const totalMax = Object.values(dims).reduce((s, d) => s + d.max, 0);
  const penaltyTotal = penalties.reduce((s, p) => s + p.amount, 0);
  const totalScore = Math.max(0, positiveTotal + penaltyTotal);

  let verdict;
  if (decl.verdict) {
    verdict = decl.verdict;
  } else if (rp.status === 'disqualified') {
    verdict = 'disqualification';
  } else if (rp.status === 'failed') {
    verdict = 'fail';
  } else if (totalScore >= totalMax * VERDICT_PASS_PCT) {
    verdict = 'pass';
  } else if (totalScore >= totalMax * VERDICT_CONDITIONAL_PCT) {
    verdict = 'conditional_pass';
  } else {
    verdict = 'fail';
  }

  const allAutoOverridden = overriddenCount === autoDims.length;
  const judgeType = allAutoOverridden && decl.judge_type === 'human' ? 'human' : 'hybrid';

  const blindKey = crypto
    .createHash('sha256')
    .update(`${rp.task_id}:${packetId}`)
    .digest('hex')
    .slice(0, 12);
  const judgeRecordId = blind
    ? `jr-blind-${rp.task_id}-${blindKey}`
    : `jr-${rp.task_id}-${rp.agent_id}-${Date.now()}`;

  const noteParts = [String(decl.judge_notes).trim()];
  noteParts.push(
    `Finalized by judge.js: ${autoDims.filter((d) => !overrides[d]).join(', ') || '(none)'} machine-scored; ` +
      `${pendingDims.join(', ')}${overriddenCount > 0 ? ` and ${Object.keys(overrides).join(', ')} (overrides)` : ''} human-scored.`
  );
  if (blind)
    noteParts.push(
      'Blind judging: participant runtime/model/node/agent identity withheld from this record.'
    );

  const record = {
    schema_version: 1,
    judge_record_id: judgeRecordId,
    task_id: rp.task_id,
    packet_id: blind ? `blinded-packet-${blindKey}` : packetId,
    judge_type: judgeType,
    judge_identity: String(decl.judge_identity).trim(),
    scoring_rubric: decl.scoring_rubric || RUBRIC_REF,
    score_dimensions: dims,
    total_score: totalScore,
    penalties_applied: penalties,
    verdict,
    judge_notes: noteParts.join('\n'),
    created_at: new Date().toISOString(),
  };
  if (decl.dimension_notes && typeof decl.dimension_notes === 'object') {
    record.dimension_notes = decl.dimension_notes;
  }
  return record;
}

/**
 * Full finalize flow. Returns { record, outputPath }.
 */
function finalize({
  packetPath,
  declarationPath,
  blind = false,
  outputPath = null,
  force = false,
}) {
  const { rp, packetId } = resolvePacket(packetPath);
  const decl = loadYamlFile(declarationPath);
  validateDeclaration(decl, rp, packetId);

  const record = buildJudgeRecord(rp, packetId, decl, { blind });

  // Oracle-leak guard: declarations may quote the oracle, records may not.
  let oracleFile = null;
  try {
    oracleFile = findOracleFile(rp.task_id);
  } catch {
    /* no oracle dir */
  }
  if (oracleFile) assertNoOracleLeak(record, loadYamlFile(oracleFile));
  assertNoSecretLeak(record);
  if (blind) assertBlindClean(record, rp);

  // Schema validation (judge-record v1) before writing anything.
  const schemaResult = score.validateSchema(record, 'judge-record', 1);
  if (!schemaResult.valid) {
    throw new JudgeError(
      `Finalized record failed judge-record schema validation:\n  - ${schemaResult.errors.join('\n  - ')}`
    );
  }

  const base = path.basename(packetPath, path.extname(packetPath));
  const out = outputPath
    ? path.resolve(outputPath)
    : path.join(path.dirname(path.resolve(packetPath)), `${base}-judge.yaml`);
  if (fs.existsSync(out) && !force) {
    throw new JudgeError(`Output already exists: ${out} (use --force to overwrite)`);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, dumpYaml(record));
  return { record, outputPath: out };
}

// ---------------------------------------------------------------------------
// promotion-check — read-only tier evidence report
// ---------------------------------------------------------------------------

const TIER_RANK = { draft: 0, smoke: 1, verified: 2 };

/**
 * Check whether a judge record covers all six core rubric dimensions with
 * numeric scores (no pending human dimensions left).
 */
function judgeRecordComplete(judgeRecord, rubricDims) {
  if (!judgeRecord || !judgeRecord.score_dimensions) return false;
  return Object.keys(rubricDims).every((dim) => {
    const d = judgeRecord.score_dimensions[dim];
    return d && typeof d.score === 'number';
  });
}

function promotionCheck({ tasksDir, resultsDir, strict = false }) {
  const rubricDims = loadRubricDimensions();
  const absTasks = path.resolve(tasksDir);
  const absResults = path.resolve(resultsDir);
  if (!fs.existsSync(absTasks)) throw new JudgeError(`Tasks directory not found: ${tasksDir}`);

  // Load envelopes, preferring -v2 files per task_id.
  const envByTask = new Map();
  for (const name of fs
    .readdirSync(absTasks)
    .filter((n) => /\.ya?ml$/.test(n))
    .sort()) {
    const full = path.join(absTasks, name);
    let doc;
    try {
      doc = loadYamlFile(full);
    } catch {
      continue;
    }
    if (!doc || !doc.task_id || !doc.objective || !Array.isArray(doc.allowed_actions)) continue;
    const existing = envByTask.get(doc.task_id);
    const isV2 = doc.schema_version === 2 || /-v2\.ya?ml$/.test(name);
    if (!existing || (isV2 && !existing.isV2)) {
      envByTask.set(doc.task_id, { doc, file: full, isV2 });
    }
  }
  if (envByTask.size === 0) throw new JudgeError(`No task envelopes found in ${tasksDir}`);

  // Index result packets and their judge records by task_id.
  const packetsByTask = new Map();
  for (const f of fs.existsSync(absResults) ? score.findResultPackets(absResults) : []) {
    let doc;
    try {
      doc = loadYamlFile(f);
    } catch {
      continue;
    }
    if (!doc) continue;
    const rp = doc.result_packet && typeof doc.result_packet === 'object' ? doc.result_packet : doc;
    if (!rp.task_id || !rp.agent_id) continue;
    if (!packetsByTask.has(rp.task_id)) packetsByTask.set(rp.task_id, []);
    packetsByTask.get(rp.task_id).push({ file: f, rp });
  }

  console.log(`Promotion check — tier evidence report (read-only)`);
  console.log(`Tasks:   ${path.relative(ROOT, absTasks) || absTasks}`);
  console.log(`Results: ${path.relative(ROOT, absResults) || absResults}\n`);

  const violations = [];
  for (const [taskId, { doc, isV2 }] of [...envByTask.entries()].sort()) {
    const tier = doc.tier;
    const tierLabel = tier || 'MISSING (defaults draft)';
    const flags = [];
    if (!tier) flags.push('tier field missing from envelope');
    if (!isV2) flags.push('no v2 envelope found — using v1');

    // Packet evidence
    const packets = packetsByTask.get(taskId) || [];
    let validPacket = null;
    let completeJudge = null;
    let judgeVerdict = null;
    let judgeFileRef = null;
    for (const { file, rp } of packets) {
      const schemaResult = score.validateSchema(rp, 'result-packet', score.getSchemaVersion(rp));
      const semErrors = score
        .semanticPacketChecks(rp)
        .filter((i) => i.severity === score.SEVERITY.error);
      const isValid = schemaResult.valid && semErrors.length === 0;
      if (isValid && !validPacket) validPacket = file;
      for (const jf of score.findJudgeFiles(path.dirname(file), file)) {
        let jr;
        try {
          jr = loadYamlFile(jf);
        } catch {
          continue;
        }
        if (judgeRecordComplete(jr, rubricDims) && isValid && !completeJudge) {
          completeJudge = jf;
          judgeVerdict = jr.verdict;
          judgeFileRef = jf;
        }
      }
    }

    const baselinePresent = !!(doc.baseline && doc.baseline.baseline_actor);
    let supported = 'draft';
    if (validPacket) supported = 'smoke';
    if (validPacket && completeJudge && baselinePresent) supported = 'verified';

    console.log(`── ${taskId} ──`);
    console.log(`   recorded tier:   ${tierLabel}`);
    console.log(
      `   result packet:   ${validPacket ? `valid — ${path.relative(ROOT, validPacket)}` : packets.length > 0 ? `${packets.length} packet(s), none validating` : 'none'}`
    );
    console.log(
      `   judge record:    ${completeJudge ? `complete (all ${Object.keys(rubricDims).length} dimensions) — ${path.relative(ROOT, judgeFileRef)}` : 'none complete (pending human dimensions or missing)'}`
    );
    if (judgeVerdict) console.log(`   judge verdict:   ${judgeVerdict}`);
    console.log(`   baseline block:  ${baselinePresent ? 'present' : 'absent'}`);
    console.log(`   evidence supports: ${supported}`);
    for (const flag of flags) console.log(`   flag: ${flag}`);

    if (tier === 'retired') {
      console.log('   note: retired is a manual decision — not evidence-evaluated.');
      console.log('');
      continue;
    }
    const currentRank = TIER_RANK[tier] != null ? TIER_RANK[tier] : 0;
    if (currentRank > TIER_RANK[supported]) {
      const missing = [];
      if (!validPacket) missing.push('validating result packet');
      if (currentRank >= 2 && !completeJudge)
        missing.push('complete judge record (six scored dimensions)');
      if (currentRank >= 2 && !baselinePresent) missing.push('baseline block');
      console.log(
        `   GAP: recorded tier "${tier}" exceeds evidence-supported tier "${supported}" — missing: ${missing.join(', ')}`
      );
      violations.push(taskId);
    } else if (currentRank < TIER_RANK[supported]) {
      console.log(
        `   note: evidence would support promotion to "${supported}" (envelope edit is manual — this tool never edits).`
      );
    }
    console.log('');
  }

  console.log('--- Summary ---');
  console.log(`Tasks checked:      ${envByTask.size}`);
  console.log(
    `Tier gaps found:    ${violations.length}${violations.length > 0 ? ` (${violations.join(', ')})` : ''}`
  );
  if (strict && violations.length > 0) {
    console.error('\nSTRICT: recorded tiers exceed evidence — failing.');
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// fixtures — positive + negative declaration cases
// ---------------------------------------------------------------------------

function runFixtures() {
  const packet = path.join(ROOT, 'results', 'ops-001-yukson.yaml');
  let pass = 0;
  let fail = 0;
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'judge-harness-'));

  const report = (ok, label, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `\n      ${detail}` : ''}`);
    if (ok) pass += 1;
    else fail += 1;
  };

  try {
    // Positive: declaration finalizes into a complete, schema-valid record.
    const positiveDecl = path.join(FIXTURES_DIR, 'positive-declaration.yaml');
    try {
      const { record, outputPath } = finalize({
        packetPath: packet,
        declarationPath: positiveDecl,
        outputPath: path.join(tmpDir, 'ops-001-yukson-judge.yaml'),
      });
      const rubricDims = loadRubricDimensions();
      const complete = judgeRecordComplete(record, rubricDims);
      report(
        complete,
        'positive declaration finalizes with all six dimensions scored',
        `total=${record.total_score} verdict=${record.verdict} judge_type=${record.judge_type} → ${outputPath}`
      );
    } catch (err) {
      report(
        false,
        'positive declaration finalizes with all six dimensions scored',
        err.message.split('\n')[0]
      );
    }

    // Positive (blind): record must not contain participant identity.
    try {
      const { record } = finalize({
        packetPath: packet,
        declarationPath: positiveDecl,
        blind: true,
        outputPath: path.join(tmpDir, 'blind-judge.yaml'),
      });
      const text = JSON.stringify(record).toLowerCase();
      const leaked = ['yukson', 'openclaw', 'gpt-5.x', 'vps5'].filter((s) => text.includes(s));
      report(
        leaked.length === 0,
        'blind finalize hides runtime/model/node/agent identity',
        leaked.length > 0 ? `leaked: ${leaked.join(', ')}` : `packet_id=${record.packet_id}`
      );
    } catch (err) {
      report(
        false,
        'blind finalize hides runtime/model/node/agent identity',
        err.message.split('\n')[0]
      );
    }

    // Negative cases: each declaration must be rejected with a clear error.
    const negatives = [
      { file: 'negative-score-over-max.yaml', expect: 'exceeds rubric max' },
      { file: 'negative-task-id-mismatch.yaml', expect: 'does not match packet task_id' },
      { file: 'negative-missing-reason.yaml', expect: 'reason is required' },
    ];
    for (const { file, expect } of negatives) {
      const declPath = path.join(FIXTURES_DIR, file);
      try {
        finalize({
          packetPath: packet,
          declarationPath: declPath,
          outputPath: path.join(tmpDir, `${file}-judge.yaml`),
        });
        report(false, `${file} rejected`, 'finalize unexpectedly succeeded');
      } catch (err) {
        const ok = err instanceof JudgeError && err.message.includes(expect);
        report(
          ok,
          `${file} rejected with "${expect}"`,
          ok ? undefined : `got: ${err.message.split('\n').slice(0, 2).join(' ')}`
        );
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    process.exitCode = 1;
    console.error('Judge harness fixtures FAILED.');
  } else {
    console.log('Judge harness fixtures passed.');
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  console.error(`Usage:
  node scripts/judge.js oracle-check <packet.yaml> [--oracle <file>]
  node scripts/judge.js template <packet.yaml> [--oracle <file>] [--output <file>]
  node scripts/judge.js finalize <packet.yaml> --declaration <decl.yaml> [--blind] [--output <file>] [--force]
  node scripts/judge.js promotion-check [--tasks-dir tasks/season-001] [--results-dir results] [--strict]
  node scripts/judge.js fixtures`);
}

function parseArgs(argv) {
  const args = { positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--oracle') args.oracle = argv[++i];
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--declaration') args.declaration = argv[++i];
    else if (arg === '--tasks-dir') args.tasksDir = argv[++i];
    else if (arg === '--results-dir') args.resultsDir = argv[++i];
    else if (arg === '--blind') args.blind = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--strict') args.strict = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--')) throw new JudgeError(`Unknown option: ${arg}`);
    else args.positional.push(arg);
  }
  return args;
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (!command || args.help) {
    usage();
    process.exitCode = command ? 0 : 1;
    return;
  }

  if (command === 'oracle-check') {
    const packetPath = args.positional[0];
    if (!packetPath) {
      usage();
      process.exitCode = 1;
      return;
    }
    const { rp, packetId } = resolvePacket(packetPath);
    const oracleFile = findOracleFile(rp.task_id, args.oracle);
    if (!oracleFile) {
      console.log(
        `No oracle found for task ${rp.task_id} under ${path.relative(ROOT, ORACLE_DIR)} — nothing to check.`
      );
      return;
    }
    const oracle = loadYamlFile(oracleFile);
    printOracleCheck(rp, packetId, runOracleCheck(rp, oracle, oracleFile));
    return;
  }

  if (command === 'template') {
    const packetPath = args.positional[0];
    if (!packetPath) {
      usage();
      process.exitCode = 1;
      return;
    }
    const { rp, packetId } = resolvePacket(packetPath);
    const oracleFile = findOracleFile(rp.task_id, args.oracle);
    const oracle = oracleFile ? loadYamlFile(oracleFile) : null;
    const oracleReport = oracle ? runOracleCheck(rp, oracle, oracleFile) : null;
    const text = buildDeclaration(rp, packetId, oracle, oracleReport);
    if (args.output) {
      const out = path.resolve(args.output);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, text);
      console.log(`Judge declaration template written: ${out}`);
      if (!oracle) console.log(`(no oracle found for ${rp.task_id} — guidance fields omitted)`);
    } else {
      process.stdout.write(text);
    }
    return;
  }

  if (command === 'finalize') {
    const packetPath = args.positional[0];
    if (!packetPath || !args.declaration) {
      usage();
      process.exitCode = 1;
      return;
    }
    const { record, outputPath } = finalize({
      packetPath,
      declarationPath: args.declaration,
      blind: !!args.blind,
      outputPath: args.output,
      force: !!args.force,
    });
    console.log(`Judge record written: ${outputPath}`);
    console.log(`  judge_type: ${record.judge_type}${args.blind ? ' (blind)' : ''}`);
    for (const [dim, d] of Object.entries(record.score_dimensions)) {
      console.log(`  ${dim}: ${d.score}/${d.max}`);
    }
    if (record.penalties_applied.length > 0) {
      for (const p of record.penalties_applied)
        console.log(`  penalty ${p.kind}: ${p.amount} (${p.reason})`);
    }
    console.log(`  total: ${record.total_score}  verdict: ${record.verdict}`);
    console.log(
      `Verify with: node scripts/validate.js ${path.relative(process.cwd(), outputPath)}`
    );
    return;
  }

  if (command === 'promotion-check') {
    promotionCheck({
      tasksDir: args.tasksDir || path.join(ROOT, 'tasks', 'season-001'),
      resultsDir: args.resultsDir || path.join(ROOT, 'results'),
      strict: !!args.strict,
    });
    return;
  }

  if (command === 'fixtures') {
    runFixtures();
    return;
  }

  usage();
  process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(
      err instanceof JudgeError
        ? `ERROR: ${err.message}`
        : `Fatal error: ${err.stack || err.message}`
    );
    process.exit(1);
  }
}

module.exports = {
  runOracleCheck,
  buildDeclaration,
  validateDeclaration,
  buildJudgeRecord,
  finalize,
  promotionCheck,
};
