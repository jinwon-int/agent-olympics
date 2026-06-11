#!/usr/bin/env node
/**
 * Negative fixture transport: quickly writes a minimal, schema-valid v1
 * result packet + trace + evidence bundle, then hangs forever.
 *
 * The live runner must kill it at the enforced time limit and — because a
 * usable result packet is present — map the run to `partial`
 * ("timed out with usable partial output").
 *
 * Usage: node write-packet-then-hang.js <envelope> <run_dir> <agent_id> <run_id>
 */

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const [envelopePath, runDir, agentId, runId] = process.argv.slice(2);
if (!envelopePath || !runDir || !agentId || !runId) {
  console.error('usage: write-packet-then-hang.js <envelope> <run_dir> <agent_id> <run_id>');
  process.exit(3);
}

const envelope = yaml.load(fs.readFileSync(envelopePath, 'utf8'));
const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const taskId = envelope.task_id;

const outputs = {};
for (const key of envelope.required_outputs || []) {
  outputs[key] = `[fixture-transport] partial output for "${key}" written before the time limit.`;
}

const writeYaml = (name, doc) => {
  fs.writeFileSync(path.join(runDir, name), yaml.dump(doc, { indent: 2, lineWidth: 120 }), 'utf8');
};

writeYaml('result-packet.yaml', {
  schema_version: 1,
  task_id: taskId,
  agent_id: agentId,
  runtime: 'cli',
  started_at: now,
  ended_at: now,
  status: 'partial',
  summary: `Fixture transport wrote a usable partial result for ${taskId} and then deliberately exceeded the time limit.`,
  evidence: [
    {
      id: 'ev-fixture-log',
      kind: 'log',
      source: 'fixture transport',
      summary: 'Partial work log written before the transport stalled.',
      content_ref: 'runner-transport.log',
      content_type: 'text/plain',
    },
  ],
  findings: [
    {
      claim: 'A usable partial result was produced before the time limit expired.',
      evidence: ['ev-fixture-log'],
      confidence: 'medium',
    },
  ],
  outputs,
});

writeYaml('trace.yaml', {
  schema_version: 1,
  trace_id: `tr-${runId}`,
  run_id: runId,
  agent_id: agentId,
  generated_at: now,
  entries: [
    {
      seq: 0,
      timestamp: now,
      action: 'write',
      target: 'result_packet',
      summary: 'Wrote partial result packet before stalling.',
      duration_ms: 10,
    },
  ],
});

writeYaml('evidence-bundle.yaml', {
  schema_version: 1,
  bundle_id: `eb-${runId}`,
  run_id: runId,
  agent_id: agentId,
  generated_at: now,
  items: [
    {
      id: 'ev-fixture-log',
      kind: 'log',
      source: 'fixture transport',
      summary: 'Partial work log written before the transport stalled.',
      redacted: false,
    },
  ],
});

console.log('fixture transport: artifacts written, now hanging past the time limit...');
setInterval(() => {}, 1000);
