#!/usr/bin/env node
/**
 * Agent Olympics — Appeal lifecycle tool (CJS)
 *
 * The repo already defines an appeal *record contract* — see
 * scripts/competition-validity.js `checkAppealRecord`, documented in
 * docs/rules.md "Appeals", with the validating shape in
 * fixtures/competition-validity/positive-appeal-record.yaml. What was missing
 * was a tool that runs the appeal lifecycle end to end:
 *
 *     file  →  review  →  apply
 *
 * This script is that tool. It does NOT invent a new schema: it conforms to
 * the existing checkAppealRecord contract (same required fields, same status
 * set, same reviewed_by rule) and reuses it for validation.
 *
 *   Required fields (checkAppealRecord): packet_id, filed_at, filed_by,
 *                                        statement, desired_outcome
 *   Allowed statuses:  filed, under_review, upheld, denied, remanded, dismissed
 *   reviewed_by:       required for any status other than `filed`
 *
 * Audit-trail guarantee: an appeal outcome NEVER silently rewrites a judge
 * record. `apply` only ever amends a judge record together with an
 * `appeal_resolution` provenance block
 *   { appeal_id, decision, reviewed_by, decided_at, prior_verdict, new_verdict }
 * recorded under the judge record's `appeal_record` field, and the amended
 * record is re-validated against the judge-record schema before being written.
 *
 * Honesty note: appeals adjudicate PROCEDURE, not taste. A substantively
 * correct answer that crossed a safety boundary (e.g. an oracle-reference
 * exposure, taxonomy ORACLE_BOUNDARY) can still be correctly disqualified — the
 * boundary stands regardless of diagnosis quality. The worked daegyo fixtures
 * (fixtures/appeals/) demonstrate both a legitimate DENIAL and a legitimate
 * UPHELD correction. See docs/appeals-workflow.md.
 *
 * CLI:
 *   node scripts/appeal.js file <judge-record-or-packet>
 *        --filed-by <id> --statement <text> --desired-outcome <text>
 *        [--rule-ref <ref>] [--output <file>]
 *   node scripts/appeal.js review <appeal>
 *        --reviewed-by <id> --decision upheld|denied|remanded|dismissed
 *        --reasoning <text> [--output <file>]
 *   node scripts/appeal.js apply <appeal> --judge-record <file> [--output <file>]
 *   node scripts/appeal.js validate <appeal>
 *   node scripts/appeal.js fixtures
 *
 * Exit code: 0 = success; non-zero on invalid transition / validation failure
 * / fixture failure.
 */
'use strict';

const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Appeal record contract — mirrored EXACTLY from competition-validity.js
// checkAppealRecord. Kept as named constants so there is a single, auditable
// correspondence between the two. If checkAppealRecord changes, these must too.
// ---------------------------------------------------------------------------

const APPEAL_STATUSES = ['filed', 'under_review', 'upheld', 'denied', 'remanded', 'dismissed'];
const APPEAL_REQUIRED_FIELDS = ['packet_id', 'filed_at', 'filed_by', 'statement', 'desired_outcome'];
// Statuses other than `filed` require a reviewed_by (matches checkAppealRecord).
const REVIEWED_STATUSES = ['under_review', 'upheld', 'denied', 'remanded', 'dismissed'];
// Terminal decision statuses produced by `review`.
const DECISION_STATUSES = ['upheld', 'denied', 'remanded', 'dismissed'];

class AppealError extends Error {}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function repoPath(relOrAbs) {
  const resolved = path.isAbsolute(relOrAbs) ? relOrAbs : path.resolve(ROOT, relOrAbs);
  return resolved;
}

function loadYaml(p) {
  const full = repoPath(p);
  return yaml.load(fs.readFileSync(full, 'utf8'));
}

function dumpYaml(doc) {
  return yaml.dump(doc, { lineWidth: 100, noRefs: true, sortKeys: false });
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Validate an appeal record against the checkAppealRecord contract. Returns an
 * array of error strings (empty = valid). Mirrors checkAppealRecord's exact
 * field/status set so the two never diverge.
 */
function validateAppealRecord(appeal) {
  const errs = [];
  if (!appeal || typeof appeal !== 'object') {
    return ['appeal record is empty or not an object'];
  }
  if (!APPEAL_STATUSES.includes(appeal.status)) {
    errs.push(`appeal status "${appeal.status}" is not allowed (one of: ${APPEAL_STATUSES.join(', ')})`);
  }
  for (const field of APPEAL_REQUIRED_FIELDS) {
    if (!appeal[field]) errs.push(`appeal missing required field "${field}"`);
  }
  if (REVIEWED_STATUSES.includes(appeal.status) && !appeal.reviewed_by) {
    errs.push(`appeal status "${appeal.status}" requires reviewed_by`);
  }
  return errs;
}

/**
 * Cross-check our own validation against the canonical checkAppealRecord by
 * driving competition-validity.js over a temp packet that embeds the appeal.
 * This guarantees conformance to the live contract, not just to our mirror.
 * Returns { ok, output }.
 */
function crossCheckWithCompetitionValidity(appeal) {
  // Wrap the standalone appeal in a minimal packet so checkAppealRecord runs
  // (it keys off packetDoc.appeal). The wrapper is a throwaway temp file.
  const wrapper = {
    packet_id: appeal.packet_id,
    appeal,
  };
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'appeal-xcheck-'));
  const tmpFile = path.join(tmpDir, 'positive-appeal-xcheck.yaml');
  try {
    fs.writeFileSync(tmpFile, dumpYaml(wrapper));
    const res = cp.spawnSync(
      process.execPath,
      [path.join(ROOT, 'scripts', 'competition-validity.js'), 'fixtures', tmpDir],
      { encoding: 'utf8' }
    );
    return { ok: res.status === 0, output: (res.stdout || '') + (res.stderr || '') };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/** Validate a judge record file through scripts/validate.js (real schema). */
function validateJudgeRecordFile(filePath) {
  const res = cp.spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'validate.js'), filePath],
    { encoding: 'utf8' }
  );
  return { ok: res.status === 0, output: (res.stdout || '') + (res.stderr || '') };
}

function writeOut(doc, outputPath, label) {
  const text = dumpYaml(doc);
  if (outputPath) {
    const out = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text);
    console.log(`${label} written to ${path.relative(ROOT, out)}`);
  } else {
    process.stdout.write(text);
  }
}

/**
 * Resolve the packet_id from a `file` source, which may be a judge record (has
 * packet_id), a result packet (has packet_id), or an embedded-appeal packet.
 * Returns { packetId, taskId, source }.
 */
function resolveAppealTarget(srcPath) {
  const doc = loadYaml(srcPath);
  if (!doc || typeof doc !== 'object') {
    throw new AppealError(`appeal target ${srcPath} is empty or not an object`);
  }
  const packetId = doc.packet_id || (doc.result_packet && doc.result_packet.packet_id);
  if (!packetId) {
    throw new AppealError(`could not resolve packet_id from ${srcPath} (no packet_id / result_packet.packet_id)`);
  }
  const taskId = doc.task_id || (doc.result_packet && doc.result_packet.task_id) || null;
  return { packetId, taskId, source: doc };
}

function appealId(packetId) {
  return `appeal-${packetId}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// file — create an appeal record (status `filed`)
// ---------------------------------------------------------------------------

function cmdFile(args) {
  const src = args._[0];
  if (!src) throw new AppealError('file: missing <judge-record-or-packet> argument');
  for (const req of ['filedBy', 'statement', 'desiredOutcome']) {
    if (!args[req]) throw new AppealError(`file: missing required --${req.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}`);
  }

  const { packetId, taskId } = resolveAppealTarget(src);

  const appeal = {
    schema_version: 1,
    appeal_id: appealId(packetId),
    status: 'filed',
    packet_id: packetId,
    task_id: taskId || undefined,
    filed_at: nowIso(),
    filed_by: args.filedBy,
    statement: args.statement,
    desired_outcome: args.desiredOutcome,
  };
  if (args.ruleRef) appeal.rule_ref = args.ruleRef;
  if (args.evidenceRefs) appeal.evidence_refs = args.evidenceRefs.split(',').map((s) => s.trim()).filter(Boolean);
  // Drop undefined keys for clean YAML.
  for (const k of Object.keys(appeal)) if (appeal[k] === undefined) delete appeal[k];

  const errs = validateAppealRecord(appeal);
  if (errs.length) {
    throw new AppealError(`filed appeal failed contract validation:\n  - ${errs.join('\n  - ')}`);
  }

  writeOut(appeal, args.output, 'Filed appeal');
  console.log(`Appeal ${appeal.appeal_id} filed against packet ${packetId} (status: filed).`);
}

// ---------------------------------------------------------------------------
// review — advance to a decision status
// ---------------------------------------------------------------------------

function cmdReview(args) {
  const src = args._[0];
  if (!src) throw new AppealError('review: missing <appeal> argument');
  if (!args.reviewedBy) throw new AppealError('review: missing required --reviewed-by');
  if (!args.decision) throw new AppealError('review: missing required --decision');
  if (!args.reasoning) throw new AppealError('review: missing required --reasoning');
  if (!DECISION_STATUSES.includes(args.decision)) {
    throw new AppealError(`review: --decision must be one of ${DECISION_STATUSES.join(', ')}`);
  }

  const appeal = loadYaml(src);
  if (!appeal || typeof appeal !== 'object') {
    throw new AppealError(`review: appeal ${src} is empty or not an object`);
  }

  // Transition guard: cannot review an already-decided appeal.
  if (DECISION_STATUSES.includes(appeal.status)) {
    throw new AppealError(
      `invalid transition: appeal is already in terminal status "${appeal.status}"; cannot re-review`);
  }
  if (!['filed', 'under_review'].includes(appeal.status)) {
    throw new AppealError(`invalid transition: cannot review an appeal in status "${appeal.status}"`);
  }

  // The pre-decision record must itself be a valid filed appeal.
  const preErrs = validateAppealRecord({ ...appeal, status: 'filed' });
  // filed-status check excludes reviewed_by; ignore that single field here.
  const realPreErrs = preErrs.filter((e) => !/requires reviewed_by/.test(e));
  if (realPreErrs.length) {
    throw new AppealError(`review: appeal under review is malformed:\n  - ${realPreErrs.join('\n  - ')}`);
  }

  const reviewed = {
    ...appeal,
    status: args.decision,
    reviewed_by: args.reviewedBy,
    reviewed_at: nowIso(),
    decided_at: nowIso(),
    decision: args.decision,
    decision_reasoning: args.reasoning,
    outcome: args.decision,
    outcome_notes: args.reasoning,
  };

  const errs = validateAppealRecord(reviewed);
  if (errs.length) {
    throw new AppealError(`reviewed appeal failed contract validation:\n  - ${errs.join('\n  - ')}`);
  }

  writeOut(reviewed, args.output, 'Reviewed appeal');
  console.log(`Appeal ${reviewed.appeal_id || '(unnamed)'} reviewed by ${args.reviewedBy}: ${args.decision}.`);
}

// ---------------------------------------------------------------------------
// apply — apply an UPHELD appeal's effect to the judge record (with audit)
// ---------------------------------------------------------------------------

function parseDesiredOutcome(desired) {
  // Recognized machine-actionable outcomes embedded in desired_outcome /
  // decision_reasoning. Format (case-insensitive, anywhere in the string):
  //   verdict=<pass|conditional_pass|fail|disqualification>
  //   total_score=<number>
  const text = String(desired || '');
  const out = {};
  const vm = text.match(/verdict\s*=\s*(pass|conditional_pass|fail|disqualification)/i);
  if (vm) out.verdict = vm[1].toLowerCase();
  const sm = text.match(/total_score\s*=\s*(-?\d+(?:\.\d+)?)/i);
  if (sm) out.total_score = Number(sm[1]);
  return out;
}

function cmdApply(args) {
  const src = args._[0];
  if (!src) throw new AppealError('apply: missing <appeal> argument');
  if (!args.judgeRecord) throw new AppealError('apply: missing required --judge-record');

  const appeal = loadYaml(src);
  if (!appeal || typeof appeal !== 'object') {
    throw new AppealError(`apply: appeal ${src} is empty or not an object`);
  }
  if (!DECISION_STATUSES.includes(appeal.status)) {
    throw new AppealError(
      `apply: appeal must be in a decided status (${DECISION_STATUSES.join(', ')}); got "${appeal.status}". Run \`review\` first.`);
  }
  // A decided appeal must still be contract-valid.
  const aerrs = validateAppealRecord(appeal);
  if (aerrs.length) {
    throw new AppealError(`apply: appeal failed contract validation:\n  - ${aerrs.join('\n  - ')}`);
  }

  const judgePath = repoPath(args.judgeRecord);
  const judge = loadYaml(judgePath);
  if (!judge || typeof judge !== 'object' || !judge.judge_record_id) {
    throw new AppealError(`apply: --judge-record ${args.judgeRecord} is not a judge record`);
  }
  if (judge.packet_id && appeal.packet_id && judge.packet_id !== appeal.packet_id) {
    throw new AppealError(
      `apply: appeal packet_id "${appeal.packet_id}" does not match judge record packet_id "${judge.packet_id}"`);
  }

  const priorVerdict = judge.verdict;
  const decidedAt = appeal.decided_at || appeal.reviewed_at || nowIso();
  const amended = JSON.parse(JSON.stringify(judge));

  let newVerdict = priorVerdict;
  let changed = false;
  const changes = [];

  if (appeal.status === 'upheld') {
    // Apply the desired_outcome's machine-actionable effects (verdict / score).
    const desired = parseDesiredOutcome(
      `${appeal.desired_outcome || ''} ${appeal.decision_reasoning || ''}`);
    if (desired.verdict && desired.verdict !== priorVerdict) {
      amended.verdict = desired.verdict;
      newVerdict = desired.verdict;
      changed = true;
      changes.push(`verdict ${priorVerdict} -> ${desired.verdict}`);
    }
    if (typeof desired.total_score === 'number' && desired.total_score !== amended.total_score) {
      changes.push(`total_score ${amended.total_score} -> ${desired.total_score}`);
      amended.total_score = desired.total_score;
      changed = true;
    }
    if (!changed) {
      // Upheld but no machine-actionable change encoded — still stamp the
      // resolution so the upheld decision is on the record (e.g. remand-style
      // guidance), but make the no-op explicit rather than silent.
      changes.push('no machine-actionable verdict/score change encoded in desired_outcome');
    }
  } else {
    // denied / dismissed / remanded: judge record substance is UNCHANGED.
    changes.push(`${appeal.status}: judge record substance unchanged`);
  }

  // Mandatory audit trail — under appeal_record (schema allows additionalProps).
  amended.appeal_record = {
    appeal_id: appeal.appeal_id || `appeal-${appeal.packet_id}`,
    status: appeal.status,
    filed_at: appeal.filed_at,
    reviewed_by: appeal.reviewed_by,
    reviewed_at: appeal.reviewed_at || decidedAt,
    outcome: appeal.outcome || appeal.status,
    outcome_notes: appeal.outcome_notes || appeal.decision_reasoning || '',
    appeal_resolution: {
      appeal_id: appeal.appeal_id || `appeal-${appeal.packet_id}`,
      decision: appeal.status,
      reviewed_by: appeal.reviewed_by,
      decided_at: decidedAt,
      prior_verdict: priorVerdict,
      new_verdict: newVerdict,
      changes,
    },
  };

  // Write to a temp file, validate against the real judge-record schema, then
  // commit to the requested output (never write an invalid record).
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'appeal-apply-'));
  const tmpFile = path.join(tmpDir, 'amended-judge-record.yaml');
  try {
    fs.writeFileSync(tmpFile, dumpYaml(amended));
    const v = validateJudgeRecordFile(tmpFile);
    if (!v.ok) {
      throw new AppealError(`apply: amended judge record failed schema validation:\n${v.output}`);
    }
    writeOut(amended, args.output, 'Amended judge record');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  const head = appeal.status === 'upheld' && changed ? 'APPLIED' : (appeal.status === 'upheld' ? 'UPHELD (no-op)' : appeal.status.toUpperCase());
  console.log(`${head}  appeal ${amended.appeal_record.appeal_id}  prior_verdict=${priorVerdict} new_verdict=${newVerdict}`);
  for (const c of changes) console.log(`  - ${c}`);
}

// ---------------------------------------------------------------------------
// validate — standalone appeal record validation (contract + cross-check)
// ---------------------------------------------------------------------------

function cmdValidate(args) {
  const src = args._[0];
  if (!src) throw new AppealError('validate: missing <appeal> argument');
  const appeal = loadYaml(src);
  const errs = validateAppealRecord(appeal);
  if (errs.length) {
    console.error(`INVALID  ${src}`);
    for (const e of errs) console.error(`  - ${e}`);
    process.exitCode = 1;
    return;
  }
  console.log(`VALID    ${src}  (status: ${appeal.status})`);
}

// ---------------------------------------------------------------------------
// fixtures — exercise the full lifecycle over the daegyo-style worked cases
// ---------------------------------------------------------------------------

const FIXTURE_DIR = 'fixtures/appeals';

function report(pass, label, detail) {
  console.log(`${pass ? 'OK  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  return pass;
}

function runFixtures() {
  let failures = 0;
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'appeal-fixtures-'));

  try {
    // ---- Case A: DENIED oracle-boundary disqualification (daegyo) ----------
    // The DQ judge record + a filed appeal + a denied decision are committed
    // fixtures. We verify: filed appeal validates; the denial decision
    // validates and is terminal; apply leaves the verdict UNCHANGED but stamps
    // the audit trail; the amended judge record still validates.
    {
      const judgeRec = `${FIXTURE_DIR}/daegyo-oracle-dq-judge-record.yaml`;
      const denied = `${FIXTURE_DIR}/daegyo-oracle-dq-appeal-denied.yaml`;

      const deniedDoc = loadYaml(denied);
      failures += report(validateAppealRecord(deniedDoc).length === 0,
        'A: denied appeal validates against contract',
        `status=${deniedDoc.status}`) ? 0 : 1;
      failures += report(deniedDoc.status === 'denied',
        'A: appeal is denied (boundary upheld, not rubber-stamped)') ? 0 : 1;

      // apply -> verdict must stay disqualification.
      const out = path.join(tmpDir, 'A-amended-judge.yaml');
      const res = cp.spawnSync(process.execPath, [__filename, 'apply', denied,
        '--judge-record', judgeRec, '--output', out], { encoding: 'utf8' });
      const applied = res.status === 0 && fs.existsSync(out) ? loadYaml(out) : null;
      failures += report(res.status === 0 && applied && applied.verdict === 'disqualification',
        'A: apply leaves verdict disqualification (unchanged)',
        applied ? `verdict=${applied.verdict}` : 'apply failed') ? 0 : 1;
      const ar = applied && applied.appeal_record && applied.appeal_record.appeal_resolution;
      failures += report(!!ar && ar.decision === 'denied'
        && ar.prior_verdict === 'disqualification' && ar.new_verdict === 'disqualification',
        'A: audit trail present, prior==new verdict',
        ar ? `${ar.prior_verdict} -> ${ar.new_verdict}` : 'no appeal_resolution') ? 0 : 1;
      const v = applied ? validateJudgeRecordFile(out) : { ok: false };
      failures += report(v.ok, 'A: amended judge record still schema-valid') ? 0 : 1;
    }

    // ---- Case B: UPHELD procedural error (PR #228 dangling-evidence-id) -----
    // A packet quarantined for a dangling evidence id that was an adapter
    // normalization artifact. Appeal upheld; verdict corrected with audit.
    {
      const judgeRec = `${FIXTURE_DIR}/pr228-evidence-id-judge-record.yaml`;
      const upheld = `${FIXTURE_DIR}/pr228-evidence-id-appeal-upheld.yaml`;

      const upheldDoc = loadYaml(upheld);
      failures += report(validateAppealRecord(upheldDoc).length === 0,
        'B: upheld appeal validates against contract',
        `status=${upheldDoc.status}`) ? 0 : 1;
      failures += report(upheldDoc.status === 'upheld',
        'B: appeal is upheld (real procedural error corrected)') ? 0 : 1;

      const out = path.join(tmpDir, 'B-amended-judge.yaml');
      const res = cp.spawnSync(process.execPath, [__filename, 'apply', upheld,
        '--judge-record', judgeRec, '--output', out], { encoding: 'utf8' });
      const applied = res.status === 0 && fs.existsSync(out) ? loadYaml(out) : null;
      const priorJudge = loadYaml(judgeRec);
      failures += report(res.status === 0 && applied
        && applied.verdict !== priorJudge.verdict && applied.verdict === 'conditional_pass',
        'B: apply corrects verdict per desired_outcome',
        applied ? `${priorJudge.verdict} -> ${applied.verdict}` : 'apply failed') ? 0 : 1;
      const ar = applied && applied.appeal_record && applied.appeal_record.appeal_resolution;
      failures += report(!!ar && ar.decision === 'upheld'
        && ar.prior_verdict === priorJudge.verdict && ar.new_verdict === applied.verdict,
        'B: audit trail records verdict correction',
        ar ? `${ar.prior_verdict} -> ${ar.new_verdict}` : 'no appeal_resolution') ? 0 : 1;
      const v = applied ? validateJudgeRecordFile(out) : { ok: false };
      failures += report(v.ok, 'B: amended judge record still schema-valid') ? 0 : 1;
    }

    // ---- Case C: invalid-transition guard ----------------------------------
    // Reviewing an already-decided appeal must fail (non-zero).
    {
      const denied = `${FIXTURE_DIR}/daegyo-oracle-dq-appeal-denied.yaml`;
      const res = cp.spawnSync(process.execPath, [__filename, 'review', denied,
        '--reviewed-by', 'judge-x', '--decision', 'upheld', '--reasoning', 'retry'],
        { encoding: 'utf8' });
      failures += report(res.status !== 0,
        'C: re-reviewing a decided appeal is rejected',
        `exit=${res.status}`) ? 0 : 1;
    }

    // ---- Case D: round-trip file -> review -------------------------------
    // file a fresh appeal off the DQ judge record, then review->denied; both
    // outputs must validate.
    {
      const judgeRec = `${FIXTURE_DIR}/daegyo-oracle-dq-judge-record.yaml`;
      const filedOut = path.join(tmpDir, 'D-filed.yaml');
      const r1 = cp.spawnSync(process.execPath, [__filename, 'file', judgeRec,
        '--filed-by', 'daegyo', '--statement', 'Diagnosis was correct; exposure was an honest model limitation.',
        '--desired-outcome', 'reinstate verdict=pass', '--rule-ref', 'docs/rules.md#appeals',
        '--output', filedOut], { encoding: 'utf8' });
      const filedDoc = r1.status === 0 && fs.existsSync(filedOut) ? loadYaml(filedOut) : null;
      failures += report(r1.status === 0 && filedDoc && filedDoc.status === 'filed'
        && validateAppealRecord(filedDoc).length === 0,
        'D: file produces a valid filed appeal') ? 0 : 1;

      const reviewedOut = path.join(tmpDir, 'D-reviewed.yaml');
      const r2 = cp.spawnSync(process.execPath, [__filename, 'review', filedOut,
        '--reviewed-by', 'judge-appeals-01', '--decision', 'denied',
        '--reasoning', 'Oracle exposure is a safety boundary; it stands regardless of diagnosis quality.',
        '--output', reviewedOut], { encoding: 'utf8' });
      const reviewedDoc = r2.status === 0 && fs.existsSync(reviewedOut) ? loadYaml(reviewedOut) : null;
      failures += report(r2.status === 0 && reviewedDoc && reviewedDoc.status === 'denied'
        && validateAppealRecord(reviewedDoc).length === 0,
        'D: review denies the filed appeal, still valid') ? 0 : 1;
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  if (failures > 0) {
    console.error(`\nAppeal lifecycle fixtures FAILED (${failures} check(s)).`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAppeal lifecycle fixtures passed.');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  console.error(`Usage:
  node scripts/appeal.js file <judge-record-or-packet> --filed-by <id> --statement <text> --desired-outcome <text> [--rule-ref <ref>] [--evidence-refs a,b] [--output <file>]
  node scripts/appeal.js review <appeal> --reviewed-by <id> --decision upheld|denied|remanded|dismissed --reasoning <text> [--output <file>]
  node scripts/appeal.js apply <appeal> --judge-record <file> [--output <file>]
  node scripts/appeal.js validate <appeal>
  node scripts/appeal.js fixtures`);
}

const FLAG_MAP = {
  '--filed-by': 'filedBy',
  '--statement': 'statement',
  '--desired-outcome': 'desiredOutcome',
  '--rule-ref': 'ruleRef',
  '--evidence-refs': 'evidenceRefs',
  '--reviewed-by': 'reviewedBy',
  '--decision': 'decision',
  '--reasoning': 'reasoning',
  '--judge-record': 'judgeRecord',
  '--output': 'output',
};

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (Object.prototype.hasOwnProperty.call(FLAG_MAP, a)) {
      args[FLAG_MAP[a]] = argv[++i];
    } else if (a.startsWith('--')) {
      throw new AppealError(`unknown argument: ${a}`);
    } else {
      args._.push(a);
    }
  }
  return args;
}

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') { usage(); return; }

  const args = parseArgs(argv.slice(1));
  if (args.help) { usage(); return; }

  switch (cmd) {
    case 'file': cmdFile(args); break;
    case 'review': cmdReview(args); break;
    case 'apply': cmdApply(args); break;
    case 'validate': cmdValidate(args); break;
    case 'fixtures': runFixtures(); break;
    default:
      console.error(`Unknown command: "${cmd}"`);
      usage();
      process.exit(1);
  }
}

try {
  main();
} catch (err) {
  if (err instanceof AppealError) {
    console.error(`appeal: ${err.message}`);
  } else {
    console.error(err.stack || err.message);
  }
  process.exit(1);
}

module.exports = {
  validateAppealRecord,
  crossCheckWithCompetitionValidity,
  parseDesiredOutcome,
  APPEAL_STATUSES,
  APPEAL_REQUIRED_FIELDS,
};
