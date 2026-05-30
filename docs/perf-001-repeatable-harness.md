# perf-001 Repeatable Baseline Harness

> **Purpose:** Provide a repeatable source-only harness/report path for
> multiple baseline iterations of the perf-001 Performance Trial workload,
> preserving raw/scored separation and surfacing machine/human visible
> caveats for fair comparison.
>
> **Related:** #140, #138, #26, #16, #133
> **Run:** agent-olympics-team1-season-readiness-20260530T0835KST
> **Worker:** nosuk
> **Team:** team1
> **Lane:** 2/3

## Harness Script: `scripts/perf-harness.js`

The harness runs the four perf-001 workload phases (repo scan, validation,
tests, probes) against the local repository for N iterations, collecting
raw measurements each time and computing scored values.

### Usage

```bash
# Default: 3 iterations
node scripts/perf-harness.js

# Custom iteration count
node scripts/perf-harness.js --iterations 5

# Custom hardware label for scoring normalization
node scripts/perf-harness.js --iterations 3 --hardware a2a-runner

# Machine-readable JSON output only (no terminal summary table)
node scripts/perf-harness.js --json

# Validate output report after generation
node scripts/perf-harness.js --validate
```

### Output

The harness writes two artifacts to `results/`:

| File | Format | Audience |
|---|---|---|
| `perf-harness-report-<timestamp>.json` | JSON | Machines — structured report with all iterations, caveats, and statistics |
| `perf-harness-report-<timestamp>.yaml` | YAML (v2 result-packet style) | Humans — readable artifact mirroring existing packet format |

### What It Measures

The harness executes four workload phases per iteration (matching the
workload definition in `fixtures/season-001/perf-001/workload-definition.yaml`):

| Phase | Measurement | Raw Fields |
|---|---|---|
| A — Repo scan | Git commit count, file count, line count, wall time | `raw_git_commit_count`, `raw_file_count`, `raw_line_count`, `raw_scan_wall_time_seconds` |
| B — Validation | Validated file count, pass/fail, wall time, per-file latency | `raw_validated_file_count`, `raw_passed_count`, `raw_failed_count`, `raw_validation_wall_time_seconds`, `raw_validation_latency_ms` |
| C — Tests | Test count, pass/fail, wall time, throughput | `raw_test_count`, `raw_test_passed`, `raw_test_failed`, `raw_test_wall_time_seconds`, `raw_test_throughput` |
| D — Probes | 5 sequential probes (disk, CPU, memory, PS, schema), total wall | `raw_probe_count`, `raw_sequential_estimate_seconds`, `raw_total_wall_time_seconds`, `raw_speedup_factor` |

### Caveats

The harness explicitly surfaces the following caveats in both machine and
human readable form:

| Caveat | Severity | Explanation |
|---|---|---|
| Source-only mode | info | Probes run sequentially, not in parallel. Real agents with concurrency support will show higher speedup. |
| Cache effect | warn (iter 1) / info (iter 2+) | First iteration is cold. Subsequent iterations benefit from filesystem cache. |
| Container runtime | warn | Container resource limits, CPU throttling, and filesystem caching may differ from dedicated host execution. |
| Hardware profile | info | Raw measurements reflect the current hardware; cross-class comparison requires scored values. |

## Multi-Iteration Report Format

### Per-Iteration Structure

Each iteration in the report has three sections:

```yaml
iterations:
  - iteration: 1
    raw_measurements:
      wall_time_seconds: 98.5
      raw_scan_wall_time_seconds: 3.12
      raw_test_throughput: 3.74
      # ... all raw_-prefixed fields
    scored_values:
      efficiency_score: 0.84
      evidence_quality_score: 0.85
      # ... normalized scores only
    caveats:
      - id: iteration-1-cache-effect
        severity: warn
        message: "Cold cache — first iteration..."
        machine_key: cache_state
        machine_value: cold
```

### Summary Statistics

Across all iterations, the harness computes:

| Statistic | Description |
|---|---|
| `mean` | Arithmetic mean of the N iteration values |
| `min` / `max` | Range of observed values |
| `stddev` | Population standard deviation |
| `cv` | Coefficient of variation (stddev / mean) — stability indicator |
| `n` | Number of iterations |

A CV below 0.05 indicates stable, repeatable measurements. CV above 0.3
suggests high variance — interpret with caution.

### Raw/Scored Separation

The harness enforces strict namespace separation:

- **`raw_measurements`**: Contains only `raw_`-prefixed field names and
  canonical instrumented fields (`wall_time_seconds`, `action_count`, etc.)
- **`scored_values`**: Contains only score-suffixed fields (`_score`,
  `normalization`)
- **Validation**: The harness verifies no field name collision between
  namespaces and reports contamination if found.

This matches the `validateRawScoredSeparation()` checks in `scripts/score.js`.

## Comparing the Harness with Live Agent Packets

| Aspect | Source-Only Harness | Live Agent Result Packet |
|---|---|---|
| Execution | Container-local `execSync()` | Agent runtime with delegation |
| Probes | Sequential (5 probes) | Concurrent (with `concurrency_limit`) |
| Speedup factor | Always 1.0 (sequential) | > 1.0 when probes run in parallel |
| Model calls | 0 (no LLM involved) | Reported as `model_calls` |
| Scored values | Computed locally via normalization formula | Computed by score.js or judge engine |
| Caveats | Explicit cache/container/environment caveats | Host-contention and hardware-class caveats |

## Transform to Scoreboard Pipeline

The harness report format is not directly consumable by the scoring/publication
pipeline (`score.js aggregate`, `dry-run-gates.js publication`), which expects
standard result packets with `evidence`/`findings` arrays.

The bridge script `scripts/harness-to-packet.js` transforms any perf-harness
report (JSON or YAML) into one or more v2 result packets that the pipeline
accepts.

### Usage

```bash
# Run the harness first
node scripts/perf-harness.js --iterations 3

# Transform the generated report into scoreboard-compatible packets
node scripts/harness-to-packet.js results/perf-harness-report-*.json

# Or transform the last report explicitly
node scripts/harness-to-packet.js results/perf-harness-report-$(ls -t results/perf-harness-report-*.json | head -1 | xargs basename .json).json

# Now the output packets can enter the standard pipeline
node scripts/score.js aggregate
node scripts/dry-run-gates.js publication
```

### Output

The transform writes one packet per iteration plus an aggregate summary packet:

| File | Content |
|---|---|
| `perf-harness-packet-<run-id>-iter-<N>.yaml` | Per-iteration v2 result packet with evidence, findings, and raw/scored separation preserved |
| `perf-harness-packet-<run-id>-summary.yaml` | Aggregate summary packet with statistics across all iterations |

### Options

```bash
# Specify output directory
node scripts/harness-to-packet.js <report> --output-dir results/

# Override agent_id (for scoreboard tracking)
node scripts/harness-to-packet.js <report> --agent-id nosuk

# Skip summary packet
node scripts/harness-to-packet.js <report> --no-summary

# Quiet mode (only emit packet filenames, for scripting)
node scripts/harness-to-packet.js <report> --quiet
```

### What the Transform Preserves

| Aspect | Preservation |
|---|---|
| Raw/scored separation | `raw_measurements` and `scored_values` mapped directly to v2 result-packet fields |
| Hardware profile | Written to `hardware_profile` + `comparable_metadata.node` for `assessComparability()` |
| Iteration caveats | Added to `risks` array and `summary` text |
| Summary statistics | Available in the aggregate summary packet's `outputs.summary_statistics` |
| Raw measurement fidelity | All `raw_`-prefixed fields preserved in `raw_measurements` |

### Caveats Pipeline

The transform ensures harness-level caveats (cache effects, container runtime,
hardware profile, source-only mode) are surfaced in the standard pipeline:

1. Per-iteration caveats → `risks[]` and `summary` string
2. Per-iteration caveats → `comparable_metadata._harness_caveats` (for `assessComparability()`)
3. Harness-level caveats from `summary.caveats` → `risks[]` in summary packet

This means the scoreboard entries for harness packets will include the
comparability caveats, allowing consumers to account for source-only bias.

## Fixture Report

A demo multi-iteration report is available at:

```
results/perf-harness-three-iteration-demo.yaml
```

To test the transform pipeline with this fixture:

```bash
node scripts/harness-to-packet.js results/perf-harness-three-iteration-demo.yaml --verbose
node scripts/score.js validate results/pkt-harness-*  # validate schema
```

## Make Targets

```bash
# Run the harness with default settings (3 iterations)
make perf-harness

# Run with custom iteration count
PERF_ITERATIONS=5 make perf-harness

# Run the full pipeline (harness → packets → scoreboard)
make perf-harness-pipeline

# Run the full pipeline with custom agent id
AGENT_ID=nosuk make perf-harness-pipeline
```

See the `perf-harness-pipeline` and `perf-harness-to-packets` targets in
`Makefile` for exact commands.

## See Also

- `scripts/perf-harness.js` — the harness script
- `scripts/harness-to-packet.js` — transform harness reports to scoreboard-compatible v2 result packets
- `results/perf-harness-three-iteration-demo.yaml` — demo multi-iteration fixture
- `scripts/score.js` — scoring engine with `extractPerformanceProfile()`,
  `validateRawScoredSeparation()`, and `assessComparability()`
- `docs/performance-scoring.md` — scoring documentation with raw/normalized
  comparison semantics
- `docs/perf-001-triple-baseline-comparison.md` — triple-profile comparison
- `fixtures/season-001/perf-001/workload-definition.yaml` — workload phase definitions
