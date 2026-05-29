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

## Fixture Report

A demo multi-iteration report is available at:

```
results/perf-harness-three-iteration-demo.yaml
```

This fixture shows three iterations with realistic values, summary
statistics, and machine/human visible caveats. It validates against the
snapshot schema and can be used as a reference for building live harness
reports.

## Make Targets

```bash
# Run the harness with default settings (3 iterations)
make perf-harness

# Run with custom iteration count
PERF_ITERATIONS=5 make perf-harness
```

## See Also

- `scripts/perf-harness.js` — the harness script
- `results/perf-harness-three-iteration-demo.yaml` — demo multi-iteration fixture
- `scripts/score.js` — scoring engine with `extractPerformanceProfile()`,
  `validateRawScoredSeparation()`, and `assessComparability()`
- `docs/performance-scoring.md` — scoring documentation with raw/normalized
  comparison semantics
- `docs/perf-001-triple-baseline-comparison.md` — triple-profile comparison
- `fixtures/season-001/perf-001/workload-definition.yaml` — workload phase definitions
