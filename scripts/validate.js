#!/usr/bin/env node
/**
 * Agent Olympics Schema Validator (v1 + v2)
 *
 * Validates Task Envelope, Result Packet, Run Result, Trace Record,
 * Evidence Bundle, and Judge Record YAML/JSON files against their JSON Schema
 * definitions (v1 or v2 where available), plus cross-field semantic checks.
 *
 * Usage:
 *   node scripts/validate.js envelopes          - validate all task envelopes (v1)
 *   node scripts/validate.js envelopes-v2       - validate v2-only task envelopes
 *   node scripts/validate.js packets            - validate all result packets
 *   node scripts/validate.js packets-v2         - validate v2-only result packets
 *   node scripts/validate.js traces             - validate all trace records
 *   node scripts/validate.js bundles            - validate all evidence bundles
 *   node scripts/validate.js runs               - validate all run results
 *   node scripts/validate.js judges             - validate all judge records
 *   node scripts/validate.js judges-v2          - validate v2-only judge records
 *   node scripts/validate.js smoke              - validate smoke suite envelopes
 *   node scripts/validate.js oracle             - validate oracle answer key files
 *   node scripts/validate.js fixtures           - validate fixture bundle manifests and season fixture manifests
 *   node scripts/validate.js all                - validate all known types
 *   node scripts/validate.js all-v2             - validate only v2 documents
 *   node scripts/validate.js rounds            - validate all round manifests
 *   node scripts/validate.js profiles           - validate all node profile inventory files
 *   node scripts/validate.js <single-file>      - validate one file (auto-detect)
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
  'task-envelope':    loadSchema('schemas/task-envelope.schema.json'),
  'result-packet':    loadSchema('schemas/result-packet.schema.json'),
  'judge-record':     loadSchema('schemas/judge-record.schema.json'),
  'trace-record':     loadSchema('schemas/trace-record.schema.json'),
  'evidence-bundle':  loadSchema('schemas/evidence-bundle.schema.json'),
  'run-result':       loadSchema('schemas/run-result.schema.json'),
};

// ---------------------------------------------------------------------------
// Load fixture schemas
// ---------------------------------------------------------------------------
let fixtureBundleSchema = null;
let seasonFixtureManifestSchema = null;
try {
  fixtureBundleSchema = loadSchema('schemas/fixture-bundle.schema.json');
} catch { /* ignore */ }
try {
  seasonFixtureManifestSchema = loadSchema('schemas/season-fixture-manifest.schema.json');
} catch { /* ignore */ }

// ---------------------------------------------------------------------------
// Load round manifest schema
// ---------------------------------------------------------------------------
let roundManifestSchema = null;
try {
  roundManifestSchema = loadSchema('schemas/round-manifest.schema.json');
} catch { /* ignore */ }

// ---------------------------------------------------------------------------
// Load node profile inventory schema
// ---------------------------------------------------------------------------
let nodeProfileSchema = null;
let nodeProfileValidator = null;
try {
  nodeProfileSchema = loadSchema('schemas/node-profile-inventory.schema.json');
  const npAjv = new Ajv({ allErrors: true, verbose: true });
  addFormats(npAjv);
  nodeProfileValidator = npAjv.compile(nodeProfileSchema);
} catch (e) { /* ignore */ }

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
  'task-envelope':   ajv.getSchema(v1Schemas['task-envelope'].$id),
  'result-packet':   ajv.getSchema(v1Schemas['result-packet'].$id),
  'judge-record':    ajv.getSchema(v1Schemas['judge-record'].$id),
  'trace-record':    ajv.getSchema(v1Schemas['trace-record'].$id),
  'evidence-bundle': ajv.getSchema(v1Schemas['evidence-bundle'].$id),
  'run-result':      ajv.getSchema(v1Schemas['run-result'].$id),
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

    // v2: oracle_ref should reference an existing file
    if (schemaVersion === 2 && doc.oracle_ref) {
      const oraclePath = path.join(ROOT, doc.oracle_ref);
      if (!fs.existsSync(oraclePath)) {
        issues.push({ severity: SEVERITY.warn, msg: `oracle_ref "${doc.oracle_ref}" does not exist on disk` });
      }
    }

    // v2: comparable_metadata checks
    if (schemaVersion === 2) {
      if (doc.comparable_metadata) {
        const cm = doc.comparable_metadata;

        // Check participant block
        if (cm.participant) {
          if (cm.participant.agent_id !== doc.agent_id) {
            issues.push({ severity: SEVERITY.warn, msg: `comparable_metadata.participant.agent_id ("${cm.participant.agent_id}") differs from top-level agent_id ("${doc.agent_id}")` });
          }
        } else {
          issues.push({ severity: SEVERITY.warn, msg: 'v2 result packet missing comparable_metadata.participant block' });
        }

        // Check runtime block matches top-level
        if (cm.runtime) {
          if (cm.runtime.name && cm.runtime.name !== doc.runtime) {
            issues.push({ severity: SEVERITY.warn, msg: `comparable_metadata.runtime.name ("${cm.runtime.name}") differs from top-level runtime ("${doc.runtime}")` });
          }
        } else {
          issues.push({ severity: SEVERITY.warn, msg: 'v2 result packet missing comparable_metadata.runtime block' });
        }

        // Check model block
        if (cm.model) {
          if (cm.model.name && doc.model && cm.model.name !== doc.model) {
            issues.push({ severity: SEVERITY.warn, msg: `comparable_metadata.model.name ("${cm.model.name}") differs from top-level model ("${doc.model}")` });
          }
        } else {
          issues.push({ severity: SEVERITY.warn, msg: 'v2 result packet missing comparable_metadata.model block' });
        }

        // Check node block
        if (cm.node) {
          if (cm.node.profile_ref && doc.node && cm.node.profile_ref !== doc.node) {
            issues.push({ severity: SEVERITY.warn, msg: `comparable_metadata.node.profile_ref ("${cm.node.profile_ref}") differs from top-level node ("${doc.node}")` });
          }
        } else {
          issues.push({ severity: SEVERITY.warn, msg: 'v2 result packet missing comparable_metadata.node block' });
        }

        // Check task block
        if (cm.task) {
          if (cm.task.task_id && cm.task.task_id !== doc.task_id) {
            issues.push({ severity: SEVERITY.warn, msg: `comparable_metadata.task.task_id ("${cm.task.task_id}") differs from top-level task_id ("${doc.task_id}")` });
          }
        } else {
          issues.push({ severity: SEVERITY.warn, msg: 'v2 result packet missing comparable_metadata.task block' });
        }

        // Secret scan inside comparable_metadata
        detectSecrets(cm, issues, 'comparable_metadata');
      } else {
        issues.push({ severity: SEVERITY.warn, msg: 'v2 result packet missing comparable_metadata block' });
      }

      // raw_measurements checks
      if (doc.raw_measurements) {
        if (doc.raw_measurements.wall_time_seconds !== undefined) {
          if (typeof doc.raw_measurements.wall_time_seconds !== 'number' || doc.raw_measurements.wall_time_seconds < 0) {
            issues.push({ severity: SEVERITY.warn, msg: 'raw_measurements.wall_time_seconds should be a non-negative number' });
          }
        }
      }

      // scored_values should not contain secrets
      if (doc.scored_values) {
        detectSecrets(doc.scored_values, issues, 'scored_values');
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

    // Public-facing envelopes MUST NOT contain hidden_judge_notes. Season 001
    // keeps v1 envelopes as private historical/judge material, while v2
    // envelopes are the participant-facing files used for new runs.
    const pubVis = doc.participant_visibility === 'visible' || doc.participant_visibility === 'blind';
    const participantFacingFile = schemaVersion === 2 || file.includes('/public/') || /-v2\.ya?ml$/.test(file);
    if (participantFacingFile && pubVis && doc.hidden_judge_notes) {
      issues.push({
        severity: SEVERITY.error,
        msg: `participant_visibility is "${doc.participant_visibility}" but envelope contains hidden_judge_notes — public envelopes must not expose judge-only material; use judge_notes_ref and oracle_ref instead`
      });
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
        msg: `season task "${doc.task_id}" has tier="${tier}" - not yet verified for competitive use. Set tier="verified" only after a human or trusted baseline agent completes it and the judge result matches the intended rubric.`
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
        issues.push({ severity: SEVERITY.warn, msg: `Unusually long ${key} (${val.length} chars) - may contain secret data` });
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
  if (doc.task_id && doc.judge_type && doc.verdict) {
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

  if (doc.manifest_id && doc.tasks && Array.isArray(doc.tasks) && doc.tasks.length > 0) {
    return 'smoke-manifest';
  }

  // Round manifest: round_id + season + lifecycle + tasks + participants
  if (doc.round_id && doc.season && doc.lifecycle && Array.isArray(doc.tasks) && Array.isArray(doc.participants)) {
    return 'round-manifest';
  }

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

/**
 * Detect fixture bundle manifest files.
 */
function detectFixtureBundle(doc) {
  if (!doc || typeof doc !== 'object') return false;
  return doc.schema_version !== undefined && doc.bundle_id !== undefined
    && doc.season !== undefined && doc.task_id !== undefined
    && doc.files !== undefined && Array.isArray(doc.files);
}

/**
 * Detect season fixture manifest files.
 */
function detectSeasonFixtureManifest(doc) {
  if (!doc || typeof doc !== 'object') return false;
  return doc.schema_version !== undefined && doc.manifest_id !== undefined
    && doc.season !== undefined && doc.bundles !== undefined
    && Array.isArray(doc.bundles);
}

/**
 * Detect round manifest files.
 */
function detectRoundManifest(doc) {
  if (!doc || typeof doc !== 'object') return false;
  return doc.schema_version !== undefined && doc.round_id !== undefined
    && doc.season !== undefined && doc.lifecycle !== undefined
    && Array.isArray(doc.tasks) && Array.isArray(doc.participants);
}

/**
 * Detect node profile inventory files.
 */
function detectNodeProfile(doc) {
  if (!doc || typeof doc !== 'object') return false;
  return doc.schema_version !== undefined
    && doc.profile_id !== undefined
    && doc.profile_class !== undefined
    && doc.os_family !== undefined
    && doc.cpu !== undefined
    && doc.memory_gb !== undefined
    && doc.runner_limits !== undefined
    && doc.storage_class !== undefined
    && doc.network_class !== undefined
    && doc.capability_labels !== undefined;
}

/**
 * Validate a node profile inventory file.
 */
function validateNodeProfile(filePath) {
  const rel = path.relative(ROOT, filePath);
  let doc;
  try {
    doc = loadYaml(filePath);
  } catch (err) {
    console.error(`FAIL  ${rel}  - YAML parse error: ${err.message}`);
    totalErrors++;
    fileCount++;
    return;
  }

  if (!doc || typeof doc !== 'object') {
    console.error(`FAIL  ${rel}  - empty or invalid document`);
    totalErrors++;
    fileCount++;
    return;
  }

  if (!detectNodeProfile(doc)) {
    console.warn(`SKIP  ${rel}  - not a node profile (missing required fields)`);
    fileCount++;
    return;
  }

  const issues = [];

  // Schema validation (if schema loaded)
  if (nodeProfileValidator) {
    const valid = nodeProfileValidator(doc);
    if (!valid) {
      for (const err of nodeProfileValidator.errors) {
        const field = err.instancePath || '(root)';
        const msg = err.message || 'invalid';
        const extra = err.params ? JSON.stringify(err.params) : '';
        issues.push({ severity: SEVERITY.error, msg: `${field}: ${msg} ${extra}`.trim() });
      }
    }
  }

  // Cross-field checks
  if (doc.cpu) {
    if (typeof doc.cpu.cores_min === 'number' && typeof doc.cpu.cores_max === 'number') {
      if (doc.cpu.cores_max < doc.cpu.cores_min) {
        issues.push({ severity: SEVERITY.error, msg: 'cpu.cores_max must be >= cpu.cores_min' });
      }
    }
  }

  if (doc.memory_gb) {
    if (typeof doc.memory_gb.min === 'number' && typeof doc.memory_gb.max === 'number') {
      if (doc.memory_gb.max < doc.memory_gb.min) {
        issues.push({ severity: SEVERITY.error, msg: 'memory_gb.max must be >= memory_gb.min' });
      }
    }
  }

  // Ensure capability_labels is non-empty
  if (Array.isArray(doc.capability_labels) && doc.capability_labels.length === 0) {
    issues.push({ severity: SEVERITY.error, msg: 'capability_labels must have at least one entry' });
  }

  // profile_id must be a safe slug (no hostnames, IPs, or paths)
  if (doc.profile_id) {
    if (!/^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/.test(doc.profile_id)) {
      issues.push({ severity: SEVERITY.error, msg: `profile_id "${doc.profile_id}" must be a safe slug (lowercase, digits, hyphens, underscores only)` });
    }
    // Additional heuristics: profile_id should not look like a hostname or IP
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(doc.profile_id)) {
      issues.push({ severity: SEVERITY.error, msg: `profile_id "${doc.profile_id}" looks like an IP address; use a safe slug instead` });
    }
    if (/^[a-zA-Z0-9-]+\.(com|org|net|io|dev|local|internal)$/.test(doc.profile_id)) {
      issues.push({ severity: SEVERITY.warn, msg: `profile_id "${doc.profile_id}" looks like a hostname or domain; use a safe slug instead` });
    }
  }

  // Check for forbidden secret-like fields anywhere in the document
  detectSecrets(doc, issues);

  // Additional node-profile-specific forbidden pattern detection
  const FORBIDDEN_PROFILE_PATTERNS = [
    { pattern: /\b(\d{1,3}\.){3}\d{1,3}\b/, description: 'IP address' },
    { pattern: /\b(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b/, description: 'potential hostname or domain' },
    { pattern: /\/home\/[a-z_][a-z0-9_-]*/i, description: 'absolute home path' },
    { pattern: /\/etc\/[a-z_][a-z0-9_-]*/i, description: 'absolute system config path' },
    { pattern: /\/root\/\S+/i, description: 'root home path' },
    { pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/, description: 'private key material' },
    { pattern: /sk-[a-zA-Z0-9]{20,}/, description: 'API key pattern' },
  ];

  function scanForbiddenPatterns(obj, objPath = '') {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, val] of Object.entries(obj)) {
      const fp = objPath ? `${objPath}.${key}` : key;
      if (typeof val === 'string') {
        for (const bp of FORBIDDEN_PROFILE_PATTERNS) {
          if (bp.pattern.test(val)) {
            issues.push({ severity: SEVERITY.error, msg: `Forbidden pattern (${bp.description}) detected in "${fp}": value matches sensitive pattern` });
            break;
          }
        }
      } else if (typeof val === 'object' && val !== null) {
        scanForbiddenPatterns(val, fp);
      }
    }
  }
  scanForbiddenPatterns(doc);

  const hasIssues = issues.filter(i => i.severity === SEVERITY.error).length > 0;

  for (const issue of issues) {
    const prefix = issue.severity === SEVERITY.error ? 'FAIL' : 'WARN';
    const label = issue.severity === SEVERITY.error ? '  error' : '  warn';
    console.error(`${prefix}  ${rel}  - ${label}: ${issue.msg}`);
    if (issue.severity === SEVERITY.error) totalErrors++;
    else totalWarnings++;
  }

  if (!hasIssues) {
    console.log(`OK    ${rel}  (node-profile)`);
  }
  fileCount++;
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
    console.error(`FAIL  ${rel}  - YAML parse error: ${err.message}`);
    totalErrors++;
    fileCount++;
    return;
  }

  if (doc === null || doc === undefined) {
    console.error(`FAIL  ${rel}  - empty document`);
    totalErrors++;
    fileCount++;
    return;
  }

  const kind = detectKind(doc);
  if (!kind) {
    console.warn(`SKIP  ${rel}  - unknown document kind, skipping`);
    fileCount++;
    return;
  }

  const schemaVersion = getSchemaVersion(doc);

  // Select validator based on schema version
  let validator, schemaName;
  const validators = schemaVersion === 2 ? v2Validators : v1Validators;
  const versionLabel = schemaVersion === 2 ? 'v2' : 'v1';

  if (kind === 'task-envelope' || kind === 'result-packet' || kind === 'judge-record' ||
      kind === 'trace-record' || kind === 'evidence-bundle' || kind === 'run-result') {
    validator = validators[kind];
    schemaName = `${kind}-${versionLabel}`;
  }

  // Schema validation
  let schemaValid = true;
  let schemaErrors = null;
  if (validator) {
    schemaValid = validator(doc);
    schemaErrors = validator.errors;
  } else {
    if (schemaVersion === 2) {
      console.error(`FAIL  ${rel}  - v2 schema not loaded for ${kind}`);
      totalErrors++;
      fileCount++;
      return;
    }
  }

  // Manifest-specific validation
  if (kind === 'smoke-manifest') {
    // Validate manifest structure
    const taskIds = doc.tasks.map(t => t.task_id);
    const dups = taskIds.filter((id, i) => taskIds.indexOf(id) !== i);
    if (dups.length) {
      console.error(`FAIL  ${rel}  - manifest has duplicate task_ids: ${[...new Set(dups)].join(', ')}`);
      totalErrors++;
    }

    // Check minimum task count (5 required)
    if (doc.tasks.length < 5) {
      console.error(`FAIL  ${rel}  - manifest has ${doc.tasks.length} tasks, minimum is 5`);
      totalErrors++;
    }

    // Check each task has required fields
    for (const task of doc.tasks) {
      const missing = [];
      if (!task.task_id) missing.push('task_id');
      if (!task.title) missing.push('title');
      if (!task.envelope) missing.push('envelope');
      if (missing.length) {
        console.error(`FAIL  ${rel}  - task ${task.task_id || '(no id)'} missing: ${missing.join(', ')}`);
        totalErrors++;
      }
    }

    console.log(`OK    ${rel}  (smoke-manifest)`);
    fileCount++;
    return;
  }

  // Semantic checks
  const semantic = semanticChecks(doc, kind, rel, schemaVersion);

  // Report
  const hasSchemaIssues = !schemaValid;
  const hasSemanticIssues = semantic.length > 0;
  const hasErrors = hasSchemaIssues || semantic.some(s => s.severity === SEVERITY.error);

  if (!hasSchemaIssues && !hasSemanticIssues) {
    console.log(`OK    ${rel}  (${kind} ${versionLabel})`);
  } else {
    if (hasSchemaIssues) {
      console.error(`FAIL  ${rel}  - schema errors (${schemaName}):`);
      console.error(formatErrors(schemaErrors));
      totalErrors++;
    }
    for (const issue of semantic) {
      const prefix = issue.severity === SEVERITY.error ? 'FAIL' : 'WARN';
      const label = issue.severity === SEVERITY.error ? '  error' : '  warn';
      console.error(`${prefix}  ${rel}  - ${label}: ${issue.msg}`);
      if (issue.severity === SEVERITY.error) totalErrors++;
      else totalWarnings++;
    }
    if (!hasSchemaIssues && !semantic.some(s => s.severity === SEVERITY.error)) {
      // Only warnings - still count as pass
      console.log(`OK    ${rel}  (${kind} ${versionLabel}) - see warnings above`);
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
    console.error(`FAIL  ${rel}  - YAML parse error: ${err.message}`);
    totalErrors++;
    fileCount++;
    return;
  }

  if (!doc || typeof doc !== 'object') {
    console.error(`FAIL  ${rel}  - empty or invalid document`);
    totalErrors++;
    fileCount++;
    return;
  }

  if (!detectOracle(doc)) {
    console.warn(`SKIP  ${rel}  - not an oracle file (missing oracle_schema_version / oracle_id)`);
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
    console.error(`${prefix}  ${rel}  - ${label}: ${issue.msg}`);
    if (issue.severity === SEVERITY.error) totalErrors++;
    else totalWarnings++;
  }

  if (!hasIssues) {
    console.log(`OK    ${rel}  (oracle)`);
  }
  fileCount++;
}

/**
 * Validate a fixture bundle manifest or season fixture manifest file.
 */
function validateFixtureBundle(filePath) {
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

  // Determine kind
  const isBundle = detectFixtureBundle(doc);
  const isSeasonManifest = detectSeasonFixtureManifest(doc);

  if (!isBundle && !isSeasonManifest) {
    console.warn(`SKIP  ${rel}  — not a fixture bundle or season manifest (missing bundle_id+season+task_id+files or manifest_id+season+bundles)`);
    fileCount++;
    return;
  }

  const issues = [];
  const kind = isBundle ? 'fixture-bundle' : 'season-fixture-manifest';
  const schema = isBundle ? fixtureBundleSchema : seasonFixtureManifestSchema;

  // Schema validation
  if (schema) {
    const ajv = new Ajv({ allErrors: true, verbose: true });
    const addFormats = require('ajv-formats');
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const valid = validate(doc);
    if (!valid) {
      for (const err of validate.errors) {
        const field = err.instancePath || '(root)';
        const msg = err.message || 'invalid';
        issues.push({ severity: SEVERITY.error, msg: `${field}: ${msg}` });
      }
    }
  }

  if (isBundle) {
    // Bundle non-schema checks
    if (!/^season-\d{3}-[a-z]+-\d{3}-v\d+$/.test(doc.bundle_id)) {
      issues.push({ severity: SEVERITY.warn, msg: `bundle_id "${doc.bundle_id}" does not match convention 'season-XXX-family-NNN-vN'` });
    }

    // Check that referenced files exist relative to the manifest directory
    const bundleDir = path.dirname(filePath);
    for (const f of doc.files) {
      if (f.path && f.path !== '.' && !f.path.endsWith('/')) {
        const fullPath = path.join(bundleDir, f.path);
        if (!fs.existsSync(fullPath)) {
          issues.push({ severity: SEVERITY.warn, msg: `referenced file "${f.path}" does not exist in bundle directory` });
        }
      }
    }
  }

  if (isSeasonManifest) {
    // Season manifest non-schema checks
    if (!/^season-\d{3}-fixtures-v\d+$/.test(doc.manifest_id)) {
      issues.push({ severity: SEVERITY.warn, msg: `manifest_id "${doc.manifest_id}" does not match convention 'season-XXX-fixtures-vN'` });
    }

    // Check that referenced bundle paths exist
    for (const b of doc.bundles) {
      if (b.path) {
        const bundleDir = path.join(ROOT, b.path);
        if (!fs.existsSync(bundleDir)) {
          issues.push({ severity: SEVERITY.warn, msg: `bundle path "${b.path}" does not exist` });
        } else {
          const bundleManifest = path.join(bundleDir, 'manifest.yaml');
          if (!fs.existsSync(bundleManifest)) {
            issues.push({ severity: SEVERITY.warn, msg: `bundle path "${b.path}" is missing manifest.yaml` });
          }
        }
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
    console.log(`OK    ${rel}  (${kind})`);
  }
  fileCount++;
}

/**
 * Validate a round manifest file.
 */
function validateRoundManifest(filePath) {
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

  if (!detectRoundManifest(doc)) {
    console.warn(`SKIP  ${rel}  — not a round manifest (missing round_id, season, lifecycle, tasks, participants)`);
    fileCount++;
    return;
  }

  const issues = [];

  // Schema validation
  if (roundManifestSchema) {
    const ajv = new Ajv({ allErrors: true, verbose: true });
    const addFormats = require('ajv-formats');
    addFormats(ajv);
    const validate = ajv.compile(roundManifestSchema);
    const valid = validate(doc);
    if (!valid) {
      for (const err of validate.errors) {
        const field = err.instancePath || '(root)';
        const msg = err.message || 'invalid';
        issues.push({ severity: SEVERITY.error, msg: `${field}: ${msg}` });
      }
    }
  }

  // round_id format check
  if (doc.round_id && !/^season-\d{3}-round-\d{3}$/.test(doc.round_id)) {
    issues.push({ severity: SEVERITY.warn, msg: `round_id "${doc.round_id}" does not match convention 'season-XXX-round-XXX'` });
  }

  // Lifecycle status
  const validStatuses = ['pending', 'fixture_preparation', 'running', 'completed', 'scored', 'archived'];
  if (doc.lifecycle && !validStatuses.includes(doc.lifecycle.status)) {
    issues.push({ severity: SEVERITY.error, msg: `lifecycle.status "${doc.lifecycle.status}" is not valid; expected one of: ${validStatuses.join(', ')}` });
  }

  // Check referenced envelope paths exist
  for (let i = 0; i < (doc.tasks || []).length; i++) {
    const t = doc.tasks[i];
    if (t.envelope_path) {
      const full = path.resolve(ROOT, t.envelope_path);
      if (!fs.existsSync(full)) {
        issues.push({ severity: SEVERITY.warn, msg: `task #${i + 1} envelope_path "${t.envelope_path}" not found` });
      }
    }
    if (t.fixture_bundle_ref) {
      const full = path.resolve(ROOT, t.fixture_bundle_ref);
      if (!fs.existsSync(full)) {
        issues.push({ severity: SEVERITY.warn, msg: `task #${i + 1} fixture_bundle_ref "${t.fixture_bundle_ref}" not found` });
      }
    }
  }

  // Participant uniqueness
  const agentIds = (doc.participants || []).map(p => p.agent_id);
  const uniqueIds = new Set(agentIds);
  if (uniqueIds.size !== agentIds.length) {
    const dups = agentIds.filter((id, i) => agentIds.indexOf(id) !== i);
    issues.push({ severity: SEVERITY.error, msg: `duplicate participant agent_ids: ${[...new Set(dups)].join(', ')}` });
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
    console.log(`OK    ${rel}  (round-manifest)`);
  }
  fileCount++;
}

// ---------------------------------------------------------------------------
// Mode resolution
// ---------------------------------------------------------------------------
const MODES = {
  'envelopes':     { kinds: ['task-envelope'], versions: [1], roots: ['tasks'] },
  'envelopes-v2':  { kinds: ['task-envelope'], versions: [2], roots: ['tasks'] },
  'packets':       { kinds: ['result-packet', 'run-result'], versions: [1], roots: ['results'] },
  'packets-v2':    { kinds: ['result-packet'], versions: [2], roots: ['results'] },
  'traces':        { kinds: ['trace-record'], versions: [1], roots: ['results'] },
  'bundles':       { kinds: ['evidence-bundle'], versions: [1], roots: ['results'] },
  'runs':          { kinds: ['run-result'], versions: [1], roots: ['results'] },
  'judges':        { kinds: ['judge-record'], versions: [1], roots: ['results'] },
  'judges-v2':     { kinds: ['judge-record'], versions: [2], roots: ['results'] },
  'all':           { kinds: ['task-envelope', 'result-packet', 'run-result', 'trace-record', 'evidence-bundle', 'judge-record'], versions: [1, 2], roots: ['tasks', 'results'] },
  'all-v2':        { kinds: ['task-envelope', 'result-packet', 'judge-record'], versions: [2], roots: ['tasks', 'results'] },
  'smoke':         { kinds: ['task-envelope', 'smoke-manifest'], versions: [1], roots: ['tasks-smoke'] },
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

  // Rounds mode
  if (mode === 'rounds') {
    const roundsDir = path.join(ROOT, 'rounds');
    if (!fs.existsSync(roundsDir)) {
      console.log('No rounds directory found.');
      process.exit(0);
    }
    const files = findFiles(roundsDir, /\.ya?ml$/);
    if (files.length === 0) {
      console.log('No round manifest files found.');
      process.exit(0);
    }
    console.log(`Validating ${files.length} round manifest file(s)...\n`);
    for (const f of files) {
      validateRoundManifest(f);
    }
    console.log(`\n--- Summary ---`);
    console.log(`Files:     ${fileCount}`);
    console.log(`Errors:    ${totalErrors}`);
    console.log(`Warnings:  ${totalWarnings}`);
    process.exit(totalErrors > 0 ? 1 : 0);
  }

  // Profiles mode
  if (mode === 'profiles') {
    const profilesDir = path.join(ROOT, 'fixtures', 'node-profiles');
    if (!fs.existsSync(profilesDir)) {
      console.log('No node-profiles directory found.');
      process.exit(0);
    }
    const files = findFiles(profilesDir, /\.ya?ml$/);
    if (files.length === 0) {
      console.log('No node profile files found.');
      process.exit(0);
    }
    console.log(`Validating ${files.length} node profile file(s)...\n`);
    for (const f of files) {
      validateNodeProfile(f);
    }
    console.log(`\n--- Summary ---`);
    console.log(`Files:     ${fileCount}`);
    console.log(`Errors:    ${totalErrors}`);
    console.log(`Warnings:  ${totalWarnings}`);
    process.exit(totalErrors > 0 ? 1 : 0);
  }

  // Fixtures mode
  if (mode === 'fixtures') {
    const fixturesDir = path.join(ROOT, 'fixtures');
    if (!fs.existsSync(fixturesDir)) {
      console.log('No fixtures directory found.');
      process.exit(0);
    }
    const files = findFiles(fixturesDir, /\.ya?ml$/);
    if (files.length === 0) {
      console.log('No fixture files found.');
      process.exit(0);
    }
    console.log(`Validating ${files.length} fixture file(s)...\n`);
    for (const f of files) {
      validateFixtureBundle(f);
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
    console.error(`Usage: node scripts/validate.js <envelopes|envelopes-v2|packets|packets-v2|traces|bundles|runs|judges|judges-v2|smoke|rounds|fixtures|profiles|oracle|all|all-v2|file>`);
    process.exit(1);
  }

  const tasksDir = path.join(ROOT, 'tasks');
  const resultsDir = path.join(ROOT, 'results');

  let files = [];

  if (modeConfig.roots.includes('tasks-smoke')) {
    const smokeDir = path.join(tasksDir, 'smoke');
    if (fs.existsSync(smokeDir)) {
      files = files.concat(findFiles(smokeDir, /\.ya?ml$/));
    }
  }

  if (modeConfig.roots.includes('tasks')) {
    files = files.concat(findFiles(tasksDir, /\.ya?ml$/));
  }

  if (modeConfig.roots.includes('results')) {
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
    const kind = detectKind(doc);
    const sv = getSchemaVersion(doc);
    if (modeConfig.kinds.includes(kind) && modeConfig.versions.includes(sv)) {
      validateFile(f);
    } else {
      // Skip files with non-matching kind or schema version
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
