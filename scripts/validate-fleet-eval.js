#!/usr/bin/env node
/**
 * Fleet evaluation Q-set validator (#325).
 *
 * Validates Q-set items under fixtures/fleet-eval/qset/<family>/*.jsonl and
 * run records under fixtures/fleet-eval/runs/*.jsonl plus the format examples
 * in fixtures/fleet-eval/examples/. Besides the JSON schemas it enforces the
 * cross-field rules a schema cannot express (see docs/fleet-eval.md):
 *
 * - an item's family matches its directory and its id prefix; ids are unique
 * - rule check patterns compile
 * - no credential material or personal contact data in any item string
 * - a run record references a known item, family, version and judge kind
 * - a rule-judged run lists one check outcome per item check, in order
 * - an llm judge never runs on the target's own lane (no self-evaluation)
 */
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const { SECRET_VALUE_PATTERNS } = require('./lib/secret-patterns');

const ROOT = path.resolve(__dirname, '..');
const EVAL_DIR = path.join(ROOT, 'fixtures', 'fleet-eval');
const QSET_DIR = path.join(EVAL_DIR, 'qset');
const RUN_DIRS = [path.join(EVAL_DIR, 'runs'), path.join(EVAL_DIR, 'examples')];

// Personal contact data that must never be pasted into an item.
const PERSONAL_PATTERNS = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, // e-mail address
  /\b01[016789][- ]?\d{3,4}[- ]?\d{4}\b/, // Korean mobile number
];

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function compileSchemas() {
  const ajv = new Ajv({ allErrors: true, verbose: true });
  addFormats(ajv);
  return {
    item: ajv.compile(loadJson(path.join(EVAL_DIR, 'qset-record.schema.json'))),
    run: ajv.compile(loadJson(path.join(EVAL_DIR, 'run-record.schema.json'))),
  };
}

function formatErrors(errors) {
  return (errors || [])
    .map((error) => `${error.instancePath || '(root)'} ${error.message || 'invalid'}`)
    .join('; ');
}

function jsonlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .map((name) => path.join(dir, name));
}

function readJsonl(file) {
  const out = [];
  fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (!line.trim()) return;
      try {
        out.push({ line: index + 1, value: JSON.parse(line) });
      } catch (err) {
        out.push({ line: index + 1, parseError: err.message });
      }
    });
  return out;
}

function collectStrings(value, acc = []) {
  if (typeof value === 'string') acc.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, acc));
  else if (value && typeof value === 'object')
    Object.values(value).forEach((v) => collectStrings(v, acc));
  return acc;
}

/** Cross-field problems of one schema-valid item (empty array: fine). */
function itemProblems(item, dirFamily) {
  const problems = [];
  if (dirFamily && item.family !== dirFamily) {
    problems.push(`family ${item.family} does not match directory ${dirFamily}`);
  }
  if (!item.id.startsWith(`${item.family}-`)) {
    problems.push(`id ${item.id} does not start with family ${item.family}-`);
  }
  for (const check of (item.expected && item.expected.checks) || []) {
    if (check.op !== 'regex' && check.op !== 'not_regex') continue;
    try {
      new RegExp(check.pattern, check.flags || '');
    } catch (err) {
      problems.push(`check pattern does not compile: ${err.message}`);
    }
  }
  for (const text of collectStrings(item)) {
    if (SECRET_VALUE_PATTERNS.some((re) => re.test(text))) {
      problems.push('credential-like value in item text');
      break;
    }
    if (PERSONAL_PATTERNS.some((re) => re.test(text))) {
      problems.push('personal contact data in item text');
      break;
    }
  }
  return problems;
}

/** Cross-field problems of one schema-valid run record against the item index. */
function runProblems(run, items) {
  const problems = [];
  if (run.judge.kind === 'llm' && run.judge.lane === run.target.lane) {
    problems.push(`llm judge lane ${run.judge.lane} equals target lane (self-evaluation)`);
  }
  const item = items.get(run.itemId);
  if (!item) {
    problems.push(`unknown itemId ${run.itemId}`);
    return problems;
  }
  if (item.family !== run.family)
    problems.push(`family ${run.family} != item family ${item.family}`);
  if (item.version !== run.itemVersion) {
    problems.push(`itemVersion ${run.itemVersion} != item version ${item.version}`);
  }
  if (item.judge !== run.judge.kind)
    problems.push(`judge ${run.judge.kind} != item judge ${item.judge}`);
  if (run.judge.kind === 'rule' && run.verdict !== 'error') {
    const expectedOps = item.expected.checks.map((c) => c.op);
    const gotOps = (run.checks || []).map((c) => c.op);
    if (expectedOps.join(',') !== gotOps.join(',')) {
      problems.push(`check outcomes [${gotOps}] do not match item checks [${expectedOps}]`);
    } else {
      const allOk = run.checks.every((c) => c.ok);
      if (allOk !== (run.verdict === 'pass')) {
        problems.push(`verdict ${run.verdict} inconsistent with check outcomes`);
      }
    }
  }
  return problems;
}

function validate({ qsetDir = QSET_DIR, runDirs = RUN_DIRS, log = console.log } = {}) {
  const schemas = compileSchemas();
  const items = new Map();
  const counts = { items: 0, active: 0, runs: 0, errors: 0 };
  const fail = (where, msg) => {
    counts.errors += 1;
    log(`ERR   ${where} ${msg}`);
  };

  const families = fs.existsSync(qsetDir)
    ? fs.readdirSync(qsetDir).filter((d) => fs.statSync(path.join(qsetDir, d)).isDirectory())
    : [];
  for (const family of families.sort()) {
    for (const file of jsonlFiles(path.join(qsetDir, family))) {
      const rel = path.relative(ROOT, file);
      for (const entry of readJsonl(file)) {
        const where = `${rel}:${entry.line}`;
        counts.items += 1;
        if (entry.parseError) {
          fail(where, `invalid JSON: ${entry.parseError}`);
          continue;
        }
        const item = entry.value;
        if (!schemas.item(item)) {
          fail(where, `schema: ${formatErrors(schemas.item.errors)}`);
          continue;
        }
        if (items.has(item.id)) {
          fail(where, `duplicate id: ${item.id}`);
          continue;
        }
        const problems = itemProblems(item, family);
        if (problems.length) {
          problems.forEach((p) => fail(where, p));
          continue;
        }
        items.set(item.id, item);
        if (item.status === 'active') counts.active += 1;
        log(`OK    ${where} ${item.id}`);
      }
    }
  }

  for (const dir of runDirs) {
    for (const file of jsonlFiles(dir)) {
      const rel = path.relative(ROOT, file);
      for (const entry of readJsonl(file)) {
        const where = `${rel}:${entry.line}`;
        counts.runs += 1;
        if (entry.parseError) {
          fail(where, `invalid JSON: ${entry.parseError}`);
          continue;
        }
        const run = entry.value;
        if (!schemas.run(run)) {
          fail(where, `schema: ${formatErrors(schemas.run.errors)}`);
          continue;
        }
        const problems = runProblems(run, items);
        if (problems.length) {
          problems.forEach((p) => fail(where, p));
          continue;
        }
        log(`OK    ${where} ${run.runId} ${run.itemId}#${run.attempt}`);
      }
    }
  }

  if (counts.items === 0) fail('fixtures/fleet-eval/qset', 'no Q-set items found');
  return counts;
}

function main() {
  const counts = validate();
  console.log('\n--- Fleet eval summary ---');
  console.log(`Items:   ${counts.items} (active ${counts.active})`);
  console.log(`Runs:    ${counts.runs}`);
  console.log(`Errors:  ${counts.errors}`);
  process.exit(counts.errors > 0 ? 1 : 0);
}

if (require.main === module) main();

module.exports = { validate, itemProblems, runProblems, compileSchemas };
