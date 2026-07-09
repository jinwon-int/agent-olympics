#!/usr/bin/env node
'use strict';

/**
 * CLI agent model attestation probe (thin CLI over scripts/lib/model-detect.js).
 *
 * Detects which model a coding-agent CLI (claude / codex / any argv command)
 * actually routes to, so the CLI mission wrapper records an honest model label
 * instead of trusting CLI_AGENT_MODEL env. Coding CLIs vary widely, so this
 * tries the common info/version subcommands and parses a "Model:" line:
 *
 *   claude --version           ->  "Claude Code 1.2.3 (model: claude-opus-4)"
 *   <cli> config get model     ->  "Model: gpt-5.1 (openai)"
 *
 * Detection is best-effort. When no Model line is found the wrapper falls back
 * to the operator env, and records model_source honestly
 * (cli_config / operator_env / unknown). Like all attestation here, this
 * catches honest mistakes, not adversarial spoofing. Endpoints / base URLs are
 * never emitted.
 *
 * Usage:
 *   node scripts/cli-model-detect.js [--bin <claude>] [--args "<info args>"]
 *   node scripts/cli-model-detect.js --parse-file <captured-output.txt>
 *   node scripts/cli-model-detect.js --self-test
 *
 * Prints JSON: {"detected":bool,"model":string,"provider":string,"via":string}
 * Exit codes: 0 detected, 1 not detected, 2 usage/self-test failure.
 */

const { parseModelInfo, detect: sharedDetect } = require('./lib/model-detect');

// Candidate info invocations tried in order until one prints a Model line.
// CLI_AGENT_INFO_ARGS / --args overrides the list with a single invocation.
const CANDIDATE_ARGS = [
  ['config', 'get', 'model'],
  ['config', 'show'],
  ['models', 'current'],
  ['--model'],
  ['info'],
  ['--version'],
];

function detect(bin, overrideArgs) {
  return sharedDetect(bin, CANDIDATE_ARGS, overrideArgs);
}

function selfTest() {
  const cases = [
    {
      name: 'bare model with provider',
      text: 'Model: gpt-5.1 (openai)',
      expect: { model: 'gpt-5.1', provider: 'openai' },
    },
    {
      name: 'dict style',
      text: "Model: {'default': 'claude-opus-4', 'provider': 'anthropic'}",
      expect: { model: 'claude-opus-4', provider: 'anthropic' },
    },
    {
      name: 'bare model only',
      text: 'model = codex-mini',
      expect: { model: 'codex-mini', provider: 'unknown' },
    },
    { name: 'no model line', text: 'Claude Code 1.2.3\nReady.', expect: null },
  ];
  let failed = 0;
  for (const c of cases) {
    const got = parseModelInfo(c.text);
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
  let bin = 'claude';
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
          'Usage: cli-model-detect.js [--bin <claude>] [--args "<info args>"] | --parse-file <file> | --self-test'
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
    const parsed = parseModelInfo(fs.readFileSync(parseFile, 'utf8'));
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

module.exports = { parseModelInfo, detect };
