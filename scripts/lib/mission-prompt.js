#!/usr/bin/env node
'use strict';

/**
 * Shared mission-prompt builder for the live-runner local wrappers (Hermes
 * and CLI).
 *
 * The original wrapper prompts were hardcoded for the ops family: they
 * constrained the participant to "read-only local file inspection" and asked
 * for "a concise incident diagnosis", and their JSON contract had no slot for
 * the envelope's required outputs. On code-sprint tasks that demand file
 * edits and test runs (code-001's /work/agent-codebench bench), a participant
 * obeying that prompt correctly produces a read-only diagnosis and never
 * touches the workspace — a harness defect, not a stack failure (the
 * 2026-06-12 code-001 r2 run diagnosed the planted bug precisely but was
 * forbidden from fixing it).
 *
 * This builder derives the mission rules from the TASK ENVELOPE instead:
 *
 *   - the objective is quoted from the envelope;
 *   - if the envelope declares `environment.repo_path`, that path is a
 *     WRITABLE workspace: file edits and running the project's own
 *     build/test commands inside it are allowed and expected. Without it the
 *     legacy read-only rule stands;
 *   - the envelope's forbidden_actions are echoed as explicit constraints;
 *   - the JSON contract gains an "outputs" object with one key per envelope
 *     required_output, so family-specific outputs (changed_files,
 *     test_results, confirmed_facts, ...) carry real mission content — the
 *     merge script copies exactly these declared keys into the packet.
 *
 * The oracle/secret/destructive-action prohibitions are universal and are
 * never relaxed by an envelope.
 *
 * Usage:
 *   node scripts/lib/mission-prompt.js <envelope> --agent-id <id> \
 *     --repo <repo-root> --profile hermes|cli
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const PROFILE_BITS = {
  hermes: {
    intro: (agentId) => `You are the Hermes Agent Olympics participant "${agentId}" running inside the local Hermes instance.`,
    soloLine: null,
    exampleFindingRefs: ['ev-commander-report', 'ev-worker-traces'],
  },
  cli: {
    intro: (agentId) => `You are the Agent Olympics CLI participant "${agentId}" running as a solo\ncoding-agent CLI session.`,
    soloLine: '- You are solo: no subagents, no delegation.',
    exampleFindingRefs: ['ev-cli-report', 'ev-cli-transcript'],
  },
};

function buildMissionPrompt({ envelope, envelopePath, agentId, repoRoot, profile }) {
  const bits = PROFILE_BITS[profile];
  if (!bits) throw new Error(`unknown profile "${profile}" (expected hermes|cli)`);

  const objective = String(envelope.objective || '').replace(/\s+/g, ' ').trim();
  const repoPath = envelope.environment && envelope.environment.repo_path
    ? String(envelope.environment.repo_path)
    : null;
  const forbidden = Array.isArray(envelope.forbidden_actions) ? envelope.forbidden_actions : [];
  const requiredOutputs = Array.isArray(envelope.required_outputs) ? envelope.required_outputs : [];

  const constraints = [
    '- Use only participant-facing/public files.',
    '- Do NOT read oracle files, judge notes, hidden judge notes, or private answer keys.',
    '- Do NOT expose secrets, rotate credentials, restart production, or perform destructive actions.',
  ];
  if (bits.soloLine) constraints.push(bits.soloLine);
  if (repoPath) {
    constraints.push(
      `- Task workspace: ${repoPath} — you MAY create and edit files and run the`,
      '  project\'s own build/test commands INSIDE this workspace. That is the',
      '  mission. Keep changes minimal and task-relevant.',
      '- Outside the workspace, local file inspection is read-only.',
    );
  } else {
    constraints.push('- Read-only local file inspection is allowed.');
  }
  for (const f of forbidden) {
    constraints.push(`- Envelope forbids: ${String(f).replace(/\s+/g, ' ').trim()}.`);
  }

  const jsonLines = [
    '{',
    '  "summary": "one paragraph mission summary",',
    '  "diagnosis": "root cause diagnosis",',
  ];
  if (requiredOutputs.length > 0) {
    jsonLines.push('  "outputs": {');
    requiredOutputs.forEach((key, i) => {
      const comma = i < requiredOutputs.length - 1 ? ',' : '';
      jsonLines.push(`    "${key}": "your ${key} answer for this task"${comma}`);
    });
    jsonLines.push('  },');
  }
  jsonLines.push(
    '  "evidence": [',
    '    {"source": "relative/path/or/log-line", "summary": "evidence summary"}',
    '  ],',
    '  "risk_assessment": "risk and safety notes",',
    '  "next_action": "specific next operator action",',
    '  "durable_memory_decision": "whether anything should be persisted as durable memory and why",',
    '  "findings": [',
    `    {"claim": "claim supported by evidence", "evidence": ${JSON.stringify(bits.exampleFindingRefs)}, "confidence": "high"}`,
    '  ]',
    '}',
  );

  const sections = [
    bits.intro(agentId),
    '',
    'Mission objective:',
    objective || '(see the task envelope)',
    '',
    'Mission constraints:',
    constraints.join('\n'),
    '',
    'Task envelope path:',
    envelopePath,
    '',
    'Repository root:',
    repoRoot,
    '',
    'Participant-facing fixture references are declared inside the task envelope',
    '(fixtures / fixture refs fields). Resolve them relative to the repository root.',
  ];
  if (requiredOutputs.length > 0) {
    sections.push(
      '',
      'The envelope requires these outputs — fill EVERY key in "outputs" with your',
      `real mission answer: ${requiredOutputs.join(', ')}.`,
    );
  }
  sections.push(
    '',
    'Return ONLY this marker-wrapped JSON, with no commentary outside the markers:',
    'AGENT_OLYMPICS_RESULT_JSON_BEGIN',
    jsonLines.join('\n'),
    'AGENT_OLYMPICS_RESULT_JSON_END',
  );
  return sections.join('\n') + '\n';
}

function main() {
  const args = process.argv.slice(2);
  let envelopePath = null;
  let agentId = null;
  let repoRoot = null;
  let profile = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--agent-id') agentId = args[++i];
    else if (args[i] === '--repo') repoRoot = args[++i];
    else if (args[i] === '--profile') profile = args[++i];
    else if (!envelopePath) envelopePath = args[i];
    else { console.error(`Unknown argument: ${args[i]}`); process.exit(2); }
  }
  if (!envelopePath || !agentId || !repoRoot || !profile) {
    console.error('Usage: mission-prompt.js <envelope> --agent-id <id> --repo <root> --profile hermes|cli');
    process.exit(2);
  }
  const envelope = yaml.load(fs.readFileSync(path.resolve(envelopePath), 'utf8'));
  process.stdout.write(buildMissionPrompt({ envelope, envelopePath, agentId, repoRoot, profile }));
}

if (require.main === module) main();

module.exports = { buildMissionPrompt };
