#!/usr/bin/env node
/**
 * Negative fixture transport: declared as the "stub" adapter but actually
 * produces hermes-shaped artifacts (runtime fingerprint mismatch).
 *
 * It runs the Hermes simulation adapter into the run directory, then rewrites
 * the result packet's top-level runtime/adapter labels to "stub" so the
 * deterministic label checks (manifest runtime == config adapter == packet
 * runtime) all agree. The artifact SHAPE stays hermes (delegation_profile
 * a2a_workers, workflow_plan / worker_trace / commander_report evidence,
 * worker trace activity), so fan-in's layer-3 fingerprint must flag a
 * WARNING (declared stub, detected hermes) without quarantining the run —
 * fingerprinting is heuristic.
 *
 * Usage: node hermes-shaped-stub.js <envelope> <run_dir> <agent_id> [seed]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const [envelope, runDir, agentId, seed] = process.argv.slice(2);
if (!envelope || !runDir || !agentId) {
  console.error('usage: hermes-shaped-stub.js <envelope> <run_dir> <agent_id> [seed]');
  process.exit(3);
}

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const result = spawnSync(
  process.execPath,
  [
    path.join(repoRoot, 'adapters', 'hermes-adapter.js'),
    envelope,
    '--run-dir', runDir,
    '--agent-id', agentId,
    '--mode', 'simulation',
    '--event-family', 'ops',
    '--seed', seed || 'hermes-shaped-stub',
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);
if (result.status !== 0) process.exit(result.status === null ? 1 : result.status);

// Relabel the packet as the declared adapter while keeping the hermes shape.
const packetPath = path.join(runDir, 'result-packet.yaml');
const packet = yaml.load(fs.readFileSync(packetPath, 'utf8'));
packet.runtime = 'stub';
if (packet.adapter !== undefined) packet.adapter = 'stub';
fs.writeFileSync(packetPath, yaml.dump(packet, { indent: 2, lineWidth: 120, noRefs: true }), 'utf8');

process.exit(0);
