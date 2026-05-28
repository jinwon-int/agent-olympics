#!/usr/bin/env node
/**
 * Agent Olympics Schema Validator
 *
 * Validates Task Envelope, Result Packet, Run Result, Trace Record,
 * Evidence Bundle, and Judge Record YAML/JSON files against their
 * JSON Schema definitions, plus cross-field semantic checks.
 *
 * Usage:
 *   node scripts/validate.js envelopes        — validate all task envelopes
 *   node scripts/validate.js packets          — validate all result packets
 *   node scripts/validate.js traces           — validate all trace records
 *   node scripts/validate.js bundles          — validate all evidence bundles
 *   node scripts/validate.js runs             — validate all run results
 *   node scripts/validate.js judges           — validate all judge records
 *   node scripts/validate.js all              — validate all known types
 *   node scripts/validate.js <single-file>    — validate one file (auto-detect)
 *
 * Exit code: 0 = all valid, 1 = any validation failed.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Load schemas
// ---------------------------------------------------------------------------
const schemas = {
  'task-envelope':    loadSchema('schemas/task-envelope.schema.json'),
  'result-packet':    loadSchema('schemas/result-packet.schema.json'),
  'judge-record':     loadSchema('schemas/judge-record.schema.json'),
  'trace-record':     loadSchema('schemas/trace-record.schema.json'),
  'evidence-bundle':  loadSchema('schemas/evidence-bundle.schema.json'),
  'run-result':       loadSchema('schemas/run-result.schema.json'),
};

const ajv = new Ajv({ allErrors: true, verbose: true });
// Register all schemas so cross-$ref works
for (const [name, schema] of Object.entries(schemas)) {
  ajv.addSchema(schema, schema.$id || name);
}

addFormats(ajv);

const validateEnvelope       = ajv.getSchema(schemas['task-envelope'].$id);
const validatePacket         = ajv.getSchema(schemas['result-packet'].$id);
const validateJudge          = ajv.getSchema(schemas['judge-record'].$id);
const validateTrace          = ajv.getSchema(schemas['trace-record'].$id);
const validateBundle         = ajv.getSchema(schemas['evidence-bundle'].$id);
const validateRunResult      = ajv.getSchema(schemas['run-result'].$id);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function loadSchema(relPath) {
  const raw = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  return JSON.parse(raw);
}

function loadYaml(relPath) {
  const full = path.resolve(relPath);
  if (!fs.existsSync(full)) {
    throw new Error(`File not found: ${relPath}`);
  }
  return yaml.load(fs.readFileSync(full, 'utf8'));
}

function formatErrors(errors) {
  return errors.map(e => {
    const field = e.instancePath || '(root)';
    const msg = e.message || 'invalid';
    const extra = e.params ? JSON.stringify(e.params) : '';
    return `  ${field}: ${msg} ${extra}`.trim();
  }).join('\n');
}

// ---------------------------------------------------------------------------
// Semantic (cross-field) checks
// ---------------------------------------------------------------------------
const SEVERITY = { error: 'ERROR', warn: 'WARN' };

function semanticChecks(doc, kind, file) {
  const issues = [];

  if (kind === 'result-packet' || kind === 'run-result') {
    const rp = kind === 'run-result' ? (doc.result_packet || doc) : doc;

    // Evidence IDs must be unique
    if (rp.evidence) {
      const ids = rp.evidence.map(e => e.id);
      const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
      if (dups.length) {
        issues.push({ severity: SEVERITY.error, msg: `Duplicate evidence IDs: ${[...new Set(dups)].join(', ')}` });
      }
    }

    // Findings must reference evidence IDs that exist
    if (rp.findings && rp.evidence) {
      const validIds = new Set(rp.evidence.map(e => e.id));
      for (const f of rp.findings) {
        if (f.evidence) {
          for (const ref of f.evidence) {
            if (!validIds.has(ref)) {
              issues.push({ severity: SEVERITY.warn, msg: `Finding "${f.claim?.slice(0, 50)}..." references unknown evidence ID: ${ref}` });
            }
          }
        }
      }
    }

    // Action evidence references
    if (rp.actions && rp.actions.length && rp.evidence) {
      const validIds = new Set(rp.evidence.map(e => e.id));
      for (const a of rp.actions) {
        if (a.evidence_id && !validIds.has(a.evidence_id)) {
          issues.push({ severity: SEVERITY.warn, msg: `Action "${a.id}" references unknown evidence ID: ${a.evidence_id}` });
        }
      }
    }

    // Timestamps: ended_at should be >= started_at
    if (rp.started_at && rp.ended_at) {
      const start = new Date(rp.started_at);
      const end   = new Date(rp.ended_at);
      if (!isNaN(start) && !isNaN(end) && end < start) {
        issues.push({ severity: SEVERITY.error, msg: `ended_at (${rp.ended_at}) is before started_at (${rp.started_at})` });
      }
    }

    // Check for forbidden patterns (potential secret leaks)
    detectSecrets(rp, issues);
  }

  if (kind === 'evidence-bundle') {
    // Check for duplicate evidence item IDs
    if (doc.items) {
      const ids = doc.items.map(e => e.id);
      const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
      if (dups.length) {
        issues.push({ severity: SEVERITY.error, msg: `Duplicate evidence item IDs: ${[...new Set(dups)].join(', ')}` });
      }
    }
    detectSecrets(doc, issues);
  }

  if (kind === 'trace-record') {
    // Check for duplicate seq numbers
    if (doc.entries) {
      const seqs = doc.entries.map(e => e.seq);
      const dups = seqs.filter((s, i) => seqs.indexOf(s) !== i);
      if (dups.length) {
        issues.push({ severity: SEVERITY.warn, msg: `Duplicate entry seq numbers: ${[...new Set(dups)].join(', ')}` });
      }
      // Check entries are in seq order
      for (let i = 1; i < doc.entries.length; i++) {
        if (doc.entries[i].seq < doc.entries[i - 1].seq) {
          issues.push({ severity: SEVERITY.warn, msg: `Entries out of sequence order at index ${i}: seq ${doc.entries[i].seq} after ${doc.entries[i - 1].seq}` });
          break;
        }
      }
    }
    detectSecrets(doc, issues);
  }

  if (kind === 'run-result') {
    // Check run_id consistency across sub-documents
    const runId = doc.run_id;
    if (doc.trace && doc.trace.trace_id && !doc.trace.run_id) {
      // trace run_id should match or be absent (inherited)
    }
    if (doc.evidence_bundle && doc.evidence_bundle.bundle_id && !doc.evidence_bundle.run_id) {
      // bundle run_id should match or be absent
    }
    detectSecrets(doc, issues);
  }

  if (kind === 'task-envelope') {
    // Check allowed_actions and forbidden_actions aren't empty
    if (!doc.allowed_actions || doc.allowed_actions.length === 0) {
      issues.push({ severity: SEVERITY.error, msg: 'allowed_actions must have at least one entry' });
    }
    if (!doc.forbidden_actions || doc.forbidden_actions.length === 0) {
      issues.push({ severity: SEVERITY.error, msg: 'forbidden_actions must have at least one entry' });
    }

    // Check required_outputs
    if (!doc.required_outputs || doc.required_outputs.length === 0) {
      issues.push({ severity: SEVERITY.error, msg: 'required_outputs must have at least one entry' });
    }

    // Task ID naming convention
    if (doc.task_id && !/^[a-z]+-\d{3}$/.test(doc.task_id)) {
      issues.push({ severity: SEVERITY.warn, msg: `task_id "${doc.task_id}" does not match convention 'family-XXX'` });
    }
  }

  return issues;
}

/** Rudimentary secret/heuristic scan for likely credential patterns. */
function detectSecrets(obj, issues, path = '') {
  if (!obj || typeof obj !== 'object') return;
  const SUSPECT_KEYS = [
    /^api[_-]?key$/i, /^api[_-]?secret$/i,
    /^token$/i, /^password$/i, /^secret$/i,
    /^credential/i, /^auth[_-]?token/i,
    /^private[_-]?key/i, /^access[_-]?key/i,
    /^session[_-]?cookie/i,
  ];
  const SUSPECT_VALUES = [
    /^sk-[a-zA-Z0-9]{20,}/,   // OpenAI-style keys
    /^ghp_[a-zA-Z0-9]{36}/,   // GitHub PAT (legacy)
    /^gho_[a-zA-Z0-9]{36}/,   // GitHub PAT (org)
    /^github_pat_[a-zA-Z0-9]{4,}/,  // GitHub fine-grained PAT
    /^xox[baprs]-/,            // Slack tokens
    /^-----BEGIN (RSA |EC )?PRIVATE KEY-----/,
  ];

  for (const [key, val] of Object.entries(obj)) {
    const fp = path ? `${path}.${key}` : key;
    if (typeof val === 'string') {
      // Check key names
      if (SUSPECT_KEYS.some(r => r.test(key))) {
        issues.push({ severity: SEVERITY.warn, msg: `Potential secret exposure in "${fp}": key name suggests credentials` });
      }
      // Check values
      if (SUSPECT_VALUES.some(r => r.test(val))) {
        issues.push({ severity: SEVERITY.error, msg: `Secret pattern detected in "${fp}"` });
      }
      // Check for redaction_reason that accidentally contains a secret
      if ((key === 'redaction_reason' || key === 'redaction_rule') &&
          val.length > 200) {
        issues.push({ severity: SEVERITY.warn, msg: `Unusually long ${key} (${val.length} chars) — may contain secret data` });
      }
    } else if (typeof val === 'object' && val !== null) {
      detectSecrets(val, issues, fp);
    }
  }
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------
function findFiles(baseDir, pattern) {
  const results = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') walk(full);
      else if (pattern.test(entry.name)) results.push(full);
    }
  }
  walk(baseDir);
  return results.sort();
}

/**
 * Auto-detect what kind of document a YAML file represents.
 *
 * Detection priority: most-specific fields first. Order matters because
 * a run-result contains a result_packet which shares fields with plain
 * result-packets, and evidence-bundles share fields with other types.
 */
function detectKind(doc) {
  if (!doc || typeof doc !== 'object') return null;

  // Run result: has top-level run_id + result_packet
  if (doc.run_id && doc.result_packet && typeof doc.result_packet === 'object') {
    return 'run-result';
  }

  // Trace record: has trace_id + entries array
  if (doc.trace_id && Array.isArray(doc.entries) && doc.entries.length > 0 &&
      doc.entries[0].seq !== undefined && doc.entries[0].action) {
    return 'trace-record';
  }

  // Evidence bundle: has bundle_id + items
  if (doc.bundle_id && Array.isArray(doc.items) && doc.items.length > 0) {
    return 'evidence-bundle';
  }

  // Judge record: has judge_record_id and score_dimensions
  if (doc.judge_record_id && doc.score_dimensions) {
    return 'judge-record';
  }

  // Result packet: has agent_id + status + evidence array
  if (doc.agent_id && doc.status && Array.isArray(doc.evidence) && doc.evidence.length > 0) {
    return 'result-packet';
  }

  // Task envelope: has objective + allowed_actions + task_id
  if (doc.task_id && doc.objective && Array.isArray(doc.allowed_actions)) {
    return 'task-envelope';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Validation logic
// ---------------------------------------------------------------------------
let totalErrors = 0;
let totalWarnings = 0;
let fileCount = 0;

const VALIDATOR_MAP = {
  'task-envelope':   { validator: validateEnvelope,  schemaName: 'task-envelope' },
  'result-packet':   { validator: validatePacket,    schemaName: 'result-packet' },
  'judge-record':    { validator: validateJudge,     schemaName: 'judge-record' },
  'trace-record':    { validator: validateTrace,     schemaName: 'trace-record' },
  'evidence-bundle': { validator: validateBundle,    schemaName: 'evidence-bundle' },
  'run-result':      { validator: validateRunResult, schemaName: 'run-result' },
};

function validateFile(filePath) {
  const rel = path.relative(ROOT, filePath);
  let doc;
  try {
    doc = loadYaml(filePath);
  } catch (err) {
    console.error(`FAIL  ${rel}  — YAML parse error: ${err.message}`);
    totalErrors++;
    fileCount++;
    return;
  }

  if (doc === null || doc === undefined) {
    console.error(`FAIL  ${rel}  — empty document`);
    totalErrors++;
    fileCount++;
    return;
  }

  const kind = detectKind(doc);
  if (!kind) {
    console.warn(`SKIP  ${rel}  — unknown document kind, skipping`);
    fileCount++;
    return;
  }

  const entry = VALIDATOR_MAP[kind];
  const validator = entry ? entry.validator : null;
  const schemaName = entry ? entry.schemaName : kind;

  // Schema validation
  const schemaValid = validator ? validator(doc) : false;
  const schemaErrors = validator ? validator.errors : [];

  // Semantic checks
  const semantic = semanticChecks(doc, kind, rel);

  // Report
  const hasSchemaIssues = !schemaValid;
  const hasSemanticIssues = semantic.length > 0;
  const hasErrors = hasSchemaIssues || semantic.some(s => s.severity === SEVERITY.error);

  if (!hasErrors) {
    const warnCount = semantic.filter(s => s.severity === SEVERITY.warn).length;
    if (warnCount > 0) {
      console.log(`OK    ${rel}  (${kind}) — ${warnCount} warning(s)`);
    } else {
      console.log(`OK    ${rel}  (${kind})`);
    }
  } else {
    if (hasSchemaIssues) {
      console.error(`FAIL  ${rel}  — schema errors (${schemaName}):`);
      console.error(formatErrors(schemaErrors));
      totalErrors++;
    }
    for (const issue of semantic) {
      const prefix = issue.severity === SEVERITY.error ? 'FAIL' : 'WARN';
      const label = issue.severity === SEVERITY.error ? '  error' : '  warn';
      console.error(`${prefix}  ${rel}  — ${label}: ${issue.msg}`);
      if (issue.severity === SEVERITY.error) totalErrors++;
      else totalWarnings++;
    }
  }
  fileCount++;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  let mode = args[0] || 'all';

  const validModes = ['envelopes', 'packets', 'traces', 'bundles', 'runs', 'judges', 'all'];
  if (!validModes.includes(mode) && !fs.existsSync(mode)) {
    console.error(`Usage: node scripts/validate.js <envelopes|packets|traces|bundles|runs|judges|all|file>`);
    process.exit(1);
  }

  const tasksDir = path.join(ROOT, 'tasks');
  const resultsDir = path.join(ROOT, 'results');
  const schemasDir = path.join(ROOT, 'schemas');

  let files = [];

  if (fs.existsSync(mode)) {
    // Single file mode
    files = [path.resolve(mode)];
  } else if (mode === 'envelopes' || mode === 'all') {
    files = files.concat(findFiles(tasksDir, /\.ya?ml$/));
  }

  if (mode === 'packets' || mode === 'all') {
    // Result packets live in results/ (but exclude known judge records)
    const allResults = findFiles(resultsDir, /\.ya?ml$/);
    for (const f of allResults) {
      const doc = loadYaml(f);
      const kind = detectKind(doc);
      if (kind === 'result-packet' || kind === 'run-result') {
        files.push(f);
      }
    }
  }

  if (mode === 'traces' || mode === 'all') {
    const allResults = findFiles(resultsDir, /\.ya?ml$/);
    for (const f of allResults) {
      const doc = loadYaml(f);
      const kind = detectKind(doc);
      if (kind === 'trace-record') {
        files.push(f);
      }
    }
  }

  if (mode === 'bundles' || mode === 'all') {
    const allResults = findFiles(resultsDir, /\.ya?ml$/);
    for (const f of allResults) {
      const doc = loadYaml(f);
      const kind = detectKind(doc);
      if (kind === 'evidence-bundle') {
        files.push(f);
      }
    }
  }

  if (mode === 'runs' || mode === 'all') {
    const allResults = findFiles(resultsDir, /\.ya?ml$/);
    for (const f of allResults) {
      const doc = loadYaml(f);
      const kind = detectKind(doc);
      if (kind === 'run-result') {
        files.push(f);
      }
    }
  }

  if (mode === 'judges' || mode === 'all') {
    files = files.concat(findFiles(resultsDir, /\.ya?ml$/));
  }

  // Deduplicate
  files = [...new Set(files)];

  if (files.length === 0) {
    console.log('No files matched.');
    process.exit(0);
  }

  console.log(`Validating ${files.length} file(s)...\n`);

  for (const f of files) {
    validateFile(f);
  }

  console.log(`\n--- Summary ---`);
  console.log(`Files:     ${fileCount}`);
  console.log(`Errors:    ${totalErrors}`);
  console.log(`Warnings:  ${totalWarnings}`);

  process.exit(totalErrors > 0 ? 1 : 0);
}

main();
