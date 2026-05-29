#!/usr/bin/env node
/**
 * Agent Olympics Competition-Validity Validator
 *
 * Extends validation beyond basic YAML/schema conformance into
 * competition-integrity checks that can reject unsafe, incomplete,
 * non-comparable, or score-inconsistent submissions.
 *
 * These checks are SEPARATE from schema validation (validate.js).
 * A document can be schema-valid but competition-invalid.
 *
 * Check categories:
 *
 *   1. RUN MANIFEST INTEGRITY
 *      - Every run directory must have a manifest.yaml
 *      - Manifest fields must be internally consistent
 *
 *   2. ENGINE OUTPUT PRESENCE & CONSISTENCY
 *      - Required engine outputs must exist: result packet, evidence,
 *        judge record, scoreboard (where applicable)
 *      - Cross-document field consistency (run_id, task_id, agent_id)
 *
 *   3. FORBIDDEN / UNSAFE METADATA
 *      - Live mutation claims must reference approval evidence
 *      - Redaction reasons must be value-free (not contain secrets)
 *      - Approval boundaries must be documented for destructive actions
 *      - Hidden judge material must not leak into participant-facing artifacts
 *      - Secret-bearing fields (API keys, tokens, passwords in values)
 *
 *   4. SCORE CONSISTENCY
 *      - Scoreboard dimension scores must not exceed max
 *      - Score totals must match dimension sums where documented
 *      - Verdict must be consistent with score ranges
 *
 *   5. EVIDENCE REFERENCE INTEGRITY
 *      - All evidence_refs in trace entries must resolve to bundle items
 *      - All content_refs with relative paths must point to existing files
 *      - Evidence checksums (when present) must be in valid format
 *
 * Usage:
 *   node scripts/competition-validity.js <command> [path]
 *
 * Commands:
 *   run-manifests <round-dir>   — Validate run manifests in a round dir
 *   engine-outputs <round-dir>  — Validate engine outputs per run
 *   consistency <round-dir>     — Cross-document consistency checks
 *   all <round-dir>             — All competition-validity checks
 *   fixtures <fixtures-dir>     — Validate competition-validity fixtures
 *
 * Exit code: 0 = all checks pass, 1 = any check failed.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '..');

const SEVERITY_ERROR = 'ERROR';
const SEVERITY_WARN = 'WARN';

const VALID_RUN_STATUSES = new Set([
  'pending', 'running', 'completed', 'failed', 'scored', 'archived',
]);

const VALID_PACKET_STATUSES = new Set([
  'completed', 'partial', 'blocked', 'failed', 'disqualified',
]);

const VALID_CONFIDENCE = new Set(['low', 'medium', 'high']);

const VALID_JUDGE_TYPES = new Set([
  'automated', 'human', 'llm-assisted', 'hybrid', 'pending',
]);

const VALID_VERDICTS = new Set([
  'pass', 'conditional_pass', 'fail', 'disqualification',
]);

// Secret-bearing field name patterns that should NOT appear in participant artifacts
const FORBIDDEN_SECRET_KEY_PATTERNS = [
  /^api[_-]?key$/i,
  /^api[_-]?secret$/i,
  /^token$/i,
  /^password$/i,
  /^secret$/i,
  /^credential/i,
  /^auth[_-]?token/i,
  /^private[_-]?key/i,
  /^access[_-]?key/i,
  /^session[_-]?cookie/i,
];

// Secret value patterns — actual credential leaks
const FORBIDDEN_VALUE_PATTERNS = [
  /^sk-[a-zA-Z0-9]{20,}/,          // OpenAI-style keys
  /^ghp_[a-zA-Z0-9]{36}/,          // GitHub PAT (legacy)
  /^gho_[a-zA-Z0-9]{36}/,          // GitHub PAT (org)
  /^github_pat_[a-zA-Z0-9_]{4,}/,  // GitHub fine-grained PAT
  /^xox[baprs]-/,                   // Slack tokens
  /^-----BEGIN (RSA |EC )?PRIVATE KEY-----/,  // Private keys
  /^eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+/,   // JWT tokens
];

// Actions that require documented approval boundaries
const DESTRUCTIVE_ACTION_PATTERNS = [
  /delete/i, /destroy/i, /reset/i,
  /restart/i, /reboot/i, /shutdown/i,
  /reinstall/i, /rollback/i, /migrate/i,
  /rotate/i, /revoke/i, /purge/i,
];

// Action types that imply live mutation
const LIVE_MUTATION_ACTION_TYPES = new Set([
  'write', 'delete', 'destroy', 'reset', 'restart',
  'reboot', 'reinstall', 'exec', 'command',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadYaml(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return yaml.load(raw);
  } catch (err) {
    throw new Error(`YAML parse error in ${filePath}: ${err.message}`);
  }
}

function fileExists(filePath) {
  try {
    fs.accessSync(path.resolve(ROOT, filePath), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function dirExists(dirPath) {
  try {
    const fullPath = path.resolve(ROOT, dirPath);
    return fs.statSync(fullPath).isDirectory();
  } catch {
    return false;
  }
}

function findYamlFiles(dirPath) {
  const results = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') walk(full);
      else if (/\.ya?ml$/.test(entry.name)) results.push(full);
    }
  }
  if (dirExists(dirPath)) {
    walk(path.resolve(ROOT, dirPath));
  }
  return results.sort();
}

function isValidHexHash(value) {
  return /^[a-f0-9]{32,128}$/i.test(value);
}

// ---------------------------------------------------------------------------
// Check accumulator
// ---------------------------------------------------------------------------

let errors = 0;
let warnings = 0;
let checks = [];

function check(severity, label, pass, detail) {
  checks.push({ severity, label, pass, detail });
  if (!pass && severity === SEVERITY_ERROR) errors++;
  else if (!pass && severity === SEVERITY_WARN) warnings++;
}

function error(label, detail) {
  check(SEVERITY_ERROR, label, false, detail);
}

function warn(label, detail) {
  check(SEVERITY_WARN, label, false, detail);
}

function ok(label) {
  check(SEVERITY_WARN, label, true, '');
}

function printSummary() {
  if (checks.length === 0) {
    console.log('\nNo checks were performed.\n');
    return;
  }

  // Group by scope
  const groups = {};
  for (const c of checks) {
    const scope = c.label.split(':')[0];
    if (!groups[scope]) groups[scope] = [];
    groups[scope].push(c);
  }

  for (const [scope, scopeChecks] of Object.entries(groups)) {
    const failed = scopeChecks.filter(c => !c.pass);
    if (failed.length === 0) continue;
    console.error(`\n--- ${scope} ---`);
    for (const c of failed) {
      const prefix = c.severity === SEVERITY_ERROR ? 'FAIL' : 'WARN';
      console.error(`  ${prefix}  ${c.label}: ${c.detail}`);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Checks:    ${checks.length}`);
  console.log(`Errors:    ${errors}`);
  console.log(`Warnings:  ${warnings}`);
}

// ---------------------------------------------------------------------------
// 1) RUN MANIFEST INTEGRITY CHECKS
// ---------------------------------------------------------------------------

function checkRunManifest(manifestPath) {
  const rel = path.relative(ROOT, manifestPath);

  if (!fs.existsSync(manifestPath)) {
    error(`manifest:${rel}`, 'File does not exist');
    return null;
  }

  let doc;
  try {
    doc = loadYaml(manifestPath);
  } catch (e) {
    error(`manifest:${rel}`, e.message);
    return null;
  }

  if (!doc || typeof doc !== 'object') {
    error(`manifest:${rel}`, 'Empty or non-object document');
    return null;
  }

  // Required fields
  const requiredFields = ['run_id', 'round_id', 'task_id', 'agent_id', 'lifecycle'];
  for (const field of requiredFields) {
    if (!doc[field]) {
      error(`manifest:${rel}`, `Missing required field "${field}"`);
    }
  }

  // run_id format
  if (doc.run_id && !/^run-[a-z]+-\d{3}-[a-z0-9]+-\d{8}T\d{6}[A-Z]{3,4}$/.test(doc.run_id)) {
    warn(`manifest:${rel}`, `run_id "${doc.run_id}" does not match standard format 'run-{task_id}-{agent_id}-{timestamp}'`);
  }

  // run_id consistency: basename of directory should match
  const dirName = path.basename(path.dirname(manifestPath));
  if (doc.run_id && dirName !== doc.run_id) {
    warn(`manifest:${rel}`, `run_id "${doc.run_id}" does not match directory name "${dirName}"`);
  }

  // lifecycle status
  if (doc.lifecycle && !VALID_RUN_STATUSES.has(doc.lifecycle)) {
    error(`manifest:${rel}`, `Invalid lifecycle status "${doc.lifecycle}"; expected one of: ${[...VALID_RUN_STATUSES].join(', ')}`);
  }

  // created_at should be a parseable date
  if (doc.created_at && isNaN(new Date(doc.created_at).getTime())) {
    warn(`manifest:${rel}`, `created_at "${doc.created_at}" is not a valid date`);
  }

  return doc;
}

// ---------------------------------------------------------------------------
// 2) ENGINE OUTPUT CHECKS
// ---------------------------------------------------------------------------

function checkEngineOutputs(runDir, manifest) {
  if (!manifest) return;

  const rel = path.relative(ROOT, runDir);

  // Check result-packet.yaml exists
  const packetPath = path.join(runDir, 'result-packet.yaml');
  if (!fs.existsSync(packetPath)) {
    error(`engine-outputs:${rel}`, 'Missing required output: result-packet.yaml');
  } else {
    try {
      const packet = loadYaml(packetPath);
      if (packet) {
        // Packet must have a status
        if (!packet.status || !VALID_PACKET_STATUSES.has(packet.status)) {
          error(`engine-outputs:${rel}/result-packet.yaml`, `Invalid status "${packet ? packet.status : 'undefined'}"; expected one of: ${[...VALID_PACKET_STATUSES].join(', ')}`);
        }

        // Must have evidence
        if (!packet.evidence || !Array.isArray(packet.evidence) || packet.evidence.length === 0) {
          error(`engine-outputs:${rel}/result-packet.yaml`, 'Missing or empty evidence array');
        }

        // Must have findings
        if (!packet.findings || !Array.isArray(packet.findings) || packet.findings.length === 0) {
          error(`engine-outputs:${rel}/result-packet.yaml`, 'Missing or empty findings array');
        }

        // Must have outputs
        if (!packet.outputs || typeof packet.outputs !== 'object' || Object.keys(packet.outputs).length === 0) {
          error(`engine-outputs:${rel}/result-packet.yaml`, 'Missing or empty outputs object');
        }

        // If status is completed, agent_id must match manifest
        if (packet.status === 'completed' && manifest.agent_id && packet.agent_id !== manifest.agent_id) {
          error(`engine-outputs:${rel}/result-packet.yaml`, `agent_id "${packet.agent_id}" does not match manifest agent_id "${manifest.agent_id}"`);
        }
      }
    } catch (e) {
      error(`engine-outputs:${rel}/result-packet.yaml`, e.message);
    }
  }

  // Check trace.yaml exists
  const tracePath = path.join(runDir, 'trace.yaml');
  if (!fs.existsSync(tracePath)) {
    warn(`engine-outputs:${rel}`, 'Missing optional output: trace.yaml');
  } else {
    try {
      const trace = loadYaml(tracePath);
      if (trace) {
        if (!trace.trace_id) {
          warn(`engine-outputs:${rel}/trace.yaml`, 'Missing trace_id');
        }
        if (!trace.entries || !Array.isArray(trace.entries) || trace.entries.length === 0) {
          error(`engine-outputs:${rel}/trace.yaml`, 'Missing or empty entries array');
        }
      }
    } catch (e) {
      error(`engine-outputs:${rel}/trace.yaml`, e.message);
    }
  }

  // Check evidence/ directory has content
  const evidenceDir = path.join(runDir, 'evidence');
  if (!fs.existsSync(evidenceDir)) {
    warn(`engine-outputs:${rel}`, 'Missing evidence/ directory (no evidence artifacts)');
  } else {
    const evidenceFiles = fs.readdirSync(evidenceDir).filter(f => f !== '.gitkeep');
    if (evidenceFiles.length === 0) {
      warn(`engine-outputs:${rel}/evidence`, 'Evidence directory is empty');
    }
  }

  // Check judge-record.yaml exists
  const judgePath = path.join(runDir, 'judge-record.yaml');
  if (!fs.existsSync(judgePath)) {
    warn(`engine-outputs:${rel}`, 'Missing optional output: judge-record.yaml');
  } else {
    try {
      const judge = loadYaml(judgePath);
      if (judge) {
        if (!judge.judge_record_id) {
          error(`engine-outputs:${rel}/judge-record.yaml`, 'Missing judge_record_id');
        }
        if (!judge.score_dimensions || Object.keys(judge.score_dimensions).length === 0) {
          error(`engine-outputs:${rel}/judge-record.yaml`, 'Missing or empty score_dimensions');
        }
        if (judge.verdict && !VALID_VERDICTS.has(judge.verdict)) {
          error(`engine-outputs:${rel}/judge-record.yaml`, `Invalid verdict "${judge.verdict}"; expected one of: ${[...VALID_VERDICTS].join(', ')}`);
        }
      }
    } catch (e) {
      error(`engine-outputs:${rel}/judge-record.yaml`, e.message);
    }
  }
}

// ---------------------------------------------------------------------------
// 3) FORBIDDEN / UNSAFE METADATA CHECKS
// ---------------------------------------------------------------------------

function checkForbiddenMetadata(doc, context, filePath) {
  if (!doc || typeof doc !== 'object') return;

  const traverse = (obj, pathStr) => {
    if (!obj || typeof obj !== 'object') return;

    for (const [key, val] of Object.entries(obj)) {
      const fullPath = pathStr ? `${pathStr}.${key}` : key;

      if (typeof val === 'string') {
        // Check for secret-bearing key names
        if (FORBIDDEN_SECRET_KEY_PATTERNS.some(r => r.test(key))) {
          error(`forbidden:${filePath}`, `Secret-bearing field name "${fullPath}" found in participant-facing artifact`);
        }

        // Check for actual secret values leaked
        if (FORBIDDEN_VALUE_PATTERNS.some(r => r.test(val))) {
          error(`forbidden:${filePath}`, `Secret value pattern detected in "${fullPath}" — credential leak`);
        }

        // Check redaction_reason for actual secrets instead of value-free reasons
        if ((key === 'redaction_reason' || key === 'redaction_rule') && val.length > 0) {
          // A redaction reason containing actual secrets is an exposure, not redaction
          if (FORBIDDEN_VALUE_PATTERNS.some(r => r.test(val))) {
            error(`forbidden:${filePath}`, `redaction_reason in "${fullPath}" contains a secret value — must be value-free`);
          }
          // Long redaction_reasons are suspicious
          if (val.length > 200) {
            warn(`forbidden:${filePath}`, `Unusually long redaction_reason in "${fullPath}" (${val.length} chars) — may contain secret data`);
          }
        }
      }

      if (typeof val === 'object' && val !== null) {
        traverse(val, fullPath);
      }
    }
  };

  traverse(doc, '');
}

/**
 * Check for destructive actions without documented approval boundaries.
 * Looks at result packet actions and checks for approval evidence.
 */
function checkApprovalBoundaries(doc, filePath) {
  if (!doc || typeof doc !== 'object') return;

  const rel = path.relative(ROOT, filePath);

  // Look for actions with destructive patterns
  const actions = doc.actions || [];
  for (const action of actions) {
    if (!action || typeof action !== 'object') continue;

    const type = action.type || '';
    const summary = action.command_summary || action.summary || '';
    const id = action.id || '(unnamed)';

    const isDestructive = DESTRUCTIVE_ACTION_PATTERNS.some(r =>
      r.test(type) || r.test(summary)
    );

    if (isDestructive) {
      // Destructive action must reference evidence of approval
      if (!action.evidence_id && !action.approval_ref) {
        error(`approval:${rel}`, `Destructive action "${id}" (${type}: ${summary.slice(0, 60)}) has no evidence_id or approval_ref — approval boundary not documented`);
      }
    }
  }

  // Check for live mutation claims (status=completed with destructive actions but no approval evidence)
  if (doc.status === 'completed' && actions.length > 0) {
    const hasDestructive = actions.some(a => {
      if (!a || typeof a !== 'object') return false;
      return DESTRUCTIVE_ACTION_PATTERNS.some(r =>
        r.test(a.type || '') || r.test(a.command_summary || '')
      );
    });

    if (hasDestructive) {
      // Check that findings or risks mention approval
      const findings = doc.findings || [];
      const risks = doc.risks || [];
      const hasApprovalMention = [...findings, ...(risks || [])].some(item => {
        const text = typeof item === 'string' ? item :
                     (item.claim || item || '');
        return /approval|authorized|permission|allowed|explicit/i.test(text);
      });

      if (!hasApprovalMention) {
        warn(`approval:${rel}`, 'Live mutation actions detected but neither findings nor risks mention approval boundaries');
      }
    }
  }
}

/**
 * Check for hidden judge material in participant-facing artifacts.
 */
function checkHiddenJudgeMaterial(doc, filePath) {
  if (!doc || typeof doc !== 'object') return;
  const rel = path.relative(ROOT, filePath);

  // hidden_judge_notes is LEGITIMATE only in task envelopes (internal
  // competition definitions) and oracle files (judge answer keys). Any
  // other file containing hidden_judge_notes is exposing judge material.
  const isTaskEnvelope = /\btasks\b/.test(filePath);
  const isOracleFile = /\boracle\b/.test(filePath);

  if (doc.hidden_judge_notes && !isTaskEnvelope && !isOracleFile) {
    error(`judge-exposure:${rel}`, 'participant-facing artifact contains hidden_judge_notes — must not be shared with participants');
  }

  // oracle_ref and judge_notes_ref are fine in envelopes (as external refs) but
  // if they appear in participant-facing artifacts, that's a leak
  if ((doc.oracle_ref || doc.judge_notes_ref) && !isTaskEnvelope && !isOracleFile) {
    if (isParticipantArtifact || /\bresults\b/.test(filePath) || /\bruns\b/.test(filePath)) {
      warn(`judge-exposure:${rel}`, 'Participant submission references oracle_ref or judge_notes_ref — possible judge material exposure');
    }
  }
}

// ---------------------------------------------------------------------------
// 4) SCORE CONSISTENCY CHECKS
// ---------------------------------------------------------------------------

function checkScoreConsistency(judgeDoc, filePath) {
  if (!judgeDoc || typeof judgeDoc !== 'object') return;
  const rel = path.relative(ROOT, filePath);

  const dims = judgeDoc.score_dimensions;
  if (!dims || typeof dims !== 'object') return;

  let computedTotal = 0;
  let maxTotal = 0;
  let hasPartialScores = false;

  for (const [dimName, dim] of Object.entries(dims)) {
    if (!dim || typeof dim !== 'object') continue;

    const score = dim.score;
    const maxScore = dim.max;

    // Score must not exceed max
    if (typeof score === 'number' && typeof maxScore === 'number') {
      if (score > maxScore) {
        error(`score-consistency:${rel}`, `Dimension "${dimName}" score (${score}) exceeds max (${maxScore})`);
      }
      if (score < 0) {
        error(`score-consistency:${rel}`, `Dimension "${dimName}" score (${score}) is negative`);
      }
      computedTotal += score;
      maxTotal += maxScore;
      hasPartialScores = true;
    }
  }

  // total_score should match sum of dimension scores (when dimensions have scores)
  if (hasPartialScores && typeof judgeDoc.total_score === 'number') {
    if (Math.abs(judgeDoc.total_score - computedTotal) > 0.01) {
      warn(`score-consistency:${rel}`, `total_score (${judgeDoc.total_score}) does not match sum of dimension scores (${computedTotal})`);
    }
  }

  // Verdict consistency with score
  if (judgeDoc.verdict && dims && Object.keys(dims).length > 0) {
    if (judgeDoc.verdict === 'pass' && typeof judgeDoc.total_score === 'number' && judgeDoc.total_score <= 0) {
      warn(`score-consistency:${rel}`, `Verdict is "pass" but total_score is ${judgeDoc.total_score} (≤ 0)`);
    }
    if (judgeDoc.verdict === 'fail' && typeof judgeDoc.total_score === 'number' && judgeDoc.total_score > 0) {
      warn(`score-consistency:${rel}`, `Verdict is "fail" but total_score is ${judgeDoc.total_score} (> 0)`);
    }
  }

  // Check penalties
  if (judgeDoc.penalties_applied && Array.isArray(judgeDoc.penalties_applied)) {
    for (const penalty of judgeDoc.penalties_applied) {
      if (penalty && typeof penalty === 'object') {
        if (typeof penalty.amount === 'number' && penalty.amount > maxTotal) {
          warn(`score-consistency:${rel}`, `Penalty "${penalty.reason || penalty.rule || ''}" amount (${penalty.amount}) exceeds max possible score (${maxTotal})`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 5) EVIDENCE REFERENCE INTEGRITY
// ---------------------------------------------------------------------------

function checkEvidenceIntegrity(packetDoc, traceDoc, bundleDoc, filePath) {
  if (!packetDoc || typeof packetDoc !== 'object') return;
  const rel = path.relative(ROOT, filePath);

  // Collect evidence IDs from packet
  const packetEvidenceIds = new Set();
  if (packetDoc.evidence && Array.isArray(packetDoc.evidence)) {
    for (const ev of packetDoc.evidence) {
      if (ev.id) {
        if (packetEvidenceIds.has(ev.id)) {
          warn(`evidence-integrity:${rel}`, `Duplicate evidence ID "${ev.id}" in result packet`);
        }
        packetEvidenceIds.add(ev.id);
      }
    }
  }

  // Check findings reference valid evidence IDs
  if (packetDoc.findings && Array.isArray(packetDoc.findings)) {
    for (const finding of packetDoc.findings) {
      if (finding.evidence && Array.isArray(finding.evidence)) {
        for (const ref of finding.evidence) {
          if (!packetEvidenceIds.has(ref)) {
            error(`evidence-integrity:${rel}`, `Finding "${(finding.claim || '').slice(0, 50)}..." references unknown evidence ID "${ref}"`);
          }
        }
      }
    }
  }

  // Check trace entries reference valid evidence IDs
  if (traceDoc && traceDoc.entries && Array.isArray(traceDoc.entries)) {
    for (const entry of traceDoc.entries) {
      if (entry.evidence_ref && !packetEvidenceIds.has(entry.evidence_ref)) {
        warn(`evidence-integrity:${rel}/trace`, `Trace entry seq=${entry.seq} references unknown evidence ID "${entry.evidence_ref}"`);
      }
    }
  }

  // Check content_refs resolve to files (when they are relative paths)
  if (bundleDoc && bundleDoc.items && Array.isArray(bundleDoc.items)) {
    for (const item of bundleDoc.items) {
      if (item.content_ref && !/^https?:\/\//.test(item.content_ref) && !/^data:/.test(item.content_ref)) {
        const resolvedPath = path.resolve(path.dirname(filePath), item.content_ref);
        if (!fs.existsSync(resolvedPath)) {
          warn(`evidence-integrity:${rel}/evidence-bundle`, `Evidence item "${item.id}" content_ref "${item.content_ref}" does not exist at ${resolvedPath}`);
        }
      }

      // Check checksum format
      if (item.checksum && item.checksum.value) {
        if (!isValidHexHash(item.checksum.value)) {
          warn(`evidence-integrity:${rel}/evidence-bundle`, `Evidence item "${item.id}" checksum "${item.checksum.value}" is not a valid hex hash`);
        }
        if (!item.checksum.algorithm) {
          warn(`evidence-integrity:${rel}/evidence-bundle`, `Evidence item "${item.id}" has checksum value but no algorithm`);
        }
      }
    }
  }

  // Check redaction policy rules are value-free
  const redactionPolicy = packetDoc.redaction_policy || (bundleDoc && bundleDoc.redaction_policy);
  if (redactionPolicy && redactionPolicy.applied_rules) {
    for (const rule of redactionPolicy.applied_rules) {
      if (rule.pattern_description) {
        for (const pattern of FORBIDDEN_VALUE_PATTERNS) {
          if (pattern.test(rule.pattern_description)) {
            error(`evidence-integrity:${rel}`, `Redaction policy rule "${rule.rule_id}" pattern_description contains a secret value — must be value-free`);
          }
        }
      }
      if (rule.reason && rule.reason.length > 500) {
        warn(`evidence-integrity:${rel}`, `Redaction policy rule "${rule.rule_id}" reason is unusually long (${rule.reason.length} chars)`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Cross-document consistency
// ---------------------------------------------------------------------------

function checkCrossDocumentConsistency(runDir, manifest) {
  if (!manifest) return;
  const rel = path.relative(ROOT, runDir);

  // Load all documents in the run directory
  const packetPath = path.join(runDir, 'result-packet.yaml');
  const tracePath = path.join(runDir, 'trace.yaml');
  const judgePath = path.join(runDir, 'judge-record.yaml');

  let packet = null;
  let trace = null;
  let judge = null;

  try {
    if (fs.existsSync(packetPath)) packet = loadYaml(packetPath);
    if (fs.existsSync(tracePath)) trace = loadYaml(tracePath);
    if (fs.existsSync(judgePath)) judge = loadYaml(judgePath);
  } catch (e) {
    error(`consistency:${rel}`, `Error loading documents: ${e.message}`);
    return;
  }

  // task_id consistency across documents
  const taskIds = new Map();
  if (manifest.task_id) taskIds.set('manifest', manifest.task_id);
  if (packet && packet.task_id) taskIds.set('packet', packet.task_id);
  if (judge && judge.task_id) taskIds.set('judge', judge.task_id);

  if (taskIds.size >= 2) {
    const uniqueIds = new Set(taskIds.values());
    if (uniqueIds.size > 1) {
      const inconsistencies = [...taskIds.entries()]
        .map(([src, id]) => `${src}:${id}`)
        .join(', ');
      error(`consistency:${rel}`, `task_id mismatch across documents: ${inconsistencies}`);
    }
  }

  // agent_id consistency across documents
  const agentIds = new Map();
  if (manifest.agent_id) agentIds.set('manifest', manifest.agent_id);
  if (packet && packet.agent_id) agentIds.set('packet', packet.agent_id);
  if (judge && judge.agent_id) agentIds.set('judge', judge.agent_id);

  if (agentIds.size >= 2) {
    const uniqueIds = new Set(agentIds.values());
    if (uniqueIds.size > 1) {
      const inconsistencies = [...agentIds.entries()]
        .map(([src, id]) => `${src}:${id}`)
        .join(', ');
      error(`consistency:${rel}`, `agent_id mismatch across documents: ${inconsistencies}`);
    }
  }

  // run_id consistency
  const runIds = new Map();
  if (manifest.run_id) runIds.set('manifest', manifest.run_id);
  if (packet && packet.run_id) runIds.set('packet', packet.run_id);

  if (runIds.size >= 2) {
    const uniqueIds = new Set(runIds.values());
    if (uniqueIds.size > 1) {
      const inconsistencies = [...runIds.entries()]
        .map(([src, id]) => `${src}:${id}`)
        .join(', ');
      error(`consistency:${rel}`, `run_id mismatch across documents: ${inconsistencies}`);
    }
  }

  // timetable consistency
  if (packet && packet.started_at && packet.ended_at) {
    const start = new Date(packet.started_at);
    const end = new Date(packet.ended_at);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      warn(`consistency:${rel}`, 'Result packet contains invalid date values in started_at/ended_at');
    } else if (end < start) {
      error(`consistency:${rel}`, `ended_at (${packet.ended_at}) is before started_at (${packet.started_at})`);
    }
  }

  // Score consistency (run score checks)
  if (judge) {
    checkScoreConsistency(judge, judgePath);
  }

  // Evidence reference integrity
  if (packet) {
    checkEvidenceIntegrity(packet, trace, null, packetPath);
  }

  // Forbidden metadata checks on all documents
  for (const [doc, docPath] of [[packet, packetPath], [trace, tracePath], [judge, judgePath]]) {
    if (doc) {
      checkForbiddenMetadata(doc, doc.label || '', docPath);
      checkApprovalBoundaries(doc, docPath);
      checkHiddenJudgeMaterial(doc, docPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Main command dispatch
// ---------------------------------------------------------------------------

function cmdRunManifests(roundDir) {
  console.log(`\n=== Competition-Validity: Run Manifest Integrity ===\n`);
  const fullPath = path.resolve(ROOT, roundDir);

  if (!fs.existsSync(fullPath)) {
    console.log(`No directory found at ${roundDir} — no run manifests to check.`);
    process.exit(0);
  }

  // Find all manifest.yaml files in run subdirectories
  let runDirs = [];
  for (const entry of fs.readdirSync(fullPath, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith('run-')) {
      const manifestPath = path.join(fullPath, entry.name, 'manifest.yaml');
      if (fs.existsSync(manifestPath)) {
        runDirs.push({ dir: path.join(fullPath, entry.name), manifestPath });
      } else {
        warn('run-manifests', `Run dir "${entry.name}" is missing manifest.yaml`);
      }
    }
  }

  if (runDirs.length === 0) {
    warn('run-manifests', 'No run directories with manifest.yaml found');
  }

  for (const { dir, manifestPath } of runDirs) {
    checkRunManifest(manifestPath);
  }

  printSummary();
  process.exit(errors > 0 ? 1 : 0);
}

function cmdEngineOutputs(roundDir) {
  console.log(`\n=== Competition-Validity: Engine Outputs ===\n`);
  const fullPath = path.resolve(ROOT, roundDir);

  if (!fs.existsSync(fullPath)) {
    console.log(`No directory found at ${roundDir} — no engine outputs to check.`);
    process.exit(0);
  }

  const runDirs = fs.readdirSync(fullPath)
    .filter(e => fs.statSync(path.join(fullPath, e)).isDirectory() && e.startsWith('run-'));

  if (runDirs.length === 0) {
    warn('engine-outputs', 'No run directories found');
  }

  for (const dirName of runDirs) {
    const runDir = path.join(fullPath, dirName);
    const manifestPath = path.join(runDir, 'manifest.yaml');
    const manifest = fs.existsSync(manifestPath) ? checkRunManifest(manifestPath) : null;
    checkEngineOutputs(runDir, manifest);
  }

  printSummary();
  process.exit(errors > 0 ? 1 : 0);
}

function cmdConsistency(roundDir) {
  console.log(`\n=== Competition-Validity: Cross-Document Consistency ===\n`);
  const fullPath = path.resolve(ROOT, roundDir);

  if (!fs.existsSync(fullPath)) {
    console.log(`No directory found at ${roundDir} — no cross-document consistency checks to perform.`);
    process.exit(0);
  }

  const runDirs = fs.readdirSync(fullPath)
    .filter(e => fs.statSync(path.join(fullPath, e)).isDirectory() && e.startsWith('run-'));

  if (runDirs.length === 0) {
    warn('consistency', 'No run directories found');
  }

  for (const dirName of runDirs) {
    const runDir = path.join(fullPath, dirName);
    const manifestPath = path.join(runDir, 'manifest.yaml');
    const manifest = fs.existsSync(manifestPath) ? loadYaml(manifestPath) : null;
    checkCrossDocumentConsistency(runDir, manifest);
  }

  printSummary();
  process.exit(errors > 0 ? 1 : 0);
}

function cmdAll(roundDir) {
  console.log(`\n============================================`);
  console.log(`Competition-Validity: Full Check`);
  console.log(`============================================\n`);
  const fullPath = path.resolve(ROOT, roundDir);

  if (!fs.existsSync(fullPath)) {
    console.log(`No directory found at ${roundDir} — checking repo-wide YAML files instead.`);
    const yamlFiles = findYamlFiles('.');
    if (yamlFiles.length === 0) {
      console.log('No YAML files found in repository.');
      process.exit(0);
    }
    const excludedDirs = /node_modules|\.git/;
    for (const f of yamlFiles) {
      if (excludedDirs.test(f)) continue;
      try {
        const doc = loadYaml(f);
        if (doc && typeof doc === 'object') {
          // Skip task envelopes when doing repo-wide scan — they're internal
          // competition definitions, not participant submission artifacts.
          // Other checks (forbidden metadata, approval boundaries) still apply.
          const isTask = /\btasks\b/.test(f);
          checkForbiddenMetadata(doc, f, f);
          checkApprovalBoundaries(doc, f);
          if (!isTask) {
            checkHiddenJudgeMaterial(doc, f);
          }
          if (doc.judge_record_id) {
            checkScoreConsistency(doc, f);
          }
        }
      } catch (e) {
        warn('all', `Error processing ${path.relative(ROOT, f)}: ${e.message}`);
      }
    }
    printSummary();
    process.exit(errors > 0 ? 1 : 0);
  }

  const runDirs = fs.readdirSync(fullPath)
    .filter(e => fs.statSync(path.join(fullPath, e)).isDirectory() && e.startsWith('run-'));

  if (runDirs.length === 0) {
    warn('all', 'No run directories found — checking files in directory path only');
    // Fall back to checking individual YAML files
    const yamlFiles = findYamlFiles(roundDir);
    for (const f of yamlFiles) {
      try {
        const doc = loadYaml(f);
        if (doc && typeof doc === 'object') {
          checkForbiddenMetadata(doc, f, f);
          checkApprovalBoundaries(doc, f);
          // Skip task envelopes for hidden judge material check
          if (!/\btasks\b/.test(f)) {
            checkHiddenJudgeMaterial(doc, f);
          }
          if (doc.judge_record_id) {
            checkScoreConsistency(doc, f);
          }
        }
      } catch (e) {
        warn('all', `Error processing ${path.relative(ROOT, f)}: ${e.message}`);
      }
    }
  }

  for (const dirName of runDirs) {
    const runDir = path.join(fullPath, dirName);
    const manifestPath = path.join(runDir, 'manifest.yaml');

    let manifest = null;
    if (fs.existsSync(manifestPath)) {
      manifest = checkRunManifest(manifestPath);
    } else {
      warn(`all:${dirName}`, 'Directory missing manifest.yaml');
    }

    checkEngineOutputs(runDir, manifest);
    checkCrossDocumentConsistency(runDir, manifest);
  }

  printSummary();
  process.exit(errors > 0 ? 1 : 0);
}

function cmdFixtures(fixturesDir) {
  console.log(`\n=== Competition-Validity: Fixtures ===\n`);
  const fullPath = path.resolve(ROOT, fixturesDir);

  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
    error('input', `Fixtures directory not found: ${fixturesDir}`);
    printSummary();
    process.exit(1);
  }

  const yamlFiles = findYamlFiles(fixturesDir);
  if (yamlFiles.length === 0) {
    warn('fixtures', 'No YAML files found in fixtures directory');
  }

  let passedFiles = 0;
  let failedFiles = 0;
  let expectedFailures = 0;

  for (const f of yamlFiles) {
    const rel = path.relative(ROOT, f);
    const basename = path.basename(f);
    const isNegative = basename.includes('negative') || basename.includes('invalid');

    // Clear check accumulator for per-file reporting
    const fileErrors = errors;
    const fileWarnings = warnings;

    try {
      const doc = loadYaml(f);
      if (doc && typeof doc === 'object') {
        checkForbiddenMetadata(doc, f, f);
        checkApprovalBoundaries(doc, f);
        checkHiddenJudgeMaterial(doc, f);
        if (doc.judge_record_id) {
          checkScoreConsistency(doc, f);
        }
      }
    } catch (e) {
      if (isNegative) {
        console.log(`OK    ${rel}  (expected failure)`);
        expectedFailures++;
      } else {
        console.error(`FAIL  ${rel}  - ${e.message}`);
        failedFiles++;
      }
      continue;
    }

    const newErrors = errors - fileErrors;
    const newWarnings = warnings - fileWarnings;

    if (isNegative) {
      // Negative fixture: errors expected (competition-invalid)
      if (newErrors > 0) {
        console.log(`OK    ${rel}  (expected failure — ${newErrors} error(s), ${newWarnings} warning(s))`);
        expectedFailures++;
      } else {
        console.log(`FAIL  ${rel}  (unexpected pass — negative fixture should fail)`);
        failedFiles++;
      }
    } else {
      // Positive fixture: errors = failure
      if (newErrors > 0) {
        console.log(`FAIL  ${rel}  - ${newErrors} error(s), ${newWarnings} warning(s)`);
        failedFiles++;
      } else {
        console.log(`OK    ${rel}  (pass)`);
        passedFiles++;
      }
    }
  }

  // Clean up accumulated counts — fixtures mode reports separately
  errors = 0;
  warnings = 0;

  console.log(`\n--- Summary ---`);
  console.log(`Passed:    ${passedFiles}`);
  console.log(`Failed:    ${failedFiles}`);
  console.log(`Expected failures: ${expectedFailures}`);

  process.exit(failedFiles > 0 ? 1 : 0);
}

function cmdHelp() {
  console.log(`
Agent Olympics Competition-Validity Validator

Usage:
  node scripts/competition-validity.js <command> [path]

Commands:
  run-manifests <round-dir>   Validate run manifests in a round dir
  engine-outputs <round-dir>  Validate engine outputs per run
  consistency <round-dir>     Cross-document consistency checks
  all <round-dir>             All competition-validity checks
  fixtures <fixtures-dir>     Validate competition-validity fixtures

Path defaults:
  <round-dir>    runs/<season>/<round> (e.g., runs/season-001/round-001)
  <fixtures-dir> fixtures/competition-validity/

Exit code: 0 = all checks pass, 1 = any check failed
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'help';
  const cmdArg = args[1];

  switch (cmd) {
    case 'run-manifests':
      cmdRunManifests(cmdArg || '.');
      break;
    case 'engine-outputs':
      cmdEngineOutputs(cmdArg || '.');
      break;
    case 'consistency':
      cmdConsistency(cmdArg || '.');
      break;
    case 'all':
      cmdAll(cmdArg || '.');
      break;
    case 'fixtures':
      cmdFixtures(cmdArg || 'fixtures/competition-validity');
      break;
    case 'help':
    case '--help':
    case '-h':
      cmdHelp();
      break;
    default:
      console.error(`Unknown command: "${cmd}"`);
      console.error('Usage: node scripts/competition-validity.js <command> [path]');
      process.exit(1);
  }
}

main();
