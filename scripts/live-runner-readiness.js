#!/usr/bin/env node
/**
 * Platform-neutral live runner readiness gate.
 *
 * This script does not dispatch participants. It evaluates a source-only
 * readiness fixture and blocks credential-bearing live dispatch until transport,
 * approval, credential references, timeout/cancel control, artifact fan-in,
 * redaction, and judge handoff are all documented as ready.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');

const SECRET_VALUE_PATTERNS = [
  /^sk-[a-zA-Z0-9]{20,}/,
  /^ghp_[a-zA-Z0-9]{36}/,
  /^gho_[a-zA-Z0-9]{36}/,
  /^github_pat_[a-zA-Z0-9_]{4,}/,
  /^xox[baprs]-/,
  /^-----BEGIN (RSA |EC |OPENSSH |ED25519 )?PRIVATE KEY-----/,
  /^eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+/,
];

function usage() {
  console.log(`Usage:
  node scripts/live-runner-readiness.js <fixture.yaml> [options]

Options:
  --expect <ready|blocked>  Exit 0 only when the decision matches
  --json                    Print packet JSON instead of a text summary
  --help                    Show this help

Exit codes:
  0  ready, or expected blocked/ready matched
  1  invalid input or expectation mismatch
  2  blocked readiness gate when no --expect is supplied`);
}

function parseArgs(argv) {
  const options = { fixture: null, expect: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--expect':
        options.expect = argv[++i];
        break;
      case '--json':
        options.json = true;
        break;
      case '--help':
      case '-h':
        usage();
        process.exit(0);
        break;
      default:
        if (!options.fixture) options.fixture = arg;
        else throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  if (!options.fixture) throw new Error('Missing fixture path');
  if (options.expect && !['ready', 'blocked'].includes(options.expect)) {
    throw new Error(`Invalid --expect value: ${options.expect}`);
  }
  return options;
}

function repoPath(relPath) {
  const resolved = path.resolve(ROOT, relPath);
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) {
    throw new Error(`Path escapes repository root: ${relPath}`);
  }
  return resolved;
}

function loadFixture(relPath) {
  const filePath = repoPath(relPath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Fixture not found: ${relPath}`);
  }
  return yaml.load(fs.readFileSync(filePath, 'utf8'));
}

function hasSecretValue(value) {
  return typeof value === 'string' && SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function scanSecrets(value, pathParts = []) {
  const findings = [];
  if (hasSecretValue(value)) {
    findings.push(pathParts.join('.') || '(root)');
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      findings.push(...scanSecrets(entry, [...pathParts, String(index)]));
    });
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      findings.push(...scanSecrets(entry, [...pathParts, key]));
    }
  }
  return findings;
}

function statusReady(section) {
  return section && section.status === 'ready';
}

function evaluate(fixture) {
  const blockers = [];
  const reasons = [];

  if (!fixture || typeof fixture !== 'object') {
    blockers.push('fixture is empty or not an object');
    return buildPacket(fixture || {}, blockers, reasons);
  }

  if (fixture.packet_kind !== 'agent-olympics.live-runner-readiness.input') {
    blockers.push('packet_kind must be agent-olympics.live-runner-readiness.input');
  }

  const secretPaths = scanSecrets(fixture);
  if (secretPaths.length > 0) {
    blockers.push(`secret-like value detected at: ${secretPaths.join(', ')}`);
  }

  const mode = fixture.mode || 'live';
  const dispatch = fixture.dispatch || {};
  const credentials = fixture.credentials || {};
  const approval = fixture.operator_approval || {};
  const timeoutCancel = fixture.timeout_cancel || {};
  const artifactFanIn = fixture.artifact_fan_in || {};
  const redaction = fixture.redaction || {};
  const judgeHandoff = fixture.judge_handoff || {};

  if (!fixture.runner_id) blockers.push('runner_id is required');
  if (!fixture.round_manifest) blockers.push('round_manifest is required');

  if (mode === 'dry_run') {
    if (credentials.required === true) {
      blockers.push('dry-run readiness fixture must not require credentials');
    }
    if (!['stub', 'dry_run'].includes(dispatch.transport)) {
      blockers.push('dry-run readiness requires stub or dry_run transport');
    }
    reasons.push('dry-run mode uses stub/source-only execution only');
  } else if (mode === 'live') {
    if (!statusReady(dispatch)) {
      blockers.push('live dispatch transport is not ready');
    }
    if (credentials.required !== true) {
      blockers.push('live mode must explicitly declare whether credentials are required');
    }
    if (credentials.required === true) {
      if (credentials.handling !== 'reference_only') {
        blockers.push('credential handling must be reference_only');
      }
      if (!Array.isArray(credentials.refs) || credentials.refs.length === 0) {
        blockers.push('credential refs are required for credential-bearing live dispatch');
      }
    }
    if (approval.required !== true || !approval.approval_ref) {
      blockers.push('operator approval_ref is required before credential-bearing live dispatch');
    }
  } else {
    blockers.push(`unsupported mode: ${mode}`);
  }

  if (!statusReady(timeoutCancel)) blockers.push('timeout/cancel/status mapping is not ready');
  if (!statusReady(artifactFanIn)) blockers.push('artifact fan-in is not ready');
  if (!statusReady(redaction)) blockers.push('redaction and secret/oracle leak checks are not ready');
  if (!statusReady(judgeHandoff)) blockers.push('judge handoff/oracle isolation is not ready');

  if (blockers.length === 0) {
    reasons.push('all required live runner readiness gates are ready');
  }

  return buildPacket(fixture, blockers, reasons);
}

function buildPacket(fixture, blockers, reasons) {
  const decision = blockers.length === 0 ? 'ready' : 'blocked';
  return {
    schema_version: 1,
    packet_kind: 'agent-olympics.live-runner-readiness.packet',
    runner_id: fixture.runner_id || null,
    round_manifest: fixture.round_manifest || null,
    mode: fixture.mode || 'live',
    decision,
    dispatch_allowed: decision === 'ready',
    reasons,
    blockers,
    boundaries: [
      'No credential values may appear in fixtures, logs, PRs, or result artifacts.',
      'Credential-bearing live dispatch requires operator approval_ref.',
      'OpenClaw/A2A is one transport option, not a mandatory participant class.',
      'Oracle files and hidden judge notes must stay out of participant-facing artifacts.',
    ],
  };
}

function printSummary(packet) {
  console.log(`Live runner readiness: ${packet.decision}`);
  console.log(`  runner:   ${packet.runner_id || '(missing)'}`);
  console.log(`  mode:     ${packet.mode}`);
  console.log(`  manifest: ${packet.round_manifest || '(missing)'}`);
  if (packet.reasons.length > 0) {
    console.log('  reasons:');
    packet.reasons.forEach((reason) => console.log(`    - ${reason}`));
  }
  if (packet.blockers.length > 0) {
    console.log('  blockers:');
    packet.blockers.forEach((blocker) => console.log(`    - ${blocker}`));
  }
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    const packet = evaluate(loadFixture(options.fixture));
    if (options.json) {
      console.log(JSON.stringify(packet, null, 2));
    } else {
      printSummary(packet);
    }

    if (options.expect) {
      if (packet.decision !== options.expect) {
        console.error(`Expected ${options.expect}, got ${packet.decision}`);
        process.exit(1);
      }
      return;
    }

    if (packet.decision !== 'ready') {
      process.exit(2);
    }
  } catch (err) {
    console.error(`live-runner-readiness failed: ${err.message}`);
    process.exit(1);
  }
}

main();
