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
 *   finalizer-ready      — Run ALL gates (readiness + publication) for broker
 *   list                 — List all available gates with descriptions
 *
 * Options:
 *   --manifest <path>    — Round manifest path
 *   --results-dir <path> — Results directory
 *   --runs-dir <path>    — Runs directory
 *   --output <path>      — Output file for evidence JSON
 *   --verbose, -v        — Verbose output
 *   --quiet, -q          — Quiet output (JSON only)
 *
 * Exit code: 0 = all gates pass, 1 = any gate fails, 2 = usage error
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const yaml = require('js-yaml');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, '..');

const FORBIDDEN_KEY_PATTERNS = [
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

const FORBIDDEN_VALUE_PATTERNS = [
  /^sk-[a-zA-Z0-9]{20,}/,
  /^ghp_[a-zA-Z0-9]{36}/,
  /^gho_[a-zA-Z0-9]{36}/,
  /^github_pat_[a-zA-Z0-9_]{4,}/,
  /^xox[baprs]-/,
  /^eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+/,
];

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

function runNode(script) {
  try {
    const out = execSync(`node -e ${JSON.stringify(script)}`, {
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
      const re = /^.*\.yaml$/;
      const files = fs.readdirSync(path.resolve(ROOT, resultsDir))
        .filter(f => re.test(f) && !f.includes('judge') && !f.includes('trace') && !f.includes('evidence') && !f.includes('scoreboard'));
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
  const files = fs.readdirSync(path.resolve(ROOT, resultsDir))
    .filter(f => /\.ya?ml$/.test(f) && !f.includes('judge') && !f.includes('trace') && !f.includes('evidence') && !f.includes('scoreboard') && !f.includes('.git'));

  if (files.length === 0) {
    console.log('  (no result packets to check)');
    return runner;
  }

  for (const file of files) {
    const filePath = path.join(resultsDir, file);
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
          if (ev.redaction_reason && FORBIDDEN_VALUE_PATTERNS.some(p => p.test(ev.redaction_reason))) {
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
          if (typeof value === 'string') {
            if (FORBIDDEN_VALUE_PATTERNS.some(p => p.test(value))) {
              issues.push(`${fullPath}: contains credential pattern`);
            }
            if (FORBIDDEN_KEY_PATTERNS.some(p => p.test(key))) {
              issues.push(`${fullPath}: potentially secret-bearing field name`);
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

  const files = fs.readdirSync(path.resolve(ROOT, resultsDir))
    .filter(f => /\.ya?ml$/.test(f) && !f.includes('judge') && !f.includes('trace') && !f.includes('evidence') && !f.includes('scoreboard') && !f.includes('.git'));

  if (files.length === 0) {
    console.log('  (no result packets to check)');
    return runner;
  }

  for (const file of files) {
    const filePath = path.join(resultsDir, file);
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
// Finalizer-Ready — Run All Gates
// ---------------------------------------------------------------------------

function finalizerReady(runner, options) {
  console.log('\n=== BROKER FINALIZER — Full Gate Suite ===\n');
  console.log('Running ALL readiness and publication gates...\n');

  readinessGates(runner, options.manifest);
  redactionCheck(runner, options);
  safeMetadataCheck(runner, options);

  if (options['runs-dir'] || options['results-dir']) {
    publicationGates(runner, options);
  }

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
  console.log('  finalizer-ready      — Run ALL gates (readiness + publication + checks)');
  console.log('  list                 — Show this list\n');
  console.log('Options:');
  console.log('  --manifest <path>    Round manifest path (default: rounds/season-001-round-001.yaml)');
  console.log('  --results-dir <path> Results directory (default: results/)');
  console.log('  --runs-dir <path>    Runs directory for competition-validity checks');
  console.log('  --output <path>      Write JSON evidence to file');
  console.log('  --verbose, -v        Verbose output');
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
  finalizer-ready      All gates combined for broker finalization
  list                 List all gate commands

Options:
  --manifest <path>    Round manifest path
  --results-dir <path> Results directory
  --runs-dir <path>    Runs directory
  --output <path>      Write JSON evidence to file
  --verbose, -v        Verbose output
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
    else if (args[i] === '--verbose' || args[i] === '-v') { options.verbose = true; }
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
