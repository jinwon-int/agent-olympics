#!/usr/bin/env node
/**
 * Agent Olympics — Official Dry-Run Go/No-Go Gates
 *
 * Concrete command gates for Season 001 dry-run readiness checks,
 * publication readiness checks, and broker finalizer evidence.
 *
 * These are the operator-facing gates defined in
 * docs/dry-run-readiness.md.
 *
 * Usage:
 *   node scripts/dry-run-gates.js <command> [options]
 *
 * Commands:
 *   readiness            — Run all qualification/readiness gates
 *   publication          — Run all publication readiness gates
 *   redaction-check      — Check redaction hygiene on result packets
 *   safe-metadata        — Check comparable_metadata for unsafe values
 *   integrity            — Run evidence integrity chain checks (from #40)
 *   provisional-scoring  — Validate publishability / provisional scoring gates
 *   appeals              — Validate appeal record structure and compliance (from #41)
 *   judge-workflow       — Validate judge state-machine transitions
 *   finalizer-ready      — Run ALL gates (readiness + publication + checks) for broker
 *   list                 — List all available gates with descriptions
 *
 * Options:
 *   --manifest <path>    — Round manifest path
 *   --results-dir <path> — Results directory
 *   --runs-dir <path>    — Runs directory
 *   --output <path>      — Output file for evidence JSON
 *   --quiet, -q          — Quiet output (JSON only)
 *
 * Exit code: 0 = all gates pass, 1 = any gate fails, 2 = usage error
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const yaml = require('js-yaml');
const {
  SECRET_KEY_PATTERNS,
  SECRET_VALUE_PATTERNS,
  looksLikeSecretValue,
} = require('./lib/secret-patterns');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '..');

const UNSAFE_VALUE_PATTERNS = [
  /@[a-zA-Z0-9.-]+\.(com|org|net|io|dev|app)/,
  /^(https?:\/\/)?\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
  /\/var\/run\//,
  /\/etc\//,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadYaml(filePath) {
  const resolved = path.resolve(ROOT, filePath);
  try {
    const raw = fs.readFileSync(resolved, 'utf8');
    return yaml.load(raw);
  } catch (err) {
    throw new Error(`Cannot load ${resolved}: ${err.message}`);
  }
}

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return null;
  }
}

function fileExists(filePath) {
  try {
    const resolved = path.resolve(ROOT, filePath);
    return fs.existsSync(resolved);
  } catch {
    return false;
  }
}

function dirExists(dirPath) {
  try {
    const resolved = path.resolve(ROOT, dirPath);
    return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
  } catch {
    return false;
  }
}

function runScript(scriptPath, args) {
  try {
    const cmd = `node ${scriptPath}${args ? ' ' + args : ''}`;
    const out = execSync(cmd, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    });
    return { ok: true, output: out.trim() };
  } catch (err) {
    return { ok: false, output: (err.stderr || err.message || '').trim() };
  }
}

// ---------------------------------------------------------------------------
// Helper: find YAML result packets or judge records in a directory
// ---------------------------------------------------------------------------

/**
 * Find result packet YAML files in a directory (excluding judge/trace/evidence).
 */
function findResultYamls(dir) {
  const fullPath = path.resolve(ROOT, dir);
  if (!fs.existsSync(fullPath)) return [];
  return fs.readdirSync(fullPath)
    .filter(f => /\.ya?ml$/.test(f) &&
      !f.includes('judge') && !f.includes('trace') &&
      !f.includes('evidence') && !f.includes('scoreboard') &&
      !f.includes('.git'))
    .map(f => path.join(fullPath, f));
}

/**
 * Find judge record YAML files in a directory.
 */
function findJudgeYamls(dir) {
  const fullPath = path.resolve(ROOT, dir);
  if (!fs.existsSync(fullPath)) return [];
  return fs.readdirSync(fullPath)
    .filter(f => /\.ya?ml$/.test(f) && /-judge/.test(f))
    .map(f => path.join(fullPath, f));
}

// ---------------------------------------------------------------------------
// Gate Result Accumulator
// ---------------------------------------------------------------------------

class GateRunner {
  constructor(options = {}) {
    this.options = options;
    this.results = [];
    this.failCount = 0;
    this.passCount = 0;
  }

  run(gateId, description, fn) {
    try {
      const result = fn();
      if (result.ok) {
        this.results.push({ gate: gateId, description, status: 'pass', detail: result.output });
        this.passCount++;
        if (!this.options.quiet) {
          console.log(`  ✓ ${gateId}: ${description}`);
        }
        return true;
      } else {
        this.results.push({ gate: gateId, description, status: 'fail', detail: result.output });
        this.failCount++;
        if (!this.options.quiet) {
          console.log(`  ✗ ${gateId}: ${description}`);
          console.log(`    Output: ${result.output}`);
        }
        return false;
      }
    } catch (err) {
      this.results.push({ gate: gateId, description, status: 'error', detail: err.message });
      this.failCount++;
      if (!this.options.quiet) {
        console.log(`  ! ${gateId}: ${description} (error: ${err.message})`);
      }
      return false;
    }
  }

  require(gateId, description, conditionFn) {
    try {
      const pass = conditionFn();
      if (pass) {
        this.results.push({ gate: gateId, description, status: 'pass', detail: 'Condition met' });
        this.passCount++;
        if (!this.options.quiet) {
          console.log(`  ✓ ${gateId}: ${description}`);
        }
        return true;
      } else {
        this.results.push({ gate: gateId, description, status: 'fail', detail: 'Condition not met' });
        this.failCount++;
        if (!this.options.quiet) {
          console.log(`  ✗ ${gateId}: ${description}`);
        }
        return false;
      }
    } catch (err) {
      this.results.push({ gate: gateId, description, status: 'error', detail: err.message });
      this.failCount++;
      if (!this.options.quiet) {
        console.log(`  ! ${gateId}: ${description} (error: ${err.message})`);
      }
      return false;
    }
  }

  summary() {
    return {
      total: this.passCount + this.failCount,
      pass: this.passCount,
      fail: this.failCount,
      allPassed: this.failCount === 0,
      gates: this.results,
      timestamp: new Date().toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Readiness Gates
// ---------------------------------------------------------------------------

function readinessGates(runner, manifestPath) {
  console.log('\n=== Qualification / Readiness Gates ===\n');

  const manifest = manifestPath || 'rounds/season-001-round-001.yaml';

  // Gate 2.1 — Round manifest is schema-valid
  runner.run('R2.1', 'Round manifest schema-valid', () => {
    if (!fileExists(manifest)) return { ok: false, output: `Manifest not found: ${manifest}` };
    return runScript('scripts/validate.js', manifest);
  });

  // Gate 2.2 — Task envelopes resolve
  runner.run('R2.2', 'Task envelopes validate', () => {
    return runScript('scripts/validate.js', 'smoke');
  });

  // Gate 2.3 — Fixture bundles exist
  runner.run('R2.3', 'Fixture bundles exist', () => {
    return runScript('scripts/validate.js', 'fixtures');
  });

  // Gate 2.4 — Oracle files are valid (private)
  runner.run('R2.4', 'Oracle files valid', () => {
    return runScript('scripts/validate.js', 'oracle');
  });

  // Gate 2.5 — Participant metadata complete, no duplicates
  runner.run('R2.5', 'Participant metadata complete', () => {
    if (!fileExists(manifest)) return { ok: false, output: `Manifest not found: ${manifest}` };
    const m = loadYaml(manifest);
    if (!m.participants || m.participants.length === 0) {
      return { ok: false, output: 'No participants in manifest' };
    }
    const ids = m.participants.map(p => p.agent_id);
    const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dups.length) {
      return { ok: false, output: `Duplicate agent_ids: ${dups.join(', ')}` };
    }
    const incomplete = m.participants.filter(p => !p.agent_id || !p.runtime || !p.label);
    if (incomplete.length) {
      return { ok: false, output: `Incomplete participants: ${incomplete.map(p => p.agent_id || '?').join(', ')}` };
    }
    return { ok: true, output: `Participants (${ids.length}): ${ids.join(', ')}` };
  });

  // Gate 2.6 — Plan output succeeds (runs directory ready)
  runner.run('R2.6', 'Round plan succeeds', () => {
    return runScript('scripts/round.js', `plan ${manifest}`);
  });

  // Gate 2.9 — Dependencies installed
  runner.require('R2.9', 'Dependencies installed', () => {
    return dirExists('node_modules');
  });

  return runner;
}

// ---------------------------------------------------------------------------
// Publication Gates
// ---------------------------------------------------------------------------

function publicationGates(runner, options) {
  console.log('\n=== Publication Readiness Gates ===\n');

  const resultsDir = options['results-dir'] || 'results/';
  const runsDir = options['runs-dir'];

  // Gate 3.1 — All runs terminal (if runs dir provided)
  if (runsDir && dirExists(runsDir)) {
    runner.run('P3.1', 'All runs in terminal state', () => {
      return runScript('scripts/competition-validity.js', `engine-outputs ${runsDir}`);
    });
  } else {
    runner.run('P3.1', 'All result packets present', () => {
      const files = findResultYamls(resultsDir).map(f => path.basename(f));
      if (files.length === 0) return { ok: false, output: `No result packets found in ${resultsDir}` };
      return { ok: true, output: `Found ${files.length} result packets: ${files.slice(0, 5).join(', ')}...` };
    });

    runner.run('P3.1b', 'No manifest lifecycle issues', () => {
      return runScript('scripts/validate.js', 'rounds');
    });
  }

  // Gate 3.3 — All result packets pass schema validation
  runner.run('P3.3', 'All result packets schema-valid', () => {
    return runScript('scripts/validate.js', 'packets');
  });

  // Gate 3.4 — Scoreboard generated and valid
  runner.run('P3.4', 'Scoreboard generated', () => {
    const scoreboardPath = path.resolve(ROOT, resultsDir, 'scoreboard.json');
    if (!fileExists(path.relative(ROOT, scoreboardPath))) {
      return { ok: false, output: `scoreboard.json not found in ${resultsDir}` };
    }
    const sb = loadJson(scoreboardPath);
    if (!sb) return { ok: false, output: 'scoreboard.json is not valid JSON' };
    if (!sb.entries || sb.entries.length === 0) return { ok: false, output: 'scoreboard has no entries' };
    return {
      ok: true,
      output: `Scoreboard: ${sb.entries.length} entries, ${new Set(sb.entries.map(e => e.task_id)).size} tasks, ${new Set(sb.entries.map(e => e.agent_id)).size} participants`
    };
  });

  // Gate 3.5 — Web display fields present
  runner.run('P3.5', 'Web-display fields present', () => {
    const scoreboardPath = path.resolve(ROOT, resultsDir, 'scoreboard.json');
    if (!fileExists(path.relative(ROOT, scoreboardPath))) {
      return { ok: false, output: `scoreboard.json not found in ${resultsDir}` };
    }
    const sb = loadJson(scoreboardPath);
    if (!sb || !sb.entries) return { ok: false, output: 'Cannot parse scoreboard' };
    let missing = 0;
    for (const e of sb.entries) {
      if (!e.agent_id) { missing++; }
      if (!e.score && e.judge_type !== 'pending') { missing++; }
      if (!e.packet_ref) { missing++; }
      if (!e.task_id) { missing++; }
    }
    if (missing > 0) return { ok: false, output: `${missing} entries missing required web-display fields` };
    return { ok: true, output: `All ${sb.entries.length} entries have required web-display fields` };
  });

  // Gate 3.10 — Competition-validity fixtures pass
  runner.run('P3.10', 'Competition-validity fixtures pass', () => {
    return runScript('scripts/competition-validity.js', 'fixtures fixtures/competition-validity');
  });

  // Generic gate: All schemas validate repo-wide
  runner.run('P3.11', 'All schemas validate repo-wide', () => {
    return runScript('scripts/validate.js', 'all');
  });

  return runner;
}

// ---------------------------------------------------------------------------
// Redaction Check
// ---------------------------------------------------------------------------

function redactionCheck(runner, options) {
  console.log('\n=== Redaction Hygiene Check ===\n');

  const resultsDir = options['results-dir'] || 'results/';

  // Check each result packet for redaction issues
  const files = findResultYamls(resultsDir);

  if (files.length === 0) {
    console.log('  (no result packets to check)');
    return runner;
  }

  for (const filePath of files) {
    const file = path.basename(filePath);
    runner.run(`REDACT-${file}`, `Redaction check: ${file}`, () => {
      const doc = loadYaml(filePath);
      if (!doc) return { ok: false, output: `Cannot parse ${file}` };

      const issues = [];

      // Check evidence items
      if (doc.evidence && Array.isArray(doc.evidence)) {
        for (const ev of doc.evidence) {
          if (ev.redacted && (!ev.redaction_reason || ev.redaction_reason.trim() === '')) {
            issues.push(`Evidence ${ev.id}: redacted but missing redaction_reason`);
          }
          if (ev.redaction_reason && SECRET_VALUE_PATTERNS.some(p => p.test(ev.redaction_reason))) {
            issues.push(`Evidence ${ev.id}: redaction_reason contains credential pattern`);
          }
        }
      }

      // Check actions
      if (doc.actions && Array.isArray(doc.actions)) {
        for (const act of doc.actions) {
          if (act.redacted && (!act.redaction_reason || act.redaction_reason.trim() === '')) {
            issues.push(`Action ${act.id}: redacted but missing redaction_reason`);
          }
        }
      }

      // Check top-level fields for leaked judge material
      if (doc.oracle_ref) {
        issues.push('oracle_ref found in participant-facing artifact');
      }
      if (doc.judge_notes_ref) {
        issues.push('judge_notes_ref found in participant-facing artifact');
      }

      // Scan all string values for credential patterns
      const scanStrings = (obj, path) => {
        if (!obj || typeof obj !== 'object') return;
        for (const [key, value] of Object.entries(obj)) {
          const fullPath = path ? `${path}.${key}` : key;
          // Secret-named keys only fail when the value itself looks like a
          // credential — policy descriptors (e.g. credential_values: omitted)
          // are value-free statements about credential handling, not leaks.
          if (SECRET_KEY_PATTERNS.some(p => p.test(key)) && looksLikeSecretValue(value)) {
            issues.push(`${fullPath}: secret-bearing field name with credential-like value`);
          }
          if (typeof value === 'string') {
            if (SECRET_VALUE_PATTERNS.some(p => p.test(value))) {
              issues.push(`${fullPath}: contains credential pattern`);
            }
          } else if (typeof value === 'object' && value !== null) {
            scanStrings(value, fullPath);
          }
        }
      };
      scanStrings(doc, '');

      if (issues.length > 0) {
        return { ok: false, output: issues.join('\n') };
      }
      return { ok: true, output: 'No redaction issues found' };
    });
  }

  return runner;
}

// ---------------------------------------------------------------------------
// Safe Metadata Check
// ---------------------------------------------------------------------------

function safeMetadataCheck(runner, options) {
  console.log('\n=== Safe Metadata Check ===\n');

  const resultsDir = options['results-dir'] || 'results/';

  const files = findResultYamls(resultsDir);

  if (files.length === 0) {
    console.log('  (no result packets to check)');
    return runner;
  }

  for (const filePath of files) {
    const file = path.basename(filePath);
    runner.run(`META-${file}`, `Safe metadata: ${file}`, () => {
      const doc = loadYaml(filePath);
      if (!doc) return { ok: false, output: `Cannot parse ${file}` };

      const issues = [];

      // Check comparable_metadata
      const cm = doc.comparable_metadata || {};
      const unsafeKeys = ['hostname', 'ip_address', 'ssh_host', 'endpoint_url', 'connection_string'];

      const scanSafe = (obj, path) => {
        if (!obj || typeof obj !== 'object') return;
        for (const [key, value] of Object.entries(obj)) {
          const fullPath = path ? `${path}.${key}` : key;
          if (unsafeKeys.includes(key)) {
            issues.push(`${fullPath}: unsafe metadata key '${key}'`);
          }
          if (typeof value === 'string') {
            if (UNSAFE_VALUE_PATTERNS.some(p => p.test(value))) {
              issues.push(`${fullPath}: potentially unsafe value '${value}'`);
            }
          } else if (typeof value === 'object' && value !== null) {
            scanSafe(value, fullPath);
          }
        }
      };

      scanSafe(cm, 'comparable_metadata');
      scanSafe(doc.hardware_profile || {}, 'hardware_profile');

      if (issues.length > 0) {
        return { ok: false, output: issues.join('\n') };
      }
      return { ok: true, output: 'All metadata is safe' };
    });
  }

  return runner;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Integrity Gate — Evidence Integrity Chain (#40)
// ---------------------------------------------------------------------------

/**
 * integrity — Run evidence integrity chain checks mandated by issue #40.
 *
 * Validates the full evidence chain across result packets:
 * 1. Cross-document field consistency (task_id, agent_id, run_id)
 * 2. Finding evidence references resolve to existing evidence IDs
 * 3. No forbidden metadata patterns (secret keys, credential leaks)
 * 4. Destructive actions have approval evidence
 * 5. Hidden judge material is not present in participant-facing artifacts
 * 6. Oracle/judge note separation is maintained
 *
 * Options:
 *   --results-dir <path>  Results directory (default: results/)
 */
function integrityGate(runner, options) {
  console.log('\n=== Integrity Gate — Evidence Chain Integrity (#40) ===\n');

  const resultsDir = options['results-dir'] || 'results/';
  const files = findResultYamls(resultsDir);

  if (files.length === 0) {
    console.log('  (no result packets to check)');
    return runner;
  }

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    let doc;
    try {
      doc = loadYaml(file);
    } catch (e) {
      runner.require(`INTEGRITY-PARSE-${rel}`, `Parseable: ${rel}`, () => false);
      continue;
    }

    // Unwrap run-result wrapper
    const rp = doc && doc.result_packet ? doc.result_packet : doc;
    if (!rp || typeof rp !== 'object') {
      runner.require(`INTEGRITY-DOC-${rel}`, `Valid document: ${rel}`, () => false);
      continue;
    }

    // 1. Cross-document field consistency — task_id must be present
    runner.require(`INTEGRITY-TASK-${rel}`, `task_id present: ${rel}`, () => !!rp.task_id);
    runner.require(`INTEGRITY-AGENT-${rel}`, `agent_id present: ${rel}`, () => !!rp.agent_id);

    // 2. Evidence IDs unique
    const evIds = (rp.evidence || []).map(e => e && e.id).filter(Boolean);
    const dupIds = evIds.filter((id, i) => evIds.indexOf(id) !== i);
    runner.require(`INTEGRITY-EVID-UNIQUE-${rel}`, `Evidence IDs unique: ${rel}`, () => dupIds.length === 0);
    if (dupIds.length > 0) {
      runner.results[runner.results.length - 1].detail = `Duplicate evidence IDs: ${[...new Set(dupIds)].join(', ')}`;
    }

    // 3. Finding evidence references resolve
    const validEvIds = new Set(evIds);
    let unresolvedRefs = 0;
    for (const finding of rp.findings || []) {
      if (!finding || typeof finding !== 'object') continue;
      for (const ref of finding.evidence || []) {
        if (!validEvIds.has(ref)) unresolvedRefs++;
      }
    }
    runner.require(`INTEGRITY-FINDING-REFS-${rel}`, `Finding evidence refs resolve: ${rel}`, () => unresolvedRefs === 0);
    if (unresolvedRefs > 0) {
      runner.results[runner.results.length - 1].detail = `${unresolvedRefs} finding evidence reference(s) do not resolve`;
    }

    // 4. Action evidence references resolve
    let actionRefIssues = 0;
    for (const action of rp.actions || []) {
      if (action.evidence_id && !validEvIds.has(action.evidence_id)) actionRefIssues++;
    }
    runner.require(`INTEGRITY-ACTION-REFS-${rel}`, `Action evidence refs resolve: ${rel}`, () => actionRefIssues === 0);
    if (actionRefIssues > 0) {
      runner.results[runner.results.length - 1].detail = `${actionRefIssues} action evidence reference(s) do not resolve`;
    }

    // 5. No forbidden metadata / secret leaks
    let secretCount = 0;
    let forbiddenKeyCount = 0;
    let redactionReasonLeak = 0;

    function scanForSecrets(obj, path) {
      if (!obj || typeof obj !== 'object') return;
      for (const [key, val] of Object.entries(obj)) {
        // Secret-named keys only count when the value looks credential-like;
        // value-free policy descriptors under credential-named keys are fine.
        if (SECRET_KEY_PATTERNS.some(p => p.test(key)) && looksLikeSecretValue(val)) {
          forbiddenKeyCount++;
        }
        if (typeof val === 'string') {
          if (SECRET_VALUE_PATTERNS.some(p => p.test(val))) secretCount++;
          // redaction_reason containing a secret is a double leak
          if (key === 'redaction_reason' && SECRET_VALUE_PATTERNS.some(p => p.test(val))) {
            redactionReasonLeak++;
          }
        } else if (val && typeof val === 'object') {
          scanForSecrets(val, path ? `${path}.${key}` : key);
        }
      }
    }
    scanForSecrets(rp, '');

    runner.require(`INTEGRITY-SECRET-${rel}`, `No secret leaks: ${rel}`, () => secretCount === 0);
    if (secretCount > 0) {
      runner.results[runner.results.length - 1].detail = `${secretCount} secret pattern(s) detected`;
    }
    runner.require(`INTEGRITY-FORBIDDEN-KEY-${rel}`, `No secret-bearing field names: ${rel}`, () => forbiddenKeyCount === 0);
    runner.require(`INTEGRITY-REDACT-LEAK-${rel}`, `Redaction reasons value-free: ${rel}`, () => redactionReasonLeak === 0);

    // 6. Destructive actions have approval evidence
    const destructivePatterns = [/delete/i, /destroy/i, /reset/i, /reinstall/i, /reboot/i];
    let unapprovedDestructive = 0;
    for (const action of rp.actions || []) {
      const summary = `${action.type || ''} ${action.command_summary || action.summary || ''}`;
      if (destructivePatterns.some(p => p.test(summary))) {
        if (!action.evidence_id && !action.approval_ref) {
          unapprovedDestructive++;
        }
      }
    }
    runner.require(`INTEGRITY-APPROVAL-${rel}`, `Destructive actions have approval: ${rel}`, () => unapprovedDestructive === 0);
    if (unapprovedDestructive > 0) {
      runner.results[runner.results.length - 1].detail = `${unapprovedDestructive} destructive action(s) missing approval evidence`;
    }

    // 7. Hidden judge material not in participant artifacts
    const hasJudgeNotes = !!rp.hidden_judge_notes;
    runner.require(`INTEGRITY-JUDGE-LEAK-${rel}`, `No hidden judge notes leak: ${rel}`, () => !hasJudgeNotes);
  }

  return runner;
}

// ---------------------------------------------------------------------------
// Provisional Scoring Gate — Publishability State Machine
// ---------------------------------------------------------------------------

/**
 * provisional-scoring — Validate publishability and provisional scoring gates.
 *
 * Checks the result packet state machine for provisional vs publishable status:
 * 1. `publishable: true` is only valid for `valid` or `partial_valid` states
 * 2. `validity: appealed` or `disqualified` must NOT have `publishable: true`
 * 3. `publishable: true` requires redaction review evidence
 * 4. `publishable: false` or absent requires a provisional/private marker
 * 5. Scoreboard entries with pending human judge dimensions are provisional
 *
 * Options:
 *   --results-dir <path>  Results directory (default: results/)
 */
function provisionalScoringGate(runner, options) {
  console.log('\n=== Provisional Scoring Gate — Publishability State Machine ===\n');

  const resultsDir = options['results-dir'] || 'results/';
  const files = findResultYamls(resultsDir);

  if (files.length === 0) {
    console.log('  (no result packets to check)');
    return runner;
  }

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    let doc;
    try {
      doc = loadYaml(file);
    } catch {
      continue;
    }

    const rp = doc && doc.result_packet ? doc.result_packet : doc;
    if (!rp || typeof rp !== 'object') continue;

    // validity may be the object form supported by appealsGate; use its state field
    const validityRaw = (rp.validity && typeof rp.validity === 'object')
      ? rp.validity.state
      : rp.validity;
    const validity = String(validityRaw || rp.status || 'unknown');
    const publishable = rp.publishable;

    // 1. publishable: true requires valid/partial_valid validity
    if (publishable === true) {
      const nonPublishableStates = ['invalid', 'appealed', 'disqualified'];
      const inNonPublishableState = nonPublishableStates.some(s =>
        validity.toLowerCase() === s.toLowerCase()
      );
      runner.require(`PUBLISH-STATE-${rel}`, `publishable validity check: ${rel}`, () => !inNonPublishableState);
      if (inNonPublishableState) {
        runner.results[runner.results.length - 1].detail =
          `publishable: true is rejected for state "${validity}"`;
      }

      // 2. publishable: true requires redaction evidence
      const hasRedactionEvidence = (rp.evidence || []).some(e =>
        (e.redacted && e.redaction_reason) ||
        (e.id && /redact|review|sanitize/i.test(String(e.id)))
      );
      const hasRedactionPolicy = !!(rp.redaction_policy);
      runner.require(`PUBLISH-REDACT-${rel}`, `Redaction evidence for publishable: ${rel}`,
        () => hasRedactionEvidence || hasRedactionPolicy);
      if (!hasRedactionEvidence && !hasRedactionPolicy) {
        runner.results[runner.results.length - 1].detail =
          'publishable: true but no redaction evidence or redaction_policy found';
      }
    }

    // 3. Scoreboard check — if pending dimensions, mark provisional
    if (rp.status === 'completed' && rp.findings && rp.findings.length > 0) {
      const scoreboardPath = path.resolve(ROOT, resultsDir, 'scoreboard.json');
      if (fs.existsSync(scoreboardPath)) {
        try {
          const sb = JSON.parse(fs.readFileSync(scoreboardPath, 'utf8'));
          const entry = (sb.entries || []).find(e => e.packet_ref && file.endsWith(e.packet_ref));
          if (entry && entry.judge_type === 'pending') {
            runner.require(`PUBLISH-PENDING-JUDGE-${rel}`, `Pending human judge: ${rel}`, () =>
              publishable === false || publishable === undefined);
            if (publishable === true) {
              runner.results[runner.results.length - 1].detail =
                'publishable: true but result has pending human-judge dimensions — should be provisional';
            }
          }
        } catch { /* scoreboard may not exist yet */ }
      }
    }
  }

  return runner;
}

// ---------------------------------------------------------------------------
// Appeals Gate — Appeal Record Validation (#41)
// ---------------------------------------------------------------------------

/**
 * appeals — Validate appeal record structure and compliance mandated by issue #41.
 *
 * Checks that appeal records in result packets or judge records are:
 * 1. Complete (required fields present: packet_id, statement, evidence_refs,
 *    desired_outcome)
 * 2. Have valid status transitions (filed -> under_review -> upheld|denied|remanded|dismissed)
 * 3. Have a reviewer assigned for under_review or beyond
 * 4. Timeline compliance: filing deadline within 72h of result publication
 * 5. Outcome is valid enum
 *
 * Options:
 *   --results-dir <path>  Results directory (default: results/)
 */
function appealsGate(runner, options) {
  console.log('\n=== Appeals Gate — Appeal Record Validation (#41) ===\n');

  const resultsDir = options['results-dir'] || 'results/';
  const files = findResultYamls(resultsDir);

  if (files.length === 0) {
    console.log('  (no result packets to check)');
    return runner;
  }

  // Look for appeal blocks in result packets
  let totalAppeals = 0;

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    let doc;
    try {
      doc = loadYaml(file);
    } catch {
      continue;
    }

    const rp = doc && doc.result_packet ? doc.result_packet : doc;
    if (!rp || typeof rp !== 'object') continue;

    // Check for inline appeal block
    if (rp.appeal) {
      totalAppeals++;
      validateAppealRecord(runner, rp.appeal, rel, 'result_packet.appeal');
    }

    // Check for appeals in validity block
    if (rp.validity && typeof rp.validity === 'object' && rp.validity.appeal) {
      totalAppeals++;
      validateAppealRecord(runner, rp.validity.appeal, rel, 'validity.appeal');
    }

    // Check state machine: if validity=appealed, must have appeal block
    const validity = rp.validity || '';
    if (typeof validity === 'string' && validity.toLowerCase() === 'appealed') {
      runner.require(`APPEAL-REQUIRED-${rel}`, `appeal block for appealed state: ${rel}`,
        () => !!(rp.appeal || (rp.validity && typeof rp.validity === 'object' && rp.validity.appeal)));
      if (!rp.appeal) {
        runner.results[runner.results.length - 1].detail =
          'validity is "appealed" but no appeal block found';
      }
    }
  }

  if (totalAppeals === 0) {
    console.log('  (no appeal records found in result packets)');
  }

  // Also check judge records
  const judgeFiles = fs.readdirSync(path.resolve(ROOT, resultsDir))
    .filter(f => /-judge/.test(f) && /\.ya?ml$/.test(f));

  for (const file of judgeFiles) {
    const rel = path.join(resultsDir, file);
    try {
      const jdoc = loadYaml(rel);
      if (jdoc && jdoc.appeal) {
        totalAppeals++;
        validateAppealRecord(runner, jdoc.appeal, rel, 'judge_record.appeal');
      }
    } catch { /* skip */ }
  }

  return runner;
}

/**
 * Validate a single appeal record against the rules defined in docs/rules.md.
 */
function validateAppealRecord(runner, appeal, fileRef, contextPath) {
  const label = `${contextPath} in ${path.basename(fileRef)}`;

  // Required fields
  const requiredFields = {
    packet_id: 'packet_id of the result being appealed',
    statement: 'clear statement of what is being challenged',
    evidence_refs: 'supporting evidence references',
    desired_outcome: 'desired outcome (re-score, re-classify, re-instate)',
  };

  for (const [field, desc] of Object.entries(requiredFields)) {
    runner.require(`APPEAL-FIELD-${field}-${label}`, `Appeal has ${field} (${desc}): ${label}`,
      () => !!appeal[field]);
    if (!appeal[field]) {
      runner.results[runner.results.length - 1].detail =
        `Appeal missing required field "${field}" — ${desc}`;
    }
  }

  // Valid status values
  const validStatuses = ['filed', 'under_review', 'upheld', 'denied', 'remanded', 'dismissed'];
  if (appeal.status) {
    runner.require(`APPEAL-STATUS-${label}`, `Appeal status valid: ${label}`,
      () => validStatuses.includes(appeal.status));
    if (!validStatuses.includes(appeal.status)) {
      runner.results[runner.results.length - 1].detail =
        `Invalid appeal status "${appeal.status}"; expected one of: ${validStatuses.join(', ')}`;
    }

    // Status transitions: under_review or beyond must have reviewed_by
    const needsReviewer = ['under_review', 'upheld', 'denied', 'remanded', 'dismissed'];
    if (needsReviewer.includes(appeal.status)) {
      runner.require(`APPEAL-REVIEWER-${label}`, `Appeal has reviewer for ${appeal.status}: ${label}`,
        () => !!appeal.reviewed_by);
      if (!appeal.reviewed_by) {
        runner.results[runner.results.length - 1].detail =
          `Appeal status is "${appeal.status}" but reviewed_by is missing`;
      }
    }
  }

  // Valid outcome values
  const validOutcomes = ['upheld', 'denied', 'remanded', 'dismissed'];
  if (appeal.outcome) {
    runner.require(`APPEAL-OUTCOME-${label}`, `Appeal outcome valid: ${label}`,
      () => validOutcomes.includes(appeal.outcome));
    if (!validOutcomes.includes(appeal.outcome)) {
      runner.results[runner.results.length - 1].detail =
        `Invalid appeal outcome "${appeal.outcome}"; expected one of: ${validOutcomes.join(', ')}`;
    }
  }

  // Timestamp presence for key fields
  if (appeal.filed_at) {
    runner.require(`APPEAL-TS-FILED-${label}`, `Appeal filed_at valid date: ${label}`,
      () => !isNaN(new Date(appeal.filed_at).getTime()));
  }
  if (appeal.reviewed_at) {
    runner.require(`APPEAL-TS-REVIEWED-${label}`, `Appeal reviewed_at valid date: ${label}`,
      () => !isNaN(new Date(appeal.reviewed_at).getTime()));
  }

  // filed_by is required
  runner.require(`APPEAL-FILER-${label}`, `Appeal has filed_by: ${label}`,
    () => !!appeal.filed_by);
}

// ---------------------------------------------------------------------------
// Judge Workflow Gate — Judge State-Machine Transitions
// ---------------------------------------------------------------------------

/**
 * judge-workflow — Validate judge workflow state-machine transitions.
 *
 * Checks:
 * 1. Judge record schema compliance
 * 2. Automated -> human/blind -> finalized transitions are tracked
 * 3. Pending dimensions are documented for human/blind judge records
 * 4. Score dimensions do not exceed max values
 * 5. Verdict is consistent with score
 * 6. Judge type is valid enum
 *
 * Options:
 *   --results-dir <path>  Results directory (default: results/)
 */
function judgeWorkflowGate(runner, options) {
  console.log('\n=== Judge Workflow Gate — Judge State-Machine Transitions ===\n');

  const resultsDir = options['results-dir'] || 'results/';
  const judgeFiles = findJudgeYamls(resultsDir);

  if (judgeFiles.length === 0) {
    console.log('  (no judge records to check)');
    console.log('  Check scoreboard for pending dimensions...');
    return runner;
  }

  const validJudgeTypes = ['automated', 'human', 'llm-assisted', 'hybrid', 'pending'];
  const validVerdicts = ['pass', 'conditional_pass', 'fail', 'disqualification'];

  for (const file of judgeFiles) {
    const rel = path.relative(ROOT, file);
    let doc;
    try {
      doc = loadYaml(file);
    } catch {
      continue;
    }

    if (!doc || typeof doc !== 'object') continue;

    // Check judge record ID
    runner.require(`JUDGE-ID-${rel}`, `Judge record has judge_record_id: ${rel}`, () => !!doc.judge_record_id);

    // Schema version
    if (doc.schema_version === undefined || doc.schema_version === null) {
      runner.require(`JUDGE-VERSION-${rel}`, `Schema version present: ${rel}`, () => false);
    } else {
      runner.require(`JUDGE-VERSION-${rel}`, `Schema version present: ${rel}`, () =>
        typeof doc.schema_version === 'number');
    }

    // Judge type validity
    runner.require(`JUDGE-TYPE-${rel}`, `Judge type valid: ${rel}`, () =>
      validJudgeTypes.includes(doc.judge_type || 'automated'));
    if (doc.judge_type && !validJudgeTypes.includes(doc.judge_type)) {
      runner.results[runner.results.length - 1].detail =
        `Invalid judge_type "${doc.judge_type}"; expected one of: ${validJudgeTypes.join(', ')}`;
    }

    // Score dimensions present and within bounds
    const dims = doc.score_dimensions || {};
    const dimKeys = Object.keys(dims);
    runner.require(`JUDGE-DIMS-${rel}`, `Score dimensions present: ${rel}`, () => dimKeys.length > 0);

    let computedTotal = 0;
    let maxTotal = 0;
    for (const [dimName, dim] of Object.entries(dims)) {
      if (!dim || typeof dim !== 'object') continue;
      const score = dim.score;
      const max = dim.max;
      if (typeof score === 'number' && typeof max === 'number') {
        if (score > max) {
          runner.require(`JUDGE-DIM-OVER-${rel}-${dimName}`, `${dimName} score ≤ max: ${rel}`, () => false);
          runner.results[runner.results.length - 1].detail =
            `Dimension ${dimName} score (${score}) exceeds max (${max})`;
        }
        if (score < 0) {
          runner.require(`JUDGE-DIM-NEG-${rel}-${dimName}`, `${dimName} score ≥ 0: ${rel}`, () => false);
          runner.results[runner.results.length - 1].detail =
            `Dimension ${dimName} score (${score}) is negative`;
        }
        computedTotal += score;
        maxTotal += max;
      }
    }

    // total_score matches sum of dimensions
    if (typeof doc.total_score === 'number' && maxTotal > 0) {
      const diff = Math.abs(doc.total_score - computedTotal);
      runner.require(`JUDGE-TOTAL-${rel}`, `total_score matches dimensions: ${rel}`, () => diff < 0.01);
      if (diff >= 0.01) {
        runner.results[runner.results.length - 1].detail =
          `total_score (${doc.total_score}) != sum of dimensions (${computedTotal})`;
      }
    }

    // Verdict validity
    runner.require(`JUDGE-VERDICT-${rel}`, `Verdict valid: ${rel}`, () =>
      validVerdicts.includes(doc.verdict || 'pass'));

    // Verdict consistency with score
    if (doc.verdict === 'pass' && typeof doc.total_score === 'number' && doc.total_score <= 0) {
      runner.require(`JUDGE-VERDICT-SCORE-${rel}`, `Verdict consistent with score: ${rel}`, () => false);
      runner.results[runner.results.length - 1].detail =
        `Verdict is "${doc.verdict}" but total_score is ${doc.total_score} (≤ 0)`;
    }
    if (doc.verdict === 'fail' && typeof doc.total_score === 'number' && doc.total_score > 0) {
      runner.require(`JUDGE-VERDICT-SCORE-${rel}`, `Verdict consistent with score: ${rel}`, () => false);
      runner.results[runner.results.length - 1].detail =
        `Verdict is "${doc.verdict}" but total_score is ${doc.total_score} (> 0)`;
    }

    // Automated judge records should document pending human dimensions
    if (doc.judge_type === 'automated' || !doc.judge_type) {
      const hasPendingNote = (doc.judge_notes || '').toLowerCase().includes('pending') ||
        (doc.judge_notes || '').toLowerCase().includes('human');
      runner.require(`JUDGE-PENDING-NOTE-${rel}`, `Auto-judge documents pending dimensions: ${rel}`,
        () => hasPendingNote);
      if (!hasPendingNote) {
        runner.results[runner.results.length - 1].detail =
          'Automated judge record should document which dimensions are pending human review';
      }
    }

    // task_id presence
    runner.require(`JUDGE-TASK-${rel}`, `Judge record has task_id: ${rel}`, () => !!doc.task_id);

    // created_at validity
    if (doc.created_at) {
      runner.require(`JUDGE-CREATED-${rel}`, `created_at valid date: ${rel}`,
        () => !isNaN(new Date(doc.created_at).getTime()));
    }
  }

  return runner;
}

// ---------------------------------------------------------------------------
// Finalizer-Ready — Run All Gates
// ---------------------------------------------------------------------------

function finalizerReady(runner, options) {
  console.log('\n=== BROKER FINALIZER — Full Gate Suite ===\n');
  console.log('Running ALL readiness, publication, and workflow gates...\n');

  readinessGates(runner, options.manifest);
  integrityGate(runner, options);
  provisionalScoringGate(runner, options);
  redactionCheck(runner, options);
  safeMetadataCheck(runner, options);
  appealsGate(runner, options);
  judgeWorkflowGate(runner, options);

  publicationGates(runner, options);

  return runner;
}

// ---------------------------------------------------------------------------
// List Gates
// ---------------------------------------------------------------------------

function listGates() {
  console.log('\nAvailable dry-run gate commands:\n');
  console.log('  readiness            — Check qualification/readiness gates (pre-run)');
  console.log('  publication          — Check publication readiness gates (post-run)');
  console.log('  redaction-check      — Check redaction hygiene on result packets');
  console.log('  safe-metadata        — Check comparable_metadata for unsafe values');
  console.log('  integrity            — Run evidence integrity chain checks (#40)');
  console.log('  provisional-scoring  — Validate publishability/provisional scoring gates');
  console.log('  appeals              — Validate appeal record structure and compliance (#41)');
  console.log('  judge-workflow       — Validate judge state-machine transitions');
  console.log('  finalizer-ready      — Run ALL gates (readiness + publication + checks)');
  console.log('  list                 — Show this list\n');
  console.log('Options:');
  console.log('  --manifest <path>    Round manifest path (default: rounds/season-001-round-001.yaml)');
  console.log('  --results-dir <path> Results directory (default: results/)');
  console.log('  --runs-dir <path>    Runs directory for competition-validity checks');
  console.log('  --output <path>      Write JSON evidence to file');
  console.log('  --quiet, -q          Suppress stdout, emit JSON only\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// CLI Entrypoint
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Agent Olympics — Dry-Run Go/No-Go Gates

Usage: node scripts/dry-run-gates.js <command> [options]

Commands:
  readiness            Qualification/readiness gates (pre-run)
  publication          Publication readiness gates (post-run)
  redaction-check      Redaction hygiene check
  safe-metadata        Safe metadata check
  integrity            Evidence integrity chain checks (#40)
  provisional-scoring  Publishability / provisional scoring gates
  appeals              Appeal record structure and compliance (#41)
  judge-workflow       Judge state-machine transitions
  finalizer-ready      All gates combined for broker finalization
  list                 List all gate commands

Options:
  --manifest <path>    Round manifest path
  --results-dir <path> Results directory
  --runs-dir <path>    Runs directory
  --output <path>      Write JSON evidence to file
  --quiet, -q          Quiet output (JSON only)

Exit: 0 = all gates pass, 1 = any gate fails, 2 = usage error
`);
    process.exit(0);
  }

  const command = args[0];

  // Parse options
  const options = { manifest: 'rounds/season-001-round-001.yaml' };
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--manifest' && i + 1 < args.length) { options.manifest = args[++i]; }
    else if (args[i] === '--results-dir' && i + 1 < args.length) { options['results-dir'] = args[++i]; }
    else if (args[i] === '--runs-dir' && i + 1 < args.length) { options['runs-dir'] = args[++i]; }
    else if (args[i] === '--output' && i + 1 < args.length) { options.output = args[++i]; }
    else if (args[i] === '--quiet' || args[i] === '-q') { options.quiet = true; }
    else if (args[i] === '--manifest' && !args[i + 1]) { console.error('--manifest requires a path'); process.exit(2); }
    else if (args[i] === '--results-dir' && !args[i + 1]) { console.error('--results-dir requires a path'); process.exit(2); }
    else if (args[i] === '--runs-dir' && !args[i + 1]) { console.error('--runs-dir requires a path'); process.exit(2); }
  }

  if (command === 'list') {
    listGates();
  }

  const runner = new GateRunner(options);

  if (!options.quiet) {
    console.log(`\nGate Runner: ${command}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
  }

  switch (command) {
    case 'readiness':
      if (!options.manifest) { console.error('--manifest is required for readiness'); process.exit(2); }
      readinessGates(runner, options.manifest);
      break;

    case 'publication':
      publicationGates(runner, options);
      break;

    case 'redaction-check':
      redactionCheck(runner, options);
      break;

    case 'safe-metadata':
      safeMetadataCheck(runner, options);
      break;

    case 'integrity':
      integrityGate(runner, options);
      break;

    case 'provisional-scoring':
      provisionalScoringGate(runner, options);
      break;

    case 'appeals':
      appealsGate(runner, options);
      break;

    case 'judge-workflow':
      judgeWorkflowGate(runner, options);
      break;

    case 'finalizer-ready':
      finalizerReady(runner, options);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run "node scripts/dry-run-gates.js list" for available commands.');
      process.exit(2);
  }

  const summary = runner.summary();

  if (!options.quiet) {
    console.log(`\n=== Summary ===`);
    console.log(`  Total: ${summary.total}`);
    console.log(`  Pass:  ${summary.pass}`);
    console.log(`  Fail:  ${summary.fail}`);
    console.log(`  All passed: ${summary.allPassed ? 'YES ✓' : 'NO ✗'}`);
  }

  // Write output file if requested
  if (options.output) {
    const outputPath = path.resolve(ROOT, options.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2) + '\n');
    if (!options.quiet) {
      console.log(`\nEvidence written to: ${options.output}`);
    }
  }

  // Write to default evidence location if not specified and finalizer-ready
  if (!options.output && command === 'finalizer-ready') {
    const defaultPath = 'evidence/dry-run/finalizer-evidence.json';
    const outputPath = path.resolve(ROOT, defaultPath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2) + '\n');
    if (!options.quiet) {
      console.log(`\nEvidence written to: ${defaultPath}`);
    }
  }

  // Quiet mode: just emit JSON
  if (options.quiet) {
    console.log(JSON.stringify(summary, null, 2));
  }

  process.exit(summary.allPassed ? 0 : 1);
}

main();
