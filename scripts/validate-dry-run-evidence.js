#!/usr/bin/env node
'use strict';

/**
 * Validate the format of generated dry-run evidence JSON files.
 * Extracted from an inline Makefile `node -e` one-liner (#269).
 *
 * Exit code: 0 = all evidence files valid (or none yet), 1 = any invalid.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function main() {
  const dir = path.join(ROOT, 'evidence', 'dry-run');
  if (!fs.existsSync(dir)) {
    console.log('No dry-run evidence yet. Run a gate first.');
    process.exit(0);
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  let ok = 0;
  let bad = 0;
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (j.allPassed !== undefined) {
        ok++;
        console.log(`${f}: valid`);
      } else {
        bad++;
        console.log(`${f}: missing allPassed`);
      }
    } catch (e) {
      bad++;
      console.log(`${f}: parse error - ${e.message}`);
    }
  }
  console.log(`${ok} valid, ${bad} invalid`);
  process.exit(bad > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { main };
