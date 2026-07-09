#!/usr/bin/env node
/**
 * Source-only end-to-end round CI gate.
 *
 * Runs a minimal round lifecycle without live nodes or credentials:
 * validate -> init -> execute/stub -> score -> competition-validity.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_MANIFEST = 'rounds/season-001-round-001.yaml';
const DEFAULT_WORK_DIR = '.tmp/ci-round';
const DEFAULT_TASK_ID = 'ops-001';
const DEFAULT_AGENT_ID = 'sogyo';
const DEFAULT_SEED = 'ci-round-source-only';

function usage() {
  console.log(`Usage:
  node scripts/ci-round.js [options]

Options:
  --manifest <path>   Source round manifest (default: ${DEFAULT_MANIFEST})
  --work-dir <path>   Repo-relative temporary workspace (default: ${DEFAULT_WORK_DIR})
  --task-id <id>      Task to include in the smoke round (default: ${DEFAULT_TASK_ID})
  --agent-id <id>     Participant to include in the smoke round (default: ${DEFAULT_AGENT_ID})
  --seed <string>     Stub adapter seed (default: ${DEFAULT_SEED})
  --keep              Keep temporary artifacts after a successful run
  --help              Show this help

The gate is source-only. It uses scripts/round.js execute with the stub adapter
and never calls live runners, providers, or OpenClaw nodes.`);
}

function parseArgs(argv) {
  const options = {
    manifest: DEFAULT_MANIFEST,
    workDir: DEFAULT_WORK_DIR,
    taskId: DEFAULT_TASK_ID,
    agentId: DEFAULT_AGENT_ID,
    seed: DEFAULT_SEED,
    keep: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--manifest':
        options.manifest = argv[++i];
        break;
      case '--work-dir':
        options.workDir = argv[++i];
        break;
      case '--task-id':
        options.taskId = argv[++i];
        break;
      case '--agent-id':
        options.agentId = argv[++i];
        break;
      case '--seed':
        options.seed = argv[++i];
        break;
      case '--keep':
        options.keep = true;
        break;
      case '--help':
      case '-h':
        usage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  for (const [key, value] of Object.entries(options)) {
    if (value === undefined || value === '') {
      throw new Error(`Missing value for --${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`);
    }
  }

  return options;
}

function repoPath(relPath) {
  const resolved = path.resolve(ROOT, relPath);
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) {
    throw new Error(`Path escapes repository root: ${relPath}`);
  }
  return resolved;
}

function runStage(label, args) {
  console.log(`\n=== ${label} ===`);
  console.log(`$ node ${args.join(' ')}`);
  const result = spawnSync(process.execPath, args, {
    cwd: ROOT,
    stdio: 'inherit',
    encoding: 'utf8',
  });

  if (result.error) {
    throw new Error(`${label} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const err = new Error(`${label} failed with exit code ${result.status}`);
    err.exitCode = result.status;
    throw err;
  }
}

function loadYaml(relPath) {
  const filePath = repoPath(relPath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Manifest not found: ${relPath}`);
  }
  return yaml.load(fs.readFileSync(filePath, 'utf8'));
}

function ensureRelativePath(relPath, label) {
  if (path.isAbsolute(relPath)) {
    throw new Error(`${label} must be repo-relative: ${relPath}`);
  }
  repoPath(relPath);
}

function writeCiManifest(options) {
  ensureRelativePath(options.workDir, 'work-dir');
  const manifest = loadYaml(options.manifest);

  const selectedTask = (manifest.tasks || []).find((entry) => entry.task_id === options.taskId);
  if (!selectedTask) {
    throw new Error(`Task not found in ${options.manifest}: ${options.taskId}`);
  }
  const task = { ...selectedTask };

  const participant = (manifest.participants || []).find((entry) => entry.agent_id === options.agentId);
  if (!participant) {
    throw new Error(`Participant not found in ${options.manifest}: ${options.agentId}`);
  }

  const workDir = repoPath(options.workDir);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  // The smoke round runs against the canonical v2 envelope referenced by the
  // manifest. (Historically this downgraded to a sibling v1 envelope when one
  // existed; the v1 Season-001 envelopes were retired in #257, so the stub now
  // exercises the strict v2 result-packet schema directly.)

  const runDirectory = path.posix.join(
    options.workDir.replace(/\\/g, '/').replace(/\/$/, ''),
    'runs',
    manifest.season || 'season-001',
    'round-001'
  ) + '/';

  const ciManifest = {
    ...manifest,
    title: `${manifest.title || manifest.round_id} - CI source-only smoke`,
    description: [
      'Source-only CI smoke copy generated by scripts/ci-round.js.',
      'Runs one task and one participant through validate/init/execute/stub/score/competition-validity.',
      'No live runner, provider, or credential access is allowed.',
    ].join(' '),
    lifecycle: {
      status: 'pending',
      status_history: [
        {
          status: 'pending',
          timestamp: new Date().toISOString(),
          note: 'CI source-only smoke manifest generated from version-controlled round manifest',
        },
      ],
    },
    tasks: [task],
    participants: [{ ...participant, enabled: true }],
    run_directory: runDirectory,
    labels: [...new Set([...(manifest.labels || []), 'ci-round', 'source-only', 'stub'])],
  };

  const manifestPath = path.posix.join(options.workDir.replace(/\\/g, '/'), 'round.yaml');
  fs.writeFileSync(
    repoPath(manifestPath),
    yaml.dump(ciManifest, { indent: 2, lineWidth: 120 }),
    'utf8'
  );

  return {
    manifestPath,
    runDirectory,
    workDir: options.workDir,
  };
}

function runDirectories(runDirectory) {
  const full = repoPath(runDirectory);
  if (!fs.existsSync(full)) {
    throw new Error(`Run directory was not created: ${runDirectory}`);
  }
  return fs.readdirSync(full)
    .filter((entry) => entry.startsWith('run-'))
    .map((entry) => path.posix.join(runDirectory.replace(/\\/g, '/'), entry));
}

function assertCompletedRuns(runDirectory) {
  const runs = runDirectories(runDirectory);
  if (runs.length === 0) {
    throw new Error(`No run directories found in ${runDirectory}`);
  }

  const nonCompleted = [];
  for (const runDir of runs) {
    const manifest = yaml.load(fs.readFileSync(repoPath(path.posix.join(runDir, 'manifest.yaml')), 'utf8'));
    if (manifest.lifecycle !== 'completed') {
      nonCompleted.push(`${manifest.run_id || runDir}:${manifest.lifecycle || 'unknown'}`);
    }
  }

  if (nonCompleted.length > 0) {
    throw new Error(`Stub execution did not complete all runs: ${nonCompleted.join(', ')}`);
  }
}

function assertScoreboard(runDirectory) {
  const scoreboardPath = repoPath(path.posix.join(runDirectory.replace(/\\/g, '/'), 'scoreboard.json'));
  if (!fs.existsSync(scoreboardPath)) {
    throw new Error(`Scoreboard was not created: ${path.relative(ROOT, scoreboardPath)}`);
  }
  const scoreboard = JSON.parse(fs.readFileSync(scoreboardPath, 'utf8'));
  const summary = scoreboard.summary || {};
  if (!summary.total_entries || summary.total_entries < 1) {
    throw new Error('Scoreboard contains no entries');
  }
  if (summary.entries_with_errors !== 0) {
    throw new Error(`Scoreboard has entries_with_errors=${summary.entries_with_errors}`);
  }
}

function main() {
  let options;
  let prepared = null;
  let failed = false;

  try {
    options = parseArgs(process.argv.slice(2));
    prepared = writeCiManifest(options);

    console.log('Agent Olympics source-only CI round gate');
    console.log(`  manifest:      ${prepared.manifestPath}`);
    console.log(`  run directory: ${prepared.runDirectory}`);
    console.log(`  task:          ${options.taskId}`);
    console.log(`  participant:   ${options.agentId}`);
    console.log(`  seed:          ${options.seed}`);

    runStage('validate', ['scripts/validate.js', 'all']);
    runStage('round validate', ['scripts/round.js', 'validate', prepared.manifestPath, '--strict']);
    runStage('init', ['scripts/round.js', 'init', prepared.manifestPath, '--strict']);
    runStage('execute/stub', ['scripts/round.js', 'execute', prepared.manifestPath, '--seed', options.seed]);
    assertCompletedRuns(prepared.runDirectory);
    runStage('score', ['scripts/score.js', 'run', prepared.runDirectory]);
    assertScoreboard(prepared.runDirectory);
    runStage('competition-validity', ['scripts/competition-validity.js', 'all', prepared.runDirectory]);

    console.log('\nci-round passed: source-only round lifecycle is valid end to end.');
  } catch (err) {
    failed = true;
    console.error(`\nci-round failed: ${err.message}`);
    if (prepared) {
      console.error(`  artifacts kept at: ${prepared.workDir}`);
    }
    process.exitCode = err.exitCode || 1;
  } finally {
    if (prepared && !failed && !options.keep) {
      fs.rmSync(repoPath(prepared.workDir), { recursive: true, force: true });
    } else if (prepared && !failed && options.keep) {
      console.log(`  artifacts kept at: ${prepared.workDir}`);
    }
  }
}

main();
