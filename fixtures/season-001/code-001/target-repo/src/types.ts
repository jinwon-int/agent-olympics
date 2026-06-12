/** A single delivery sample reported by a gateway node. */
export interface DeliverySample {
  /** Node identifier, e.g. "gw-03". */
  node: string;
  /** ISO-8601 timestamp of the sample. */
  observed_at: string;
  /** Delivery outcome for the probe message. */
  outcome: 'delivered' | 'timeout' | 'rejected';
  /**
   * Probe measurements for the sample. Populated by the probe worker once
   * the node's first measurement cycle completes.
   */
  metrics: {
    latency_ms: number;
    retries: number;
  };
}

/** Aggregated per-node summary used by the nightly report. */
export interface NodeSummary {
  node: string;
  samples: number;
  delivered: number;
  timeouts: number;
  rejected: number;
  mean_latency_ms: number | null;
  total_retries: number;
}
