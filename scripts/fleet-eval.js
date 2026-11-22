#!/usr/bin/env node
/**
 * Fleet evaluation runner and gate (#325 slice 2a).
 *
 *   node scripts/fleet-eval.js run  --target-lane <lane> --target-model <model> \
 *     --adapter stub --stub-outputs <file.json>
 *   node scripts/fleet-eval.js run  --target-lane <lane> --target-model <model> \
 *     --adapter command --command <bin> [--command-arg <arg>]...
 *     [--family <f>]... [--attempts 3] [--timeout-ms 120000]
 *     [--out fixtures/fleet-eval/runs] [--qset-commit <sha>] [--run-suffix <s>]
 *   node scripts/fleet-eval.js gate --baseline <run.jsonl> --candidate <run.jsonl> [--json]
 *
 * `run` loads the active Q-set items, sends each item's prompt to the target
 * through an adapter, judges every attempt with the rule judge and writes
 * body-free run records (fleet-eval-run-v1) to <out>/<runId>.jsonl. Every
 * record is checked with the validator's schema and cross-field rules before
 * it is written.
 *
 * `gate` compares a candidate run with a baseline run and fails when a gated
 * family (>= 8 active items) or the gated overall pass rate drops. See
 * docs/fleet-eval.md for the rules.
 *
 * Adapters:
 *   stub     fixed outputs per item id from a JSON file; no model call. CI uses
 *            only this adapter.
 *   command  spawns <bin> [args] without a shell, writes the prompt to stdin and
 *            reads the final output text from stdout. stderr is discarded and
 *            never stored. This is the only path that calls a model, and only
 *            when an operator runs it explicitly.
 *
 * Exit codes: 0 ok / gate passed, 1 gate failed, 2 usage or input error.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const { compileSchemas, itemProblems, runProblems } = require('./validate-fleet-eval');

const ROOT = path.resolve(__dirname, '..');
const EVAL_DIR = path.join(ROOT, 'fixtures', 'fleet-eval');
const QSET_DIR = path.join(EVAL_DIR, 'qset');
const RUNS_DIR = path.join(EVAL_DIR, 'runs');

const DEFAULT_ATTEMPTS = 3;
const MAX_ATTEMPTS = 5; // run-record.schema.json attempt maximum
const DEFAULT_TIMEOUT_MS = 120000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MIN_GATED_ITEMS = 8;
const LANE_RE = /^[a-z0-9][a-z0-9._-]*$/;

class UsageError extends Error {}

// ---------------------------------------------------------------------------
// Q-set loading
// ---------------------------------------------------------------------------

function readJsonlValues(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new UsageError(`${file}:${index + 1} invalid JSON: ${err.message}`);
      }
    });
}

/** Load and validate every Q-set item. Returns Map(id -> item). */
function loadQset(qsetDir = QSET_DIR, schemas = compileSchemas()) {
  const items = new Map();
  if (!fs.existsSync(qsetDir)) throw new UsageError(`Q-set directory not found: ${qsetDir}`);
  const families = fs
    .readdirSync(qsetDir)
    .filter((d) => fs.statSync(path.join(qsetDir, d)).isDirectory())
    .sort();
  for (const family of families) {
    const dir = path.join(qsetDir, family);
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.jsonl'))
      .sort();
    for (const name of files) {
      for (const item of readJsonlValues(path.join(dir, name))) {
        if (!schemas.item(item)) {
          throw new UsageError(`${family}/${name}: item ${item.id || '?'} is not schema-valid`);
        }
        const problems = itemProblems(item, family);
        if (problems.length) throw new UsageError(`${item.id}: ${problems.join('; ')}`);
        if (items.has(item.id)) throw new UsageError(`duplicate item id ${item.id}`);
        items.set(item.id, item);
      }
    }
  }
  if (items.size === 0) throw new UsageError(`no Q-set items under ${qsetDir}`);
  return items;
}

/** Active item count per family; a family is gated at MIN_GATED_ITEMS. */
function activeCounts(items) {
  const counts = new Map();
  for (const item of items.values()) {
    if (item.status !== 'active') continue;
    counts.set(item.family, (counts.get(item.family) || 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Prompt and rule judge
// ---------------------------------------------------------------------------

/** The exact text sent to the target for one item. */
function buildPrompt(item) {
  const parts = [item.input.prompt];
  if (item.input.context) parts.push(`상황 자료:\n${item.input.context}`);
  if (item.input.outputFormat === 'json') {
    const hint = item.input.outputHint ? ` 형식: ${item.input.outputHint}` : '';
    parts.push(`JSON 객체 하나만 답하라. 다른 설명은 쓰지 않는다.${hint}`);
  }
  return parts.join('\n\n');
}

/** Strip one surrounding Markdown code fence, if present. */
function stripFence(text) {
  const match = /^\s*```[A-Za-z0-9_-]*[ \t]*\r?\n([\s\S]*?)\r?\n?```\s*$/.exec(text);
  return match ? match[1] : text;
}

function parseJsonObject(text) {
  try {
    const value = JSON.parse(stripFence(text));
    if (value && typeof value === 'object' && !Array.isArray(value)) return { value };
  } catch (_err) {
    // fall through
  }
  return { error: 'unparseable_output' };
}

function valueAt(obj, dotted) {
  let cur = obj;
  for (const key of dotted.split('.')) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, key)) return undefined;
    cur = cur[key];
  }
  return cur;
}

function checkOk(check, text, json) {
  switch (check.op) {
    case 'regex':
      return new RegExp(check.pattern, check.flags || '').test(text);
    case 'not_regex':
      return !new RegExp(check.pattern, check.flags || '').test(text);
    case 'json_equals':
      return valueAt(json, check.path) === check.value;
    case 'json_in':
      return check.values.includes(valueAt(json, check.path));
    case 'json_includes_all': {
      const v = valueAt(json, check.path);
      return Array.isArray(v) && check.values.every((x) => v.includes(x));
    }
    case 'json_excludes_all': {
      const v = valueAt(json, check.path);
      if (v === undefined) return true; // a missing path counts as an empty array
      return Array.isArray(v) && check.values.every((x) => !v.includes(x));
    }
    default:
      throw new Error(`unknown check op ${check.op}`);
  }
}

/**
 * Judge one output with the item's rule checks.
 * Returns { verdict, score, checks, error? }. A json item whose output does not
 * parse as an object fails every check (verdict fail, error unparseable_output).
 */
function judgeRule(item, output) {
  const checks = item.expected.checks;
  let json = null;
  if (item.input.outputFormat === 'json') {
    const parsed = parseJsonObject(output);
    if (parsed.error) {
      return {
        verdict: 'fail',
        score: 0,
        checks: checks.map((c) => ({ op: c.op, ok: false })),
        error: { type: 'unparseable_output' },
      };
    }
    json = parsed.value;
  }
  const outcomes = checks.map((c) => ({ op: c.op, ok: checkOk(c, output, json) }));
  const passed = outcomes.filter((c) => c.ok).length;
  return {
    verdict: passed === outcomes.length ? 'pass' : 'fail',
    score: Math.round((passed / outcomes.length) * 10000) / 10000,
    checks: outcomes,
  };
}

// ---------------------------------------------------------------------------
// Adapters: call(item, prompt, attempt, timeoutMs) -> Promise<{output}|{error}>
// ---------------------------------------------------------------------------

/**
 * Stub adapter. `outputs` maps item id to a string (every attempt), an array
 * (one entry per attempt, last entry repeats) or an entry `{ "error": type }`
 * with type timeout | adapter_error. An unknown id is an adapter_error.
 */
function stubAdapter(outputs) {
  return {
    name: 'stub',
    async call(item, _prompt, attempt) {
      if (!Object.prototype.hasOwnProperty.call(outputs, item.id)) {
        return { error: 'adapter_error' };
      }
      const entry = outputs[item.id];
      const pick = Array.isArray(entry) ? entry[Math.min(attempt, entry.length) - 1] : entry;
      if (pick && typeof pick === 'object') {
        return { error: pick.error === 'timeout' ? 'timeout' : 'adapter_error' };
      }
      return { output: String(pick) };
    },
  };
}

function loadStubOutputs(file) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new UsageError(`cannot read --stub-outputs ${file}: ${err.message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UsageError('--stub-outputs must be a JSON object keyed by item id');
  }
  return value;
}

/** Command adapter: prompt on stdin, final output text on stdout. No shell. */
function commandAdapter(command, args = []) {
  return {
    name: 'command',
    call(_item, prompt, _attempt, timeoutMs) {
      return new Promise((resolve) => {
        let settled = false;
        let bytes = 0;
        const chunks = [];
        const finish = (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(result);
        };
        let child;
        try {
          child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'] });
        } catch (_err) {
          resolve({ error: 'adapter_error' });
          return;
        }
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          finish({ error: 'timeout' });
        }, timeoutMs);
        child.on('error', () => finish({ error: 'adapter_error' }));
        child.stdout.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > MAX_OUTPUT_BYTES) {
            child.kill('SIGKILL');
            finish({ error: 'adapter_error' });
            return;
          }
          chunks.push(chunk);
        });
        child.on('close', (code) => {
          if (code !== 0) finish({ error: 'adapter_error' });
          else finish({ output: Buffer.concat(chunks).toString('utf8') });
        });
        child.stdin.on('error', () => {}); // target may exit before reading stdin
        child.stdin.end(prompt);
      });
    },
  };
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function gitShortSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_err) {
    return null;
  }
}

/**
 * Run the active items (optionally filtered by family) through an adapter.
 * Returns { runId, records, skipped }. Records are validated, not written.
 */
async function runEval({
  items,
  adapter,
  target,
  families = [],
  attempts = DEFAULT_ATTEMPTS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  qsetCommit,
  runSuffix,
  now = () => new Date(),
  schemas = compileSchemas(),
}) {
  const date = now().toISOString().slice(0, 10);
  const runId = `${date}-${qsetCommit.slice(0, 12)}${runSuffix ? `-${runSuffix}` : ''}`;
  const selected = [...items.values()]
    .filter((item) => item.status === 'active')
    .filter((item) => families.length === 0 || families.includes(item.family))
    .sort((a, b) => a.id.localeCompare(b.id));
  const records = [];
  const skipped = [];
  for (const item of selected) {
    if (item.judge !== 'rule') {
      skipped.push({ itemId: item.id, reason: 'llm judge is slice 3' });
      continue;
    }
    const prompt = buildPrompt(item);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const started = now();
      const t0 = Date.now();
      const result = await adapter.call(item, prompt, attempt, timeoutMs);
      const durationMs = Math.max(0, Date.now() - t0);
      const record = {
        schemaVersion: 'fleet-eval-run-v1',
        runId,
        qsetCommit,
        itemId: item.id,
        family: item.family,
        itemVersion: item.version,
        attempt,
        target,
        judge: { kind: 'rule' },
      };
      if (result.error) {
        Object.assign(record, { verdict: 'error', score: 0, error: { type: result.error } });
      } else {
        const judged = judgeRule(item, result.output);
        Object.assign(record, {
          verdict: judged.verdict,
          score: judged.score,
          checks: judged.checks,
          outputSha256: sha256(result.output),
          outputChars: [...result.output].length,
        });
        if (judged.error) record.error = judged.error;
      }
      record.durationMs = durationMs;
      record.startedAt = started.toISOString();
      if (!schemas.run(record)) {
        throw new Error(`internal: run record for ${item.id} is not schema-valid`);
      }
      const problems = runProblems(record, items);
      if (problems.length) throw new Error(`internal: ${item.id}: ${problems.join('; ')}`);
      records.push(record);
    }
  }
  return { runId, records, skipped };
}

function writeRecords(outDir, runId, records) {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${runId}.jsonl`);
  if (fs.existsSync(file)) {
    throw new UsageError(`${file} already exists; pass --run-suffix to record another run`);
  }
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}

// ---------------------------------------------------------------------------
// Scoring and gate
// ---------------------------------------------------------------------------

/** Passing attempts an item needs: 2 of 3 (ceil of two thirds). */
function requiredPasses(attemptCount) {
  return Math.ceil((attemptCount * 2) / 3);
}

/**
 * Collapse one run's records into per-item outcomes.
 * Returns { runId, lane, items: Map(id -> {family, version, attempts, passes, errors, pass}) }.
 */
function itemOutcomes(records) {
  if (records.length === 0) throw new UsageError('run file has no records');
  const runIds = new Set(records.map((r) => r.runId));
  const lanes = new Set(records.map((r) => r.target.lane));
  if (runIds.size !== 1) throw new UsageError(`run file mixes runIds: ${[...runIds].join(', ')}`);
  if (lanes.size !== 1) throw new UsageError(`run file mixes target lanes: ${[...lanes]}`);
  const out = new Map();
  for (const r of records) {
    const cur = out.get(r.itemId) || {
      family: r.family,
      version: r.itemVersion,
      attempts: 0,
      passes: 0,
      errors: 0,
    };
    if (cur.version !== r.itemVersion) {
      throw new UsageError(`${r.itemId} has records for more than one itemVersion`);
    }
    cur.attempts += 1;
    if (r.verdict === 'pass') cur.passes += 1;
    if (r.verdict === 'error') cur.errors += 1;
    out.set(r.itemId, cur);
  }
  for (const cur of out.values()) cur.pass = cur.passes >= requiredPasses(cur.attempts);
  return { runId: [...runIds][0], lane: [...lanes][0], items: out };
}

function rate(passed, total) {
  return total === 0 ? null : passed / total;
}

/** Per-family summary of one run (used by `run` output). */
function summarize(outcomes, items) {
  const counts = activeCounts(items);
  const fam = new Map();
  for (const o of outcomes.items.values()) {
    const cur = fam.get(o.family) || { items: 0, passed: 0, errorAttempts: 0 };
    cur.items += 1;
    if (o.pass) cur.passed += 1;
    cur.errorAttempts += o.errors;
    fam.set(o.family, cur);
  }
  return [...fam.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, v]) => ({
      family,
      ...v,
      passRate: rate(v.passed, v.items),
      gated: (counts.get(family) || 0) >= MIN_GATED_ITEMS,
    }));
}

/**
 * Compare a candidate run against a baseline run.
 * Only active items with the same version in the Q-set, the baseline and the
 * candidate are compared. A comparable baseline item the candidate did not run
 * fails the gate (so a run cannot skip a family to pass).
 */
function gate(baselineRecords, candidateRecords, items) {
  const base = itemOutcomes(baselineRecords);
  const cand = itemOutcomes(candidateRecords);
  if (base.lane !== cand.lane) {
    throw new UsageError(`target lanes differ: baseline ${base.lane}, candidate ${cand.lane}`);
  }
  const counts = activeCounts(items);
  const gatedFamilies = new Set(
    [...counts.entries()].filter(([, n]) => n >= MIN_GATED_ITEMS).map(([f]) => f)
  );
  const excluded = [];
  const missing = [];
  const families = new Map();
  const ids = new Set([...base.items.keys(), ...cand.items.keys()]);
  for (const id of [...ids].sort()) {
    const item = items.get(id);
    const b = base.items.get(id);
    const c = cand.items.get(id);
    if (!item || item.status !== 'active') {
      excluded.push({ itemId: id, reason: 'not an active Q-set item' });
      continue;
    }
    if (!b) {
      excluded.push({ itemId: id, reason: 'new since baseline' });
      continue;
    }
    if (b.version !== item.version) {
      excluded.push({ itemId: id, reason: `version ${b.version} -> ${item.version}` });
      continue;
    }
    if (!c) {
      missing.push(id);
      continue;
    }
    if (c.version !== item.version) {
      excluded.push({ itemId: id, reason: `candidate ran version ${c.version}` });
      continue;
    }
    const cur = families.get(item.family) || { items: 0, basePassed: 0, candPassed: 0 };
    cur.items += 1;
    if (b.pass) cur.basePassed += 1;
    if (c.pass) cur.candPassed += 1;
    families.set(item.family, cur);
  }
  const rows = [...families.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, v]) => ({
      family,
      gated: gatedFamilies.has(family),
      items: v.items,
      baseline: rate(v.basePassed, v.items),
      candidate: rate(v.candPassed, v.items),
      regressed: v.candPassed < v.basePassed,
      basePassed: v.basePassed,
      candPassed: v.candPassed,
    }));
  const gatedRows = rows.filter((r) => r.gated);
  const overallItems = gatedRows.reduce((n, r) => n + r.items, 0);
  const overall = {
    items: overallItems,
    baseline: rate(
      gatedRows.reduce((n, r) => n + r.basePassed, 0),
      overallItems
    ),
    candidate: rate(
      gatedRows.reduce((n, r) => n + r.candPassed, 0),
      overallItems
    ),
  };
  const reasons = [];
  for (const r of gatedRows) {
    if (r.regressed) reasons.push(`family ${r.family} pass rate dropped`);
  }
  if (overallItems > 0 && overall.candidate < overall.baseline) {
    reasons.push('overall gated pass rate dropped');
  }
  const missingGated = missing.filter((id) => gatedFamilies.has(items.get(id).family));
  if (missingGated.length) reasons.push(`candidate did not run: ${missingGated.join(', ')}`);
  const errorAttempts = (o) => [...o.items.values()].reduce((n, x) => n + x.errors, 0);
  return {
    pass: reasons.length === 0,
    reasons,
    baselineRunId: base.runId,
    candidateRunId: cand.runId,
    lane: base.lane,
    families: rows,
    overall,
    excluded,
    missing,
    errorAttempts: { baseline: errorAttempts(base), candidate: errorAttempts(cand) },
    note: gatedRows.length === 0 ? `no family has ${MIN_GATED_ITEMS} active items yet` : null,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const MULTI = new Set(['family', 'command-arg']);
const FLAGS = new Set(['json']);

function parseArgs(argv) {
  const opts = { family: [], 'command-arg': [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new UsageError(`unexpected argument ${arg}`);
    const key = arg.slice(2);
    if (FLAGS.has(key)) {
      opts[key] = true;
      continue;
    }
    if (i + 1 >= argv.length) throw new UsageError(`--${key} needs a value`);
    const value = argv[(i += 1)];
    if (MULTI.has(key)) opts[key].push(value);
    else opts[key] = value;
  }
  return opts;
}

function intOpt(opts, key, fallback, min, max) {
  if (opts[key] === undefined) return fallback;
  const n = Number(opts[key]);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new UsageError(`--${key} must be an integer in ${min}..${max}`);
  }
  return n;
}

function pct(value) {
  return value === null ? '-' : `${(value * 100).toFixed(1)}%`;
}

const RUN_KEYS = new Set([
  'target-lane',
  'target-model',
  'adapter',
  'stub-outputs',
  'command',
  'command-arg',
  'family',
  'attempts',
  'timeout-ms',
  'out',
  'qset-commit',
  'run-suffix',
  'qset-dir',
]);
const GATE_KEYS = new Set(['baseline', 'candidate', 'qset-dir', 'json']);

function rejectUnknown(opts, allowed) {
  for (const key of Object.keys(opts)) {
    const empty = Array.isArray(opts[key]) && opts[key].length === 0;
    if (!allowed.has(key) && !empty) throw new UsageError(`unknown option --${key}`);
  }
}

async function cmdRun(opts, log) {
  rejectUnknown(opts, RUN_KEYS);
  for (const key of ['target-lane', 'target-model', 'adapter']) {
    if (!opts[key]) throw new UsageError(`--${key} is required`);
  }
  if (!LANE_RE.test(opts['target-lane'])) throw new UsageError('--target-lane is not a lane id');
  let adapter;
  if (opts.adapter === 'stub') {
    if (!opts['stub-outputs']) throw new UsageError('--adapter stub needs --stub-outputs');
    adapter = stubAdapter(loadStubOutputs(opts['stub-outputs']));
  } else if (opts.adapter === 'command') {
    if (!opts.command) throw new UsageError('--adapter command needs --command');
    adapter = commandAdapter(opts.command, opts['command-arg']);
  } else {
    throw new UsageError('--adapter must be stub or command');
  }
  const qsetCommit = opts['qset-commit'] || gitShortSha();
  if (!qsetCommit || !/^[0-9a-f]{7,40}$/.test(qsetCommit)) {
    throw new UsageError('cannot determine the Q-set commit; pass --qset-commit <sha>');
  }
  if (opts['run-suffix'] && !/^[a-z0-9-]+$/.test(opts['run-suffix'])) {
    throw new UsageError('--run-suffix must match [a-z0-9-]+');
  }
  const schemas = compileSchemas();
  const items = loadQset(opts['qset-dir'] || QSET_DIR, schemas);
  const known = new Set([...items.values()].map((i) => i.family));
  for (const f of opts.family) if (!known.has(f)) throw new UsageError(`unknown family ${f}`);
  const result = await runEval({
    items,
    adapter,
    target: { lane: opts['target-lane'], model: opts['target-model'], adapter: adapter.name },
    families: opts.family,
    attempts: intOpt(opts, 'attempts', DEFAULT_ATTEMPTS, 1, MAX_ATTEMPTS),
    timeoutMs: intOpt(opts, 'timeout-ms', DEFAULT_TIMEOUT_MS, 1, 3600000),
    qsetCommit,
    runSuffix: opts['run-suffix'],
    schemas,
  });
  if (result.records.length === 0) throw new UsageError('no rule-judged active items selected');
  const file = writeRecords(opts.out || RUNS_DIR, result.runId, result.records);
  log(`run ${result.runId}: ${result.records.length} records -> ${path.relative(ROOT, file)}`);
  for (const s of result.skipped) log(`SKIP  ${s.itemId} (${s.reason})`);
  for (const row of summarize(itemOutcomes(result.records), items)) {
    log(
      `${row.gated ? 'GATED' : 'info '} ${row.family}: ${row.passed}/${row.items} items ` +
        `(${pct(row.passRate)}), error attempts ${row.errorAttempts}`
    );
  }
  return 0;
}

function cmdGate(opts, log) {
  rejectUnknown(opts, GATE_KEYS);
  if (!opts.baseline || !opts.candidate) {
    throw new UsageError('gate needs --baseline and --candidate');
  }
  const items = loadQset(opts['qset-dir'] || QSET_DIR);
  const report = gate(readJsonlValues(opts.baseline), readJsonlValues(opts.candidate), items);
  if (opts.json) {
    log(JSON.stringify(report, null, 2));
  } else {
    log(`gate ${report.pass ? 'PASS' : 'FAIL'} lane=${report.lane}`);
    log(`baseline ${report.baselineRunId} -> candidate ${report.candidateRunId}`);
    for (const r of report.families) {
      log(
        `${r.gated ? 'GATED' : 'info '} ${r.family}: ${pct(r.baseline)} -> ${pct(r.candidate)}` +
          ` (${r.items} items)${r.regressed ? ' REGRESSED' : ''}`
      );
    }
    log(`overall (gated): ${pct(report.overall.baseline)} -> ${pct(report.overall.candidate)}`);
    log(
      `error attempts: baseline ${report.errorAttempts.baseline}, ` +
        `candidate ${report.errorAttempts.candidate}`
    );
    for (const e of report.excluded) log(`EXCL  ${e.itemId} (${e.reason})`);
    for (const id of report.missing) log(`MISS  ${id}`);
    if (report.note) log(`note: ${report.note}`);
    for (const reason of report.reasons) log(`FAIL  ${reason}`);
  }
  return report.pass ? 0 : 1;
}

async function main(argv = process.argv.slice(2), log = console.log) {
  const [command, ...rest] = argv;
  try {
    const opts = parseArgs(rest);
    if (command === 'run') return await cmdRun(opts, log);
    if (command === 'gate') return cmdGate(opts, log);
    throw new UsageError('usage: fleet-eval.js run|gate [options] (see docs/fleet-eval.md)');
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    log(`ERR   ${err.message}`);
    return 2;
  }
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err.stack || String(err));
      process.exit(2);
    }
  );
}

module.exports = {
  buildPrompt,
  stripFence,
  judgeRule,
  stubAdapter,
  commandAdapter,
  loadQset,
  runEval,
  writeRecords,
  itemOutcomes,
  requiredPasses,
  summarize,
  gate,
  main,
  MIN_GATED_ITEMS,
};
