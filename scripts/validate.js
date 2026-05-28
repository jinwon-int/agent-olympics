#!/usr/bin/env node
/**
 * Agent Olympics Schema Validator (v1 + v2)
 *
 * Validates Task Envelope, Result Packet, and Judge Record YAML files
 * against their JSON Schema definitions (v1 or v2), plus cross-field
 * semantic checks.
 *
 * Usage:
 *   node scripts/validate.js envelopes          — validate all task envelopes (v1)
 *   node scripts/validate.js envelopes-v2       — validate v2-only task envelopes
 *   node scripts/validate.js packets            — validate all result packets
 *   node scripts/validate.js packets-v2         — validate v2-only result packets
 *   node scripts/validate.js judges             — validate all judge records
 *   node scripts/validate.js judges-v2          — validate v2-only judge records
 *   node scripts/validate.js all                — validate everything (v1 + v2)
 *   node scripts/validate.js all-v2             — validate only v2 documents
 *   node scripts/validate.js oracle             — validate oracle answer key files
 *   node scripts/validate.js <single-file>      — validate one file (auto-detect)
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
// Load schemas (v1)
// ---------------------------------------------------------------------------
const v1Schemas = {
  'task-envelope': loadSchema('schemas/task-envelope.schema.json'),
  'result-packet': loadSchema('schemas/result-packet.schema.json'),
  'judge-record':  loadSchema('schemas/judge-record.schema.json'),
};

// ---------------------------------------------------------------------------
// Load schemas (v2)
// ---------------------------------------------------------------------------
let v2Schemas = {};
for (const [name, relPath] of Object.entries({
  'task-envelope': 'schemas/task-envelope-v2.schema.json',
  'result-packet': 'schemas/result-packet-v2.schema.json',
  'judge-record':  'schemas/judge-record-v2.schema.json',
})) {
  try {
    v2Schemas[name] = loadSchema(relPath);
  } catch {
    v2Schemas[name] = null;
  }
}

const ajv = new Ajv({ allErrors: true, verbose: true });

// Register v1 schemas
for (const [name, schema] of Object.entries(v1Schemas)) {
  ajv.addSchema(schema, schema.$id || `v1/${name}`);
}

// Register v2 schemas (different $id, no conflict)
for (const [name, schema] of Object.entries(v2Schemas)) {
  if (schema) {
    ajv.addSchema(schema, schema.$id || `v2/${name}`);
  }
}

addFormats(ajv);

const v1Validators = {
  'task-envelope': ajv.getSchema(v1Schemas['task-envelope'].$id),
  'result-packet': ajv.getSchema(v1Schemas['result-packet'].$id),
  'judge-record':  ajv.getSchema(v1Schemas['judge-record'].$id),
};

const v2Validators = {};
for (const name of Object.keys(v2Schemas)) {
  const schema = v2Schemas[name];
  v2Validators[name] = schema ? ajv.getSchema(schema.$id) : null;
}

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

function semanticChecks(doc, kind, file, schemaVersion) {
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

    // v2: oracle_ref should reference an existing file
    if (schemaVersion === 2 && doc.oracle_ref) {
      const oraclePath = path.join(ROOT, doc.oracle_ref);
      if (!fs.existsSync(oraclePath)) {
        issues.push({ severity: SEVERITY.warn, msg: `oracle_ref "${doc.oracle_ref}" does not exist on disk` });
      }
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

    // v1: hidden_judge_notes should be present in well-formed envelopes
    if (schemaVersion === 1 && !doc.hidden_judge_notes) {
      issues.push({ severity: SEVERITY.warn, msg: 'v1 envelope missing hidden_judge_notes (participants should not see this, but it aids judging)' });
    }

    // v2: hidden_judge_notes must not appear
    if (schemaVersion === 2 && doc.hidden_judge_notes) {
      issues.push({ severity: SEVERITY.error, msg: 'v2 envelope must not contain hidden_judge_notes; use judge_notes_ref and oracle_ref instead' });
    }

    // v2: judge_notes_ref and oracle_ref should reference existing files
    if (schemaVersion === 2) {
      if (!doc.judge_notes_ref && !doc.oracle_ref) {
        issues.push({ severity: SEVERITY.warn, msg: 'v2 envelope should have at least one of judge_notes_ref or oracle_ref' });
      }
      if (doc.judge_notes_ref) {
        const refPath = path.join(ROOT, doc.judge_notes_ref);
        if (!fs.existsSync(refPath)) {
          issues.push({ severity: SEVERITY.warn, msg: `judge_notes_ref "${doc.judge_notes_ref}" does not exist on disk` });
        }
      }
      if (doc.oracle_ref) {
        const refPath = path.join(ROOT, doc.oracle_ref);
        if (!fs.existsSync(refPath)) {
          issues.push({ severity: SEVERITY.warn, msg: `oracle_ref "${doc.oracle_ref}" does not exist on disk` });
        }
      }
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

  if (kind === 'judge-record') {
    // v2: oracle_ref should reference an existing file
    if (schemaVersion === 2 && doc.oracle_ref) {
      const oraclePath = path.join(ROOT, doc.oracle_ref);
      if (!fs.existsSync(oraclePath)) {
        issues.push({ severity: SEVERITY.warn, msg: `oracle_ref "${doc.oracle_ref}" does not exist on disk` });
      }
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

/**
 * Detect oracle answer key files (oracle_schema_version marker).
 */
function detectOracle(doc) {
  if (!doc || typeof doc !== 'object') return false;
  return doc.oracle_schema_version !== undefined && doc.oracle_id !== undefined;
}

/**
 * Resolve schema version from document, defaulting to 1 if not present.
 */
function getSchemaVersion(doc) {
  if (doc && typeof doc.schema_version === 'number') {
    return doc.schema_version;
  }
  return 1;
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

  const schemaVersion = getSchemaVersion(doc);

  // Select validator based on schema version
  let validator, schemaName;
  const validators = schemaVersion === 2 ? v2Validators : v1Validators;
  const versionLabel = schemaVersion === 2 ? 'v2' : 'v1';

  if (kind === 'task-envelope') {
    validator = validators['task-envelope'];
    schemaName = `task-envelope-${versionLabel}`;
  } else if (kind === 'result-packet') {
    validator = validators['result-packet'];
    schemaName = `result-packet-${versionLabel}`;
  } else if (kind === 'judge-record') {
    validator = validators['judge-record'];
    schemaName = `judge-record-${versionLabel}`;
  }

  // Schema validation
  let schemaValid = true;
  let schemaErrors = null;
  if (validator) {
    schemaValid = validator(doc);
    schemaErrors = validator.errors;
  } else {
    if (schemaVersion === 2) {
      console.error(`FAIL  ${rel}  — v2 schema not loaded for ${kind}`);
      totalErrors++;
      fileCount++;
      return;
    }
  }

  // Semantic checks
  const semantic = semanticChecks(doc, kind, rel, schemaVersion);

  // Report
  const hasSchemaIssues = !schemaValid;
  const hasSemanticIssues = semantic.length > 0;

  if (!hasSchemaIssues && !hasSemanticIssues) {
    console.log(`OK    ${rel}  (${kind} ${versionLabel})`);
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
      console.log(`OK    ${rel}  (${kind} ${versionLabel}) — see warnings above`);
    }
  }
  fileCount++;
}

/**
 * Validate an oracle answer key file.
 */
function validateOracle(filePath) {
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

  if (!doc || typeof doc !== 'object') {
    console.error(`FAIL  ${rel}  — empty or invalid document`);
    totalErrors++;
    fileCount++;
    return;
  }

  if (!detectOracle(doc)) {
    console.warn(`SKIP  ${rel}  — not an oracle file (missing oracle_schema_version / oracle_id)`);
    fileCount++;
    return;
  }

  const issues = [];

  // Required fields
  if (!doc.task_id) {
    issues.push({ severity: SEVERITY.error, msg: 'oracle missing task_id' });
  }
  if (!doc.oracle_id) {
    issues.push({ severity: SEVERITY.error, msg: 'oracle missing oracle_id' });
  }
  if (!doc.expected_answer_categories || !Array.isArray(doc.expected_answer_categories)) {
    issues.push({ severity: SEVERITY.error, msg: 'oracle missing expected_answer_categories array' });
  }
  if (!doc.scoring_guidance || typeof doc.scoring_guidance !== 'object') {
    issues.push({ severity: SEVERITY.error, msg: 'oracle missing scoring_guidance object' });
  }

  // Check answer_key_checks
  if (doc.answer_key_checks && Array.isArray(doc.answer_key_checks)) {
    for (const check of doc.answer_key_checks) {
      if (!check.question_id || !check.question || !check.expected) {
        issues.push({ severity: SEVERITY.warn, msg: `oracle check "${check.question_id || '(unnamed)'}" missing required fields (question_id, question, expected)` });
      }
    }
  }

  const hasIssues = issues.filter(i => i.severity === SEVERITY.error).length > 0;

  for (const issue of issues) {
    const prefix = issue.severity === SEVERITY.error ? 'FAIL' : 'WARN';
    const label = issue.severity === SEVERITY.error ? '  error' : '  warn';
    console.error(`${prefix}  ${rel}  — ${label}: ${issue.msg}`);
    if (issue.severity === SEVERITY.error) totalErrors++;
    else totalWarnings++;
  }

  if (!hasIssues) {
    console.log(`OK    ${rel}  (oracle)`);
  }
  fileCount++;
}

// ---------------------------------------------------------------------------
// Mode resolution
// ---------------------------------------------------------------------------
const MODES = {
  'envelopes':     { kinds: ['task-envelope'], versions: [1] },
  'envelopes-v2':  { kinds: ['task-envelope'], versions: [2] },
  'packets':       { kinds: ['result-packet'], versions: [1] },
  'packets-v2':    { kinds: ['result-packet'], versions: [2] },
  'judges':        { kinds: ['judge-record'], versions: [1] },
  'judges-v2':     { kinds: ['judge-record'], versions: [2] },
  'all':           { kinds: ['task-envelope', 'result-packet', 'judge-record'], versions: [1, 2] },
  'all-v2':        { kinds: ['task-envelope', 'result-packet', 'judge-record'], versions: [2] },
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  let mode = args[0] || 'all';

  // Oracle mode
  if (mode === 'oracle') {
    const oracleDir = path.join(ROOT, 'oracle');
    const files = fs.existsSync(oracleDir) ? findFiles(oracleDir, /\.ya?ml$/) : [];
    if (files.length === 0) {
      console.log('No oracle files found.');
      process.exit(0);
    }
    console.log(`Validating ${files.length} oracle file(s)...\n`);
    for (const f of files) {
      validateOracle(f);
    }
    console.log(`\n--- Summary ---`);
    console.log(`Files:     ${fileCount}`);
    console.log(`Errors:    ${totalErrors}`);
    console.log(`Warnings:  ${totalWarnings}`);
    process.exit(totalErrors > 0 ? 1 : 0);
  }

  // Single file mode
  if (fs.existsSync(mode)) {
    const files = [path.resolve(mode)];
    console.log(`Validating 1 file...\n`);
    validateFile(files[0]);
    console.log(`\n--- Summary ---`);
    console.log(`Files:     ${fileCount}`);
    console.log(`Errors:    ${totalErrors}`);
    console.log(`Warnings:  ${totalWarnings}`);
    process.exit(totalErrors > 0 ? 1 : 0);
  }

  // Named mode
  const modeConfig = MODES[mode];
  if (!modeConfig) {
    console.error(`Usage: node scripts/validate.js <envelopes|envelopes-v2|packets|packets-v2|judges|judges-v2|all|all-v2|oracle|file>`);
    process.exit(1);
  }

  const tasksDir = path.join(ROOT, 'tasks');
  const resultsDir = path.join(ROOT, 'results');

  let files = [];

  const wantsEnvelopes = modeConfig.kinds.includes('task-envelope');
  const wantsPackets = modeConfig.kinds.includes('result-packet');
  const wantsJudges = modeConfig.kinds.includes('judge-record');

  if (wantsEnvelopes) {
    files = files.concat(findFiles(tasksDir, /\.ya?ml$/));
  }
  if (wantsPackets || wantsJudges) {
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
    const doc = loadYaml(f);
    const sv = getSchemaVersion(doc);
    if (modeConfig.versions.includes(sv)) {
      validateFile(f);
    } else {
      // Skip files with non-matching schema version
    }
  }

  const skippedCount = files.length - fileCount;
  console.log(`\n--- Summary ---`);
  console.log(`Files scanned:  ${files.length}`);
  console.log(`Validated:     ${fileCount}`);
  if (skippedCount > 0) {
    console.log(`Skipped (ver): ${skippedCount}`);
  }
  console.log(`Errors:        ${totalErrors}`);
  console.log(`Warnings:      ${totalWarnings}`);

  process.exit(totalErrors > 0 ? 1 : 0);
}

main();
