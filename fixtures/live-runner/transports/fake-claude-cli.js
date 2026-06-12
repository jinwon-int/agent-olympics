#!/usr/bin/env node
/**
 * Simulation CLI transport: a tiny fake `claude`-like coding-agent binary so a
 * CLI participant runs FULLY OFFLINE through adapters/wrappers/cli-mission-
 * wrapper.sh. Same pattern as the other live-runner fixture transports.
 *
 * Behaviour:
 *   - `--version`            → prints a version line that also carries a Model:
 *                             line, so scripts/cli-model-detect.js can attest a
 *                             model (model_source=cli_config).
 *   - `config get model`     → prints a bare "Model:" line (alt detection path).
 *   - <prompt>               → reads the mission prompt (last argv element),
 *                             echoes a deterministic marker-wrapped-JSON answer
 *                             that the cli merge script can parse.
 *
 * It NEVER reads oracle/judge material — it only reflects the public envelope
 * task id mentioned in the prompt. A FAKE-but-harmless line is printed so the
 * redaction path has something to chew on without committing a real secret.
 *
 * Usage (as the wrapper invokes it):
 *   node fake-claude-cli.js [run-flags...] "<mission prompt>"
 *   node fake-claude-cli.js --version
 *   node fake-claude-cli.js config get model
 */

'use strict';

const args = process.argv.slice(2);

// --- model attestation paths -------------------------------------------------
if (args.includes('--version')) {
  // Version line carries a Model: line for cli-model-detect.js.
  console.log('fake-claude-cli 9.9.9');
  console.log("Model: {'default': 'sim-claude-opus', 'provider': 'anthropic'}");
  process.exit(0);
}
if (args[0] === 'config' && args[1] === 'get' && args[2] === 'model') {
  console.log('Model: sim-claude-opus (anthropic)');
  process.exit(0);
}

// --- mission run -------------------------------------------------------------
// The mission prompt is the final argument the wrapper appends.
const prompt = args[args.length - 1] || '';
const taskMatch = prompt.match(/Task envelope path:\s*\S*\/([a-z0-9-]+)\.ya?ml/i);
const taskId = (taskMatch && taskMatch[1]) || 'unknown-task';

// A deterministic, plausible diagnosis for the ops fixtures. No oracle content.
const answer = {
  summary: `Solo CLI agent inspected the public fixtures for ${taskId} and isolated the delivery-layer failure.`,
  diagnosis: 'The final answer was rendered into the session transcript but no source-visible outbound message was emitted on the channel — a delivery-layer release failure, not a transcript-content problem.',
  evidence: [
    { source: 'gateway delivery log', summary: 'Outbound message attempt shows a null message id after session replay.' },
    { source: 'config snapshot', summary: 'Channel target was absent on the recovered run.' },
  ],
  risk_assessment: 'Read-only inspection only; no destructive action proposed. Verify before any restart.',
  next_action: 'Add a delivery-probe check and re-emit the final message with a valid channel target.',
  durable_memory_decision: 'Document the stale-recovery delivery failure pattern as a durable runbook note.',
  findings: [
    { claim: 'Root cause is a delivery-layer release failure, not transcript absence.', evidence: ['ev-cli-report', 'ev-cli-transcript'], confidence: 'high' },
    // Cite a hallucinated id on purpose so the merge script's PR #228
    // normalization is exercised end-to-end (it must be preserved as a
    // source string, never become a dangling machine ref).
    { claim: 'A delivery probe would have caught this earlier.', evidence: ['ev-cli-report', 'ev-hallucinated-probe'], confidence: 'medium' },
  ],
};

console.log('fake-claude-cli: working on the task (simulation, offline)...');
// Harmless FAKE line so the wrapper redaction path has a benign no-op; this is
// NOT secret-shaped, so it must NOT trigger redaction or disqualification.
console.log('note: no credentials were read (FAKE simulation transport).');
console.log('AGENT_OLYMPICS_RESULT_JSON_BEGIN');
console.log(JSON.stringify(answer, null, 2));
console.log('AGENT_OLYMPICS_RESULT_JSON_END');
process.exit(0);
