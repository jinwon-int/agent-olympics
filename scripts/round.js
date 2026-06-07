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
 *   init <manifest>     Validate and initialize a round manifest
 *   plan <manifest>     Dry-run: show what would happen
 *   list [season]       List available rounds
 *   status <round_id>   Show lifecycle status for a round
 *   validate <manifest> Validate a round manifest against schema
 *   execute <manifest>  Execute pending runs via stub adapter (source-only)
 *   resume <manifest>   Resume interrupted runs (those in 'running' state)
 *
 * Options:
 *   --verbose, -v      Verbose output
 *   --strict           Fail on warnings
 *   --run-id <id>      Execute/resume only a specific run (by run_id)
 *   --exit <code>      Override stub adapter exit code (for testing)
 *   --seed <string>    Deterministic seed for stable output
 *   --help, -h         Show usage
 *
 * Exit code: 0 = success, 1 = validation or runtime error
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_RUN_ID_TEMPLATE = 'run-{task_id}-{agent_id}-{timestamp}';
const SUPPORTED_RUN_ID_TEMPLATE_VARIABLES = new Set([
  'task_id',
  'agent_id',
  'timestamp',
  'round_id',
  'season',
]);

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

function runIdTemplateVariables(template) {
  return [...String(template || '').matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);
}

function renderRunId(manifest, task, participant, timestamp) {
  const template = manifest.run_id_template || DEFAULT_RUN_ID_TEMPLATE;
  const values = {
    task_id: task.task_id,
    agent_id: participant.agent_id,
    timestamp,
    round_id: manifest.round_id,
    season: manifest.season,
  };
  return template.replace(/\{([^{}]+)\}/g, (match, key) => values[key] !== undefined ? values[key] : match);
}

function failIfStrictWarnings(strict, context) {
  if (strict && checkWarnings > 0) {
    printCheckResult(true);
    console.error(`\nCannot ${context} — strict mode treats warnings as failures`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Run lifecycle state utilities
// ---------------------------------------------------------------------------

const VALID_RUN_LIFECYCLE_STATES = [
  'pending',
  'running',
  'completed',
  'partial',
  'failed',
  'blocked',
  'disqualified'
];

const VALID_ROUND_LIFECYCLE_STATES = [
  'pending',
  'fixture_preparation',
  'running',
  'completed',
  'scored',
  'archived'
];

/**
 * Deterministic stable status from exit code (matching stub-adapter).
 */
function exitCodeToStatus(exitCode) {
  switch (exitCode) {
    case 0: return 'completed';
    case 1: return 'failed';
    case 2: return 'partial';
    default: return 'blocked';
  }
}

/**
 * Map a run result status to a terminal (non-running) state label.
 * These are the run-level outcome states.
 */
function isTerminalRunState(state) {
  return ['completed', 'partial', 'failed', 'blocked', 'disqualified'].includes(state);
}

/**
 * Map a round lifecycle status to terminal.
 */
function isTerminalRoundState(status) {
  return ['completed', 'scored', 'archived'].includes(status);
}

/**
 * Generate a deterministic run ID matching the pattern used by init.
 */
function generateRunId(taskId, agentId, timestamp) {
  return `run-${taskId}-${agentId}-${timestamp}`;
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

  const runIdTemplate = manifest.run_id_template || DEFAULT_RUN_ID_TEMPLATE;
  const templateVariables = runIdTemplateVariables(runIdTemplate);
  const unknownVariables = templateVariables.filter((name) => !SUPPORTED_RUN_ID_TEMPLATE_VARIABLES.has(name));
  check(
    'run_id_template variables are supported',
    unknownVariables.length === 0,
    `unsupported variables: ${unknownVariables.join(', ')}`
  );
  if (unknownVariables.length === 0 && Array.isArray(manifest.tasks) && manifest.tasks.length > 0 &&
      Array.isArray(manifest.participants) && manifest.participants.length > 0) {
    const sampleParticipant = manifest.participants.find((p) => p.enabled !== false) || manifest.participants[0];
    const sampleRunId = renderRunId(manifest, manifest.tasks[0], sampleParticipant, '20260101T000000UTC');
    check(
      'run_id_template renders a safe run id',
      !/[{}\/\s]/.test(sampleRunId) && sampleRunId.length > 0,
      `rendered "${sampleRunId}" from template "${runIdTemplate}"`
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
  execute <manifest>   Execute pending runs via stub adapter (source-only)
  resume <manifest>    Resume interrupted runs (those in 'running' state)
  validate-adapter-outputs  [adapter]  Validate adapter output fixture files.
                        With [adapter] (hermes, cli, human) validates a single
                        adapter's output; without, validates all adapter outputs.

Options:
  --verbose, -v        Verbose output
  --strict             Fail on warnings
  --run-id <id>        Execute/resume only a specific run (by run_id)
  --exit <code>        Override stub adapter exit code (for testing)
  --seed <string>      Deterministic seed for stable output
  --help, -h           Show this help

Exit codes:
  0  Success
  1  Validation or runtime error

Run Lifecycle States:
  pending     → running → completed | partial | failed | blocked | disqualified

Round Lifecycle States:
  pending → fixture_preparation → running → completed → scored → archived
`;
  console.log(HELP);
}

/**
 * Validate adapter output fixture files.
 * Delegates to validate.js's built-in adapter-fixtures and
 * adapter-capabilities modes via child process.
 * When an [adapter] argument is provided (hermes, cli, or human),
 * validates only that adapter's sample files by passing individual
 * file paths through validate.js.
 */
function cmdValidateAdapterOutputs(adapterArg, options) {
  const { spawnSync } = require('child_process');
  const VALIDATE_JS = path.resolve(__dirname, 'validate.js');

  // Define which adapter dirs to scan
  const adapterDirs = {
    hermes: 'fixtures/adapters/hermes',
    cli: 'fixtures/adapters/cli',
    human: 'fixtures/adapters/human-baseline',
  };

  if (!adapterArg) {
    // Validate ALL adapter fixtures using the built-in mode
    console.log('=== Validating adapter capability declarations ===');
    const capsResult = spawnSync(process.execPath, [VALIDATE_JS, 'adapter-capabilities'], {
      stdio: 'inherit',
      cwd: ROOT,
    });
    if (capsResult.status !== 0) {
      console.error('Adapter capability validation failed.');
      process.exit(1);
    }

    console.log('');
    console.log('=== Validating all adapter fixture files ===');
    const fixtureResult = spawnSync(process.execPath, [VALIDATE_JS, 'adapter-fixtures'], {
      stdio: 'inherit',
      cwd: ROOT,
    });
    if (fixtureResult.status !== 0) {
      console.error('Adapter fixture validation failed.');
      process.exit(1);
    }

    console.log('');
    console.log('All adapter output validation passed.');
    process.exit(0);
  }

  // Single adapter mode — validate individual files
  const normalized = adapterArg.replace(/^human(-baseline)?$/, 'human').replace(/^human-/, '');
  const dir = adapterDirs[normalized];
  if (!dir) {
    console.error(`Unknown adapter: "${adapterArg}". Expected one of: hermes, cli, human`);
    process.exit(1);
  }

  const fullDir = path.resolve(ROOT, dir);
  if (!fs.existsSync(fullDir)) {
    console.log(`SKIP  ${dir}  - directory not found`);
    process.exit(1);
  }

  const files = fs.readdirSync(fullDir).filter(f => /\.ya?ml$/.test(f));
  if (files.length === 0) {
    console.log(`No YAML files found in ${dir}`);
    process.exit(0);
  }

  let totalErrors = 0;
  let totalFiles = 0;

  for (const file of files) {
    const filePath = path.join(fullDir, file);
    const result = spawnSync(process.execPath, [VALIDATE_JS, filePath], {
      stdio: 'inherit',
      cwd: ROOT,
    });
    totalFiles++;
    if (result.status !== 0) {
      totalErrors++;
    }
  }

  console.log(`\n--- Adapter Output Validation Summary ---`);
  console.log(`Files checked: ${totalFiles}`);
  console.log(`Files with errors: ${totalErrors}`);
  process.exit(totalErrors > 0 ? 1 : 0);
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
  failIfStrictWarnings(options.strict, 'plan');
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
      const runId = renderRunId(manifest, t, p, generateTimestamp());
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
      const runId = renderRunId(manifest, t, p, ts);
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
// Execute — run pending runs via stub adapter (source-only)
// ---------------------------------------------------------------------------

/**
 * Load a run manifest from disk.
 */
function loadRunManifest(runDirPath) {
  const manifestPath = path.resolve(ROOT, runDirPath, 'manifest.yaml');
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    return yaml.load(raw);
  } catch (err) {
    return null;
  }
}

/**
 * Save a run manifest back to disk.
 */
function saveRunManifest(runDirPath, manifest) {
  const manifestPath = path.resolve(ROOT, runDirPath, 'manifest.yaml');
  fs.writeFileSync(manifestPath, yaml.dump(manifest, { indent: 2, lineWidth: 120 }));
}

/**
 * Invoke the stub adapter for a single run.
 * Returns { status, exitCode, error } or throws.
 */
function invokeStubAdapter(envelopePath, runDir, agentId, runtime, seed, exitOverride) {
  const resolve = (p) => path.resolve(ROOT, p);

  const args = [
    resolve('scripts/stub-adapter.js'),
    resolve(envelopePath),
    '--run-dir', resolve(runDir),
    '--agent-id', agentId,
    '--runtime', runtime,
  ];

  if (seed) {
    args.push('--seed', seed);
  }
  if (exitOverride !== undefined && exitOverride !== null) {
    args.push('--exit', String(exitOverride));
  }

  const cp = require('child_process').spawnSync(
    process.execPath,
    args,
    {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 120000, // 2-minute safety timeout
    }
  );

  const stdout = (cp.stdout || '').trim();
  const stderr = (cp.stderr || '').trim();

  // Write adapter log
  const logPath = path.resolve(ROOT, runDir, 'adapter.log');
  fs.writeFileSync(logPath, `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}\n`, 'utf8');

  if (cp.error) {
    if (cp.error.code === 'ETIMEDOUT') {
      return { status: 'partial', exitCode: 2, error: 'Adapter timed out' };
    }
    return { status: 'blocked', exitCode: 3, error: cp.error.message };
  }

  const exitCode = cp.status;
  const status = exitCodeToStatus(exitCode);

  // If exit was non-zero but we have no error string, describe it
  const error = exitCode !== 0 ? `Adapter exited with code ${exitCode}` : null;

  return { status, exitCode, error, stdout, stderr };
}

/**
 * Validate run output artifacts. Returns { valid, errors }.
 */
function validateRunOutput(runDir) {
  const errors = [];
  const requiredArtifacts = ['result-packet.yaml', 'trace.yaml', 'evidence-bundle.yaml'];

  for (const artifact of requiredArtifacts) {
    const artifactPath = path.resolve(ROOT, runDir, artifact);
    if (!fs.existsSync(artifactPath)) {
      errors.push(`Missing artifact: ${artifact}`);
      continue;
    }

    // Validate with the schema validator
    try {
      const cp = require('child_process').spawnSync(
        process.execPath,
        [path.resolve(ROOT, 'scripts/validate.js'), artifactPath],
        { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' }
      );
      if (cp.status !== 0) {
        errors.push(`${artifact} failed schema validation`);
      }
    } catch (err) {
      errors.push(`Could not validate ${artifact}: ${err.message}`);
    }
  }

  // Check that the result-packet.yaml is parseable and has a valid status
  const resultPacketPath = path.resolve(ROOT, runDir, 'result-packet.yaml');
  if (fs.existsSync(resultPacketPath)) {
    try {
      const raw = fs.readFileSync(resultPacketPath, 'utf8');
      const packet = yaml.load(raw);
      if (!packet || !packet.status) {
        errors.push('result-packet.yaml missing required field: status');
      } else if (!['completed', 'partial', 'blocked', 'failed', 'disqualified'].includes(packet.status)) {
        errors.push(`result-packet.yaml has invalid status: "${packet.status}"`);
      }
      if (packet && packet.summary === undefined) {
        errors.push('result-packet.yaml missing required field: summary');
      }
    } catch (err) {
      errors.push(`result-packet.yaml is not valid YAML: ${err.message}`);
    }

    // Check for secret patterns in output (safety scan)
    try {
      const content = fs.readFileSync(resultPacketPath, 'utf8');
      const secretPatterns = [
        /sk-[a-zA-Z0-9]{20,}/g,     // OpenAI-like keys
        /ghp_[a-zA-Z0-9]{36}/g,     // GitHub PATs
        /xox[baprs]-[a-zA-Z0-9-]+/g, // Slack tokens
        /-----BEGIN\s+(RSA|EC|Ed25519)\s+PRIVATE\s+KEY-----/g, // Private keys
      ];
      for (const pattern of secretPatterns) {
        if (pattern.test(content)) {
          errors.push('SECRET DETECTED in result-packet.yaml — potential credential exposure');
          break;
        }
      }
    } catch { /* skip scan errors */ }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Transition a run's lifecycle state.
 */
function transitionRunState(runManifest, runDir, newStatus, note) {
  const oldStatus = runManifest.lifecycle || 'unknown';
  runManifest.lifecycle = newStatus;

  if (!Array.isArray(runManifest.status_history)) {
    runManifest.status_history = [];
  }
  runManifest.status_history.push({
    status: newStatus,
    timestamp: new Date().toISOString(),
    note: note || `Transitioned from ${oldStatus} to ${newStatus}`,
  });

  runManifest.updated_at = new Date().toISOString();

  saveRunManifest(runDir, runManifest);
  return runManifest;
}

/**
 * Execute a single run: validate, invoke stub adapter, collect results.
 */
function executeSingleRun(runDir, runManifest, roundManifest, options) {
  const runId = runManifest.run_id;
  const taskId = runManifest.task_id;
  const agentId = runManifest.agent_id;
  const runtime = runManifest.runtime || 'cli';
  const envelopeRef = runManifest.envelope_ref;

  console.log(`\n  Executing run: ${runId}`);

  // --- Resolve envelope path ---
  const envelopePath = path.resolve(ROOT, envelopeRef);
  if (!fs.existsSync(envelopePath)) {
    const errMsg = `Envelope not found: ${envelopeRef}`;
    console.error(`  ✘ ${errMsg}`);
    transitionRunState(runManifest, runDir, 'failed', errMsg);
    return { runId, success: false, status: 'failed', error: errMsg };
  }

  // --- Resolve fixture path (warn if missing, not blocking) ---
  if (runManifest.fixture_ref) {
    const fixturePath = path.resolve(ROOT, runManifest.fixture_ref);
    if (!fs.existsSync(fixturePath)) {
      console.warn(`  ⚠ Fixture bundle not found: ${runManifest.fixture_ref} (continuing anyway)`);
    }
  }

  // --- Ensure fixture and evidence subdirs exist ---
  mkdirp(path.join(runDir, 'fixtures'));
  mkdirp(path.join(runDir, 'evidence'));

  // --- Copy envelope to run directory ---
  try {
    const envelopeCopyPath = path.resolve(ROOT, runDir, 'envelope.yaml');
    fs.copyFileSync(envelopePath, envelopeCopyPath);
  } catch (err) {
    console.warn(`  ⚠ Could not copy envelope: ${err.message}`);
  }

  // --- Transition to running ---
  transitionRunState(runManifest, runDir, 'running', 'Execution started via round CLI');

  // --- Determine seed ---
  const seed = options.seed || `${runId}-execute`;

  // --- Invoke stub adapter ---
  console.log(`  Calling stub adapter (agent=${agentId}, runtime=${runtime})...`);
  let result;
  try {
    result = invokeStubAdapter(
      envelopeRef,
      runDir,
      agentId,
      runtime,
      seed,
      options.exitOverride
    );
  } catch (err) {
    console.error(`  ✘ Adapter invocation failed: ${err.message}`);
    transitionRunState(runManifest, runDir, 'blocked', `Adapter invocation error: ${err.message}`);
    return { runId, success: false, status: 'blocked', error: err.message };
  }

  console.log(`  Adapter exited with code ${result.exitCode} (→ ${result.status})`);

  // --- Determine run outcome ---
  let runStatus = result.status;
  let statusNote = `Adapter exit code ${result.exitCode} mapped to ${runStatus}`;

  // --- Validate output artifacts ---
  const validation = validateRunOutput(runDir);
  if (!validation.valid) {
    console.warn(`  ⚠ Output validation issues:`);
    for (const err of validation.errors) {
      console.warn(`    • ${err}`);
    }

    // If validation found secrets, escalate to disqualified
    const hasSecretExposure = validation.errors.some(e =>
      e.includes('SECRET DETECTED') || e.includes('secret')
    );
    if (hasSecretExposure) {
      runStatus = 'disqualified';
      statusNote = 'Output validation failed: secret or credential exposure detected';
    } else if (runStatus === 'completed') {
      // If adapter reported success but artifacts are invalid, downgrade to failed
      runStatus = 'failed';
      statusNote = 'Adapter reported completed but output artifacts failed validation';
    }
    // For non-completed statuses, keep the original status but note validation issues
  }

  // --- Check for disqualifying conditions ---
  // If exit code 0 but artifacts are missing entirely, that's suspicious
  if (result.exitCode === 0) {
    const rpExists = fs.existsSync(path.resolve(ROOT, runDir, 'result-packet.yaml'));
    if (!rpExists) {
      runStatus = 'disqualified';
      statusNote = 'Exit code 0 but result-packet.yaml missing — possible fabrications';
    }
  }

  // --- Transition to final state ---
  transitionRunState(runManifest, runDir, runStatus, statusNote);

  if (runStatus === 'completed') {
    console.log(`  ✓ Run completed successfully`);
  } else {
    console.log(`  ✘ Run finished with status: ${runStatus}`);
  }

  return {
    runId,
    success: runStatus === 'completed',
    status: runStatus,
    exitCode: result.exitCode,
    error: result.error || null,
    validationErrors: validation.valid ? [] : validation.errors,
  };
}

/**
 * Collect all pending or interrupted runs from a round manifest.
 */
function collectRuns(roundManifest, options) {
  const runDirBase = roundManifest.run_directory;
  if (!runDirBase || !dirExists(runDirBase)) {
    return [];
  }

  const absRunDir = path.resolve(ROOT, runDirBase);
  let entries;
  try {
    entries = fs.readdirSync(absRunDir);
  } catch {
    return [];
  }

  const runs = [];
  for (const entry of entries) {
    const entryPath = path.join(runDirBase, entry);
    if (!entry.startsWith('run-')) continue;
    if (!fs.statSync(path.resolve(ROOT, entryPath)).isDirectory()) continue;

    const manifest = loadRunManifest(entryPath);
    if (!manifest) {
      console.warn(`  ⚠ No manifest.yaml in ${entryPath}/ — skipping`);
      continue;
    }

    // Filter by run-id if specified
    if (options.runId && manifest.run_id !== options.runId) continue;

    runs.push({ dir: entryPath, manifest });
  }

  return runs;
}

/**
 * Execute all pending runs in a round.
 */
function cmdExecute(manifestArg, options) {
  const manifestPath = manifestArg;
  if (!manifestPath) {
    console.error('Usage: node scripts/round.js execute <manifest> [options]');
    process.exit(1);
  }

  CHECKS.length = 0;
  checkPassed = 0;
  checkFailed = 0;
  checkWarnings = 0;

  // Validate manifest first
  const manifest = validateRoundManifest(manifestPath, options.strict);
  failIfStrictWarnings(options.strict, 'execute');
  if (checkFailed > 0) {
    printCheckResult(true);
    console.error('\nCannot execute — manifest is invalid');
    process.exit(1);
  }

  // Check round lifecycle is in an executable state
  const roundLifecycle = manifest.lifecycle.status;
  if (isTerminalRoundState(roundLifecycle)) {
    console.error(`\n✘ Round lifecycle is "${roundLifecycle}" — cannot execute a completed round`);
    process.exit(1);
  }

  // Collect runs
  const allRuns = collectRuns(manifest, options);
  if (options.runId && allRuns.length === 0) {
    console.error(`\nNo run found matching --run-id "${options.runId}" in ${manifest.run_directory}`);
    process.exit(1);
  }
  if (allRuns.length === 0) {
    console.log('\nNo runs found for this round.');
    return manifest;
  }

  // Separate pending vs interrupted
  const pending = allRuns.filter(r => r.manifest.lifecycle === 'pending');
  const interrupted = allRuns.filter(r => r.manifest.lifecycle === 'running');
  const alreadyDone = allRuns.filter(r => isTerminalRunState(r.manifest.lifecycle));

  console.log(`\n=== Execute Round: ${manifest.round_id} ===`);
  console.log(`  Round lifecycle: ${roundLifecycle}`);
  console.log(`  Total runs:      ${allRuns.length}`);
  console.log(`  Pending:         ${pending.length}`);
  console.log(`  Interrupted:     ${interrupted.length}`);
  console.log(`  Already done:    ${alreadyDone.length}`);

  if (interrupted.length > 0 && !options.resume) {
    console.warn(`\n  ⚠ ${interrupted.length} run(s) are in "running" state (possibly interrupted).`);
    console.warn('  Use --resume to resume them, or reinitialize the round.');
  }

  if (pending.length === 0 && (interrupted.length === 0 || !options.resume)) {
    console.log('\n✓ Nothing to execute.');
    return manifest;
  }

  // Determine which runs to process
  const toProcess = options.resume
    ? [...pending, ...interrupted]
    : pending;

  if (toProcess.length === 0) {
    console.log('\n✓ Nothing to execute.');
    return manifest;
  }

  // Update round lifecycle to running
  const origRoundStatus = manifest.lifecycle.status;
  manifest.lifecycle.status = 'running';
  if (!Array.isArray(manifest.lifecycle.status_history)) {
    manifest.lifecycle.status_history = [];
  }
  manifest.lifecycle.status_history.push({
    status: 'running',
    timestamp: new Date().toISOString(),
    note: `Round execution started (${toProcess.length} runs)`,
  });
  fs.writeFileSync(path.resolve(ROOT, manifestPath), yaml.dump(manifest, { indent: 2, lineWidth: 120 }));

  // Execute each run
  let completed = 0;
  let failed = 0;
  const results = [];

  for (const run of toProcess) {
    const result = executeSingleRun(
      run.dir,
      run.manifest,
      manifest,
      options
    );
    results.push(result);
    if (result.success) {
      completed++;
    } else {
      failed++;
    }
  }

  // Reload manifest to get latest state
  const updatedManifest = loadYaml(manifestPath);

  // Determine if all runs are now in terminal states
  const allRunsUpdated = collectRuns(updatedManifest, options);
  const allTerminal = allRunsUpdated.every(r => isTerminalRunState(r.manifest.lifecycle));

  if (allTerminal) {
    updatedManifest.lifecycle.status = 'completed';
    if (!Array.isArray(updatedManifest.lifecycle.status_history)) {
      updatedManifest.lifecycle.status_history = [];
    }
    updatedManifest.lifecycle.status_history.push({
      status: 'completed',
      timestamp: new Date().toISOString(),
      note: `All ${allRunsUpdated.length} runs completed`,
    });
    fs.writeFileSync(path.resolve(ROOT, manifestPath), yaml.dump(updatedManifest, { indent: 2, lineWidth: 120 }));
    console.log(`\n✓ Round lifecycle → completed (all runs in terminal states)`);
  } else {
    // Some runs may still be pending if we filtered by --run-id
    console.log(`\n  Round lifecycle remains "running" (${allRunsUpdated.filter(r => !isTerminalRunState(r.manifest.lifecycle)).length} runs still non-terminal)`);
  }

  // Print summary
  console.log(`\n=== Execution Summary ===`);
  for (const r of results) {
    const icon = r.success ? '✓' : '✘';
    console.log(`  ${icon} ${r.runId} → ${r.status}${r.error ? ` (${r.error})` : ''}`);
    if (r.validationErrors && r.validationErrors.length > 0) {
      for (const ve of r.validationErrors) {
        console.log(`      ∟ ${ve}`);
      }
    }
  }
  console.log(`\n  Completed: ${completed}, Failed: ${failed}, Total: ${results.length}`);

  return updatedManifest;
}

/**
 * Resume interrupted runs (alias for execute --resume).
 */
function cmdResume(manifestArg, options) {
  if (!manifestArg) {
    console.error('Usage: node scripts/round.js resume <manifest> [options]');
    process.exit(1);
  }
  console.log('Resuming interrupted runs...');
  return cmdExecute(manifestArg, { ...options, resume: true });
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
  let runId = null;
  let exitOverride = null;
  let seed = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--strict':
        options.strict = true;
        break;
      case '--run-id':
        runId = args[++i];
        break;
      case '--exit':
        exitOverride = parseInt(args[++i], 10);
        break;
      case '--seed':
        seed = args[++i];
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

  // Execution options (shared by execute and resume)
  const execOptions = {
    verbose: options.verbose,
    strict: options.strict,
    runId,
    exitOverride,
    seed,
    resume: false,
  };

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
    case 'validate-adapter-outputs':
      cmdValidateAdapterOutputs(cmdArg, options);
      break;
    case 'execute':
      cmdExecute(cmdArg, execOptions);
      break;
    case 'resume':
      cmdResume(cmdArg, execOptions);
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
