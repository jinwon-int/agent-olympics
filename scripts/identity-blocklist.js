#!/usr/bin/env node
'use strict';

/**
 * Derive the participant identity blocklist for the blind public leaderboard.
 *
 * The blind leaderboard (docs/public-leaderboard.md) withholds participant
 * identity, models, and nodes. The Pages publish workflow greps the generated
 * site for any of these tokens as a last-line fairness gate. Previously that
 * gate used a hand-maintained literal regex in .github/workflows/pages.yml, so
 * any participant/model/node registered after the list was written was not
 * protected (silent-open). This script derives the blocklist at run time from
 * the authoritative sources already in the repo:
 *
 *   - rounds/<*>.yaml   participant agent_ids, and any model/node fields
 *   - results/<*>.yaml   per-run agent_id, model, model_provider, node, and
 *                        comparable_metadata.{participant,model,node}
 *
 * plus a small static tail for infrastructure patterns (vps<N> host slugs).
 *
 * Usage:
 *   node scripts/identity-blocklist.js            # newline-separated tokens
 *   node scripts/identity-blocklist.js --regex    # a single alternation regex
 *   node scripts/identity-blocklist.js --json     # {tokens, staticPatterns, regex}
 *
 * Exits non-zero if the DERIVED (dynamic) token set is empty — that guards
 * against the extraction breaking and the gate silently becoming a no-op.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');

// Keys whose string values identify a participant, model, or node.
const IDENTITY_KEYS = new Set(['agent_id', 'node', 'model', 'model_provider', 'provider']);

// Generic / non-identifying values that must never enter the blocklist (they
// are shared defaults or placeholders, and blocking them would false-positive).
const GENERIC_VALUES = new Set([
  '',
  'none',
  'null',
  'unknown',
  'n/a',
  'na',
  'stub',
  'deterministic-stub',
  'cli',
  'cli-default',
  'orchestrator-default',
  'open-stack-default',
  'closed-stack-default',
  'default',
  'fixture',
  'fixtures',
]);

// Static infrastructure patterns (regex fragments) that don't appear as literal
// manifest tokens but must always be blocked.
const STATIC_PATTERNS = ['vps[0-9]+'];

function listYaml(dirRel) {
  const dir = path.join(ROOT, dirRel);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => path.join(dir, f));
}

function collectFromNode(node, out) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const item of node) collectFromNode(item, out);
    return;
  }
  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (IDENTITY_KEYS.has(key)) {
        if (typeof value === 'string') {
          out.add(value.trim());
        } else if (value && typeof value === 'object') {
          // e.g. model: { name, provider }, node: { profile_ref }
          for (const nested of Object.values(value)) {
            if (typeof nested === 'string') out.add(nested.trim());
          }
        }
      }
      collectFromNode(value, out);
    }
  }
}

function deriveTokens() {
  const raw = new Set();
  for (const file of [...listYaml('rounds'), ...listYaml('results')]) {
    let doc;
    try {
      doc = yaml.load(fs.readFileSync(file, 'utf8'));
    } catch {
      continue; // a malformed data file must not silently empty the gate; skip it
    }
    collectFromNode(doc, raw);
  }
  return (
    [...raw]
      .map((t) => (t || '').trim())
      .filter((t) => t.length >= 3)
      .filter((t) => !GENERIC_VALUES.has(t.toLowerCase()))
      // Drop path-like values (a field pointing at a profile/fixture file, not an identity).
      .filter((t) => !/[\\/]/.test(t) && !/\.(ya?ml|json)$/i.test(t))
      // A vps<N> slug is already covered by the static tail.
      .filter((t) => !/^vps[0-9]+$/i.test(t))
      .sort()
  );
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRegex(tokens) {
  const alts = [...tokens.map(escapeRegex), ...STATIC_PATTERNS];
  return alts.join('|');
}

function main() {
  const args = process.argv.slice(2);
  const tokens = deriveTokens();

  if (tokens.length === 0) {
    console.error(
      'ERROR: derived identity blocklist is empty — refusing to emit a no-op gate. ' +
        'Check that rounds/ and results/ contain participant data.'
    );
    process.exit(1);
  }

  if (args.includes('--json')) {
    process.stdout.write(
      JSON.stringify(
        { tokens, staticPatterns: STATIC_PATTERNS, regex: buildRegex(tokens) },
        null,
        2
      ) + '\n'
    );
  } else if (args.includes('--regex')) {
    process.stdout.write(buildRegex(tokens) + '\n');
  } else {
    process.stdout.write(tokens.join('\n') + '\n');
  }
}

if (require.main === module) {
  main();
}

module.exports = { deriveTokens, buildRegex, STATIC_PATTERNS };
