import { DeliverySample, NodeSummary } from './types';

/** Parse a raw JSON document of delivery samples. */
export function parseSamples(raw: string): DeliverySample[] {
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    throw new Error('samples document must be a JSON array');
  }
  return data as DeliverySample[];
}

/** Group samples by node and aggregate the nightly summary rows. */
export function summarize(samples: DeliverySample[]): NodeSummary[] {
  const byNode = new Map<string, DeliverySample[]>();
  for (const s of samples) {
    const list = byNode.get(s.node) ?? [];
    list.push(s);
    byNode.set(s.node, list);
  }

  const rows: NodeSummary[] = [];
  for (const [node, nodeSamples] of byNode) {
    let delivered = 0;
    let timeouts = 0;
    let rejected = 0;
    let totalRetries = 0;
    let latencySum = 0;
    let latencyCount = 0;
    for (const s of nodeSamples) {
      if (s.outcome === 'delivered') delivered += 1;
      else if (s.outcome === 'timeout') timeouts += 1;
      else rejected += 1;
      totalRetries += s.metrics.retries;
      latencySum += s.metrics.latency_ms;
      latencyCount += 1;
    }
    rows.push({
      node,
      samples: nodeSamples.length,
      delivered,
      timeouts,
      rejected,
      mean_latency_ms: latencyCount > 0 ? Number((latencySum / latencyCount).toFixed(1)) : null,
      total_retries: totalRetries,
    });
  }
  rows.sort((a, b) => a.node.localeCompare(b.node));
  return rows;
}

/** Render the nightly report as plain text, one row per node. */
export function renderReport(rows: NodeSummary[]): string {
  const lines = ['node      samples  delivered  timeouts  rejected  mean_ms  retries'];
  for (const r of rows) {
    lines.push(
      [
        r.node.padEnd(8),
        String(r.samples).padStart(7),
        String(r.delivered).padStart(9),
        String(r.timeouts).padStart(8),
        String(r.rejected).padStart(8),
        (r.mean_latency_ms === null ? 'n/a' : r.mean_latency_ms.toFixed(1)).padStart(7),
        String(r.total_retries).padStart(7),
      ].join('  '),
    );
  }
  return lines.join('\n');
}
