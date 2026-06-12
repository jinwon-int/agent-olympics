'use strict';

/**
 * Shared model-attestation parsing for the local wrappers.
 *
 * Both the Hermes and CLI mission wrappers want to attest which model a nested
 * agent actually routes to, rather than trusting the operator env (a real
 * fleet run shipped a wrong env label). They run the agent binary with
 * candidate info arguments and parse a "Model:" line out of the output. The
 * parser is shared here; scripts/hermes-model-detect.js and
 * scripts/cli-model-detect.js are thin CLIs over it.
 *
 * Like all attestation in this repo, this catches honest mistakes, not
 * adversarial spoofing. base_url and any other config values are intentionally
 * NOT emitted — endpoints can be private and belong nowhere near artifacts.
 */

const { spawnSync } = require('child_process');

/**
 * Parse a "Model:" line out of agent info output. Tolerates the observed
 * python-dict style ({'default': 'x', 'provider': 'y'}), JSON style, and a
 * bare "Model: <name>" fallback. Returns { model, provider } or null.
 */
function parseModelInfo(text) {
  const line = String(text)
    .split(/\r?\n/)
    .find((l) => /^\s*"?[Mm]odel"?\s*[:=]/.test(l));
  if (!line) return null;

  const body = line.replace(/^\s*"?[Mm]odel"?\s*[:=]\s*/, '').trim();

  // Dict/JSON style: pull 'default'/'name'/'model' and 'provider' keys with
  // either quote style.
  const dictKey = (key) => {
    const m = body.match(new RegExp(`['"]${key}['"]\\s*:\\s*['"]([^'"]+)['"]`));
    return m ? m[1] : null;
  };
  if (body.startsWith('{')) {
    const model = dictKey('default') || dictKey('name') || dictKey('model');
    if (!model) return null;
    return { model, provider: dictKey('provider') || 'unknown' };
  }

  // Bare style: "Model: deepseek-v4-pro (deepseek)" or "Model: deepseek-v4-pro"
  const bare = body.match(/^([\w.:\/-]+)(?:\s*\(([^)]+)\))?/);
  if (bare && bare[1]) {
    return { model: bare[1], provider: bare[2] || 'unknown' };
  }
  return null;
}

/**
 * Run `bin` with each candidate arg list until one prints a parseable Model
 * line. `overrideArgs` (array) forces a single invocation.
 */
function detect(bin, candidateArgs, overrideArgs) {
  const attempts = overrideArgs ? [overrideArgs] : candidateArgs;
  for (const args of attempts) {
    const res = spawnSync(bin, args, { encoding: 'utf8', timeout: 10000 });
    if (res.error) continue;
    const out = `${res.stdout || ''}\n${res.stderr || ''}`;
    const parsed = parseModelInfo(out);
    if (parsed) return { detected: true, ...parsed, via: `${bin} ${args.join(' ')}` };
  }
  return { detected: false, model: 'unknown', provider: 'unknown', via: 'none' };
}

module.exports = { parseModelInfo, detect };
