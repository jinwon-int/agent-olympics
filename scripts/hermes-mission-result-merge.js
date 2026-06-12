#!/usr/bin/env node
'use strict';

/**
 * Hermes mission-output → result-packet merge (thin profile wrapper).
 *
 * The merge logic is shared with the CLI wrapper in
 * scripts/lib/mission-result-merge.js (DRY): this file just selects the
 * `hermes` profile (evidence ids ev-commander-report / ev-worker-traces /
 * ev-probe-result, nested-Hermes-CLI execution shape, HERMES_* attestation
 * env). See that module for the redaction / hallucinated-evidence-id
 * normalization (PR #228) / parse-fallback-downgrade behavior.
 *
 * Usage: node scripts/hermes-mission-result-merge.js <envelope> <run_dir> <mission_output> <hermes_exit>
 */

const { mergeMissionResult, PROFILES } = require('./lib/mission-result-merge');

function usage() {
  console.error('Usage: node scripts/hermes-mission-result-merge.js <envelope> <run_dir> <mission_output> <hermes_exit>');
  process.exit(3);
}

const [envelopePath, runDir, outputPath, hermesExitRaw] = process.argv.slice(2);
if (!envelopePath || !runDir || !outputPath) usage();

const result = mergeMissionResult({
  envelopePath,
  runDir,
  outputPath,
  agentExitRaw: hermesExitRaw,
  profile: PROFILES.hermes,
  env: process.env,
});

console.log(`Merged Hermes mission output into ${require('path').join(runDir, 'result-packet.yaml')}`);
console.log(`parsed_json=${result.parsed} hermes_exit=${result.agentExit} output_sha256=${result.sha256} redaction_rules=${result.redactionRuleIds.join(',') || 'none'}`);
