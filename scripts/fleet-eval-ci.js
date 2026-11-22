#!/usr/bin/env node
/**
 * Caller-side gate check for fleet evaluation (#325 slice 4a).
 *
 *   node <agent-olympics>/scripts/fleet-eval-ci.js --repo-dir <caller checkout> \
 *     --base <base sha> --head <checked-out sha> [--json] [--qset-dir <dir>]
 *
 * Runs in the caller's CI (ccc-node, fleet-skills) from an agent-olympics
 * checkout pinned by the caller's `eval/fleet-eval.lock.json`. It never calls a
 * model and needs no secret: an operator node records the candidate run and
 * commits the body-free run file to the PR; this check only finds the runs and
 * compares them with `gate`.
 *
 *   1. Render the overlay at base and at head (scripts/fleet-eval-overlay.js).
 *   2. Read the run files the PR adds under the lock's `runsDir`
 *      (`git diff base...head`). Run files are append-only: a modified, renamed
 *      or deleted run file is an input error.
 *   3. not_applicable — the overlay did not change and the PR adds no run.
 *   4. candidate = the newest added run for the lock lane and repo whose
 *      overlaySha256 equals the head overlay. None → candidate_needed, or
 *      stale_run when an added run carries another overlay hash.
 *   5. baseline = the newest run already at base for the same lane, repo and the
 *      base overlay hash. With none, a PR that adds two matching runs uses the
 *      older one (first introduction, A/A check); otherwise baseline_needed.
 *   6. gate(baseline, candidate) — see docs/fleet-eval.md "Gate rule".
 *
 * Exit codes: 0 pass / not_applicable, 1 fail / candidate_needed / stale_run /
 * baseline_needed, 2 usage or input error.
 */
'use strict';

const path = require('path');
const { compileSchemas, runProblems } = require('./validate-fleet-eval');
const { loadQset, gate, UsageError } = require('./fleet-eval');
const {
  LOCK_PATH,
  OverlayError,
  safeRef,
  showAt,
  git,
  readLock,
  renderOverlay,
} = require('./fleet-eval-overlay');

const MAX_RUN_FILE_BYTES = 8 * 1024 * 1024;

class CiInputError extends Error {}

function parseJsonl(buf, where) {
  if (buf.length > MAX_RUN_FILE_BYTES) throw new CiInputError(`${where} is too large`);
  return buf
    .toString('utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, i) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new CiInputError(`${where}:${i + 1} invalid JSON: ${err.message}`);
      }
    });
}

/**
 * Load one run file at `ref` and check it: every record schema-valid, one
 * runId equal to the file name, one lane, one subject, and the validator's
 * cross-field rules for records scored on the current item version (older
 * versions are excluded by the gate anyway).
 */
function loadRun(repoDir, ref, relPath, items, schemas) {
  const where = `${ref}:${relPath}`;
  const records = parseJsonl(showAt(repoDir, ref, relPath), where);
  if (records.length === 0) throw new CiInputError(`${where} has no records`);
  for (const [i, r] of records.entries()) {
    if (!schemas.run(r))
      throw new CiInputError(`${where}:${i + 1} is not a schema-valid run record`);
    const item = items.get(r.itemId);
    if (item && item.version === r.itemVersion) {
      const problems = runProblems(r, items);
      if (problems.length) throw new CiInputError(`${where}:${i + 1}: ${problems.join('; ')}`);
    }
  }
  const one = (fn, what) => {
    const values = new Set(records.map(fn));
    if (values.size !== 1) throw new CiInputError(`${where} mixes ${what}`);
    return [...values][0];
  };
  const runId = one((r) => r.runId, 'runIds');
  if (path.posix.basename(relPath) !== `${runId}.jsonl`) {
    throw new CiInputError(`${where}: file name must be ${runId}.jsonl`);
  }
  const lane = one((r) => r.target.lane, 'target lanes');
  const subjectKey = one(
    (r) => (r.subject ? `${r.subject.repo}@${r.subject.overlaySha256}` : 'none'),
    'subjects'
  );
  const latest = records.reduce((m, r) => (r.startedAt > m ? r.startedAt : m), '');
  return {
    path: relPath,
    runId,
    lane,
    subject: subjectKey === 'none' ? null : records[0].subject,
    qsetCommit: records[0].qsetCommit,
    latest,
    records,
  };
}

function newestFirst(a, b) {
  if (a.latest !== b.latest) return a.latest < b.latest ? 1 : -1;
  return a.runId < b.runId ? 1 : -1;
}

function inRunsDir(file, runsDir) {
  return file.startsWith(`${runsDir}/`) && file.endsWith('.jsonl');
}

/** Run files the PR adds; any other change to a run file is an input error. */
function addedRunFiles(repoDir, base, head, runsDir) {
  const out = git(repoDir, ['diff', '--name-status', '--no-renames', `${base}...${head}`, '--']);
  const added = [];
  for (const line of out.toString('utf8').split('\n').filter(Boolean)) {
    const [status, file] = line.split('\t');
    if (!inRunsDir(file, runsDir)) continue;
    if (status !== 'A') {
      throw new CiInputError(`run files are append-only: ${file} has status ${status}`);
    }
    added.push(file);
  }
  return added.sort();
}

function runFilesAt(repoDir, ref, runsDir) {
  const out = git(repoDir, ['ls-tree', '-r', '--name-only', ref, '--', runsDir]);
  return out
    .toString('utf8')
    .split('\n')
    .filter((f) => inRunsDir(f, runsDir))
    .sort();
}

function matches(run, lock, overlaySha) {
  return (
    run.lane === lock.lane &&
    run.subject !== null &&
    run.subject.repo === lock.repo &&
    run.subject.overlaySha256 === overlaySha
  );
}

function runHint(lock, head) {
  return [
    `node scripts/fleet-eval-overlay.js render --repo-dir <caller checkout> --ref ${head} --out <overlay.md>`,
    `node scripts/fleet-eval.js run --target-lane ${lock.lane} --target-model <model> ` +
      `--adapter command --command <lane wrapper> --subject-repo ${lock.repo} ` +
      `--overlay <overlay.md> --qset-commit ${lock.agentOlympics.slice(0, 7)} ` +
      `--out <caller checkout>/${lock.runsDir} --run-suffix <suffix>`,
  ];
}

/** Returns { status, exitCode, ... } for one caller checkout. */
function ciCheck({ repoDir, base, head, items, schemas = compileSchemas() }) {
  for (const ref of [base, head]) {
    if (!safeRef(ref)) throw new CiInputError(`ref ${JSON.stringify(ref)} is not a plain git ref`);
  }
  const lock = readLock(repoDir, head);
  if (!lock) throw new CiInputError(`${LOCK_PATH} does not exist at ${head}`);
  const headOverlay = renderOverlay(repoDir, head, lock).sha256;
  const baseLock = readLock(repoDir, base);
  let baseOverlay = null;
  if (baseLock) {
    try {
      baseOverlay = renderOverlay(repoDir, base, baseLock).sha256;
    } catch (err) {
      if (!(err instanceof OverlayError)) throw err;
      baseOverlay = null; // an overlay file the PR adds: the overlay changed
    }
  }
  const overlayChanged = baseOverlay !== headOverlay;
  const report = {
    repo: lock.repo,
    lane: lock.lane,
    agentOlympics: lock.agentOlympics,
    overlay: { base: baseOverlay, head: headOverlay, changed: overlayChanged },
    addedRuns: [],
    baseline: null,
    candidate: null,
    gate: null,
  };
  const added = addedRunFiles(repoDir, base, head, lock.runsDir).map((f) =>
    loadRun(repoDir, head, f, items, schemas)
  );
  for (const run of added) {
    if (run.lane !== lock.lane || !run.subject || run.subject.repo !== lock.repo) {
      throw new CiInputError(
        `${run.path}: lane ${run.lane} / subject ${run.subject ? run.subject.repo : 'none'} ` +
          `does not match the lock (${lock.lane} / ${lock.repo})`
      );
    }
    report.addedRuns.push({
      path: run.path,
      runId: run.runId,
      overlaySha256: run.subject.overlaySha256,
      matchesHead: run.subject.overlaySha256 === headOverlay,
    });
  }
  const done = (status, exitCode, extra = {}) => ({ status, exitCode, ...report, ...extra });

  if (!overlayChanged && added.length === 0) return done('not_applicable', 0);

  const candidates = added.filter((r) => matches(r, lock, headOverlay)).sort(newestFirst);
  if (candidates.length === 0) {
    const stale = added.length > 0;
    return done(stale ? 'stale_run' : 'candidate_needed', 1, { hint: runHint(lock, head) });
  }
  const candidate = candidates[0];

  let baseline = null;
  let baselineSource = null;
  if (baseLock && baseOverlay) {
    const atBase = runFilesAt(repoDir, base, baseLock.runsDir)
      .map((f) => loadRun(repoDir, base, f, items, schemas))
      .filter((r) => matches(r, lock, baseOverlay))
      .sort(newestFirst);
    if (atBase.length) {
      baseline = atBase[0];
      baselineSource = 'base';
    }
  }
  if (!baseline && candidates.length >= 2) {
    baseline = candidates[candidates.length - 1];
    baselineSource = 'pr';
  }
  report.candidate = { path: candidate.path, runId: candidate.runId };
  if (!baseline) return done('baseline_needed', 1, { hint: runHint(lock, base) });
  report.baseline = { path: baseline.path, runId: baseline.runId, source: baselineSource };

  try {
    report.gate = gate(baseline.records, candidate.records, items);
  } catch (err) {
    if (err instanceof UsageError) throw new CiInputError(`gate: ${err.message}`);
    throw err;
  }
  return report.gate.pass ? done('pass', 0) : done('fail', 1);
}

function pct(v) {
  return v === null || v === undefined ? '-' : `${(v * 100).toFixed(1)}%`;
}

function printText(r, log) {
  log(`fleet-eval ${r.status.toUpperCase()} repo=${r.repo} lane=${r.lane}`);
  log(`overlay base ${r.overlay.base || 'none'} -> head ${r.overlay.head}`);
  for (const a of r.addedRuns) {
    log(`added run ${a.runId} overlay ${a.matchesHead ? 'matches head' : 'STALE'}`);
  }
  if (r.baseline) log(`baseline ${r.baseline.runId} (${r.baseline.source})`);
  if (r.candidate) log(`candidate ${r.candidate.runId}`);
  if (r.gate) {
    for (const f of r.gate.families) {
      log(
        `${f.gated ? 'GATED' : 'info '} ${f.family}: ${pct(f.baseline)} -> ${pct(f.candidate)}` +
          ` (${f.items} items)${f.regressed ? ' REGRESSED' : ''}`
      );
    }
    log(`overall (gated): ${pct(r.gate.overall.baseline)} -> ${pct(r.gate.overall.candidate)}`);
    for (const e of r.gate.excluded) log(`EXCL  ${e.itemId} (${e.reason})`);
    for (const reason of r.gate.reasons) log(`FAIL  ${reason}`);
  }
  if (r.status === 'not_applicable') log('overlay unchanged and no run added: nothing to gate');
  if (r.hint) {
    log('record a run on an operator node (model calls happen there, never in CI):');
    for (const line of r.hint) log(`  ${line}`);
  }
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new CiInputError(`unexpected argument ${arg}`);
    const key = arg.slice(2);
    if (key === 'json') {
      opts.json = true;
      continue;
    }
    if (i + 1 >= argv.length) throw new CiInputError(`--${key} needs a value`);
    opts[key] = argv[(i += 1)];
  }
  return opts;
}

function main(argv = process.argv.slice(2), log = console.log) {
  try {
    const opts = parseArgs(argv);
    for (const key of Object.keys(opts)) {
      if (!['repo-dir', 'base', 'head', 'json', 'qset-dir'].includes(key)) {
        throw new CiInputError(`unknown option --${key}`);
      }
    }
    for (const key of ['repo-dir', 'base', 'head']) {
      if (!opts[key]) throw new CiInputError(`--${key} is required`);
    }
    const schemas = compileSchemas();
    const items = opts['qset-dir']
      ? loadQset(opts['qset-dir'], schemas)
      : loadQset(undefined, schemas);
    const report = ciCheck({
      repoDir: path.resolve(opts['repo-dir']),
      base: opts.base,
      head: opts.head,
      items,
      schemas,
    });
    if (opts.json) log(JSON.stringify(report, null, 2));
    else printText(report, log);
    return report.exitCode;
  } catch (err) {
    if (!(
      err instanceof CiInputError ||
      err instanceof OverlayError ||
      err instanceof UsageError
    )) {
      throw err;
    }
    log(`ERR   ${err.message}`);
    return 2;
  }
}

if (require.main === module) process.exit(main());

module.exports = { ciCheck, loadRun, addedRunFiles, main, CiInputError };
