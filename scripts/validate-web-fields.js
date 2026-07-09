#!/usr/bin/env node
'use strict';

/**
 * Verify the scoreboard has every field the web leaderboard needs.
 * Extracted from an inline Makefile `node -e` one-liner (#269).
 *
 * Exit code: 0 = all fields present, 1 = one or more entries missing fields.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function main() {
  const sbPath = process.argv[2] || path.join(ROOT, 'results', 'scoreboard.json');
  const sb = JSON.parse(fs.readFileSync(sbPath, 'utf8'));
  let missing = 0;
  for (const e of sb.entries || []) {
    if (!e.agent_id) { missing++; console.log(`MISSING agent_id in ${e.entry_id}`); }
    if (!e.score && e.judge_type !== 'pending') { missing++; console.log(`MISSING score in ${e.entry_id}`); }
    if (!e.packet_ref) { missing++; console.log(`MISSING packet_ref in ${e.entry_id}`); }
    if (!e.task_id) { missing++; console.log(`MISSING task_id in ${e.entry_id}`); }
  }
  console.log(missing === 0 ? 'All web-display fields present' : `${missing} entries missing fields`);
  process.exit(missing > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { main };
