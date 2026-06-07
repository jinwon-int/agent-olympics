#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA_PATH = path.join(ROOT, 'fixtures', 'a2a-effectiveness', 'a2a-effectiveness-record.schema.json');
const RECORDS_DIR = path.join(ROOT, 'fixtures', 'a2a-effectiveness', 'records');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findJsonlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .map((name) => path.join(dir, name));
}

function formatErrors(errors) {
  return (errors || []).map((error) => {
    const field = error.instancePath || '(root)';
    return `${field} ${error.message || 'invalid'}`;
  }).join('; ');
}

function main() {
  const schema = loadJson(SCHEMA_PATH);
  const ajv = new Ajv({ allErrors: true, verbose: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const files = findJsonlFiles(RECORDS_DIR);
  const sampleIds = new Set();
  let records = 0;
  let errors = 0;

  if (!files.length) {
    console.error('No A2A effectiveness JSONL records found.');
    process.exit(1);
  }

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    let lineNumber = 0;
    for (const line of lines) {
      lineNumber += 1;
      if (!line.trim()) continue;
      records += 1;
      let record;
      try {
        record = JSON.parse(line);
      } catch (err) {
        errors += 1;
        console.error(`ERR   ${rel}:${lineNumber} invalid JSON: ${err.message}`);
        continue;
      }
      if (!validate(record)) {
        errors += 1;
        console.error(`ERR   ${rel}:${lineNumber} schema: ${formatErrors(validate.errors)}`);
        continue;
      }
      if (sampleIds.has(record.sampleId)) {
        errors += 1;
        console.error(`ERR   ${rel}:${lineNumber} duplicate sampleId: ${record.sampleId}`);
        continue;
      }
      sampleIds.add(record.sampleId);
      if (record.metrics.workerCount !== record.participants.workers.length) {
        errors += 1;
        console.error(`ERR   ${rel}:${lineNumber} workerCount does not match participants.workers length`);
        continue;
      }
      console.log(`OK    ${rel}:${lineNumber} ${record.sampleId}`);
    }
  }

  console.log('\n--- A2A effectiveness summary ---');
  console.log(`Files:   ${files.length}`);
  console.log(`Records: ${records}`);
  console.log(`Errors:  ${errors}`);
  process.exit(errors > 0 ? 1 : 0);
}

main();
