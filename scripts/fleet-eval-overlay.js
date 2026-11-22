#!/usr/bin/env node
/**
 * Fleet evaluation overlay renderer (#325 slice 4a).
 *
 *   node scripts/fleet-eval-overlay.js render --repo-dir <caller checkout> [--ref <git ref>] [--out <file>]
 *   node scripts/fleet-eval-overlay.js sha    --repo-dir <caller checkout> [--ref <git ref>]
 *
 * A caller repository (ccc-node, fleet-skills) declares in its lock file
 * `eval/fleet-eval.lock.json` which of its files the target must see — for
 * ccc-node the output style and the CLAUDE.md template. The renderer reads those
 * files **from a git ref** (default HEAD), never from the working tree, and
 * concatenates them into one overlay text. Its sha256 binds a run to the exact
 * content it measured: an operator renders the overlay from a PR head, runs the
 * target on it, and the caller's CI renders the same ref again and compares the
 * hash (scripts/fleet-eval-ci.js). Committing the run file does not change the
 * overlay inputs, so the binding has no cycle.
 *
 * Exit codes: 0 ok, 2 usage or input error.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const LOCK_PATH = 'eval/fleet-eval.lock.json';
const LOCK_SCHEMA = 'fleet-eval-lock-v1';
const OVERLAY_HEADER = 'fleet-eval overlay v1';
const LANE_RE = /^[a-z0-9][a-z0-9._-]*$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_OVERLAY_FILES = 32;

class OverlayError extends Error {}

/** A repo-relative path with no traversal, no absolute part and no backslash. */
function safeRelPath(p) {
  if (typeof p !== 'string' || p.length === 0 || p.length > 300) return false;
  if (p.startsWith('/') || p.includes('\\') || p.includes('\0')) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/** A git ref or sha that cannot be read as an option or a path spec. */
function safeRef(ref) {
  return typeof ref === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/^~-]{0,199}$/.test(ref);
}

function git(repoDir, args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', ['-C', repoDir, ...args], {
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    if (allowFail) return null;
    throw new OverlayError(`git ${args.join(' ')} failed in ${repoDir}`);
  }
}

/** File content at `ref`, or null when the path does not exist there. */
function showAt(repoDir, ref, relPath) {
  if (!safeRef(ref)) throw new OverlayError(`ref ${JSON.stringify(ref)} is not a plain git ref`);
  if (!safeRelPath(relPath)) throw new OverlayError(`path ${JSON.stringify(relPath)} is not safe`);
  const type = git(repoDir, ['cat-file', '-t', `${ref}:${relPath}`], { allowFail: true });
  if (type === null) return null;
  if (type.toString().trim() !== 'blob') throw new OverlayError(`${ref}:${relPath} is not a file`);
  return git(repoDir, ['show', `${ref}:${relPath}`]);
}

/** Validate a parsed lock object; returns a list of problems (empty when valid). */
function lockProblems(lock) {
  const problems = [];
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) return ['lock is not an object'];
  const allowed = new Set(['schemaVersion', 'agentOlympics', 'repo', 'lane', 'overlay', 'runsDir']);
  for (const key of Object.keys(lock)) if (!allowed.has(key)) problems.push(`unknown key ${key}`);
  if (lock.schemaVersion !== LOCK_SCHEMA) problems.push(`schemaVersion must be ${LOCK_SCHEMA}`);
  if (!SHA_RE.test(lock.agentOlympics || '')) problems.push('agentOlympics must be a 40-hex sha');
  if (!REPO_RE.test(lock.repo || '')) problems.push('repo must be <owner>/<repo>');
  if (!LANE_RE.test(lock.lane || '')) problems.push('lane is not a lane id');
  if (!safeRelPath(lock.runsDir)) problems.push('runsDir must be a safe relative path');
  if (!Array.isArray(lock.overlay) || lock.overlay.length === 0) {
    problems.push('overlay must be a non-empty list of paths');
  } else {
    if (lock.overlay.length > MAX_OVERLAY_FILES) problems.push('overlay lists too many files');
    const seen = new Set();
    for (const p of lock.overlay) {
      if (!safeRelPath(p)) problems.push(`overlay path ${JSON.stringify(p)} is not safe`);
      else if (seen.has(p)) problems.push(`overlay path ${p} is listed twice`);
      seen.add(p);
    }
  }
  return problems;
}

/** Read and validate the lock at `ref`; null when the lock does not exist there. */
function readLock(repoDir, ref) {
  const raw = showAt(repoDir, ref, LOCK_PATH);
  if (raw === null) return null;
  let lock;
  try {
    lock = JSON.parse(raw.toString('utf8'));
  } catch (err) {
    throw new OverlayError(`${ref}:${LOCK_PATH} invalid JSON: ${err.message}`);
  }
  const problems = lockProblems(lock);
  if (problems.length) throw new OverlayError(`${ref}:${LOCK_PATH}: ${problems.join('; ')}`);
  return lock;
}

/**
 * Render the overlay for `lock` at `ref`. Each file becomes a header line
 * `<!-- fleet-eval overlay v1: <path> -->` followed by its bytes and a newline,
 * in lock order. Returns { text: Buffer, sha256, files }.
 */
function renderOverlay(repoDir, ref, lock) {
  const parts = [];
  for (const rel of lock.overlay) {
    const body = showAt(repoDir, ref, rel);
    if (body === null) throw new OverlayError(`overlay file ${rel} does not exist at ${ref}`);
    if (body.length > MAX_FILE_BYTES) throw new OverlayError(`overlay file ${rel} is too large`);
    parts.push(Buffer.from(`<!-- ${OVERLAY_HEADER}: ${rel} -->\n`, 'utf8'), body);
    parts.push(Buffer.from('\n', 'utf8'));
  }
  const text = Buffer.concat(parts);
  return {
    text,
    sha256: crypto.createHash('sha256').update(text).digest('hex'),
    files: [...lock.overlay],
  };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--') || i + 1 >= argv.length) {
      throw new OverlayError(`unexpected argument ${arg}`);
    }
    opts[arg.slice(2)] = argv[(i += 1)];
  }
  return opts;
}

function main(argv = process.argv.slice(2), log = console.log) {
  const [command, ...rest] = argv;
  try {
    const opts = parseArgs(rest);
    const allowed = command === 'render' ? ['repo-dir', 'ref', 'out'] : ['repo-dir', 'ref'];
    for (const key of Object.keys(opts)) {
      if (!allowed.includes(key)) throw new OverlayError(`unknown option --${key}`);
    }
    if (command !== 'render' && command !== 'sha') {
      throw new OverlayError(
        'usage: fleet-eval-overlay.js render|sha --repo-dir <dir> [--ref <ref>]'
      );
    }
    if (!opts['repo-dir']) throw new OverlayError('--repo-dir is required');
    const repoDir = path.resolve(opts['repo-dir']);
    const ref = opts.ref || 'HEAD';
    const lock = readLock(repoDir, ref);
    if (!lock) throw new OverlayError(`${LOCK_PATH} does not exist at ${ref}`);
    const overlay = renderOverlay(repoDir, ref, lock);
    if (command === 'sha') {
      log(overlay.sha256);
      return 0;
    }
    if (!opts.out) throw new OverlayError('render needs --out <file>');
    if (fs.existsSync(opts.out)) throw new OverlayError(`${opts.out} already exists`);
    fs.writeFileSync(opts.out, overlay.text, { mode: 0o600 });
    log(`overlay ${lock.repo}@${ref} (${overlay.files.length} files) -> ${opts.out}`);
    log(`sha256 ${overlay.sha256}`);
    return 0;
  } catch (err) {
    if (!(err instanceof OverlayError)) throw err;
    log(`ERR   ${err.message}`);
    return 2;
  }
}

if (require.main === module) process.exit(main());

module.exports = {
  LOCK_PATH,
  OverlayError,
  safeRelPath,
  safeRef,
  showAt,
  git,
  lockProblems,
  readLock,
  renderOverlay,
  main,
};
