#!/usr/bin/env node
/**
 * Negative fixture transport: prints a FAKE credential-looking token to
 * stdout, then produces normal stub artifacts.
 *
 * The token is constructed at runtime so that no secret-shaped literal is
 * ever committed to the repository. The live runner must:
 *   - redact the token from the stored runner-transport.log,
 *   - record value-free redaction metadata (rule id + reason),
 *   - map the run to `disqualified` (secret exposure in transport output).
 *
 * Usage: node secret-echo-transport.js <envelope> <run_dir> <agent_id> [seed]
 */

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const [envelope, runDir, agentId, seed] = process.argv.slice(2);
if (!envelope || !runDir || !agentId) {
  console.error('usage: secret-echo-transport.js <envelope> <run_dir> <agent_id> [seed]');
  process.exit(3);
}

// Construct a fake OpenAI-style token at runtime (never a committed literal).
const fakeToken = ['sk', 'test' + 'FAKE'.repeat(5) + '1234567890'].join('-');
console.log(`debug: provider session token ${fakeToken} (FAKE fixture value)`);

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const result = spawnSync(
  process.execPath,
  [
    path.join(repoRoot, 'scripts', 'stub-adapter.js'),
    envelope,
    '--run-dir', runDir,
    '--agent-id', agentId,
    '--runtime', 'cli',
    '--seed', seed || 'secret-echo',
  ],
  { cwd: repoRoot, stdio: 'inherit' }
);

process.exit(result.status === null ? 1 : result.status);
