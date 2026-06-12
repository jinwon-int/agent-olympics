#!/usr/bin/env node
/**
 * Agent Olympics — Longitudinal (over-time) measurement (CJS)
 *
 * The charter's word is "operating": the olympics measure the operating agent
 * stack, which implies a TIME axis the repo did not previously capture. Today
 * each (task, participant) has a single latest judge record — there is no way
 * to see whether a stack's performance drifted between rounds. This tool adds
 * an *additive*, append-only longitudinal layer on top of the existing
 * scoreboard, turning a one-shot contest into continuous fleet QA.
 *
 * It is the platform measuring the very thing ops-002 diagnoses — "post-update
 * config drift" — happening to the fleet itself: a stack can drift the same way
 * a node does, and these snapshots are how we'd see it.
 *
 * Design: a longitudinal record is a sequence of immutable round SNAPSHOTS.
 * Trend/drift is computed ACROSS them; no existing scored data, judge record,
 * or scoreboard logic is changed. Snapshots are derived from the scoreboard
 * (run `make score` first), validated against
 * schemas/longitudinal-snapshot.schema.json, and written append-only under
 * results/longitudinal/ as snapshot-<captured_at>-<round_id>.yaml.
 *
 * Drift verdicts (deterministic, documented thresholds — see
 * docs/longitudinal-measurement.md). Conceptually these map to ops-002's drift
 * classes (the fleet drifting like a node):
 *   - REGRESSION    total_score drops by > threshold (default 5) between
 *                   consecutive snapshots. ~ ops-002 "performance regression
 *                   after update".
 *   - STATUS_DRIFT  a previously-clean (task,participant) becomes
 *                   quarantined/disqualified; carries the failure_code.
 *                   ~ ops-002 "the stack broke after a routine update".
 *   - RECOVERY      total_score climbs back up by > threshold (or status
 *                   returns to clean). ~ ops-002 "the targeted fix worked".
 *   - STABLE        within threshold, still clean.
 *
 * Honesty note: drift detection is threshold-based SIGNAL, not proof of
 * causation. A score drop can be task variance, model-backend flakiness, or a
 * genuine stack regression. The report flags it for investigation; it does not
 * diagnose the cause.
 *
 * Blind mode (--blind) reuses the SAME anonymization rules as the public
 * leaderboard (web-result-consumer.js: Participant A/B…, no models/nodes).
 *
 * CLI:
 *   node scripts/longitudinal.js snapshot [--scoreboard results/scoreboard.json]
 *        [--round <id>] [--output <file>]
 *   node scripts/longitudinal.js report [--dir results/longitudinal]
 *        [--task <id>] [--participant <id>] [--blind] [--threshold <n>]
 *   node scripts/longitudinal.js fixtures
 *
 * Exit code: 0 (informational) for snapshot/report; non-zero only on the
 * `fixtures` suite failing or a schema-invalid snapshot.
 */
'use strict';

const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_SCOREBOARD = path.join(ROOT, 'results', 'scoreboard.json');
const DEFAULT_DIR = path.join(ROOT, 'results', 'longitudinal');
const SCHEMA_REL = 'schemas/longitudinal-snapshot.schema.json';

const DEFAULT_THRESHOLD = 5;

// The six rubric dimensions, in canonical order.
const DIMENSIONS = [
  'correctness',
  'evidence_quality',
  'safety',
  'execution',
  'communication',
  'durability',
];

// Reuse the failure taxonomy — never re-derive codes here.
const { classifyReason, FAILURE_CATEGORIES } = require('./lib/failure-taxonomy');
const TAXONOMY_CODES = new Set(FAILURE_CATEGORIES.map((c) => c.code));

// Reuse the public-leaderboard blind anonymization. web-result-consumer.js
// runs main() on import; require its source and evaluate just the helper in an
// isolated module context so we share ONE definition of the blind rules.
const { anonymizeScoreboard } = loadBlindAnonymizer();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso() {
  return new Date().toISOString();
}

/**
 * Extract `anonymizeScoreboard` (and its dependencies) from
 * web-result-consumer.js WITHOUT triggering its main(), so the blind rules
 * are shared from a single source rather than duplicated. The consumer guards
 * nothing around main(), so we load it as a module that exports the helper by
 * re-evaluating the file with module.exports appended in a child-free vm.
 */
function loadBlindAnonymizer() {
  const Module = require('module');
  const consumerPath = path.join(ROOT, 'scripts', 'web-result-consumer.js');
  let src = fs.readFileSync(consumerPath, 'utf8');
  // Neutralize the bare main() call at the bottom and export the helper.
  src = src.replace(/\nmain\(\);\s*$/, '\n');
  src += '\nmodule.exports = { anonymizeScoreboard, participantLabel };\n';
  const m = new Module(consumerPath);
  m.filename = consumerPath;
  m.paths = Module._nodeModulePaths(path.dirname(consumerPath));
  m._compile(src, consumerPath);
  if (typeof m.exports.anonymizeScoreboard !== 'function') {
    throw new Error('could not load anonymizeScoreboard from web-result-consumer.js');
  }
  return m.exports;
}

function gitRevision() {
  try {
    const out = cp.execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

let _validateFn = null;
function getSnapshotValidator() {
  if (_validateFn) return _validateFn;
  const Ajv = require('ajv/dist/2020');
  const addFormats = require('ajv-formats');
  const ajv = new Ajv({ allErrors: true, verbose: true });
  addFormats(ajv);
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, SCHEMA_REL), 'utf8'));
  _validateFn = ajv.compile(schema);
  return _validateFn;
}

/**
 * Validate a snapshot object against the schema. Returns { valid, errors[] }.
 */
function validateSnapshot(snapshot) {
  const validate = getSnapshotValidator();
  const valid = validate(snapshot);
  if (valid) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: (validate.errors || []).map((e) => `${e.instancePath || '(root)'}: ${e.message}`),
  };
}

// ---------------------------------------------------------------------------
// Snapshot construction (from a scoreboard)
// ---------------------------------------------------------------------------

/**
 * Determine a failure_code for a rejected entry. Quarantined/disqualified
 * entries carry their taxonomy code; we derive it from the entry's recorded
 * free-text errors/caveats via the shared classifier, or from an explicit
 * failure_code if the scoreboard already carries one.
 */
function deriveFailureCode(entry) {
  if (entry.failure_code && TAXONOMY_CODES.has(entry.failure_code)) return entry.failure_code;
  const texts = []
    .concat(entry.errors || [])
    .concat(entry.warnings || [])
    .concat(entry.comparability_caveats || []);
  for (const t of texts) {
    const code = classifyReason(String(t));
    if (code && code !== 'UNCLASSIFIED') return code;
  }
  // A rejected status with no classifiable reason still gets a visible code.
  if (entry.status === 'disqualified') return 'ORACLE_BOUNDARY';
  if (entry.status === 'quarantined') return 'UNCLASSIFIED';
  return null;
}

/**
 * Build a snapshot object from a scoreboard object.
 */
function buildSnapshot(scoreboard, opts = {}) {
  const capturedAt = opts.capturedAt || nowIso();
  const roundId = opts.round || scoreboard.round_id || 'round-unknown';
  const results = [];

  for (const entry of scoreboard.entries || []) {
    const rejected = entry.status === 'quarantined' || entry.status === 'disqualified';
    const score = entry.score || {};
    const dims = {};
    if (score.dimensions) {
      for (const d of DIMENSIONS) {
        const ds = score.dimensions[d];
        if (ds && typeof ds.score === 'number') {
          dims[d] = { score: ds.score, max: ds.max };
        }
      }
    }
    const res = {
      task_id: entry.task_id,
      participant_id: entry.agent_id,
      total_score: typeof score.total_score === 'number' ? score.total_score : null,
      verdict: score.verdict || null,
      status: entry.status,
    };
    if (Object.keys(dims).length > 0) res.dimensions = dims;
    const failureCode = rejected ? deriveFailureCode(entry) : null;
    res.failure_code = failureCode;
    results.push(res);
  }

  // Stable ordering: task then participant, so two snapshots of the same round
  // serialize identically regardless of scoreboard entry order.
  results.sort((a, b) =>
    (a.task_id || '').localeCompare(b.task_id || '') ||
    (a.participant_id || '').localeCompare(b.participant_id || ''));

  return {
    schema_version: 1,
    schema_description: 'Agent Olympics longitudinal snapshot — one immutable round outcome (additive, append-only).',
    snapshot_id: `snap-${roundId}-${capturedAt}`,
    captured_at: capturedAt,
    round_id: roundId,
    source_scoreboard_id: scoreboard.scoreboard_id,
    source_revision: opts.revision || gitRevision(),
    results,
  };
}

function snapshotFilename(snapshot) {
  // ISO timestamps contain ':' which is awkward on some filesystems — keep the
  // captured_at but make it filename-safe.
  const safeTs = snapshot.captured_at.replace(/[:]/g, '-');
  return `snapshot-${safeTs}-${snapshot.round_id}.yaml`;
}

// ---------------------------------------------------------------------------
// Snapshot loading (a time-ordered series)
// ---------------------------------------------------------------------------

/**
 * Load all snapshots in a directory, time-ordered by captured_at.
 * Throws if any snapshot is schema-invalid (a corrupt record must not silently
 * skew a trend).
 */
function loadSnapshots(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir)
    .filter((f) => /^snapshot-.*\.ya?ml$/.test(f))
    .map((f) => path.join(dir, f));
  const snapshots = [];
  for (const f of files) {
    const doc = yaml.load(fs.readFileSync(f, 'utf8'));
    const { valid, errors } = validateSnapshot(doc);
    if (!valid) {
      const err = new Error(`schema-invalid snapshot ${path.relative(ROOT, f)}:\n  ${errors.join('\n  ')}`);
      err.schemaInvalid = true;
      throw err;
    }
    snapshots.push({ _file: f, ...doc });
  }
  snapshots.sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at)));
  return snapshots;
}

// ---------------------------------------------------------------------------
// Drift detection
// ---------------------------------------------------------------------------

const CLEAN_STATUSES = new Set(['completed', 'partial', 'blocked', 'failed']);
const REJECTED_STATUSES = new Set(['quarantined', 'disqualified']);

/**
 * Classify the drift between a previous and current result for the same
 * (task, participant). Deterministic, threshold-based.
 *
 * Returns { verdict, delta, failure_code }.
 *   verdict ∈ { STABLE, REGRESSION, RECOVERY, STATUS_DRIFT, NEW }
 *
 * Precedence: a status drift into rejection is the strongest signal and wins
 * over a numeric delta. A return from rejection to clean is RECOVERY.
 */
function classifyDrift(prev, curr, threshold) {
  if (!prev) {
    return { verdict: 'NEW', delta: null, failure_code: curr.failure_code || null };
  }

  const prevRejected = REJECTED_STATUSES.has(prev.status);
  const currRejected = REJECTED_STATUSES.has(curr.status);

  // STATUS_DRIFT: a previously-clean entry became quarantined/disqualified.
  if (!prevRejected && currRejected) {
    return { verdict: 'STATUS_DRIFT', delta: null, failure_code: curr.failure_code || null };
  }

  // RECOVERY (status): a previously-rejected entry returned to clean.
  if (prevRejected && !currRejected) {
    return { verdict: 'RECOVERY', delta: deltaOf(prev, curr), failure_code: null };
  }

  // Both rejected — still drift territory but no clean numeric comparison.
  if (prevRejected && currRejected) {
    return { verdict: 'STATUS_DRIFT', delta: null, failure_code: curr.failure_code || prev.failure_code || null };
  }

  // Both clean — compare numeric totals.
  const delta = deltaOf(prev, curr);
  if (delta == null) {
    return { verdict: 'STABLE', delta: null, failure_code: null };
  }
  if (delta <= -threshold) {
    return { verdict: 'REGRESSION', delta, failure_code: null };
  }
  if (delta >= threshold) {
    return { verdict: 'RECOVERY', delta, failure_code: null };
  }
  return { verdict: 'STABLE', delta, failure_code: null };
}

function deltaOf(prev, curr) {
  if (typeof prev.total_score !== 'number' || typeof curr.total_score !== 'number') return null;
  return curr.total_score - prev.total_score;
}

const KEY = (r) => `${r.task_id} ${r.participant_id}`;

/**
 * Build a per-(task,participant) trend across the time-ordered snapshots.
 * Returns an array of { task_id, participant_id, points[] } where each point is
 * { captured_at, round_id, total_score, status, drift } and drift is the
 * classifyDrift result vs the previous point.
 */
function buildTrends(snapshots, threshold, filters = {}) {
  const series = new Map(); // key -> { task_id, participant_id, points[] }
  for (const snap of snapshots) {
    for (const r of snap.results || []) {
      if (filters.task && r.task_id !== filters.task) continue;
      if (filters.participant && r.participant_id !== filters.participant) continue;
      const key = KEY(r);
      if (!series.has(key)) {
        series.set(key, { task_id: r.task_id, participant_id: r.participant_id, points: [] });
      }
      series.get(key).points.push({
        captured_at: snap.captured_at,
        round_id: snap.round_id,
        total_score: r.total_score,
        status: r.status,
        failure_code: r.failure_code || null,
        result: r,
      });
    }
  }

  const trends = [];
  for (const s of series.values()) {
    let prev = null;
    for (const pt of s.points) {
      pt.drift = classifyDrift(prev ? prev.result : null, pt.result, threshold);
      prev = pt;
    }
    trends.push(s);
  }
  trends.sort((a, b) =>
    (a.task_id || '').localeCompare(b.task_id || '') ||
    (a.participant_id || '').localeCompare(b.participant_id || ''));
  return trends;
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

const DRIFT_MARK = {
  NEW: '·',
  STABLE: '=',
  REGRESSION: '▼',
  RECOVERY: '▲',
  STATUS_DRIFT: '✗',
};

function fmtScore(v) {
  return v == null ? '—' : String(v);
}

function fmtDelta(d) {
  if (d == null) return '   ';
  if (d === 0) return ' ±0';
  return (d > 0 ? '+' : '') + d;
}

function printReport(trends, opts) {
  const threshold = opts.threshold;
  console.log(`Agent Olympics — Longitudinal trend report${opts.blind ? ' (blind)' : ''}`);
  console.log(`Drift thresholds: REGRESSION when Δscore <= -${threshold}; RECOVERY when Δscore >= +${threshold} (or status returns to clean);`);
  console.log(`STATUS_DRIFT when a clean entry becomes quarantined/disqualified (carries failure_code); STABLE otherwise.`);
  console.log(`Conceptual tie: these map to ops-002's drift classes — the fleet can drift the same way a node does.`);
  console.log(`Signal not proof: a drop may be task variance or backend flakiness — investigate, don't assume regression.\n`);

  if (trends.length === 0) {
    console.log('(no snapshots / no matching (task, participant) series)');
    return;
  }

  for (const t of trends) {
    console.log(`── ${t.task_id} / ${t.participant_id} ──`);
    for (const pt of t.points) {
      const d = pt.drift;
      const mark = DRIFT_MARK[d.verdict] || '?';
      const deltaStr = fmtDelta(d.delta);
      const codeStr = d.failure_code ? `  [${d.failure_code}]` : '';
      console.log(
        `  ${mark} ${pt.captured_at}  score=${fmtScore(pt.total_score).padStart(4)}  ` +
        `Δ${String(deltaStr).padStart(4)}  status=${pt.status.padEnd(12)} ${d.verdict}${codeStr}`
      );
    }
    console.log('');
  }

  // Summary of the latest drift per series.
  const counts = {};
  for (const t of trends) {
    const last = t.points[t.points.length - 1];
    const v = last.drift.verdict;
    counts[v] = (counts[v] || 0) + 1;
  }
  const parts = Object.entries(counts).map(([k, v]) => `${k}=${v}`);
  console.log(`Latest-round drift summary: ${parts.join('  ') || '(none)'}`);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdSnapshot(args) {
  const scoreboardPath = args.scoreboard ? path.resolve(args.scoreboard) : DEFAULT_SCOREBOARD;
  if (!fs.existsSync(scoreboardPath)) {
    console.error(`Scoreboard not found: ${scoreboardPath}\nRun \`make score\` first.`);
    process.exitCode = 1;
    return;
  }
  const scoreboard = JSON.parse(fs.readFileSync(scoreboardPath, 'utf8'));
  const snapshot = buildSnapshot(scoreboard, { round: args.round });

  const { valid, errors } = validateSnapshot(snapshot);
  if (!valid) {
    console.error('Snapshot failed schema validation:');
    for (const e of errors) console.error(`  ${e}`);
    process.exitCode = 1;
    return;
  }

  const dir = DEFAULT_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const outPath = args.output ? path.resolve(args.output) : path.join(dir, snapshotFilename(snapshot));

  // Append-only: never overwrite an existing snapshot for the same captured_at.
  if (fs.existsSync(outPath)) {
    console.error(`Refusing to overwrite existing snapshot (append-only): ${path.relative(ROOT, outPath)}`);
    process.exitCode = 1;
    return;
  }

  fs.writeFileSync(outPath, yaml.dump(snapshot, { lineWidth: 120, noRefs: true, sortKeys: false }));
  console.log(`Wrote snapshot: ${path.relative(ROOT, outPath)}`);
  console.log(`  round_id=${snapshot.round_id}  captured_at=${snapshot.captured_at}  results=${snapshot.results.length}  revision=${snapshot.source_revision.slice(0, 12)}`);
}

function cmdReport(args) {
  const dir = args.dir ? path.resolve(args.dir) : DEFAULT_DIR;
  const threshold = args.threshold != null ? Number(args.threshold) : DEFAULT_THRESHOLD;

  let snapshots;
  try {
    snapshots = loadSnapshots(dir);
  } catch (e) {
    console.error(e.message);
    // A schema-invalid snapshot is the one report-side non-zero exit.
    process.exitCode = e.schemaInvalid ? 1 : 1;
    return;
  }

  if (args.blind) {
    snapshots = snapshots.map(blindSnapshot);
  }

  const trends = buildTrends(snapshots, threshold, { task: args.task, participant: args.participant });
  printReport(trends, { threshold, blind: !!args.blind });
}

/**
 * Apply the public-leaderboard blind rules to a snapshot by routing its
 * results through the shared scoreboard anonymizer, then mapping the
 * anonymized agent_ids back onto the snapshot results. This reuses the SAME
 * Participant A/B aliasing as web-result-consumer.js rather than duplicating
 * it. Snapshots carry no model/node fields, so only the participant alias and
 * any identifying tokens in failure-free text need anonymizing here.
 */
function blindSnapshot(snap) {
  // Build a minimal scoreboard-shaped object the anonymizer understands, in the
  // SAME order, so alias assignment (first-appearance) is deterministic.
  const pseudoEntries = (snap.results || []).map((r) => ({
    entry_id: `${r.task_id}-${r.participant_id}`,
    task_id: r.task_id,
    agent_id: r.participant_id,
    run_id: `run-${r.task_id}-${r.participant_id}`,
    packet_id: `pkt-${r.task_id}-${r.participant_id}`,
    submission_metadata: {},
    comparability_caveats: [],
    warnings: [],
    errors: [],
  }));
  const pseudoParticipants = [...new Set((snap.results || []).map((r) => r.participant_id))]
    .map((id) => ({ agent_id: id }));
  const anon = anonymizeScoreboard({ entries: pseudoEntries, participants: pseudoParticipants });
  const aliasByEntry = new Map(anon.entries.map((e, i) => [pseudoEntries[i].entry_id, e.agent_id]));

  const results = (snap.results || []).map((r) => {
    const alias = aliasByEntry.get(`${r.task_id}-${r.participant_id}`) || r.participant_id;
    return { ...r, participant_id: alias };
  });
  // Drop provenance identity that could re-link a participant.
  const out = { ...snap, results };
  delete out.source_revision;
  delete out.source_scoreboard_id;
  delete out._file;
  return out;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_DIR = path.join(ROOT, 'fixtures', 'longitudinal');

function loadFixtureSnapshots() {
  return loadSnapshots(FIXTURE_DIR);
}

function runFixtures() {
  let failures = 0;
  const fail = (msg) => { console.log(`  FAIL  ${msg}`); failures += 1; };
  const ok = (msg) => { console.log(`  ok    ${msg}`); };

  console.log('Longitudinal fixtures');

  // 1. All committed fixture snapshots are schema-valid (loadSnapshots throws
  //    on invalid, so a clean load proves validity).
  let snapshots;
  try {
    snapshots = loadFixtureSnapshots();
    ok(`loaded ${snapshots.length} fixture snapshots (all schema-valid)`);
  } catch (e) {
    fail(`fixture snapshots did not load: ${e.message}`);
    finish(failures);
    return;
  }
  if (snapshots.length < 3) fail(`expected at least 3 fixture snapshots, got ${snapshots.length}`);

  const trends = buildTrends(snapshots, DEFAULT_THRESHOLD);

  // Helper: fetch the drift verdict at a given captured_at for a series.
  const seriesFor = (task, participant) =>
    trends.find((t) => t.task_id === task && t.participant_id === participant);
  const verdictsOf = (task, participant) => {
    const s = seriesFor(task, participant);
    return s ? s.points.map((p) => p.drift.verdict) : null;
  };

  // 2. STABLE -> REGRESSION -> RECOVERY on the score series.
  const driftSeries = verdictsOf('ops-002', 'fleet-alpha');
  if (!driftSeries) {
    fail('expected series ops-002 / fleet-alpha not present');
  } else {
    const expect = ['NEW', 'REGRESSION', 'RECOVERY'];
    if (JSON.stringify(driftSeries) !== JSON.stringify(expect)) {
      fail(`ops-002/fleet-alpha drift = [${driftSeries}], expected [${expect}]`);
    } else {
      ok(`ops-002/fleet-alpha: NEW -> REGRESSION -> RECOVERY classified correctly`);
    }
  }

  // 2b. A genuinely stable series stays STABLE across the same 3 snapshots.
  const stableSeries = verdictsOf('ops-002', 'fleet-stable');
  if (!stableSeries) {
    fail('expected series ops-002 / fleet-stable not present');
  } else if (!(stableSeries[1] === 'STABLE' && stableSeries[2] === 'STABLE')) {
    fail(`ops-002/fleet-stable drift = [${stableSeries}], expected later points STABLE`);
  } else {
    ok('ops-002/fleet-stable: stays STABLE within threshold');
  }

  // 3. clean -> STATUS_DRIFT (quarantined with a failure_code).
  const statusSeries = seriesFor('tool-001', 'fleet-beta');
  if (!statusSeries) {
    fail('expected series tool-001 / fleet-beta not present');
  } else {
    const last = statusSeries.points[statusSeries.points.length - 1];
    if (last.drift.verdict !== 'STATUS_DRIFT') {
      fail(`tool-001/fleet-beta last verdict = ${last.drift.verdict}, expected STATUS_DRIFT`);
    } else if (!last.drift.failure_code || !TAXONOMY_CODES.has(last.drift.failure_code)) {
      fail(`tool-001/fleet-beta STATUS_DRIFT carries invalid failure_code: ${last.drift.failure_code}`);
    } else {
      ok(`tool-001/fleet-beta: clean -> STATUS_DRIFT [${last.drift.failure_code}] classified correctly`);
    }
  }

  // 4. Blind mode leaks no real participant identity.
  const realIds = [...new Set(snapshots.flatMap((s) => (s.results || []).map((r) => r.participant_id)))];
  const blinded = snapshots.map(blindSnapshot);
  const blindedTrends = buildTrends(blinded, DEFAULT_THRESHOLD);
  const blob = JSON.stringify(blindedTrends);
  let leaked = false;
  for (const id of realIds) {
    if (blob.includes(id)) { fail(`blind report leaked participant id "${id}"`); leaked = true; }
  }
  if (!leaked) ok(`blind mode: none of ${realIds.length} real participant ids leak`);
  // Blind aliases must be Participant X.
  const blindIds = [...new Set(blinded.flatMap((s) => s.results.map((r) => r.participant_id)))];
  if (!blindIds.every((id) => /^Participant [A-Z]+$/.test(id))) {
    fail(`blind ids not all "Participant X": ${blindIds.join(', ')}`);
  } else {
    ok(`blind mode: all ids are anonymized aliases (${blindIds.join(', ')})`);
  }
  // Blind mode must also preserve the same drift classification.
  const blindDrift = (() => {
    const s = blindedTrends.find((t) => t.task_id === 'ops-002');
    return s ? s.points.map((p) => p.drift.verdict) : null;
  })();
  if (!blindDrift || !blindDrift.includes('REGRESSION')) {
    fail('blind mode altered drift classification (expected a REGRESSION to survive)');
  } else {
    ok('blind mode: drift verdicts preserved under anonymization');
  }

  // 5. A malformed snapshot fails schema validation.
  const malformed = {
    schema_version: 1,
    snapshot_id: 'snap-bad',
    captured_at: 'not-a-date',
    round_id: 'round-bad',
    results: [{ task_id: 'x', participant_id: 'y', status: 'invalid-status' }],
  };
  const res = validateSnapshot(malformed);
  if (res.valid) {
    fail('malformed snapshot unexpectedly passed schema validation');
  } else {
    ok(`malformed snapshot rejected by schema (${res.errors.length} error(s))`);
  }

  // 6. snapshot(report) round-trip: building a snapshot from a tiny scoreboard
  //    and validating it succeeds (exercises buildSnapshot + failure_code).
  const tinyBoard = {
    scoreboard_id: 'sb-test',
    round_id: 'round-test',
    entries: [
      { entry_id: 'a-p', task_id: 'a', agent_id: 'p', status: 'completed',
        score: { total_score: 80, verdict: 'pass', dimensions: { correctness: { score: 25, max: 30 } } } },
      { entry_id: 'b-q', task_id: 'b', agent_id: 'q', status: 'quarantined',
        errors: ['finding references unknown evidence id ev-9'] },
    ],
  };
  const built = buildSnapshot(tinyBoard, { capturedAt: '2026-01-01T00:00:00.000Z', revision: 'testrev' });
  const builtRes = validateSnapshot(built);
  if (!builtRes.valid) {
    fail(`buildSnapshot produced schema-invalid output: ${builtRes.errors.join('; ')}`);
  } else {
    const qEntry = built.results.find((r) => r.participant_id === 'q');
    if (qEntry.failure_code !== 'EVIDENCE_DISCIPLINE') {
      fail(`expected derived failure_code EVIDENCE_DISCIPLINE, got ${qEntry.failure_code}`);
    } else {
      ok('buildSnapshot: derives EVIDENCE_DISCIPLINE failure_code via shared taxonomy');
    }
  }

  finish(failures);
}

function finish(failures) {
  if (failures > 0) {
    console.error(`\nLongitudinal fixtures FAILED (${failures} case(s)).`);
    process.exitCode = 1;
    return;
  }
  console.log('\nLongitudinal fixtures passed.');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  console.error(`Usage:
  node scripts/longitudinal.js snapshot [--scoreboard <scoreboard.json>] [--round <id>] [--output <file>]
  node scripts/longitudinal.js report [--dir <dir>] [--task <id>] [--participant <id>] [--blind] [--threshold <n>]
  node scripts/longitudinal.js fixtures`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--scoreboard') args.scoreboard = argv[++i];
    else if (a === '--round') args.round = argv[++i];
    else if (a === '--output') args.output = argv[++i];
    else if (a === '--dir') args.dir = argv[++i];
    else if (a === '--task') args.task = argv[++i];
    else if (a === '--participant') args.participant = argv[++i];
    else if (a === '--threshold') args.threshold = argv[++i];
    else if (a === '--blind') args.blind = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else args._.push(a);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); return; }
  const cmd = args._[0];

  if (!cmd || cmd === 'fixtures') { runFixtures(); return; }
  if (cmd === 'snapshot') { cmdSnapshot(args); return; }
  if (cmd === 'report') { cmdReport(args); return; }

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
  buildSnapshot,
  validateSnapshot,
  loadSnapshots,
  classifyDrift,
  buildTrends,
  blindSnapshot,
  deriveFailureCode,
  DIMENSIONS,
  DEFAULT_THRESHOLD,
};
