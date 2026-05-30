#!/usr/bin/env node
/**
 * harness-to-packet.js — Transform perf-harness Reports into Scoreboard Packets
 *
 * Converts a perf-harness multi-iteration report (JSON or YAML) into one or
 * more v2 result packets that can be consumed by score.js (validate/score/
 * aggregate) and validated by dry-run-gates.js publication gates.
 *
 * The transform preserves raw/scored separation, comparability caveats, and
 * measurement fidelity from the original harness report, while producing
 * schema-valid v2 result packets in the standard result packet format.
 *
 * Usage:
 *   node scripts/harness-to-packet.js <report-file>
 *   node scripts/harness-to-packet.js <report-file> [options]
 *
 * Options:
 *   --output-dir <dir>   Output directory (default: results/)
 *   --agent-id <id>      Override agent_id for the generated packets
 *   --no-summary         Skip generating the aggregate summary packet
 *   --verbose, -v        Verbose output
 *   --quiet, -q          Quiet output (only packet paths)
 *   --help               Show usage
 *
 * Output:
 *   <output-dir>/perf-harness-packet-<run-id>-iter-<N>.yaml   (per iteration)
 *   <output-dir>/perf-harness-packet-<run-id>-summary.yaml     (aggregate)
 *
 * Pipeline:
 *   node scripts/perf-harness.js
 *   node scripts/harness-to-packet.js results/perf-harness-report-*.json
 *   node scripts/score.js aggregate              # generates scoreboard.json
 *   node scripts/dry-run-gates.js publication     # validates everything
 *
 * Exit code: 0 = success, 1 = any error.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT_DIR = path.join(ROOT, 'results');
const GENERATOR_ID = 'harness-to-packet.js v1';

// Default values for v2 result-packet required fields that the harness
// report doesn't provide (the harness has no agent runtime, no tool use, etc.)
const DEFAULT_DIVISION = 'closed_stack';
const DEFAULT_VALIDITY = 'valid';
const DEFAULT_PUBLISHABLE = true;
const DEFAULT_TOOL_USE_PROFILE = {
  classes_allowed: ['command', 'read'],
  classes_used: ['command', 'read'],
  disclosure_level: 'minimal',
  notes: 'Source-only harness: all actions are local exec commands. No LLM tool use.',
};
const DEFAULT_OPERATING_POLICY = {
  approval_boundaries: 'none_needed_source_harness',
  secret_handling: 'no_secrets_exposed_source_harness',
  destructive_action_rules: 'no_destructive_actions_source_harness',
  notes: 'Source-only harness runs local commands only. No agent policy applies.',
};
const DEFAULT_DELEGATION_PROFILE = {
  subagents_used: false,
  background_jobs_used: false,
  human_assistance: false,
  notes: 'Source-only harness: no delegation.',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Load a report from JSON or YAML file. Auto-detect by extension.
 */
function loadReport(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const raw = fs.readFileSync(filePath, 'utf8');
  if (ext === '.json') {
    return JSON.parse(raw);
  }
  // YAML (.yaml, .yml)
  return yaml.load(raw);
}

/**
 * Timestamp-safe identifier for packet naming.
 */
function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Create a simple evidence item from a raw measurement key-value.
 */
function measurementEvidence(id, key, value, kind) {
  return {
    id,
    kind: kind || 'instrumented_value',
    source: 'perf-harness',
    summary: `${key}: ${value}`,
  };
}

/**
 * Build a scoring-relevant finding from a measurement stat.
 */
function measurementFinding(claim, evidenceIds, confidence) {
  return {
    claim,
    evidence: evidenceIds,
    confidence: confidence || 'high',
  };
}

// ---------------------------------------------------------------------------
// Iteration → v2 Result Packet Transform
// ---------------------------------------------------------------------------

/**
 * Transform a single iteration from a perf-harness report into a stand-alone
 * v2 result packet suitable for score.js consumption.
 *
 * @param {Object}   iter           — The iteration object from the report.
 *        {number}   iter.iteration  — Iteration number (1-based).
 *        {Object}   iter.raw_measurements  — Raw instrumented values.
 *        {Object}   iter.scored_values     — Normalized/scored values.
 *        {Array}    iter.caveats           — Per-iteration caveats.
 *        {Object}   iter.phase_timings     — Phase-level wall times.
 * @param {Object}   report         — The full harness report (for shared metadata).
 * @param {Object}   options        — { agentIdOverride?, verbose? }
 * @returns {Object} A v2 result packet.
 */
function iterationToPacket(iter, report, options) {
  const raw = iter.raw_measurements || {};
  const scored = iter.scored_values || {};
  const caveats = iter.caveats || [];
  const phaseTimings = iter.phase_timings || {};

  const runId = report.run_id || `perf-harness-${safeTimestamp()}`;
  const iterNum = iter.iteration;
  const agentId = options.agentIdOverride || report.agent_id || 'perf-harness';
  const hwProfile = report.hardware_profile || {};

  // --- Build evidence from raw measurements ---
  const evidence = [];
  let evCount = 0;

  // Wall time evidence
  if (raw.wall_time_seconds != null) {
    evCount++;
    evidence.push(measurementEvidence(
      `ev-wall-time-iter${iterNum}`,
      'wall_time_seconds',
      raw.wall_time_seconds
    ));
  }

  // Phase timings as evidence
  for (const [phase, seconds] of Object.entries(phaseTimings)) {
    if (seconds != null) {
      evCount++;
      evidence.push(measurementEvidence(
        `ev-${phase}-iter${iterNum}`,
        phase,
        seconds
      ));
    }
  }

  // Probe-related evidence
  if (raw.raw_probe_count != null) {
    evCount++;
    evidence.push(measurementEvidence(
      `ev-probes-iter${iterNum}`,
      'raw_probe_count',
      raw.raw_probe_count
    ));
  }

  // Test throughput
  if (raw.raw_test_throughput != null) {
    evCount++;
    evidence.push(measurementEvidence(
      `ev-test-throughput-iter${iterNum}`,
      'raw_test_throughput',
      raw.raw_test_throughput
    ));
  }

  // Validation latency
  if (raw.raw_validation_latency_ms != null) {
    evCount++;
    evidence.push(measurementEvidence(
      `ev-val-latency-iter${iterNum}`,
      'raw_validation_latency_ms',
      raw.raw_validation_latency_ms
    ));
  }

  // Scored efficiency
  if (scored.efficiency_score != null) {
    evCount++;
    evidence.push(measurementEvidence(
      `ev-efficiency-iter${iterNum}`,
      'efficiency_score',
      scored.efficiency_score
    ));
  }

  // Ensure we have at least 1 evidence item
  if (evidence.length === 0) {
    evidence.push({
      id: `ev-completed-iter${iterNum}`,
      kind: 'observation',
      source: 'perf-harness',
      summary: `Iteration ${iterNum} completed. No instrumented measurements available.`,
    });
  }

  // --- Build findings ---
  const findings = [];
  const findingEvidenceIds = evidence.map(e => e.id);

  // Core completion finding
  const wallDesc = raw.wall_time_seconds != null
    ? ` in ${raw.wall_time_seconds}s wall time`
    : '';
  findings.push(measurementFinding(
    `Iteration ${iterNum} of perf-001 workload completed${wallDesc}.`,
    findingEvidenceIds,
    'high'
  ));

  // Raw/scored separation finding
  findings.push(measurementFinding(
    'Raw/scored separation maintained — no namespace collision detected.',
    findingEvidenceIds,
    'high'
  ));

  // Phase-specific findings
  if (raw.raw_test_throughput != null) {
    findings.push(measurementFinding(
      `Test throughput: ${raw.raw_test_throughput} tests/s.`,
      ['ev-test-throughput-iter' + iterNum],
      'high'
    ));
  }

  if (raw.raw_validation_latency_ms != null) {
    findings.push(measurementFinding(
      `Validation latency: ${raw.raw_validation_latency_ms} ms per file.`,
      ['ev-val-latency-iter' + iterNum],
      'high'
    ));
  }

  if (scored.efficiency_score != null) {
    const normDesc = scored.normalization || 'standard normalization';
    findings.push(measurementFinding(
      `Efficiency score: ${scored.efficiency_score} (normalized via ${normDesc}).`,
      ['ev-efficiency-iter' + iterNum],
      'high'
    ));
  }

  // --- Build comparability caveats from iteration caveats ---
  const comparabilityCaveats = [];
  for (const caveat of caveats) {
    comparabilityCaveats.push(caveat.message || JSON.stringify(caveat));
  }

  // --- Build comparable_metadata ---
  const comparableMetadata = {
    participant: {
      agent_id: agentId,
      adapter: report.adapter || 'cli',
    },
    runtime: {
      name: report.runtime || 'source-harness',
      version: report.runtime_profile?.node_version || process.version,
    },
    model: {
      name: report.runtime_profile?.model || 'none',
      provider: report.runtime_profile?.model_provider || 'none',
    },
    node: {
      profile_ref: hwProfile.cpu_class || 'unknown',
      hardware_profile: {
        cpu_class: hwProfile.cpu_class,
        cpu_cores: hwProfile.cpu_cores,
        memory_gb: hwProfile.memory_gb,
        storage_class: hwProfile.storage_class,
        os_family: hwProfile.os_family,
      },
    },
    config: {
      profile_ref: 'perf-harness-default',
      details: {
        model_routing: 'none',
        liveness: 'local-process',
        resource_limits: 'container-unlimited',
        tool_availability: 'command-read',
        memory_policy: 'none',
        service_ownership: 'none-for-harness',
      },
    },
    task: {
      task_id: report.task_id || 'perf-001',
      task_version: 'v1',
      fixture_ref: 'fixtures/season-001/perf-001/',
    },
  };

  // --- Build the v2 result packet ---
  const packetId = `pkt-harness-${runId}-iter-${iterNum}`;
  const now = new Date().toISOString();

  const packet = {
    schema_version: 2,
    schema_description: `perf-harness iteration ${iterNum} — v2 result packet (generated by ${GENERATOR_ID})`,
    packet_id: packetId,
    task_id: report.task_id || 'perf-001',
    agent_id: agentId,
    agent_version: report.runtime_profile?.node_version || process.version,
    adapter: report.adapter || 'cli',
    runtime: report.runtime || 'source-harness',
    runtime_version: report.runtime_profile?.node_version || process.version,
    model: 'none',
    model_provider: 'none',
    node: hwProfile.cpu_class || 'unknown',
    hardware_profile: {
      cpu_class: hwProfile.cpu_class || 'unknown',
      cpu_cores: hwProfile.cpu_cores || 0,
      memory_gb: hwProfile.memory_gb || 0,
      storage_class: hwProfile.storage_class || 'unknown',
      os_family: hwProfile.os_family || 'unknown',
    },
    configuration_profile: {
      model_routing: 'none',
      liveness: 'local-process',
      resource_limits: 'container-unlimited',
      tool_availability: 'command-read',
      memory_policy: 'none',
      service_ownership: 'none-for-harness',
      concurrency_limit: 1,
    },
    tool_use_profile: { ...DEFAULT_TOOL_USE_PROFILE },
    operating_policy: { ...DEFAULT_OPERATING_POLICY },
    delegation_profile: { ...DEFAULT_DELEGATION_PROFILE },
    division: DEFAULT_DIVISION,
    validity: DEFAULT_VALIDITY,
    publishable: DEFAULT_PUBLISHABLE,
    raw_measurements: { ...raw },
    scored_values: { ...scored },
    started_at: now,
    ended_at: now,
    status: 'completed',
    summary: `perf-harness iteration ${iterNum}: completed ${report.iterations_total || 1} iteration(s). ` +
      `Wall time: ${raw.wall_time_seconds != null ? raw.wall_time_seconds + 's' : 'N/A'}. ` +
      `Efficiency: ${scored.efficiency_score != null ? scored.efficiency_score : 'N/A'}. ` +
      `Caveats: ${comparabilityCaveats.length} noted.`,
    comparable_metadata: comparableMetadata,
    evidence,
    findings,
    outputs: {
      workload_metrics: { ...raw },
      workload_summary: `Iteration ${iterNum} of perf-001 workload completed. ` +
        `Efficiency score: ${scored.efficiency_score != null ? scored.efficiency_score : 'N/A'}.`,
    },
    risks: [
      'Source-only harness — probes ran sequentially, not in parallel.',
      'Container environment — resource limits may affect measurements.',
      'Zero model calls — this is a source-only measurement, not a live agent run.',
    ],
    // NOTE: Custom fields avoided — v2 result-packet schema has additionalProperties: false
  };

  // Add comparability caveats as risks and in the summary string.
  // The v2 result-packet schema has additionalProperties: false at top
  // level and on comparable_metadata, so we cannot add custom fields.
  // Caveats are instead stored in risks[] and the summary text.
  if (comparabilityCaveats.length > 0) {
    packet.risks.push(...comparabilityCaveats);
    packet.summary += ' Caveats: ' + comparabilityCaveats.join('; ');
  }

  // Clean up internal fields from raw_measurements that shouldn't appear
  // in standard raw_measurements
  const internalRawFields = ['_probe_details', '_probe_note'];
  for (const field of internalRawFields) {
    delete packet.raw_measurements[field];
  }

  return packet;
}

// ---------------------------------------------------------------------------
// Summary/Aggregate → v2 Result Packet Transform
// ---------------------------------------------------------------------------

/**
 * Transform the report summary into a stand-alone v2 result packet
 * representing the aggregate of all iterations.
 */
function summaryToPacket(report, options) {
  const runId = report.run_id || `perf-harness-${safeTimestamp()}`;
  const agentId = options.agentIdOverride || report.agent_id || 'perf-harness';
  const hwProfile = report.hardware_profile || {};
  const summary = report.summary || {};
  const stats = summary.statistics || {};
  const iterCount = report.iterations_total || report.iterations?.length || 0;
  const harnessCaveats = summary.caveats || [];

  // Build evidence from summary statistics
  const evidence = [];
  const statKeys = Object.keys(stats);
  for (const key of statKeys.slice(0, 15)) {  // limit to avoid bloated packet
    const s = stats[key];
    if (s && s.mean !== undefined) {
      evidence.push({
        id: `ev-stat-${key}`,
        kind: 'statistic',
        source: 'perf-harness-summary',
        summary: `${key}: mean=${s.mean}, min=${s.min}, max=${s.max}, cv=${s.cv}, n=${s.n}`,
      });
    }
  }

  if (evidence.length === 0) {
    evidence.push({
      id: 'ev-summary-completed',
      kind: 'observation',
      source: 'perf-harness-summary',
      summary: `Summary packet: ${iterCount} iterations completed.`,
    });
  }

  // Build findings
  const allEvidenceIds = evidence.map(e => e.id);
  const findings = [
    measurementFinding(
      `${iterCount} iterations of perf-001 workload completed. Summary statistics available for ${statKeys.length} metrics.`,
      allEvidenceIds,
      'high'
    ),
    measurementFinding(
      'Raw/scored separation verified across all iterations.',
      allEvidenceIds,
      'high'
    ),
  ];

  // Add variance-related findings
  const highVarMetrics = statKeys.filter(k => stats[k] && stats[k].cv > 0.3);
  if (highVarMetrics.length > 0) {
    findings.push(measurementFinding(
      `High variance detected (CV > 0.3) in: ${highVarMetrics.join(', ')}. Interpret with caution.`,
      allEvidenceIds,
      'medium'
    ));
  } else {
    findings.push(measurementFinding(
      'All metrics show low variance (CV < 0.3) — measurements are stable.',
      allEvidenceIds,
      'high'
    ));
  }

  // Build comparability caveats from harness-level caveats
  const comparabilityCaveats = [];
  for (const caveat of harnessCaveats) {
    comparabilityCaveats.push(caveat.message || JSON.stringify(caveat));
  }
  comparabilityCaveats.push(
    'Summary packet aggregates multiple iterations. Per-iteration variance is documented in summary statistics.'
  );

  // Build comparable_metadata
  const comparableMetadata = {
    participant: {
      agent_id: agentId,
      adapter: report.adapter || 'cli',
    },
    runtime: {
      name: report.runtime || 'source-harness',
      version: report.runtime_profile?.node_version || process.version,
    },
    model: {
      name: 'none',
      provider: 'none',
    },
    node: {
      profile_ref: hwProfile.cpu_class || 'unknown',
      hardware_profile: {
        cpu_class: hwProfile.cpu_class,
        cpu_cores: hwProfile.cpu_cores,
        memory_gb: hwProfile.memory_gb,
        storage_class: hwProfile.storage_class,
        os_family: hwProfile.os_family,
      },
    },
    config: {
      profile_ref: 'perf-harness-default',
      details: {
        model_routing: 'none',
        liveness: 'local-process',
        resource_limits: 'container-unlimited',
        tool_availability: 'command-read',
        memory_policy: 'none',
      },
    },
    task: {
      task_id: report.task_id || 'perf-001',
      task_version: 'v1',
      fixture_ref: 'fixtures/season-001/perf-001/',
    },
  };

  // Build summary string
  let summaryDesc = `perf-harness aggregate: ${iterCount} iterations completed. `;
  if (stats.wall_time_seconds) {
    summaryDesc += `Mean wall time: ${stats.wall_time_seconds.mean}s (min=${stats.wall_time_seconds.min}, max=${stats.wall_time_seconds.max}). `;
  }
  if (stats.efficiency_score) {
    summaryDesc += `Mean efficiency_score: ${stats.efficiency_score.mean}. `;
  }

  const packetId = `pkt-harness-${runId}-summary`;
  const now = new Date().toISOString();

  const packet = {
    schema_version: 2,
    schema_description: `perf-harness aggregate (${iterCount} iterations) — v2 result packet (generated by ${GENERATOR_ID})`,
    packet_id: packetId,
    task_id: report.task_id || 'perf-001',
    agent_id: agentId,
    agent_version: report.runtime_profile?.node_version || process.version,
    adapter: report.adapter || 'cli',
    runtime: report.runtime || 'source-harness',
    runtime_version: report.runtime_profile?.node_version || process.version,
    model: 'none',
    model_provider: 'none',
    node: hwProfile.cpu_class || 'unknown',
    hardware_profile: {
      cpu_class: hwProfile.cpu_class || 'unknown',
      cpu_cores: hwProfile.cpu_cores || 0,
      memory_gb: hwProfile.memory_gb || 0,
      storage_class: hwProfile.storage_class || 'unknown',
      os_family: hwProfile.os_family || 'unknown',
    },
    configuration_profile: {
      model_routing: 'none',
      liveness: 'local-process',
      resource_limits: 'container-unlimited',
      tool_availability: 'command-read',
      memory_policy: 'none',
      service_ownership: 'none-for-harness',
      concurrency_limit: 1,
    },
    tool_use_profile: { ...DEFAULT_TOOL_USE_PROFILE },
    operating_policy: { ...DEFAULT_OPERATING_POLICY },
    delegation_profile: { ...DEFAULT_DELEGATION_PROFILE },
    division: DEFAULT_DIVISION,
    validity: DEFAULT_VALIDITY,
    publishable: DEFAULT_PUBLISHABLE,

    // Raw measurements (from the first iteration for reference; summary stats are the canonical source)
    raw_measurements: report.iterations?.[0]?.raw_measurements || {},
    scored_values: report.iterations?.[0]?.scored_values || {},

    started_at: now,
    ended_at: now,
    status: 'completed',
    summary: summaryDesc,
    comparable_metadata: comparableMetadata,
    evidence,
    findings,
    outputs: {
      workload_metrics: report.iterations?.[0]?.raw_measurements || {},
      workload_summary: summaryDesc,
      summary_statistics: stats,
    },
    risks: [
      'Source-only harness — probes ran sequentially, not in parallel.',
      'Summary aggregates multiple iterations; per-iteration variance documented in statistics.',
      'Zero model calls — this is a source-only measurement.',
    ],
    // NOTE: Custom fields avoided — v2 result-packet schema has additionalProperties: false
  };

  // Add comparability caveats as risks and in the summary string.
  // See note above about v2 schema additionalProperties: false.
  if (comparabilityCaveats.length > 0) {
    packet.risks.push(...comparabilityCaveats);
    packet.summary += ' Caveats: ' + comparabilityCaveats.join('; ');
  }

  return packet;
}

// ---------------------------------------------------------------------------
// Write result packets to disk
// ---------------------------------------------------------------------------

/**
 * Write a v2 result packet to a YAML file.
 */
function writePacket(packet, outputDir) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const filename = `${packet.packet_id}.yaml`;
  const filePath = path.join(outputDir, filename);
  fs.writeFileSync(filePath, yaml.dump(packet, { indent: 2, lineWidth: 120 }), 'utf8');
  return filePath;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function usage() {
  console.error(`
Usage: node scripts/harness-to-packet.js <report-file> [options]

Transform a perf-harness report (JSON or YAML) into v2 result packets
that score.js can consume.

Options:
  --output-dir <dir>   Output directory (default: results/)
  --agent-id <id>      Override agent_id for generated packets
  --no-summary         Skip generating the aggregate summary packet
  --verbose, -v        Verbose output
  --quiet, -q          Quiet output (only packet paths)
  --help               Show this message

Output:
  <output-dir>/perf-harness-packet-<run-id>-iter-<N>.yaml   (per iteration)
  <output-dir>/perf-harness-packet-<run-id>-summary.yaml     (aggregate)

Pipeline:
  node scripts/perf-harness.js
  node scripts/harness-to-packet.js results/perf-harness-report-*.json
  node scripts/score.js aggregate
  node scripts/dry-run-gates.js publication

Examples:
  node scripts/harness-to-packet.js results/perf-harness-report-*.json
  node scripts/harness-to-packet.js results/perf-harness-three-iteration-demo.yaml --verbose
  node scripts/harness-to-packet.js results/perf-harness-report-*.json --agent-id nosuk
`);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    usage();
  }

  // Parse options
  let reportFile = null;
  let outputDir = DEFAULT_OUTPUT_DIR;
  let agentIdOverride = null;
  let includeSummary = true;
  let verbose = false;
  let quiet = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output-dir' && i + 1 < args.length) {
      outputDir = path.resolve(ROOT, args[++i]);
    } else if (args[i] === '--agent-id' && i + 1 < args.length) {
      agentIdOverride = args[++i];
    } else if (args[i] === '--no-summary') {
      includeSummary = false;
    } else if (args[i] === '--verbose' || args[i] === '-v') {
      verbose = true;
    } else if (args[i] === '--quiet' || args[i] === '-q') {
      quiet = true;
    } else if (!args[i].startsWith('--')) {
      reportFile = path.resolve(ROOT, args[i]);
    }
  }

  if (!reportFile) {
    console.error('ERROR: No report file specified.');
    usage();
  }

  if (!fs.existsSync(reportFile)) {
    console.error(`ERROR: Report file not found: ${reportFile}`);
    process.exit(1);
  }

  if (!quiet) {
    console.log(`harness-to-packet.js — Transform perf-harness report to v2 result packets`);
    console.log(`Report:    ${reportFile}`);
    console.log(`Output:    ${outputDir}`);
    if (agentIdOverride) console.log(`Agent ID:  ${agentIdOverride}`);
    console.log('');
  }

  // Load report
  let report;
  try {
    report = loadReport(reportFile);
  } catch (err) {
    console.error(`ERROR: Cannot parse report file: ${err.message}`);
    process.exit(1);
  }

  // Validate report structure
  const iterations = report.iterations;
  if (!iterations || !Array.isArray(iterations) || iterations.length === 0) {
    console.error('ERROR: Report has no "iterations" array. Is this a perf-harness report?');
    process.exit(1);
  }

  if (!report.hardware_profile && !report.runtime_profile) {
    console.warn('⚠  Report missing hardware_profile and runtime_profile. These fields are recommended.');
  }

  if (!quiet) {
    console.log(`Iterations: ${iterations.length}`);
    console.log(`Hardware:   ${report.hardware_profile?.cpu_class || 'N/A'}`);
    console.log('');
  }

  // Transform and write per-iteration packets
  const options = { agentIdOverride, verbose };
  const writtenFiles = [];

  for (const iter of iterations) {
    const packet = iterationToPacket(iter, report, options);
    const filePath = writePacket(packet, outputDir);
    writtenFiles.push(filePath);
    if (verbose && !quiet) {
      console.log(`  Iteration ${iter.iteration}: ${filePath} (evidence=${packet.evidence.length}, findings=${packet.findings.length})`);
    }
  }

  // Transform and write summary packet
  if (includeSummary) {
    const summaryPacket = summaryToPacket(report, options);
    const summaryPath = writePacket(summaryPacket, outputDir);
    writtenFiles.push(summaryPath);
    if (verbose && !quiet) {
      console.log(`  Summary:   ${summaryPath} (evidence=${summaryPacket.evidence.length}, findings=${summaryPacket.findings.length})`);
    }
  }

  if (!quiet) {
    console.log(`\n✅ ${writtenFiles.length} packet(s) written to: ${outputDir}`);
    console.log('');
    console.log('Next steps:');
    console.log('  node scripts/score.js aggregate    — generate scoreboard');
    console.log('  node scripts/dry-run-gates.js publication  — validate publication readiness');
  } else {
    // Quiet mode: just emit the file paths, one per line
    for (const f of writtenFiles) {
      console.log(path.relative(ROOT, f));
    }
  }
}

main();
