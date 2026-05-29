#!/usr/bin/env node
/**
 * Agent Olympics MVP Round Engine — CLI entrypoint
 *
 * Orchestrates competition rounds: manifest validation, planning,
 * run directory initialization, lifecycle state management.
 *
 * Source-only and stub-friendly — does not call live nodes.
 *
 * Usage:
 *   node scripts/round.js <command> [options]
 *
 * Commands:
 *   init <manifest>    Validate and initialize a round manifest
 *   plan <manifest>    Dry-run: show what would happen
 *   list [season]      List available rounds
 *   status <round_id>  Show lifecycle status for a round
 *   validate <manifest>  Validate a round manifest against schema
 *
 * Options:
 *   --verbose, -v      Verbose output
 *   --strict           Fail on warnings
 *   --help, -h         Show usage
 *
 * Exit code: 0 = success, 1 = validation or runtime error
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');

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

function fileExists(filePath) {
  const resolved = path.resolve(ROOT, filePath);
  try {
    fs.accessSync(resolved, fs.constants.R_OK);
    return resolved;
  } catch {
    return false;
  }
}

function dirExists(dirPath) {
  const resolved = path.resolve(ROOT, dirPath);
  try {
    const stat = fs.statSync(resolved);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function mkdirp(p) {
  const resolved = path.resolve(ROOT, p);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function generateTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const tz = now
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul', timeZoneName: 'short' })
    .match(/[A-Z]{3,4}$/)?.[0] || 'UTC';
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}${tz}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const CHECKS = [];
let checkPassed = 0;
let checkFailed = 0;
let checkWarnings = 0;

function check(label, condition, detail) {
  CHECKS.push({ label, condition, detail });
  if (condition) {
    checkPassed++;
  } else {
    checkFailed++;
  }
}

function warn(label, condition, detail) {
  CHECKS.push({ label, condition: true, detail, warning: true });
  if (!condition) {
    checkWarnings++;
  }
}

function printCheckResult(verbose) {
  for (const c of CHECKS) {
    if (c.warning && !c.condition) {
      console.warn(`  ⚠ WARN  ${c.label}: ${c.detail}`);
    } else if (c.condition) {
      if (verbose) console.log(`  ✓ ${c.label}`);
    } else {
      console.error(`  ✘ FAIL  ${c.label}: ${c.detail}`);
    }
  }
}

function validateRoundManifest(manifestPath, strict) {
  const manifest = loadYaml(manifestPath);

  // Schema version
  check(
    'schema_version is 1',
    manifest && manifest.schema_version === 1,
    `Expected 1, got ${manifest ? manifest.schema_version : 'undefined'}`
  );

  // Required top-level fields
  const required = ['round_id', 'season', 'title', 'lifecycle', 'tasks', 'participants', 'run_directory'];
  for (const field of required) {
    check(
      `field "${field}" present`,
      manifest && manifest[field] !== undefined && manifest[field] !== null,
      `${field} is missing or null`
    );
  }

  if (!manifest) return manifest;

  // round_id format
  const roundIdPattern = /^season-\d{3}-round-\d{3}$/;
  if (manifest.round_id) {
    check(
      'round_id format matches "season-XXX-round-XXX"',
      roundIdPattern.test(manifest.round_id),
      `"${manifest.round_id}" does not match pattern season-XXX-round-XXX`
    );
  }

  // Lifecycle status
  if (manifest.lifecycle) {
    const validStatuses = ['pending', 'fixture_preparation', 'running', 'completed', 'scored', 'archived'];
    check(
      'lifecycle.status is valid',
      validStatuses.includes(manifest.lifecycle.status),
      `"${manifest.lifecycle.status}" is not one of ${validStatuses.join(', ')}`
    );
  }

  // Tasks
  if (Array.isArray(manifest.tasks) && manifest.tasks.length > 0) {
    for (let i = 0; i < manifest.tasks.length; i++) {
      const t = manifest.tasks[i];
      const idx = i + 1;

      // task_id format
      check(
        `task #${idx} task_id format`,
        /^[a-z]+-\d{3}$/.test(t.task_id),
        `"${t.task_id}" does not match pattern [a-z]+-XXX`
      );

      // envelope exists
      const envPath = t.envelope_path;
      if (envPath) {
        warn(
          `task #${idx} envelope exists`,
          fileExists(envPath),
          `envelope not found: ${envPath}`
        );
      }

      // fixture bundle ref exists
      const fixPath = t.fixture_bundle_ref;
      if (fixPath) {
        warn(
          `task #${idx} fixture bundle exists`,
          dirExists(fixPath),
          `fixture bundle not found: ${fixPath}`
        );
      }

      // time limit
      check(
        `task #${idx} time_limit_minutes is positive integer`,
        Number.isInteger(t.time_limit_minutes) && t.time_limit_minutes >= 1,
        `got ${t.time_limit_minutes}`
      );
    }
  } else {
    check('at least one task', false, 'tasks array is empty or missing');
  }

  // Participants
  if (Array.isArray(manifest.participants) && manifest.participants.length > 0) {
    const agentIds = manifest.participants.map((p) => p.agent_id);
    const uniqueIds = new Set(agentIds);
    check(
      'participant agent_ids are unique',
      uniqueIds.size === agentIds.length,
      `duplicate agent_ids: ${agentIds.filter((id, i) => agentIds.indexOf(id) !== i).join(', ')}`
    );

    for (let i = 0; i < manifest.participants.length; i++) {
      const p = manifest.participants[i];
      const idx = i + 1;
      check(
        `participant #${idx} has agent_id`,
        typeof p.agent_id === 'string' && p.agent_id.length > 0,
        'agent_id is missing or empty'
      );
      check(
        `participant #${idx} has runtime`,
        typeof p.runtime === 'string' && p.runtime.length > 0,
        'runtime is missing or empty'
      );
    }
  } else {
    check('at least one participant', false, 'participants array is empty or missing');
  }

  // Run directory
  if (manifest.run_directory) {
    check(
      'run_directory is a relative path',
      !path.isAbsolute(manifest.run_directory),
      `"${manifest.run_directory}" is an absolute path — use relative`
    );
  }

  return manifest;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdHelp() {
  const HELP = `
Usage: node scripts/round.js <command> [options]

Commands:
  init <manifest>      Validate and initialize a round manifest
  plan <manifest>      Dry-run: print what would happen (no side effects)
  list [season]        List available rounds, optionally filtered by season
  status <round_id>    Show lifecycle status for a round
  validate <manifest>  Validate a round manifest against the schema

Options:
  --verbose, -v        Verbose output
  --strict             Fail on warnings
  --help, -h           Show this help

Exit codes:
  0  Success
  1  Validation or runtime error
`;
  console.log(HELP);
}

function cmdValidate(manifestArg, options) {
  const manifestPath = manifestArg;
  if (!manifestPath) {
    console.error('Usage: node scripts/round.js validate <manifest>');
    process.exit(1);
  }

  console.log(`Validating: ${manifestPath}`);
  const manifest = validateRoundManifest(manifestPath, options.strict);

  printCheckResult(options.verbose);
  console.log(`\n${checkPassed} passed, ${checkFailed} failed, ${checkWarnings} warnings`);

  if (options.strict && checkWarnings > 0) {
    console.error('Strict mode: warnings treated as failures');
    process.exit(1);
  }

  if (checkFailed > 0) process.exit(1);
  console.log('✓ Manifest is valid');
  return manifest;
}

function cmdPlan(manifestArg, options) {
  const manifestPath = manifestArg;
  if (!manifestPath) {
    console.error('Usage: node scripts/round.js plan <manifest>');
    process.exit(1);
  }

  CHECKS.length = 0;
  checkPassed = 0;
  checkFailed = 0;
  checkWarnings = 0;

  const manifest = validateRoundManifest(manifestPath, options.strict);
  if (checkFailed > 0) {
    printCheckResult(true);
    console.error('\nCannot plan — manifest is invalid');
    process.exit(1);
  }

  // Print plan
  const taskCount = manifest.tasks ? manifest.tasks.length : 0;
  const participantCount = manifest.participants ? manifest.participants.length : 0;
  const enabledParticipants = manifest.participants
    ? manifest.participants.filter((p) => p.enabled !== false)
    : [];
  const combos = taskCount * enabledParticipants.length;

  console.log(`\n=== Round Plan: ${manifest.round_id} ===`);
  console.log(`  Season:       ${manifest.season}`);
  console.log(`  Title:        ${manifest.title}`);
  console.log(`  Tasks:        ${taskCount}`);
  console.log(`  Participants: ${participantCount} (${enabledParticipants.length} enabled)`);
  console.log(`  Combos:       ${combos} (tasks × enabled participants)`);
  console.log(`  Lifecycle:    ${manifest.lifecycle ? manifest.lifecycle.status : 'unknown'}`);
  console.log(`  Run dir:      ${manifest.run_directory}`);
  console.log(`\n  Tasks:`);

  for (const t of manifest.tasks || []) {
    const envOk = fileExists(t.envelope_path) ? '✓' : '⚠ missing';
    const fixOk = dirExists(t.fixture_bundle_ref) ? '✓' : '⚠ missing';
    console.log(`    ${t.task_id.padEnd(12)} ${t.title.slice(0, 50).padEnd(52)} ${envOk} env  ${fixOk} fixtures`);
  }

  console.log(`\n  Participants:`);
  for (const p of manifest.participants || []) {
    const status = p.enabled === false ? ' (disabled)' : '';
    console.log(`    ${p.agent_id.padEnd(16)} ${p.runtime.padEnd(12)} ${p.label || ''}${status}`);
  }

  console.log(`\n  Run IDs (deterministic):`);
  for (const p of enabledParticipants) {
    for (const t of manifest.tasks || []) {
      const runId = `run-${t.task_id}-${p.agent_id}-${generateTimestamp()}`;
      console.log(`    ${runId}`);
      console.log(`      → ${manifest.run_directory}${runId}/`);
    }
  }

  console.log('\n✓ Plan complete (source-only, no side effects)');
  return manifest;
}

function cmdInit(manifestArg, options) {
  // First validate and plan
  const manifest = cmdPlan(manifestArg, options);
  CHECKS.length = 0;
  checkPassed = 0;
  checkFailed = 0;
  checkWarnings = 0;

  // Check run directory does not already exist (safety)
  const runDir = manifest.run_directory;
  if (dirExists(runDir)) {
    console.error(`\n✘ Run directory "${runDir}" already exists — refusing to overwrite`);
    process.exit(1);
  }

  // Create run directory and per-combo subdirectories
  console.log(`\n  Creating run directory: ${runDir}`);
  mkdirp(runDir);

  const enabledParticipants = manifest.participants
    ? manifest.participants.filter((p) => p.enabled !== false)
    : [];
  const tasks = manifest.tasks || [];

  for (const p of enabledParticipants) {
    for (const t of tasks) {
      const ts = generateTimestamp();
      const runId = `run-${t.task_id}-${p.agent_id}-${ts}`;
      const runPath = path.join(runDir, runId);
      mkdirp(runPath);
      mkdirp(path.join(runPath, 'fixtures'));
      mkdirp(path.join(runPath, 'evidence'));

      // Write a minimal run manifest
      const runManifest = {
        schema_version: 1,
        run_id: runId,
        round_id: manifest.round_id,
        task_id: t.task_id,
        agent_id: p.agent_id,
        runtime: p.runtime,
        created_at: new Date().toISOString(),
        lifecycle: 'pending',
        envelope_ref: t.envelope_path,
        fixture_ref: t.fixture_bundle_ref,
      };
      fs.writeFileSync(
        path.resolve(ROOT, runPath, 'manifest.yaml'),
        yaml.dump(runManifest, { indent: 2, lineWidth: 120 })
      );

      console.log(`  Created: ${runPath}/`);
    }
  }

  // Update round lifecycle to fixture_preparation
  manifest.lifecycle.status = 'fixture_preparation';
  if (!Array.isArray(manifest.lifecycle.status_history)) {
    manifest.lifecycle.status_history = [];
  }
  manifest.lifecycle.status_history.push({
    status: 'fixture_preparation',
    timestamp: new Date().toISOString(),
    note: 'Round initialized by CLI',
  });

  // Write updated manifest back
  const manifestOutPath = path.resolve(ROOT, manifestArg);
  fs.writeFileSync(manifestOutPath, yaml.dump(manifest, { indent: 2, lineWidth: 120 }));
  console.log(`\n✓ Round initialized (lifecycle → fixture_preparation)`);
  console.log(`  Manifest updated: ${manifestArg}`);
}

function cmdList(seasonFilter, options) {
  const roundDir = path.resolve(ROOT, 'rounds');
  if (!dirExists('rounds')) {
    console.log('No rounds directory found.');
    return;
  }

  const files = fs.readdirSync(roundDir).filter(
    (f) => f.endsWith('.yaml') || f.endsWith('.yml')
  );

  if (files.length === 0) {
    console.log('No round manifests found in rounds/.');
    return;
  }

  console.log('Available rounds:\n');
  for (const f of files) {
    try {
      const manifest = loadYaml(path.join('rounds', f));
      if (seasonFilter && manifest.season !== seasonFilter) continue;
      const lc = manifest.lifecycle ? manifest.lifecycle.status : 'unknown';
      const parts = f.replace(/\.ya?ml$/, '');
      console.log(`  ${manifest.round_id || parts}`);
      console.log(`    Title:     ${manifest.title || '(untitled)'}`);
      console.log(`    Season:    ${manifest.season || '?'}`);
      console.log(`    Tasks:     ${(manifest.tasks || []).length}`);
      console.log(`    Status:    ${lc}`);
      console.log(`    File:      rounds/${f}\n`);
    } catch {
      console.log(`  ${f} (unparseable)\n`);
    }
  }
}

function cmdStatus(roundIdArg, options) {
  if (!roundIdArg) {
    console.error('Usage: node scripts/round.js status <round_id>');
    process.exit(1);
  }

  const roundDir = path.resolve(ROOT, 'rounds');
  if (!dirExists('rounds')) {
    console.error('No rounds directory found.');
    process.exit(1);
  }

  const files = fs.readdirSync(roundDir).filter(
    (f) => f.endsWith('.yaml') || f.endsWith('.yml')
  );

  let found = false;
  for (const f of files) {
    try {
      const manifest = loadYaml(path.join('rounds', f));
      if (manifest.round_id === roundIdArg) {
        found = true;
        const lc = manifest.lifecycle || {};
        const history = lc.status_history || [];

        console.log(`=== Status: ${manifest.round_id} ===`);
        console.log(`  Title:       ${manifest.title || '(untitled)'}`);
        console.log(`  Season:      ${manifest.season || '?'}`);
        console.log(`  Status:      ${lc.status || 'unknown'}`);
        console.log(`  Tasks:       ${(manifest.tasks || []).length}`);
        console.log(`  Participants: ${(manifest.participants || []).length}`);
        console.log(`  Run dir:     ${manifest.run_directory || '?'}`);
        console.log(`\n  Status History:`);
        for (const h of history) {
          console.log(`    ${h.timestamp} → ${h.status}${h.note ? ` (${h.note})` : ''}`);
        }

        // Check run directory
        if (manifest.run_directory && dirExists(manifest.run_directory)) {
          const runs = fs.readdirSync(path.resolve(ROOT, manifest.run_directory));
          const runDirs = runs.filter((r) => r.startsWith('run-'));
          console.log(`\n  Run directories: ${runDirs.length} initialized`);
          for (const r of runDirs) {
            console.log(`    ${manifest.run_directory}${r}/`);
          }
        } else {
          console.log(`\n  No run directories yet.`);
        }
        break;
      }
    } catch {
      // skip unparseable
    }
  }

  if (!found) {
    console.error(`Round "${roundIdArg}" not found.`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const options = {
    verbose: false,
    strict: false,
  };

  // Parse global options
  const filtered = [];
  for (const a of args) {
    switch (a) {
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--strict':
        options.strict = true;
        break;
      case '--help':
      case '-h':
        cmdHelp();
        return;
      default:
        filtered.push(a);
    }
  }

  const cmd = filtered[0];
  const cmdArg = filtered[1];
  const cmdArg2 = filtered[2];

  switch (cmd) {
    case 'validate':
      CHECKS.length = 0;
      checkPassed = 0;
      checkFailed = 0;
      checkWarnings = 0;
      cmdValidate(cmdArg, options);
      break;
    case 'plan':
      cmdPlan(cmdArg, options);
      break;
    case 'init':
      cmdInit(cmdArg, options);
      break;
    case 'list':
      cmdList(cmdArg, options);
      break;
    case 'status':
      cmdStatus(cmdArg, options);
      break;
    default:
      if (cmd) {
        console.error(`Unknown command: "${cmd}"`);
        process.exit(1);
      }
      cmdHelp();
  }
}

main();
