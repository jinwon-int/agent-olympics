import { readFileSync } from 'fs';
import { parseSamples, summarize, renderReport } from './report';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node dist/src/index.js <samples.json>');
  process.exit(2);
}

const samples = parseSamples(readFileSync(file, 'utf8'));
const rows = summarize(samples);
console.log(renderReport(rows));
