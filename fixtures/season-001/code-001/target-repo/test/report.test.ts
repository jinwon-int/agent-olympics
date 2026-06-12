import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSamples, summarize, renderReport } from '../src/report';
import { DeliverySample } from '../src/types';

const wellFormed: DeliverySample[] = [
  {
    node: 'gw-01',
    observed_at: '2026-06-11T22:00:00Z',
    outcome: 'delivered',
    metrics: { latency_ms: 120.4, retries: 0 },
  },
  {
    node: 'gw-01',
    observed_at: '2026-06-11T22:05:00Z',
    outcome: 'timeout',
    metrics: { latency_ms: 5000.0, retries: 3 },
  },
  {
    node: 'gw-02',
    observed_at: '2026-06-11T22:00:00Z',
    outcome: 'delivered',
    metrics: { latency_ms: 98.7, retries: 1 },
  },
];

test('parseSamples accepts a JSON array document', () => {
  const parsed = parseSamples(JSON.stringify(wellFormed));
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0]?.node, 'gw-01');
});

test('parseSamples rejects a non-array document', () => {
  assert.throws(() => parseSamples('{"node":"gw-01"}'), /must be a JSON array/);
});

test('summarize aggregates outcomes and latency per node', () => {
  const rows = summarize(wellFormed);
  assert.equal(rows.length, 2);
  const gw01 = rows.find((r) => r.node === 'gw-01');
  if (!gw01) throw new Error('expected a summary row for gw-01');
  assert.equal(gw01.samples, 2);
  assert.equal(gw01.delivered, 1);
  assert.equal(gw01.timeouts, 1);
  assert.equal(gw01.total_retries, 3);
  assert.equal(gw01.mean_latency_ms, 2560.2);
});

test('renderReport prints one row per node with a header', () => {
  const text = renderReport(summarize(wellFormed));
  const lines = text.split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0] ?? '', /node\s+samples/);
  assert.match(text, /gw-01/);
  assert.match(text, /gw-02/);
});
