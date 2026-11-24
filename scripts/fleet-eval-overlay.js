#!/usr/bin/env node
/**
 * Fleet evaluation overlay renderer (#325 slice 4a).
 *
 *   node scripts/fleet-eval-overlay.js render --repo-dir <caller checkout> [--ref <git ref>] [--out <file>]
 *   node scripts/fleet-eval-overlay.js sha    --repo-dir <caller checkout> [--ref <git ref>]
 *   node scripts/fleet-eval-overlay.js catalog --skills-dir <dir> [--skills-dir <dir>]...
 *                                              [--include <file>] [--name-only <file>] [--out <file>]
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
 * Slice 4d adds the **skill catalog**: a lock may name directories whose
 * sub-directories are skills (`<dir>/<name>/SKILL.md`). The renderer appends one
 * list — `- <name>: <description>`, or `- <name>` for a name-only skill — built
 * from the same git ref, so a change to a skill's description, to the set of
 * skills or to how many of them are listed name-only changes the overlay hash.
 * `catalog` renders the same list from plain directories (an installed skill
 * tree, not a git ref) for operator experiments; it is not bound to a lock.
 *
 * Exit codes: 0 ok, 2 usage or input error.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');

const LOCK_PATH = 'eval/fleet-eval.lock.json';
const LOCK_SCHEMA = 'fleet-eval-lock-v1';
const OVERLAY_HEADER = 'fleet-eval overlay v1';
const LANE_RE = /^[a-z0-9][a-z0-9._-]*$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_OVERLAY_FILES = 32;
const CATALOG_HEADER = 'fleet-eval catalog v1';
const CATALOG_INTRO = 'The following skills are available:';
const SKILL_FILE = 'SKILL.md';
const SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_CATALOG_DIRS = 16;
const MAX_CATALOG_SKILLS = 2000;
const MAX_DESCRIPTION_CHARS = 1024;

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

/** Validate the lock's `catalog` object; returns a list of problems. */
function catalogProblems(catalog) {
  const problems = [];
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    return ['catalog is not an object'];
  }
  const allowed = new Set(['dirs', 'include', 'nameOnly']);
  for (const key of Object.keys(catalog)) {
    if (!allowed.has(key)) problems.push(`unknown catalog key ${key}`);
  }
  if (!Array.isArray(catalog.dirs) || catalog.dirs.length === 0) {
    problems.push('catalog.dirs must be a non-empty list of directories');
  } else {
    if (catalog.dirs.length > MAX_CATALOG_DIRS) problems.push('catalog.dirs lists too many dirs');
    const seen = new Set();
    for (const d of catalog.dirs) {
      if (!safeRelPath(d)) problems.push(`catalog dir ${JSON.stringify(d)} is not safe`);
      else if (seen.has(d)) problems.push(`catalog dir ${d} is listed twice`);
      seen.add(d);
    }
  }
  for (const key of ['include', 'nameOnly']) {
    if (catalog[key] !== undefined && !safeRelPath(catalog[key])) {
      problems.push(`catalog.${key} must be a safe relative path`);
    }
  }
  return problems;
}

/**
 * The one-line description of a skill from its SKILL.md front matter, or ''
 * when there is none. White space is collapsed and the text is cut at
 * MAX_DESCRIPTION_CHARS code points so one skill cannot crowd out the list.
 */
function skillDescription(raw) {
  const text = raw.toString('utf8').replace(/^\uFEFF/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return '';
  let description;
  try {
    const front = yaml.load(m[1], { schema: yaml.FAILSAFE_SCHEMA });
    description = front && typeof front === 'object' ? front.description : undefined;
  } catch (err) {
    // Front matter that is not valid YAML (an unquoted `: ` in the text is the
    // usual cause): take the `description:` line as written rather than
    // silently listing the skill name-only.
    const line = /^description:[ \t]*(.*)$/m.exec(m[1]);
    description = line ? line[1] : undefined;
  }
  if (typeof description !== 'string') return '';
  const flat = description.replace(/\s+/g, ' ').trim();
  const points = Array.from(flat);
  if (points.length <= MAX_DESCRIPTION_CHARS) return flat;
  return points.slice(0, MAX_DESCRIPTION_CHARS).join('') + '…';
}

/** Skill names from a list file: one per line, `#` comments and blank lines ignored. */
function parseNameList(raw, label) {
  const names = [];
  const seen = new Set();
  for (const line of raw.toString('utf8').split(/\r?\n/)) {
    const name = line.replace(/#.*$/, '').trim();
    if (name === '') continue;
    if (!SKILL_NAME_RE.test(name)) {
      throw new OverlayError(`${label}: ${JSON.stringify(name)} is not a skill name`);
    }
    if (seen.has(name)) throw new OverlayError(`${label}: ${name} is listed twice`);
    seen.add(name);
    names.push(name);
  }
  return names;
}

/** Skills under `dirs` at `ref`: every `<dir>/<name>/SKILL.md`. */
function catalogEntriesAtRef(repoDir, ref, dirs) {
  if (!safeRef(ref)) throw new OverlayError(`ref ${JSON.stringify(ref)} is not a plain git ref`);
  const entries = [];
  for (const dir of dirs) {
    if (!safeRelPath(dir)) throw new OverlayError(`catalog dir ${JSON.stringify(dir)} is not safe`);
    const type = git(repoDir, ['cat-file', '-t', `${ref}:${dir}`], { allowFail: true });
    if (type === null || type.toString().trim() !== 'tree') {
      throw new OverlayError(`catalog dir ${dir} does not exist at ${ref}`);
    }
    const listed = git(repoDir, ['ls-tree', '-z', '--name-only', `${ref}:${dir}`]);
    for (const name of listed.toString('utf8').split('\0')) {
      if (!SKILL_NAME_RE.test(name)) continue;
      const body = showAtOrNull(repoDir, ref, `${dir}/${name}/${SKILL_FILE}`);
      if (body === null) continue;
      if (body.length > MAX_FILE_BYTES)
        throw new OverlayError(`${dir}/${name}/${SKILL_FILE} is too large`);
      entries.push({ name, dir, description: skillDescription(body) });
    }
  }
  return entries;
}

/** Like showAt, but a path that is a directory or missing is simply "no file". */
function showAtOrNull(repoDir, ref, relPath) {
  const type = git(repoDir, ['cat-file', '-t', `${ref}:${relPath}`], { allowFail: true });
  if (type === null || type.toString().trim() !== 'blob') return null;
  return git(repoDir, ['show', `${ref}:${relPath}`]);
}

/** Skills under plain directories (an installed tree): every `<dir>/<name>/SKILL.md`. */
function catalogEntriesFromDirs(dirs) {
  const entries = [];
  for (const dir of dirs) {
    let listed;
    try {
      listed = fs.readdirSync(dir);
    } catch (err) {
      throw new OverlayError(`skills dir ${dir} cannot be read`);
    }
    for (const name of listed) {
      if (!SKILL_NAME_RE.test(name)) continue;
      const file = path.join(dir, name, SKILL_FILE);
      let stat;
      try {
        stat = fs.statSync(file);
      } catch (err) {
        continue;
      }
      if (!stat.isFile()) continue;
      if (stat.size > MAX_FILE_BYTES) throw new OverlayError(`${file} is too large`);
      entries.push({ name, dir, description: skillDescription(fs.readFileSync(file)) });
    }
  }
  return entries;
}

/**
 * Render the skill list. `include` (optional) keeps only the named skills;
 * `nameOnly` (optional) lists the named skills without their description. A
 * name in either list that is not in the catalog is an error, so a typo cannot
 * silently shrink the catalog. Skills are sorted by name; the same name in two
 * directories is an error. Returns { text: Buffer, skills, described }.
 */
function renderCatalog(entries, { include = null, nameOnly = null } = {}) {
  const byName = new Map();
  for (const e of entries) {
    if (byName.has(e.name)) {
      throw new OverlayError(`skill ${e.name} is in both ${byName.get(e.name).dir} and ${e.dir}`);
    }
    byName.set(e.name, e);
  }
  let names = [...byName.keys()];
  if (include) {
    for (const n of include) {
      if (!byName.has(n)) throw new OverlayError(`include names ${n}, which is not in the catalog`);
    }
    const keep = new Set(include);
    names = names.filter((n) => keep.has(n));
  }
  if (names.length === 0) throw new OverlayError('the catalog has no skills');
  if (names.length > MAX_CATALOG_SKILLS)
    throw new OverlayError('the catalog lists too many skills');
  const bare = new Set(nameOnly || []);
  const listed = new Set(names);
  for (const n of bare) {
    if (!listed.has(n)) throw new OverlayError(`nameOnly names ${n}, which is not in the catalog`);
  }
  names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const lines = [`<!-- ${CATALOG_HEADER} -->`, CATALOG_INTRO, ''];
  let described = 0;
  for (const n of names) {
    const description = bare.has(n) ? '' : byName.get(n).description;
    if (description) described += 1;
    lines.push(description ? `- ${n}: ${description}` : `- ${n}`);
  }
  return { text: Buffer.from(lines.join('\n') + '\n', 'utf8'), skills: names.length, described };
}

/** The lock's catalog at `ref`, with its optional list files read from the same ref. */
function renderLockCatalog(repoDir, ref, catalog) {
  const lists = {};
  for (const key of ['include', 'nameOnly']) {
    if (catalog[key] === undefined) continue;
    const raw = showAt(repoDir, ref, catalog[key]);
    if (raw === null)
      throw new OverlayError(`catalog.${key} ${catalog[key]} does not exist at ${ref}`);
    lists[key] = parseNameList(raw, catalog[key]);
  }
  return renderCatalog(catalogEntriesAtRef(repoDir, ref, catalog.dirs), lists);
}

/** Validate a parsed lock object; returns a list of problems (empty when valid). */
function lockProblems(lock) {
  const problems = [];
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) return ['lock is not an object'];
  const allowed = new Set([
    'schemaVersion',
    'agentOlympics',
    'repo',
    'lane',
    'overlay',
    'catalog',
    'runsDir',
  ]);
  for (const key of Object.keys(lock)) if (!allowed.has(key)) problems.push(`unknown key ${key}`);
  if (lock.schemaVersion !== LOCK_SCHEMA) problems.push(`schemaVersion must be ${LOCK_SCHEMA}`);
  if (!SHA_RE.test(lock.agentOlympics || '')) problems.push('agentOlympics must be a 40-hex sha');
  if (!REPO_RE.test(lock.repo || '')) problems.push('repo must be <owner>/<repo>');
  if (!LANE_RE.test(lock.lane || '')) problems.push('lane is not a lane id');
  if (!safeRelPath(lock.runsDir)) problems.push('runsDir must be a safe relative path');
  const hasCatalog = lock.catalog !== undefined;
  if (hasCatalog) problems.push(...catalogProblems(lock.catalog));
  if (lock.overlay === undefined && hasCatalog) {
    // a catalog-only lock (fleet-skills): no files, just the skill list
  } else if (!Array.isArray(lock.overlay) || (lock.overlay.length === 0 && !hasCatalog)) {
    problems.push('overlay must be a non-empty list of paths (or the lock must name a catalog)');
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
 * in lock order; the lock's skill catalog, when it has one, comes last.
 * Returns { text: Buffer, sha256, files, catalog }.
 */
function renderOverlay(repoDir, ref, lock) {
  const parts = [];
  const files = lock.overlay || [];
  for (const rel of files) {
    const body = showAt(repoDir, ref, rel);
    if (body === null) throw new OverlayError(`overlay file ${rel} does not exist at ${ref}`);
    if (body.length > MAX_FILE_BYTES) throw new OverlayError(`overlay file ${rel} is too large`);
    parts.push(Buffer.from(`<!-- ${OVERLAY_HEADER}: ${rel} -->\n`, 'utf8'), body);
    parts.push(Buffer.from('\n', 'utf8'));
  }
  let catalog = null;
  if (lock.catalog) {
    const rendered = renderLockCatalog(repoDir, ref, lock.catalog);
    parts.push(rendered.text);
    catalog = { skills: rendered.skills, described: rendered.described };
  }
  const text = Buffer.concat(parts);
  return { text, sha256: sha256Hex(text), files: [...files], catalog };
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const REPEATABLE = new Set(['skills-dir']);

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--') || i + 1 >= argv.length) {
      throw new OverlayError(`unexpected argument ${arg}`);
    }
    const key = arg.slice(2);
    const value = argv[(i += 1)];
    if (REPEATABLE.has(key)) (opts[key] = opts[key] || []).push(value);
    else opts[key] = value;
  }
  return opts;
}

function writeNew(file, buf) {
  if (fs.existsSync(file)) throw new OverlayError(`${file} already exists`);
  fs.writeFileSync(file, buf, { mode: 0o600 });
}

function readListFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file);
  } catch (err) {
    throw new OverlayError(`${file} cannot be read`);
  }
  return parseNameList(raw, file);
}

/** `catalog`: the skill list from plain directories, for operator experiments. */
function catalogCommand(opts, log) {
  const dirs = opts['skills-dir'];
  if (!dirs || dirs.length === 0) throw new OverlayError('catalog needs --skills-dir <dir>');
  const lists = {};
  if (opts.include) lists.include = readListFile(opts.include);
  if (opts['name-only']) lists.nameOnly = readListFile(opts['name-only']);
  const rendered = renderCatalog(catalogEntriesFromDirs(dirs), lists);
  const sha = sha256Hex(rendered.text);
  if (!opts.out) {
    log(sha);
    return 0;
  }
  writeNew(opts.out, rendered.text);
  log(`catalog ${rendered.skills} skills (${rendered.described} described) -> ${opts.out}`);
  log(`sha256 ${sha}`);
  return 0;
}

function main(argv = process.argv.slice(2), log = console.log) {
  const [command, ...rest] = argv;
  try {
    const opts = parseArgs(rest);
    const allowedFor = {
      render: ['repo-dir', 'ref', 'out'],
      sha: ['repo-dir', 'ref'],
      catalog: ['skills-dir', 'include', 'name-only', 'out'],
    };
    const allowed = allowedFor[command];
    if (!allowed) {
      throw new OverlayError(
        'usage: fleet-eval-overlay.js render|sha --repo-dir <dir> [--ref <ref>] | catalog --skills-dir <dir>'
      );
    }
    for (const key of Object.keys(opts)) {
      if (!allowed.includes(key)) throw new OverlayError(`unknown option --${key}`);
    }
    if (command === 'catalog') return catalogCommand(opts, log);
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
    writeNew(opts.out, overlay.text);
    const skills = overlay.catalog
      ? `, catalog ${overlay.catalog.skills} skills / ${overlay.catalog.described} described`
      : '';
    log(`overlay ${lock.repo}@${ref} (${overlay.files.length} files${skills}) -> ${opts.out}`);
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
  skillDescription,
  parseNameList,
  catalogEntriesAtRef,
  catalogEntriesFromDirs,
  renderCatalog,
  main,
};
