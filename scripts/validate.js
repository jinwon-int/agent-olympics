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
 *   node scripts/validate.js live-probe [path]   - validate with enhanced redaction / forbidden-field checks
 *   node scripts/validate.js qualifications    - validate qualification manifests and entry files
 *   node scripts/validate.js accreditations      - validate all accreditation declaration files
 *   node scripts/validate.js accreditations-validity - validate accreditation validity fixtures
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
// Load adapter capability declaration schema
// ---------------------------------------------------------------------------
let adapterCapSchema = null;
let adapterCapValidator = null;
try {
  adapterCapSchema = loadSchema('schemas/adapter-capability-declaration.schema.json');
  const acAjv = new Ajv({ allErrors: true, verbose: true });
  addFormats(acAjv);
  adapterCapValidator = acAjv.compile(adapterCapSchema);
} catch (e) { /* ignore */ }

// ---------------------------------------------------------------------------
// Load oracle schema
// ---------------------------------------------------------------------------
let oracleSchema = null;
let oracleValidator = null;
try {
  oracleSchema = loadSchema('schemas/oracle.schema.json');
  const oracleAjv = new Ajv({ allErrors: true, verbose: true });
  addFormats(oracleAjv);
  oracleValidator = oracleAjv.compile(oracleSchema);
} catch (e) { /* ignore */ }

// ---------------------------------------------------------------------------
// Load qualification entry schema
// ---------------------------------------------------------------------------
let qualificationSchema = null;
let qualificationManifestValidator = null;
let qualificationEntryValidator = null;
try {
  qualificationSchema = loadSchema('schemas/qualification-entry.schema.json');
  const qAjv = new Ajv({ allErrors: true, verbose: true });
  require('ajv-formats')(qAjv);
  // Compile manifest validator from $defs
  const mSchema = JSON.parse(JSON.stringify(qualificationSchema.$defs.qualification_manifest));
  mSchema.$id = 'https://github.com/jinwon-int/agent-olympics/schemas/qualification-manifest';
  qualificationManifestValidator = qAjv.compile(mSchema);
  // Compile entry validator from $defs (standalone file mode)
  const eSchema = JSON.parse(JSON.stringify(qualificationSchema.$defs.qualification_entry));
  eSchema.$id = 'https://github.com/jinwon-int/agent-olympics/schemas/qualification-entry-file';
  qualificationEntryValidator = qAjv.compile(eSchema);
} catch (e) {
  // Schema not available — skip qualification checks
}

// Load accreditation declaration schema
// ---------------------------------------------------------------------------
let accreditationSchema = null;
let accreditationValidator = null;
try {
  accreditationSchema = loadSchema('schemas/accreditation-declaration.schema.json');
  const accAjv = new Ajv({ allErrors: true, verbose: true });
  addFormats(accAjv);
  accreditationValidator = accAjv.compile(accreditationSchema);
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

function profileList(profile, preferredKey, legacyKey) {
  if (!profile || typeof profile !== 'object') return [];
  const preferred = Array.isArray(profile[preferredKey]) ? profile[preferredKey] : [];
  const legacy = Array.isArray(profile[legacyKey]) ? profile[legacyKey] : [];
  return [...new Set([...preferred, ...legacy])];
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

      // Hardened operating-agent-stack fields must be coherent enough for
      // scoring, rule checks, and web-result publication. Schema validation
      // enforces presence/shape; these semantic checks catch cross-field drift.
      const allowedTools = profileList(doc.tool_use_profile, 'classes_allowed', 'allowed');
      const usedTools = profileList(doc.tool_use_profile, 'classes_used', 'used');
      for (const tool of usedTools) {
        if (!allowedTools.includes(tool)) {
          issues.push({ severity: SEVERITY.error, msg: `tool_use_profile lists used tool "${tool}" that is not declared in allowed tools` });
        }
      }
      if (doc.actions && usedTools.length) {
        for (const action of doc.actions) {
          if (action.type && !usedTools.includes(action.type)) {
            issues.push({ severity: SEVERITY.warn, msg: `action "${action.id || '(unnamed)'}" type "${action.type}" is not declared in tool_use_profile used tools` });
          }
        }
      }
      if (doc.validity === 'appealed' && !doc.appeal) {
        issues.push({ severity: SEVERITY.error, msg: 'validity is "appealed" but appeal metadata is missing' });
      }
      if (doc.publishable === true && ['invalid', 'appealed', 'disqualified'].includes(doc.validity)) {
        issues.push({ severity: SEVERITY.error, msg: `publishable=true is not allowed for validity="${doc.validity}"` });
      }
      if (doc.delegation_profile && Array.isArray(doc.delegation_profile.a2a_workers) &&
          doc.delegation_profile.a2a_workers.length > 0 && !doc.delegation_profile.subagents_used) {
        issues.push({ severity: SEVERITY.warn, msg: 'delegation_profile lists a2a_workers while subagents_used=false; confirm delegation disclosure' });
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

  // Result packet: has agent_id + status + evidence array. Negative
  // fixtures may intentionally leave evidence empty, so array presence is
  // enough for type detection.
  if (doc.agent_id && doc.status && Array.isArray(doc.evidence)) {
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
 * Detect accreditation declaration files.
 */
function detectAccreditation(doc) {
  if (!doc || typeof doc !== 'object') return false;
  return doc.schema_version !== undefined && doc.accreditation_id !== undefined
    && doc.subject !== undefined && doc.accreditation_class !== undefined
    && doc.granted_zones !== undefined && doc.delegation_boundary !== undefined;
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
 * Detect adapter capability declaration files.
 */
function detectAdapterCapability(doc) {
  if (!doc || typeof doc !== 'object') return false;
  return doc.schema_version !== undefined && doc.adapter_id !== undefined
    && doc.adapter_type !== undefined && doc.display_name !== undefined
    && doc.status !== undefined && doc.evidence_kinds !== undefined
    && doc.runtime_fields !== undefined && doc.redaction_rules !== undefined;
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
    // Fall through to adapter fixture validation for files in the adapters fixture tree
    const relLower = rel.toLowerCase();
    if (relLower.startsWith('fixtures' + path.sep + 'adapters' + path.sep)) {
      return validateAdapterFixtureFile(filePath);
    }
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

  if (oracleValidator) {
    const valid = oracleValidator(doc);
    if (!valid) {
      for (const err of oracleValidator.errors) {
        const field = err.instancePath || '(root)';
        const msg = err.message || 'invalid';
        const extra = err.params ? JSON.stringify(err.params) : '';
        issues.push({ severity: SEVERITY.error, msg: `${field}: ${msg} ${extra}`.trim() });
      }
    }
  }

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

// ---------------------------------------------------------------------------
// Accreditation validation
// ---------------------------------------------------------------------------

/**
 * Known zone registry loaded from fixtures/accreditation/access-zones.yaml.
 * Used to validate that accreditation declarations reference only defined zones.
 */
let zoneRegistry = null;

function loadZoneRegistry() {
  if (zoneRegistry) return zoneRegistry;
  const zoneFile = path.join(ROOT, 'fixtures', 'accreditation', 'access-zones.yaml');
  if (!fs.existsSync(zoneFile)) return null;
  try {
    const doc = loadYaml(zoneFile);
    if (doc && Array.isArray(doc.zones)) {
      zoneRegistry = new Set(doc.zones.map(z => z.zone_id));
    }
  } catch { /* ignore */ }
  return zoneRegistry;
}

/**
 * Validate an accreditation declaration file against the schema and
 * cross-field semantic rules.
 *
 * Accreditation rules:
 * - Observer class must have can_delegate: false and delegation_scope: "none"
 * - All zone references must exist in the zone registry (when available)
 * - Delegation scope must be from the valid enum
 * - Operating surface types must be from the approved list
 * - Delegation_boundary is required for all classes
 * - No secrets, credentials, or host-specific paths
 */
function validateAccreditation(filePath) {
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

  if (!detectAccreditation(doc)) {
    // Check if it's the zone registry or roles file (which have different shapes)
    if (doc.zone_registry_id || doc.role_registry_id || doc.description === 'Reference examples of delegation boundary configurations per accreditation class') {
      console.warn(`SKIP  ${rel}  - registry/reference file, not an individual accreditation declaration`);
      fileCount++;
      return;
    }
    console.warn(`SKIP  ${rel}  - not an accreditation declaration (missing required fields)`);
    fileCount++;
    return;
  }

  const issues = [];

  // Schema validation
  if (accreditationValidator) {
    const valid = accreditationValidator(doc);
    if (!valid) {
      for (const err of accreditationValidator.errors) {
        const field = err.instancePath || '(root)';
        const msg = err.message || 'invalid';
        const extra = err.params ? JSON.stringify(err.params) : '';
        issues.push({ severity: SEVERITY.error, msg: `${field}: ${msg} ${extra}`.trim() });
      }
    }
  }

  // Cross-field semantic checks

  // 1. accreditation_id must be a valid slug
  if (doc.accreditation_id && !/^acc-[a-z0-9-]+-[a-z0-9-]+$/.test(doc.accreditation_id)) {
    issues.push({ severity: SEVERITY.error, msg: `accreditation_id "${doc.accreditation_id}" must match pattern 'acc-<class>-<identifier>'` });
  }

  // 2. Observer class constraints
  if (doc.accreditation_class === 'observer') {
    if (doc.delegation_boundary && doc.delegation_boundary.can_delegate !== false) {
      issues.push({ severity: SEVERITY.error, msg: 'Observer accreditation must have can_delegate: false' });
    }
    if (doc.delegation_boundary && doc.delegation_boundary.delegation_scope !== 'none') {
      issues.push({ severity: SEVERITY.error, msg: 'Observer accreditation must have delegation_scope: "none"' });
    }
    if (doc.delegation_boundary && doc.delegation_boundary.max_delegation_depth !== 0 && doc.delegation_boundary.max_delegation_depth !== undefined) {
      issues.push({ severity: SEVERITY.warn, msg: 'Observer accreditation should have max_delegation_depth: 0' });
    }
  }

  // 3. Judge constraints: audit_required should be true when can_delegate is true
  if (doc.accreditation_class === 'judge' && doc.delegation_boundary) {
    if (doc.delegation_boundary.can_delegate && doc.delegation_boundary.audit_required !== true) {
      issues.push({ severity: SEVERITY.warn, msg: 'Judge accreditation with can_delegate: true should set audit_required: true' });
    }
  }

  // 4. Zone references must exist in the zone registry
  const knownZones = loadZoneRegistry();
  if (knownZones && knownZones.size > 0) {
    for (const zone of (doc.granted_zones || [])) {
      if (zone.zone_id && !knownZones.has(zone.zone_id)) {
        issues.push({ severity: SEVERITY.error, msg: `granted_zones references unknown zone "${zone.zone_id}" — not defined in fixtures/accreditation/access-zones.yaml` });
      }
    }
  }

  // 5. Delegation scope must be from the valid enum
  const validScopes = ['none', 'within_class', 'within_team', 'any_accredited', 'any'];
  if (doc.delegation_boundary && doc.delegation_boundary.delegation_scope) {
    if (!validScopes.includes(doc.delegation_boundary.delegation_scope)) {
      issues.push({ severity: SEVERITY.error, msg: `delegation_scope "${doc.delegation_boundary.delegation_scope}" is not valid; expected one of: ${validScopes.join(', ')}` });
    }
  }

  // 6. Operating surface types must be from the approved list
  const validSurfaceTypes = ['api', 'filesystem', 'tool', 'network', 'capability', 'database', 'service'];
  if (Array.isArray(doc.operating_surfaces)) {
    for (const surface of doc.operating_surfaces) {
      if (surface.surface_type && !validSurfaceTypes.includes(surface.surface_type)) {
        issues.push({ severity: SEVERITY.error, msg: `operating_surfaces[${surface.surface_id}].surface_type "${surface.surface_type}" is not valid; expected one of: ${validSurfaceTypes.join(', ')}` });
      }
      if (!Array.isArray(surface.allowed_actions) || surface.allowed_actions.length === 0) {
        issues.push({ severity: SEVERITY.error, msg: `operating_surfaces[${surface.surface_id}].allowed_actions must be a non-empty array` });
      }
    }
  }

  // 7. subject must have a display_name that is not empty
  if (doc.subject && (!doc.subject.display_name || doc.subject.display_name.trim() === '')) {
    issues.push({ severity: SEVERITY.warn, msg: 'subject should have a non-empty display_name' });
  }

  // 8. Check for forbidden patterns (secrets, credentials, host-specific paths)
  detectSecrets(doc, issues);

  const hasIssues = issues.filter(i => i.severity === SEVERITY.error).length > 0;

  for (const issue of issues) {
    const prefix = issue.severity === SEVERITY.error ? 'FAIL' : 'WARN';
    const label = issue.severity === SEVERITY.error ? '  error' : '  warn';
    console.error(`${prefix}  ${rel}  - ${label}: ${issue.msg}`);
    if (issue.severity === SEVERITY.error) totalErrors++;
    else totalWarnings++;
  }

  if (!hasIssues) {
    console.log(`OK    ${rel}  (accreditation)`);
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
// Adapter fixture validation
// ---------------------------------------------------------------------------

/**
 * Validate an adapter capability declaration file against the schema.
 * Follows the pattern of validateNodeProfile / validateRoundManifest.
 */
function validateAdapterCapabilities(filePath) {
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

  if (!detectAdapterCapability(doc)) {
    console.warn(`SKIP  ${rel}  - not an adapter capability declaration (missing required fields)`);
    fileCount++;
    return;
  }

  const issues = [];

  // Schema validation
  if (adapterCapValidator) {
    const valid = adapterCapValidator(doc);
    if (!valid) {
      for (const err of adapterCapValidator.errors) {
        const field = err.instancePath || '(root)';
        const msg = err.message || 'invalid';
        const extra = err.params ? JSON.stringify(err.params) : '';
        issues.push({ severity: SEVERITY.error, msg: `${field}: ${msg} ${extra}`.trim() });
      }
    }
  }

  // Cross-field semantic checks
  // adapter_id must be a safe slug
  if (doc.adapter_id && !/^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/.test(doc.adapter_id)) {
    issues.push({ severity: SEVERITY.error, msg: `adapter_id "${doc.adapter_id}" must be a safe slug` });
  }

  // Check for adapter-specific known limitations linking to issues
  if (Array.isArray(doc.known_limitations) && doc.known_limitations.length > 0) {
    for (let i = 0; i < doc.known_limitations.length; i++) {
      if (doc.known_limitations[i].length < 10) {
        issues.push({ severity: SEVERITY.warn, msg: `known_limitations[${i}] is too short to be meaningful` });
      }
    }
  }

  // Detect forbidden patterns (no secrets, host-specific paths)
  detectSecrets(doc, issues);

  const hasIssues = issues.filter(i => i.severity === SEVERITY.error).length > 0;

  for (const issue of issues) {
    const label = issue.severity === SEVERITY.error ? '  error' : '  warn';
    console.error(`${issue.severity === SEVERITY.error ? 'FAIL' : 'WARN'}  ${rel}  - ${label}: ${issue.msg}`);
    if (issue.severity === SEVERITY.error) totalErrors++;
    else totalWarnings++;
  }

  if (!hasIssues) {
    console.log(`OK    ${rel}  (adapter-capability)`);
  }
  fileCount++;
}

/**
 * Validate an adapter fixture file with custom schema-aware checks.
 * Handles adapter-specific formats (commands.yaml, timestamp-log.yaml,
 * actions.yaml, workflow-plan.yaml, worker-trace.yaml, memory-summary.yaml)
 * by at minimum verifying YAML validity, required fields, and no secrets.
 */
function validateAdapterFixtureFile(filePath) {
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

  const issues = [];
  const fileName = path.basename(filePath).toLowerCase();

  // schema_version presence check for all adapter fixture files
  if (doc.schema_version === undefined) {
    issues.push({ severity: SEVERITY.warn, msg: 'missing schema_version field (recommended for all adapter fixture files)' });
  } else if (typeof doc.schema_version !== 'number') {
    issues.push({ severity: SEVERITY.error, msg: 'schema_version must be an integer' });
  }

  // Type-specific structural checks
  if (fileName === 'sample-workflow-plan.yaml') {
    if (!doc.workflow_id) issues.push({ severity: SEVERITY.error, msg: 'missing workflow_id for Hermes workflow plan' });
    if (!Array.isArray(doc.steps) || doc.steps.length === 0) {
      issues.push({ severity: SEVERITY.error, msg: 'workflow plan must have at least one step' });
    }
    if (!doc.objective) issues.push({ severity: SEVERITY.warn, msg: 'workflow plan missing objective' });
  }

  if (fileName === 'sample-worker-trace.yaml') {
    if (!doc.trace_id) issues.push({ severity: SEVERITY.error, msg: 'missing trace_id for Hermes worker trace' });
    if (!Array.isArray(doc.timeline) || doc.timeline.length === 0) {
      issues.push({ severity: SEVERITY.error, msg: 'worker trace must have at least one timeline entry' });
    }
    if (!doc.classification) issues.push({ severity: SEVERITY.warn, msg: 'worker trace missing classification' });
  }

  if (fileName === 'sample-memory-summary.yaml') {
    if (!doc.memory_summary_id) issues.push({ severity: SEVERITY.error, msg: 'missing memory_summary_id for Hermes memory summary' });
    if (!doc.worker_id) issues.push({ severity: SEVERITY.error, msg: 'missing worker_id for memory summary' });
    if (!Array.isArray(doc.memory_sources_consulted)) {
      issues.push({ severity: SEVERITY.warn, msg: 'memory summary missing memory_sources_consulted' });
    }
  }

  if (fileName === 'sample-commands.yaml') {
    if (doc.adapter_id !== 'cli') issues.push({ severity: SEVERITY.warn, msg: 'CLI commands file should have adapter_id: cli' });
    if (!Array.isArray(doc.commands) || doc.commands.length === 0) {
      issues.push({ severity: SEVERITY.error, msg: 'CLI commands file must have at least one command entry' });
    }
  }

  if (fileName === 'sample-timestamp-log.yaml') {
    if (!doc.operator_log_id) issues.push({ severity: SEVERITY.error, msg: 'missing operator_log_id for human baseline timestamp log' });
    if (!Array.isArray(doc.entries) || doc.entries.length === 0) {
      issues.push({ severity: SEVERITY.error, msg: 'timestamp log must have at least one entry' });
    }
  }

  if (fileName === 'sample-actions.yaml') {
    if (!Array.isArray(doc.operator_actions) || doc.operator_actions.length === 0) {
      issues.push({ severity: SEVERITY.error, msg: 'operator actions must have at least one action entry' });
    }
  }

  // Detect forbidden patterns (no secrets, host-specific paths)
  detectSecrets(doc, issues);

  const hasIssues = issues.filter(i => i.severity === SEVERITY.error).length > 0;

  for (const issue of issues) {
    const label = issue.severity === SEVERITY.error ? '  error' : '  warn';
    console.error(`${issue.severity === SEVERITY.error ? 'FAIL' : 'WARN'}  ${rel}  - ${label}: ${issue.msg}`);
    if (issue.severity === SEVERITY.error) totalErrors++;
    else totalWarnings++;
  }

  if (!hasIssues) {
    console.log(`OK    ${rel}  (adapter-fixture)`);
  }
  fileCount++;
}

// ---------------------------------------------------------------------------
// Live-probe (enhanced redaction) validation
// ---------------------------------------------------------------------------

/**
 * Tier-2 forbidden patterns for live-probe mode.
 * These catch raw diagnostic values that might leak into a profile.
 */
const LIVE_PROBE_FORBIDDEN_PATTERNS = [
  // Kernel version strings  e.g. "5.15.0-179-generic", "6.8.0-31-generic"
  { pattern: /\b\d+\.\d+\.\d+-\d+-[a-zA-Z]+\b/, description: 'kernel version string' },
  // CPU model numbers  e.g. "Intel(R) Xeon(R) Gold", "AMD EPYC", "Apple M1 Pro"
  { pattern: /\bIntel\(R\)\s+[A-Za-z0-9-]+/, description: 'CPU model number (Intel)' },
  { pattern: /\bAMD\s+[A-Z][a-z]+\s+\d+/, description: 'CPU model number (AMD)' },
  { pattern: /\bApple\s+M\d\s+(Pro|Max|Ultra)?\b/, description: 'CPU model number (Apple Silicon)' },
  // Cloud instance IDs  e.g. "i-0abcd1234efgh5678", "inst-12345"
  { pattern: /\bi-[a-f0-9]{8,}\b/, description: 'cloud instance ID' },
  { pattern: /\b(?:vpc|subnet|sg)-[a-f0-9]{8,}\b/i, description: 'cloud VPC/subnet/SG ID' },
  // MAC addresses
  { pattern: /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/, description: 'MAC address' },
  // UUIDs that look like hardware serials
  { pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, description: 'UUID (possible hardware serial)' },
  // Cloud provider region/zone names
  { pattern: /\b(?:us|eu|ap|sa)-(?:east|west|central|north|south|southeast|northeast)-\d+\b/, description: 'cloud region name' },
  // Exact mount paths with patterns likely from df output
  { pattern: /\b(?:dev\/)?(?:sd[a-z]\d?|nvme\d+n\d+)\b/, description: 'raw block device name' },
  // hostname-like patterns with hyphens and short TLD
  { pattern: /\b[a-z][a-z0-9-]{2,20}\.(?:lan|local|internal|corp|prod|dev|staging)\b/i, description: 'internal hostname with private TLD' },
];

/**
 * Run a deeper forbidden-field scan specifically for live-captured profiles.
 * This checks every string value in the document against tier-2 patterns.
 */
function scanLiveProbeForbidden(obj, issues, objPath) {
  if (!obj || typeof obj !== 'object') return;
  objPath = objPath || '';
  for (const [key, val] of Object.entries(obj)) {
    const fp = objPath ? `${objPath}.${key}` : key;
    if (typeof val === 'string') {
      // Check against tier-2 forbidden patterns
      for (const bp of LIVE_PROBE_FORBIDDEN_PATTERNS) {
        if (bp.pattern.test(val)) {
          issues.push({ severity: SEVERITY.error, msg: `Live-probe forbidden pattern (${bp.description}) detected in "${fp}": value matches sensitive diagnostic pattern` });
          break;
        }
      }
      // Check for raw command output copy-paste
      if (/^(?:\w+)@\w+/.test(val) && /\$\s+\w+/.test(val)) {
        issues.push({ severity: SEVERITY.error, msg: `Live-probe forbidden pattern (terminal prompt / command echo) detected in "${fp}": value looks like raw terminal output` });
      }
      // Check for values that look like environment variable exports
      if (/^export\s+[A-Z_]+=/.test(val)) {
        issues.push({ severity: SEVERITY.error, msg: `Live-probe forbidden pattern (environment variable export) detected in "${fp}": value looks like credential-bearing environment capture` });
      }
      // Check for raw df output lines
      if (/^\/dev\/\S+\s+\d+/.test(val)) {
        issues.push({ severity: SEVERITY.error, msg: `Live-probe forbidden pattern (raw filesystem line from df) detected in "${fp}": value must be redacted to safe bands` });
      }
    } else if (typeof val === 'object' && val !== null) {
      scanLiveProbeForbidden(val, issues, fp);
    }
  }
}

/**
 * Validate a qualification manifesto or single entry file.
 * Entry files are validated against the $defs.qualification_entry schema.
 * Manifest files are validated against $defs.qualification_manifest and
 * cross-referenced against their entries array.
 */
function validateQualification(filePath) {
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

  // Detect whether this is a manifest or a standalone entry
  const isManifest = doc.manifest_id && doc.entries;
  const isEntry = doc.entry_id && !doc.manifest_id;

  if (!isManifest && !isEntry) {
    console.warn(`SKIP  ${rel}  — not a qualification manifest or entry (needs manifest_id+entries or entry_id)`);
    fileCount++;
    return;
  }

  const issues = [];

  if (isManifest) {
    // Schema validation
    if (qualificationManifestValidator) {
      const valid = qualificationManifestValidator(doc);
      if (!valid) {
        for (const err of qualificationManifestValidator.errors) {
          const field = err.instancePath || '(root)';
          const msg = err.message || 'invalid';
          issues.push({ severity: SEVERITY.error, msg: `schema: ${field}: ${msg}` });
        }
      }
    }

    // Check manifest_id follows convention
    if (!/^season-\d{3}-qualification-v\d+$/.test(doc.manifest_id)) {
      issues.push({ severity: SEVERITY.warn, msg: `manifest_id "${doc.manifest_id}" does not match convention 'season-XXX-qualification-vN'` });
    }

    // Check for duplicate entry IDs in the manifest
    if (doc.entries) {
      const entryIds = doc.entries.map(e => e.entry_id);
      const dups = entryIds.filter((id, i) => entryIds.indexOf(id) !== i);
      if (dups.length) {
        issues.push({ severity: SEVERITY.error, msg: `Duplicate entry IDs in manifest: ${[...new Set(dups)].join(', ')}` });
      }

      // Cross-reference checks against entries/ directory
      const entriesDir = path.join(path.dirname(filePath), 'entries');
      if (fs.existsSync(entriesDir)) {
        const entryFiles = fs.readdirSync(entriesDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
        for (const entryFile of entryFiles) {
          const entryPath = path.join(entriesDir, entryFile);
          try {
            const entryDoc = loadYaml(entryPath);
            if (entryDoc && entryDoc.entry_id) {
              const manifestEntry = doc.entries.find(e => e.entry_id === entryDoc.entry_id);
              if (!manifestEntry) {
                issues.push({ severity: SEVERITY.warn, msg: `Entry file "${entryFile}" (entry_id: ${entryDoc.entry_id}) not found in manifest entries array` });
              }
            }
          } catch { /* skip unparseable entry files */ }
        }

        // Check manifest entries have matching files
        for (const entry of doc.entries) {
          const expectedFile = path.join(entriesDir, `${entry.entry_id}.yaml`);
          if (!fs.existsSync(expectedFile)) {
            issues.push({ severity: SEVERITY.warn, msg: `Entry "${entry.entry_id}" in manifest has no matching file: entries/${entry.entry_id}.yaml` });
          }
        }
      }
    }

    // Secret scan
    detectSecrets(doc, issues);
  }

  if (isEntry) {
    // Schema validation
    if (qualificationEntryValidator) {
      const valid = qualificationEntryValidator(doc);
      if (!valid) {
        for (const err of qualificationEntryValidator.errors) {
          const field = err.instancePath || '(root)';
          const msg = err.message || 'invalid';
          issues.push({ severity: SEVERITY.error, msg: `schema: ${field}: ${msg}` });
        }
      }
    }

    // Entry-specific semantic checks
    // State transitions: seeded must have seeding_score and seeding_group
    if (doc.state === 'seeded') {
      if (doc.seeding_score === undefined || doc.seeding_score === null) {
        issues.push({ severity: SEVERITY.error, msg: `seeding_score required when state is 'seeded'` });
      }
      if (!doc.seeding_group) {
        issues.push({ severity: SEVERITY.error, msg: `seeding_group required when state is 'seeded'` });
      }
      if (typeof doc.seeding_score === 'number' && (doc.seeding_score < 0 || doc.seeding_score > 10)) {
        issues.push({ severity: SEVERITY.error, msg: `seeding_score must be between 0 and 10, got ${doc.seeding_score}` });
      }
    }

    // Withdrawn must have withdrawn_at
    if (doc.state === 'withdrawn' && !doc.withdrawn_at) {
      issues.push({ severity: SEVERITY.warn, msg: `withdrawn_at recommended when state is 'withdrawn'` });
    }

    // Qualified entry must have qualifier_results
    if (doc.entry_type === 'qualified_entry' && (!doc.qualifier_results || doc.qualifier_results.length === 0)) {
      issues.push({ severity: SEVERITY.error, msg: `qualifier_results required when entry_type is 'qualified_entry'` });
    }

    // Team quota must have team_id
    if (doc.quota_type === 'team' && !doc.team_id) {
      issues.push({ severity: SEVERITY.error, msg: `team_id required when quota_type is 'team'` });
    }

    // Secret scan
    detectSecrets(doc, issues);
  }

  const hasErrors = issues.filter(i => i.severity === SEVERITY.error).length > 0;

  for (const issue of issues) {
    const prefix = issue.severity === SEVERITY.error ? 'FAIL' : 'WARN';
    console.error(`${prefix}  ${rel}  — ${issue.severity.toLowerCase()}: ${issue.msg}`);
    if (issue.severity === SEVERITY.error) totalErrors++;
    else totalWarnings++;
  }

  if (!hasErrors) {
    console.log(`OK    ${rel}  (qualification ${isManifest ? 'manifest' : 'entry'})`);
  }
  fileCount++;
}

/**
 * Validate a node profile with live-probe (enhanced redaction) checks.
 * Reuses the standard validateNodeProfile logic then adds tier-2 scans.
 */
function validateLiveProbe(filePath) {
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
    console.error(`FAIL  ${rel}  - not a node profile (missing required fields); live-probe mode requires a schema-complete profile`);
    totalErrors++;
    fileCount++;
    return;
  }

  const issues = [];

  // Schema validation (reuse node profile validator)
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

  // Cross-field checks (same as validateNodeProfile)
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
  if (Array.isArray(doc.capability_labels) && doc.capability_labels.length === 0) {
    issues.push({ severity: SEVERITY.error, msg: 'capability_labels must have at least one entry' });
  }

  // profile_id safety checks (same as validateNodeProfile)
  if (doc.profile_id) {
    if (!/^[a-z0-9]([a-z0-9_-]*[a-z0-9])?$/.test(doc.profile_id)) {
      issues.push({ severity: SEVERITY.error, msg: `profile_id "${doc.profile_id}" must be a safe slug (lowercase, digits, hyphens, underscores only)` });
    }
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(doc.profile_id)) {
      issues.push({ severity: SEVERITY.error, msg: `profile_id "${doc.profile_id}" looks like an IP address; use a safe slug instead` });
    }
  }

  // Base forbidden pattern scan (reuse the existing one)
  const FORBIDDEN_PROFILE_PATTERNS = [
    { pattern: /\b(\d{1,3}\.){3}\d{1,3}\b/, description: 'IP address' },
    { pattern: /\b(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b/, description: 'potential hostname or domain' },
    { pattern: /\/home\/[a-z_][a-z0-9_-]*/i, description: 'absolute home path' },
    { pattern: /\/etc\/[a-z_][a-z0-9_-]*/i, description: 'absolute system config path' },
    { pattern: /\/root\/\S+/i, description: 'root home path' },
    { pattern: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/, description: 'private key material' },
    { pattern: /sk-[a-zA-Z0-9]{20,}/, description: 'API key pattern' },
  ];

  function scanBaseForbidden(obj, objPath) {
    if (!obj || typeof obj !== 'object') return;
    objPath = objPath || '';
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
        scanBaseForbidden(val, fp);
      }
    }
  }
  scanBaseForbidden(doc);

  // Tier-2: live-probe enhanced forbidden scan
  scanLiveProbeForbidden(doc, issues);

  // Standard secret detection
  detectSecrets(doc, issues);

  // Check mandatory live-probe fields
  if (!doc.notes) {
    issues.push({ severity: SEVERITY.warn, msg: 'live-probe profile should include a notes field documenting the probe context and disposal certification' });
  }
  if (!doc.last_updated) {
    issues.push({ severity: SEVERITY.warn, msg: 'live-probe profile should include last_updated timestamp' });
  }

  const hasIssues = issues.filter(i => i.severity === SEVERITY.error).length > 0;

  for (const issue of issues) {
    const prefix = issue.severity === SEVERITY.error ? 'FAIL' : 'WARN';
    const label = issue.severity === SEVERITY.error ? '  error' : '  warn';
    console.error(`${prefix}  ${rel}  - [live-probe] ${label}: ${issue.msg}`);
    if (issue.severity === SEVERITY.error) totalErrors++;
    else totalWarnings++;
  }

  if (!hasIssues) {
    console.log(`OK    ${rel}  (live-probe)`);
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

  // Adapter capabilities mode
  if (mode === 'adapter-capabilities') {
    const capsDir = path.join(ROOT, 'fixtures', 'adapters', 'capabilities');
    if (!fs.existsSync(capsDir)) {
      console.log('No adapter capabilities directory found.');
      process.exit(0);
    }
    const files = findFiles(capsDir, /\.ya?ml$/);
    if (files.length === 0) {
      console.log('No adapter capability declaration files found.');
      process.exit(0);
    }
    console.log(`Validating ${files.length} adapter capability declaration file(s)...\n`);
    for (const f of files) {
      validateAdapterCapabilities(f);
    }
    console.log(`\n--- Summary ---`);
    console.log(`Capability files:  ${files.length}`);
    console.log(`Errors:           ${totalErrors}`);
    console.log(`Warnings:         ${totalWarnings}`);
    process.exit(totalErrors > 0 ? 1 : 0);
  }

  // Adapter fixtures mode — validate all adapter sample fixture files
  if (mode === 'adapter-fixtures') {
    const cliDir = path.join(ROOT, 'fixtures', 'adapters', 'cli');
    const hermesDir = path.join(ROOT, 'fixtures', 'adapters', 'hermes');
    const humanDir = path.join(ROOT, 'fixtures', 'adapters', 'human-baseline');
    const dirs = [cliDir, hermesDir, humanDir].filter(d => fs.existsSync(d));
    if (dirs.length === 0) {
      console.log('No adapter fixture directories found.');
      process.exit(0);
    }
    let files = [];
    for (const d of dirs) {
      files = files.concat(findFiles(d, /\.ya?ml$/));
    }
    if (files.length === 0) {
      console.log('No adapter fixture YAML files found.');
      process.exit(0);
    }
    console.log(`Validating ${files.length} adapter fixture file(s)...\n`);

    // Separate standard-schema files from adapter-specific format files
    const standardFiles = [];
    const customFiles = [];
    const bundleIds = ['sample-result-packet-stub.yaml', 'sample-evidence-bundle-stub.yaml'];
    for (const f of files) {
      const base = path.basename(f).toLowerCase();
      if (bundleIds.includes(base)) {
        standardFiles.push(f);
      } else {
        customFiles.push(f);
      }
    }

    // Validate standard-schema files through validateFile
    for (const f of standardFiles) {
      validateFile(f);
    }
    // Validate adapter-specific format files through custom checks
    for (const f of customFiles) {
      validateAdapterFixtureFile(f);
    }

    console.log(`\n--- Summary ---`);
    console.log(`Files:                  ${files.length}`);
    console.log(`Errors:                 ${totalErrors}`);
    console.log(`Warnings:               ${totalWarnings}`);
    process.exit(totalErrors > 0 ? 1 : 0);
  }

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

  // Accreditation mode — validate all accreditation declarations
  if (mode === 'accreditations') {
    const accDir = path.join(ROOT, 'fixtures', 'accreditation');
    if (!fs.existsSync(accDir)) {
      console.log('No fixtures/accreditation directory found.');
      process.exit(0);
    }
    const files = findFiles(accDir, /\.ya?ml$/);
    if (files.length === 0) {
      console.log('No accreditation declaration files found.');
      process.exit(0);
    }
    console.log(`Validating ${files.length} accreditation declaration file(s)...\n`);
    for (const f of files) {
      validateAccreditation(f);
    }
    console.log(`\n--- Summary ---`);
    console.log(`Files:     ${fileCount}`);
    console.log(`Errors:    ${totalErrors}`);
    console.log(`Warnings:  ${totalWarnings}`);
    process.exit(totalErrors > 0 ? 1 : 0);
  }

  // Accreditation validity mode — validate accreditation validity fixtures
  if (mode === 'accreditations-validity') {
    const validityDir = path.join(ROOT, 'fixtures', 'accreditation-validity');
    if (!fs.existsSync(validityDir)) {
      console.log('No fixtures/accreditation-validity directory found.');
      process.exit(0);
    }
    const files = findFiles(validityDir, /\.ya?ml$/);
    if (files.length === 0) {
      console.log('No accreditation validity fixture files found.');
      process.exit(0);
    }
    console.log(`Validating ${files.length} accreditation validity fixture file(s)...\n`);
    for (const f of files) {
      validateAccreditation(f);
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
    const files = findFiles(profilesDir, /\.ya?ml$/).filter((file) => {
      const parts = path.relative(profilesDir, file).split(path.sep);
      return !parts.includes('validity');
    });
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

  // Qualifications mode
  if (mode === 'qualifications') {
    const qualDir = path.join(ROOT, 'fixtures', 'season-001-qualification');
    if (!fs.existsSync(qualDir)) {
      console.log('No season-001-qualification directory found.');
      process.exit(0);
    }
    let files = [];
    // Add manifest
    const manifestPath = path.join(qualDir, 'manifest.yaml');
    if (fs.existsSync(manifestPath)) {
      files.push(manifestPath);
    }
    // Add entry files
    const entriesDir = path.join(qualDir, 'entries');
    if (fs.existsSync(entriesDir)) {
      files = files.concat(findFiles(entriesDir, /\.ya?ml$/));
    }
    // Add negative test fixtures
    const negativeDir = path.join(qualDir, 'negative');
    if (fs.existsSync(negativeDir)) {
      files = files.concat(findFiles(negativeDir, /\.ya?ml$/));
    }
    if (files.length === 0) {
      console.log('No qualification files found.');
      process.exit(0);
    }
    console.log(`Validating ${files.length} qualification file(s)...\n`);
    for (const f of files) {
      validateQualification(f);
    }
    console.log(`\n--- Summary ---`);
    console.log(`Files:     ${fileCount}`);
    console.log(`Errors:    ${totalErrors}`);
    console.log(`Warnings:  ${totalWarnings}`);
    process.exit(totalErrors > 0 ? 1 : 0);
  }

  // Live-probe enhanced redaction check mode
  if (mode === 'live-probe') {
    const targetPath = args[1];
    let files = [];

    if (targetPath) {
      if (fs.existsSync(targetPath)) {
        const stat = fs.statSync(targetPath);
        if (stat.isDirectory()) {
          files = findFiles(targetPath, /\.ya?ml$/);
        } else {
          files = [path.resolve(targetPath)];
        }
      } else {
        console.error(`Path not found: ${targetPath}`);
        process.exit(1);
      }
    } else {
      // Default: validate all node profiles
      const profilesDir = path.join(ROOT, 'fixtures', 'node-profiles');
      if (!fs.existsSync(profilesDir)) {
        console.log('No node-profiles directory found.');
        process.exit(0);
      }
      files = findFiles(profilesDir, /\.ya?ml$/);
    }

    if (files.length === 0) {
      console.log('No profile files matched.');
      process.exit(0);
    }

    console.log(`Validating ${files.length} file(s) with live-probe enhanced checks...\n`);
    for (const f of files) {
      validateLiveProbe(f);
    }
    console.log(`\n--- Summary ---`);
    console.log(`Files:     ${fileCount}`);
    console.log(`Errors:    ${totalErrors}`);
    console.log(`Warnings:  ${totalWarnings}`);
    process.exit(totalErrors > 0 ? 1 : 0);
  }

  // Competition-validity mode
  if (mode === 'competition-validity') {
    const { spawnSync } = require('child_process');
    const cvPath = path.join(__dirname, 'competition-validity.js');
    const cvArgs = process.argv.slice(3);

    console.log('Delegating to competition-validity.js...\n');
    const result = spawnSync(process.execPath, [cvPath, ...(cvArgs.length > 0 ? cvArgs : ['all', 'runs/season-001/round-001'])], {
      stdio: 'inherit',
      cwd: ROOT,
    });

    const exitCode = result.status !== null ? result.status : 1;
    if (exitCode !== 0) {
      totalErrors++;
    }
    fileCount++;
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
    console.error(`Usage: node scripts/validate.js <envelopes|envelopes-v2|packets|packets-v2|traces|bundles|runs|judges|judges-v2|smoke|rounds|fixtures|profiles|live-probe|qualifications|adapter-capabilities|adapter-fixtures|oracle|competition-validity|accreditations|accreditations-validity|all|all-v2|file>`);
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
