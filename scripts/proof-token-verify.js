#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');

function usage() {
  console.error(`Usage:
  node scripts/proof-token-verify.js
  node scripts/proof-token-verify.js --packet <result-packet.yaml> --challenge-set <challenge-set.yaml> [--expect pass|fail]`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--packet') args.packet = argv[++i];
    else if (arg === '--challenge-set') args.challengeSet = argv[++i];
    else if (arg === '--expect') args.expect = argv[++i];
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function loadYaml(relPath) {
  const full = path.resolve(ROOT, relPath);
  return yaml.load(fs.readFileSync(full, 'utf8'));
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function repoPath(relPath) {
  const resolved = path.resolve(ROOT, relPath);
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) {
    throw new Error(`path escapes repository root: ${relPath}`);
  }
  return resolved;
}

function sha256File(relPath) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(repoPath(relPath)))
    .digest('hex');
}

function verify(packetPath, challengeSetPath) {
  const packet = loadYaml(packetPath);
  const challengeSet = loadYaml(challengeSetPath);
  const challengeById = new Map((challengeSet.challenges || []).map((c) => [c.challenge_id, c]));
  const results = [];
  const seenChallengeIds = new Set();

  for (const proof of packet.proof_tokens || []) {
    const challenge = challengeById.get(proof.challenge_id);
    const errors = [];
    let points = 0;

    if (seenChallengeIds.has(proof.challenge_id)) {
      errors.push(`duplicate proof token for ${proof.challenge_id}`);
      results.push({ proof, passed: false, points, errors });
      continue;
    }
    seenChallengeIds.add(proof.challenge_id);

    if (!challenge) {
      errors.push(`unknown challenge_id ${proof.challenge_id}`);
      results.push({ proof, passed: false, points, errors });
      continue;
    }

    if (proof.token_id !== challenge.token_id) {
      errors.push(`token_id mismatch: got ${proof.token_id}, expected ${challenge.token_id}`);
    }

    const tokenHash = sha256Text(proof.submitted_token);
    if (tokenHash !== challenge.expected_token_sha256) {
      errors.push(`proof token hash mismatch for ${proof.challenge_id}`);
    }

    if (!proof.solution_artifact_ref) {
      errors.push('missing solution_artifact_ref');
    } else {
      try {
        const artifactHash = sha256File(proof.solution_artifact_ref);
        if (proof.solution_artifact_sha256 && proof.solution_artifact_sha256 !== artifactHash) {
          errors.push(`declared artifact hash mismatch for ${proof.solution_artifact_ref}`);
        }
        if (artifactHash !== challenge.expected_artifact_sha256) {
          errors.push(`artifact hash mismatch for ${proof.solution_artifact_ref}`);
        }

        const artifactText = fs.readFileSync(repoPath(proof.solution_artifact_ref), 'utf8');
        for (const marker of challenge.required_markers || []) {
          if (!artifactText.includes(marker)) {
            errors.push(`solution artifact missing marker: ${marker}`);
          }
        }
      } catch (artifactError) {
        errors.push(`solution artifact unreadable: ${artifactError.message}`);
      }
    }

    if (errors.length === 0) points = Number(challenge.points || 0);
    results.push({ proof, passed: errors.length === 0, points, errors });
  }

  if (!packet.proof_tokens || packet.proof_tokens.length === 0) {
    results.push({ proof: null, passed: false, points: 0, errors: ['packet has no proof_tokens'] });
  }

  const passed = results.every((r) => r.passed);
  const totalPoints = results.reduce((sum, r) => sum + r.points, 0);
  return { packetPath, challengeSetPath, passed, totalPoints, results };
}

function printResult(result) {
  const status = result.passed ? 'PASS' : 'FAIL';
  console.log(`${status}  ${result.packetPath}  points=${result.totalPoints}`);
  for (const item of result.results) {
    const id = item.proof ? item.proof.challenge_id : '(none)';
    console.log(`  ${item.passed ? 'OK' : 'NO'} ${id} points=${item.points}`);
    for (const error of item.errors || []) console.log(`    - ${error}`);
  }
}

function runOne(packet, challengeSet, expect) {
  const result = verify(packet, challengeSet);
  printResult(result);
  if (expect === 'pass' && !result.passed) process.exitCode = 1;
  else if (expect === 'fail' && result.passed) process.exitCode = 1;
  else if (!expect && !result.passed) process.exitCode = 1;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  if (!args.packet && !args.challengeSet) {
    const challengeSet = 'fixtures/proof-token-verification/challenge-set.yaml';
    runOne('fixtures/proof-token-verification/positive-result-packet.yaml', challengeSet, 'pass');
    runOne('fixtures/proof-token-verification/negative-result-packet.yaml', challengeSet, 'fail');
    if (process.exitCode) throw new Error('proof token verifier fixtures failed');
    console.log('Proof-token verifier fixtures passed.');
    return;
  }

  if (!args.packet || !args.challengeSet) {
    usage();
    process.exitCode = 1;
    return;
  }

  runOne(args.packet, args.challengeSet, args.expect);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
