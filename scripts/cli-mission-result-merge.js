#!/usr/bin/env node
'use strict';

/**
 * CLI mission-output → result-packet merge (thin profile wrapper).
 *
 * The merge logic is shared with the Hermes wrapper in
 * scripts/lib/mission-result-merge.js (DRY): this file just selects the `cli`
 * profile (evidence ids ev-cli-report / ev-cli-transcript / ev-cli-probe, a
 * solo coding-agent CLI execution shape with no A2A workers, CLI_*
 * attestation env). See that module for the redaction / hallucinated-evidence-
 * id normalization (PR #228) / parse-fallback-downgrade behavior — all of
 * which the CLI wrapper inherits unchanged from the shared core.
 *
 * Usage: node scripts/cli-mission-result-merge.js <envelope> <run_dir> <mission_output> <cli_exit>
 */

const path = require('path');
const { mergeMissionResult, PROFILES } = require('./lib/mission-result-merge');

function usage() {
  console.error('Usage: node scripts/cli-mission-result-merge.js <envelope> <run_dir> <mission_output> <cli_exit>');
  process.exit(3);
}

const [envelopePath, runDir, outputPath, cliExitRaw] = process.argv.slice(2);
if (!envelopePath || !runDir || !outputPath) usage();

const result = mergeMissionResult({
  envelopePath,
  runDir,
  outputPath,
  agentExitRaw: cliExitRaw,
  profile: PROFILES.cli,
  env: process.env,
});

console.log(`Merged CLI mission output into ${path.join(runDir, 'result-packet.yaml')}`);
console.log(`parsed_json=${result.parsed} cli_exit=${result.agentExit} output_sha256=${result.sha256} redaction_rules=${result.redactionRuleIds.join(',') || 'none'}`);
