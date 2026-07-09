#!/usr/bin/env node
'use strict';

/**
 * Hermes model attestation probe (thin CLI over scripts/lib/model-detect.js).
 *
 * Detects which model the local Hermes instance actually routes to by running
 * the Hermes binary with candidate info arguments and parsing the "Model:"
 * line it prints, e.g.:
 *
 *   Hermes Agent v0.16.0
 *   Model: {'default': 'deepseek-v4-pro', 'provider': 'deepseek', 'base_url': 'https://api.deepseek.com'}
 *
 * Motivation: operator-supplied HERMES_MODEL env labels are trust-based and a
 * real fleet run shipped a wrong label. Detection from the Hermes config
 * closes that gap. Like all attestation here, this catches honest mistakes,
 * not adversarial spoofing.
 *
 * Usage:
 *   node scripts/hermes-model-detect.js [--bin <hermes>] [--args "<info args>"]
 *   node scripts/hermes-model-detect.js --parse-file <captured-output.txt>
 *   node scripts/hermes-model-detect.js --self-test
 *
 * Prints JSON: {"detected":bool,"model":string,"provider":string,"via":string}
 * Exit codes: 0 detected, 1 not detected, 2 usage/self-test failure.
 * base_url and any other config values are intentionally NOT emitted.
 */

const { parseModelInfo, detect: sharedDetect } = require('./lib/model-detect');

// Candidate info invocations tried in order until one prints a Model line.
// HERMES_INFO_ARGS / --args overrides the list with a single invocation.
const CANDIDATE_ARGS = [['config', 'show'], ['config'], ['status'], ['info'], ['--version']];

// Backward-compatible aliases (existing imports use these names).
const parseHermesModelInfo = parseModelInfo;
function detect(bin, overrideArgs) {
  return sharedDetect(bin, CANDIDATE_ARGS, overrideArgs);
}

function selfTest() {
  const cases = [
    {
      name: 'observed python-dict style',
      text: "Hermes Agent v0.16.0\nModel: {'default': 'deepseek-v4-pro', 'provider': 'deepseek', 'base_url': 'https://api.deepseek.com'}",
      expect: { model: 'deepseek-v4-pro', provider: 'deepseek' },
    },
    {
      name: 'json style',
      text: 'Model: {"default": "gpt-5.5", "provider": "openai-codex"}',
      expect: { model: 'gpt-5.5', provider: 'openai-codex' },
    },
    {
      name: 'bare with provider parens',
      text: 'Model: claude-4-opus (anthropic)',
      expect: { model: 'claude-4-opus', provider: 'anthropic' },
    },
    {
      name: 'bare without provider',
      text: 'Model: llama-4-70b',
      expect: { model: 'llama-4-70b', provider: 'unknown' },
    },
    {
      name: 'no model line',
      text: 'Hermes Agent v0.16.0\nReady.',
      expect: null,
    },
    {
      name: 'name key instead of default',
      text: "model: {'name': 'qwen-3-max', 'provider': 'alibaba'}",
      expect: { model: 'qwen-3-max', provider: 'alibaba' },
    },
  ];
  let failed = 0;
  for (const c of cases) {
    const got = parseHermesModelInfo(c.text);
    const ok =
      c.expect === null
        ? got === null
        : !!got && got.model === c.expect.model && got.provider === c.expect.provider;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${c.name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(c.expect)}`}`
    );
    if (!ok) failed += 1;
  }
  console.log(`${cases.length - failed} passed, ${failed} failed`);
  return failed === 0;
}

function main() {
  const args = process.argv.slice(2);
  let bin = 'hermes';
  let overrideArgs = null;
  let parseFile = null;
  let runSelfTest = false;
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--bin':
        bin = args[++i];
        break;
      case '--args':
        overrideArgs = String(args[++i] || '')
          .split(/\s+/)
          .filter(Boolean);
        break;
      case '--parse-file':
        parseFile = args[++i];
        break;
      case '--self-test':
        runSelfTest = true;
        break;
      case '--help':
      case '-h':
        console.log(
          'Usage: hermes-model-detect.js [--bin <hermes>] [--args "<info args>"] | --parse-file <file> | --self-test'
        );
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        process.exit(2);
    }
  }

  if (runSelfTest) process.exit(selfTest() ? 0 : 2);

  if (parseFile) {
    const fs = require('fs');
    const parsed = parseHermesModelInfo(fs.readFileSync(parseFile, 'utf8'));
    const result = parsed
      ? { detected: true, ...parsed, via: `file:${parseFile}` }
      : { detected: false, model: 'unknown', provider: 'unknown', via: `file:${parseFile}` };
    console.log(JSON.stringify(result));
    process.exit(result.detected ? 0 : 1);
  }

  const result = detect(bin, overrideArgs);
  console.log(JSON.stringify(result));
  process.exit(result.detected ? 0 : 1);
}

if (require.main === module) main();

module.exports = { parseHermesModelInfo, detect };
