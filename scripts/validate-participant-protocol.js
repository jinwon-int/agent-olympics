#!/usr/bin/env node
'use strict';

/**
 * Conformance validator for the HTTP/JSON participant protocol (#287, Slice B).
 *
 * No network, no credentials, no live calls. It validates the sample fixtures
 * under fixtures/external-participant-http-json/ against the protocol schemas:
 *   - positive fixtures (`*-valid.json`) MUST pass their schema
 *   - negative fixtures (`negative-*.json`) MUST be rejected
 * and it validates the inner result_packet / trace / evidence_bundle of a valid
 * artifact submission against the competition artifact schemas, so the protocol
 * reuses the exact contracts it wraps.
 *
 * Exit code: 0 = all conformance expectations met, 1 = any violation.
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE_DIR = path.join(ROOT, 'fixtures', 'external-participant-http-json');

function loadSchema(rel) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'));
}

// fixture -> schema. Negative fixtures are validated against the same schema and
// must FAIL. run-claim covers both request and response via its oneOf.
const CASES = [
  {
    file: 'registration-valid.json',
    schema: 'schemas/participant-registration.schema.json',
    expect: 'pass',
  },
  {
    file: 'registration-internal-managed-valid.json',
    schema: 'schemas/participant-registration.schema.json',
    expect: 'pass',
  },
  {
    file: 'registration-human-baseline-valid.json',
    schema: 'schemas/participant-registration.schema.json',
    expect: 'pass',
  },
  {
    file: 'negative-registration-oracle-access.json',
    schema: 'schemas/participant-registration.schema.json',
    expect: 'fail',
  },
  {
    file: 'negative-registration-external-preaccredited.json',
    schema: 'schemas/participant-registration.schema.json',
    expect: 'fail',
  },
  {
    file: 'negative-registration-live-lane.json',
    schema: 'schemas/participant-registration.schema.json',
    expect: 'fail',
  },
  {
    file: 'participant-status-valid.json',
    schema: 'schemas/participant-status.schema.json',
    expect: 'pass',
  },
  {
    file: 'negative-participant-status-live-lane.json',
    schema: 'schemas/participant-status.schema.json',
    expect: 'fail',
  },
  {
    file: 'eligible-runs-valid.json',
    schema: 'schemas/eligible-runs.schema.json',
    expect: 'pass',
  },
  {
    file: 'negative-eligible-runs-live-lane.json',
    schema: 'schemas/eligible-runs.schema.json',
    expect: 'fail',
  },
  { file: 'run-claim-request-valid.json', schema: 'schemas/run-claim.schema.json', expect: 'pass' },
  {
    file: 'run-claim-response-valid.json',
    schema: 'schemas/run-claim.schema.json',
    expect: 'pass',
  },
  {
    file: 'negative-run-claim-request-livemode.json',
    schema: 'schemas/run-claim.schema.json',
    expect: 'fail',
  },
  {
    file: 'artifact-submission-valid.json',
    schema: 'schemas/artifact-submission.schema.json',
    expect: 'pass',
  },
  {
    file: 'negative-artifact-submission-badhash.json',
    schema: 'schemas/artifact-submission.schema.json',
    expect: 'fail',
  },
  { file: 'run-status-valid.json', schema: 'schemas/run-status.schema.json', expect: 'pass' },
  {
    file: 'negative-run-status-badstate.json',
    schema: 'schemas/run-status.schema.json',
    expect: 'fail',
  },
];

// Inner-artifact checks: the submitted result_packet / trace / evidence_bundle
// must validate against the competition schemas.
const INNER = [
  { key: 'result_packet', schema: 'schemas/result-packet-v2.schema.json' },
  { key: 'trace', schema: 'schemas/trace-record.schema.json' },
  { key: 'evidence_bundle', schema: 'schemas/evidence-bundle.schema.json' },
];

function main() {
  if (!fs.existsSync(FIXTURE_DIR)) {
    console.error(`No fixture directory: ${path.relative(ROOT, FIXTURE_DIR)}`);
    process.exit(1);
  }

  let failures = 0;
  const validators = {};
  const getValidator = (rel) => (validators[rel] = validators[rel] || loadSchema(rel));

  for (const c of CASES) {
    let doc;
    try {
      doc = readJson(c.file);
    } catch (e) {
      console.error(`FAIL: ${c.file} — not readable/parseable: ${e.message}`);
      failures++;
      continue;
    }
    const validate = getValidator(c.schema);
    const ok = validate(doc);
    if (c.expect === 'pass' && !ok) {
      console.error(`FAIL: ${c.file} should pass ${path.basename(c.schema)} but was rejected:`);
      console.error('  ' + JSON.stringify(validate.errors));
      failures++;
    } else if (c.expect === 'fail' && ok) {
      console.error(
        `FAIL: negative fixture ${c.file} unexpectedly passed ${path.basename(c.schema)}`
      );
      failures++;
    } else {
      console.log(`OK (${c.expect}): ${c.file}`);
    }
  }

  // Inner artifacts of the valid submission must validate against the real schemas.
  const submission = readJson('artifact-submission-valid.json');
  for (const inner of INNER) {
    const validate = getValidator(inner.schema);
    const ok = validate(submission[inner.key]);
    if (!ok) {
      console.error(
        `FAIL: artifact-submission.${inner.key} does not validate against ${path.basename(inner.schema)}:`
      );
      console.error('  ' + JSON.stringify(validate.errors));
      failures++;
    } else {
      console.log(`OK (inner): artifact-submission.${inner.key} -> ${path.basename(inner.schema)}`);
    }
  }

  console.log(`\n--- Summary ---\nCases: ${CASES.length + INNER.length}\nFailures: ${failures}`);
  process.exit(failures > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { main };
