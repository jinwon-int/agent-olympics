#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TMP=".tmp/round-hardening"
rm -rf "$TMP"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT

node scripts/round.js validate rounds/season-001-round-002.yaml --strict >/tmp/round-hardening-round002.out

node - <<'NODE'
const fs = require('fs');
const yaml = require('js-yaml');
const src = yaml.load(fs.readFileSync('rounds/season-001-round-001.yaml', 'utf8'));

const unknown = {
  ...src,
  run_directory: '.tmp/round-hardening/runs/unknown-template/',
  run_id_template: 'run-{unknown}-{task_id}-{agent_id}-{timestamp}',
};
fs.writeFileSync('.tmp/round-hardening/unknown-template.yaml', yaml.dump(unknown, { indent: 2, lineWidth: 120 }));

const missingFixture = {
  ...src,
  run_directory: '.tmp/round-hardening/runs/missing-fixture/',
  tasks: [{ ...src.tasks[0], fixture_bundle_ref: 'fixtures/season-001/does-not-exist/' }],
};
fs.writeFileSync('.tmp/round-hardening/missing-fixture.yaml', yaml.dump(missingFixture, { indent: 2, lineWidth: 120 }));

const runFilter = {
  ...src,
  run_directory: '.tmp/round-hardening/runs/run-filter/',
  tasks: [src.tasks[0]],
  participants: [src.participants[0]],
};
fs.writeFileSync('.tmp/round-hardening/run-filter.yaml', yaml.dump(runFilter, { indent: 2, lineWidth: 120 }));
NODE

if node scripts/round.js validate "$TMP/unknown-template.yaml" >/tmp/round-hardening-unknown.out 2>&1; then
  echo "Expected unknown run_id_template variable to fail validation"
  exit 1
fi
grep -q 'unsupported variables: unknown' /tmp/round-hardening-unknown.out

if node scripts/round.js init "$TMP/missing-fixture.yaml" --strict >/tmp/round-hardening-missing-fixture.out 2>&1; then
  echo "Expected strict missing fixture bundle to fail init"
  exit 1
fi
grep -q 'strict mode treats warnings as failures' /tmp/round-hardening-missing-fixture.out

node scripts/round.js init "$TMP/run-filter.yaml" --strict >/tmp/round-hardening-init.out
if node scripts/round.js execute "$TMP/run-filter.yaml" --run-id run-does-not-exist >/tmp/round-hardening-run-id.out 2>&1; then
  echo "Expected missing --run-id filter to fail execution"
  exit 1
fi
grep -q 'No run found matching --run-id "run-does-not-exist"' /tmp/round-hardening-run-id.out

echo "Round hardening checks passed."
