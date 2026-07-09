#!/usr/bin/env node
'use strict';

/**
 * Compile-check the scoreboard schema. Extracted from an inline Makefile
 * `node -e` one-liner (#269) so the logic is testable and lintable.
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const ROOT = path.resolve(__dirname, '..');

function main() {
  const schemaPath = path.join(ROOT, 'schemas', 'scoreboard.schema.json');
  const ajv = new Ajv({ allErrors: true, verbose: true });
  addFormats(ajv);
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  ajv.addSchema(schema, schema.$id);
  ajv.compile(schema);
  console.log('Scoreboard schema loaded and compiled.');
}

if (require.main === module) {
  main();
}

module.exports = { main };
