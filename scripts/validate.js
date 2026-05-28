#!/usr/bin/env node
/**
 * Agent Olympics Schema Validator
 *
 * Validates Task Envelope and Result Packet YAML files against
 * their JSON Schema definitions, plus cross-field semantic checks.
 *
 * Usage:
 *   node scripts/validate.js envelopes        — validate all task envelopes
 *   node scripts/validate.js packets          — validate all result packets
 *   node scripts/validate.js all              — validate both (default)
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
  'task-envelope': loadSchema('schemas/task-envelope.schema.json'),
  'result-packet': loadSchema('schemas/result-packet.schema.json'),
  'judge-record':  loadSchema('schemas/judge-record.schema.json'),
};

const ajv = new Ajv({ allErrors: true, verbose: true });
// Register all schemas so cross-$ref works
for (const [name, schema] of Object.entries(schemas)) {
  ajv.addSchema(schema, schema.$id || name);
}

addFormats(ajv);

const validateEnvelope  = ajv.getSchema(schemas['task-envelope'].$id);
const validatePacket    = ajv.getSchema(schemas['result-packet'].$id);
const validateJudge     = ajv.getSchema(schemas['judge-record'].$id);

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

  if (kind === 'result-packet') {
    // Evidence IDs must be unique
    if (doc.evidence) {
      const ids = doc.evidence.map(e => e.id);
      const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
      if (dups.length) {
        issues.push({ severity: SEVERITY.error, msg: `Duplicate evidence IDs: ${[...new Set(dups)].join(', ')}` });
      }
    }

    // Findings must reference evidence IDs that exist
    if (doc.findings && doc.evidence) {
      const validIds = new Set(doc.evidence.map(e => e.id));
      for (const f of doc.findings) {
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
    if (doc.actions && doc.actions.length && doc.evidence) {
      const validIds = new Set(doc.evidence.map(e => e.id));
      for (const a of doc.actions) {
        if (a.evidence_id && !validIds.has(a.evidence_id)) {
          issues.push({ severity: SEVERITY.warn, msg: `Action "${a.id}" references unknown evidence ID: ${a.evidence_id}` });
        }
      }
    }

    // Timestamps: ended_at should be >= started_at
    if (doc.started_at && doc.ended_at) {
      const start = new Date(doc.started_at);
      const end   = new Date(doc.ended_at);
      if (!isNaN(start) && !isNaN(end) && end < start) {
        issues.push({ severity: SEVERITY.error, msg: `ended_at (${doc.ended_at}) is before started_at (${doc.started_at})` });
      }
    }

    // Required outputs check
    if (doc.outputs) {
      const keys = Object.keys(doc.outputs);
      // No hard requirement here, just informational
    }

    // Check for forbidden patterns (potential secret leaks)
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

    // Verification tier warning for season-pack tasks
    const tier = doc.tier || 'draft';
    const labels = Array.isArray(doc.labels) ? doc.labels : [];
    const hasSeasonLabel = labels.some(l => /^season-\d{3}$/.test(l));
    if (hasSeasonLabel && tier !== 'verified' && tier !== 'retired') {
      issues.push({
        severity: SEVERITY.warn,
        msg: `season task "${doc.task_id}" has tier="${tier}" — not yet verified for competitive use. Set tier="verified" only after a human or trusted baseline agent completes it and the judge result matches the intended rubric.`
      });
    }

    // Baseline presence recommendation for verified tasks
    if (tier === 'verified' && !doc.baseline) {
      issues.push({
        severity: SEVERITY.warn,
        msg: `task "${doc.task_id}" is tier="verified" but has no baseline record. Add a baseline entry documenting who completed it and which result packet serves as the reference.`
      });
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
    /^ghp_[a-zA-Z0-9]{36}/,   // GitHub PAT
    /^gho_[a-zA-Z0-9]{36}/,
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
 */
function detectKind(doc) {
  if (!doc || typeof doc !== 'object') return null;
  if (doc.task_id && doc.objective && doc.allowed_actions) return 'task-envelope';
  if (doc.task_id && doc.agent_id && doc.status && doc.evidence) return 'result-packet';
  if (doc.task_id && doc.judge_record_id && doc.score_dimensions) return 'judge-record';
  if (doc.task_id && doc.judge_type && doc.verdict) return 'judge-record';
  return null;
}

// ---------------------------------------------------------------------------
// Validation logic
// ---------------------------------------------------------------------------
let totalErrors = 0;
let totalWarnings = 0;
let fileCount = 0;

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

  let validator, schemaName;
  if (kind === 'task-envelope') {
    validator = validateEnvelope;
    schemaName = 'task-envelope';
  } else if (kind === 'result-packet') {
    validator = validatePacket;
    schemaName = 'result-packet';
  } else if (kind === 'judge-record') {
    validator = validateJudge;
    schemaName = 'judge-record';
  }

  // Schema validation
  const schemaValid = validator ? validator(doc) : false;
  const schemaErrors = validator ? validator.errors : [];

  // Semantic checks
  const semantic = semanticChecks(doc, kind, rel);

  // Report
  const hasSchemaIssues = !schemaValid;
  const hasSemanticIssues = semantic.length > 0;

  if (!hasSchemaIssues && !hasSemanticIssues) {
    console.log(`OK    ${rel}  (${kind})`);
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
    if (!hasSchemaIssues && !semantic.some(s => s.severity === SEVERITY.error)) {
      // Only warnings — still count as pass
      console.log(`OK    ${rel}  (${kind}) — see warnings above`);
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

  const validModes = ['envelopes', 'packets', 'judges', 'all'];
  if (!validModes.includes(mode) && !fs.existsSync(mode)) {
    console.error(`Usage: node scripts/validate.js <envelopes|packets|judges|all|file>`);
    process.exit(1);
  }

  const tasksDir = path.join(ROOT, 'tasks');
  const resultsDir = path.join(ROOT, 'results');
  const issuesDir = path.join(ROOT, 'issues');

  let files = [];

  if (fs.existsSync(mode)) {
    // Single file mode
    files = [path.resolve(mode)];
  } else if (mode === 'envelopes' || mode === 'all') {
    files = files.concat(findFiles(tasksDir, /\.ya?ml$/));
  }

  if (mode === 'packets' || mode === 'all') {
    files = files.concat(findFiles(resultsDir, /\.ya?ml$/));
  }

  if (mode === 'judges' || mode === 'all') {
    // Judge records can live alongside result packets or in a dedicated dir
    // For now scan results/ and issues/ for judge records
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
