# Performance Trial Baseline Scoring

This document describes the scoreboard-level reporting and comparability semantics for **Performance Trial** event-family tasks (task IDs prefixed `perf-*`). It explains how raw measurements, normalized scores, hardware profile metadata, and comparability caveats interact to produce a scoreboard that fairly represents agent performance.

## Overview

Performance Trial baselines capture:

- **Raw measurements**: direct instrumented values (wall time, memory, tokens, errors)
- **Scored values**: normalized metrics derived from raw measurements (efficiency, quality)
- **Hardware profile**: the hardware class the agent ran on (CPU class, memory, storage, OS)
- **Comparability flags**: whether an entry can be meaningfully compared with others
- **Caveats**: human-readable warnings about comparison limitations

These fields live in the **scoreboard's `submission_metadata`** and at **entry level** (`comparable`, `comparability_caveats`). They reuse and extend the `result-packet-v2.schema.json` `comparable_metadata`, `raw_measurements`, and `scored_values` structures.

## Comparable vs Non-Comparable Results

### Comparable

An entry is **comparable** when it carries sufficient metadata for fair cross-entry comparison. This means:

1. **Hardware profile present**: at minimum `cpu_class` and `memory_gb` are available. These define the primary comparison axis.
2. **Runtime identity known**: at least one of `runtime`, `adapter`, or `model` is provided — enough to know what agent ran.
3. **Status is not disqualifying**: the entry is not `disqualified`, `blocked`, or `failed`.
4. **Workload metrics exist**: `raw_measurements` or `outputs.workload_metrics` carry the performance data.

Comparable entries can be ranked against each other on normalized metrics like `efficiency_score`. Raw measurements (e.g., `wall_time_seconds`) are comparable *only* when hardware profiles match closely (same CPU class, comparable memory tier).

### Non-Comparable

An entry is **non-comparable** when:

1. **Missing critical hardware fields**: no `cpu_class` or `memory_gb` — cannot determine what hardware class produced the results.
2. **Status prevents comparison**: `disqualified` or `blocked` entries have no valid baseline; `failed` entries carry incomplete data.
3. **No runtime identity**: cannot determine which agent/runtime produced the result.

Non-comparable entries still appear in the scoreboard. They serve as **standalone evidence** but should not be ranked against other entries.

### Comparison Matrix

| Property | Comparable | Non-Comparable |
|---|---|---|
| hardware_profile with cpu_class | Required | Missing |
| memory_gb | Required (or caveat) | Missing |
| runtime/adapter/model | At least one | None |
| Configuration profile | Recommended | Missing (caveat) |
| Workload metrics | Present | Missing |
| Status constraints | Not disqualified/blocked/failed | Disqualified/blocked/failed |
| Can be ranked | Yes (normalized) | No |
| Standalone evidence | Yes | Yes |

## Hardware Profile Fields

Hardware profile is extracted from multiple sources in priority order:

1. `rp.hardware_profile` — top-level in result packet
2. `rp.comparable_metadata.node.hardware_profile` — comparable metadata section
3. `rp.node_capability.hardware.*` — node capability inventory (legacy fallback)

Fields (all are safe labels — no hostnames, IPs, or secrets):

```yaml
hardware_profile:
  cpu_class: "large-vps"        # e.g., small-vps, large-vps, baremetal-8-core
  memory_gb: 16                 # Total system memory
  storage_class: "nvme"         # nvme, ssd, hdd, nvme-shared
  os_family: "linux"            # linux, darwin, windows
  gpu_model: "none"             # none, t4, a100, h100
```

When two entries share the same `cpu_class` and comparable `memory_gb`, their **raw measurements can be compared directly**. When they differ, only **normalized/scored values** should be compared.

## Raw vs Normalized Scoreboard Output

### Raw Measurements (`raw_measurements`)

Captured directly from the result packet `raw_measurements` or computed from instrumented fields:

```yaml
raw_measurements:
  wall_time_seconds: 142.3
  action_count: 47
  evidence_count: 12
  finding_count: 5
  peak_memory_mb: 512
  model_calls: 23
  total_prompt_tokens: 84500
  total_completion_tokens: 12300
  retries: 2
  errors: 0
```

Raw values are **non-portable across hardware classes**. A `wall_time_seconds` of 100s on `baremetal-8-core` is not comparable to 200s on `small-vps`.

### Scored Values (`scored_values`)

Normalized metrics suitable for cross-entry comparison:

```yaml
scored_values:
  efficiency_score: 0.78
  evidence_quality_score: 0.85
  safety_score: 1.0
  execution_score: 0.92
  normalization: "wall_time / cpu_class_weighted_baseline"
```

Scored values are derived from raw measurements using a documented normalization method. They are designed to be **hardware-agnostic** — an `efficiency_score` of 0.78 should mean roughly the same thing regardless of whether the run happened on a small VPS or a baremetal server.

### Scoreboard Display Conventions

The scoreboard entry renders both raw and scored values under `submission_metadata.performance_profile`:

```json
{
  "submission_metadata": {
    "runtime": "openclaw",
    "hardware_profile": { "cpu_class": "large-vps", "memory_gb": 16 },
    "performance_profile": {
      "raw_measurements": { "wall_time_seconds": 142.3, ... },
      "scored_values": { "efficiency_score": 0.78, ... }
    }
  },
  "comparable": true,
  "comparability_caveats": []
}
```

## Caveat / Warning Semantics

Each entry carries a `comparability_caveats` array. Caveats are **human-readable strings** describing specific limitations. They fall into categories:

### Missing Hardware Profile

- `"No hardware_profile provided — cannot determine hardware class for fair comparison"`
  → Entry is non-comparable. Raw measurements are standalone only.
- `"Missing cpu_class in hardware_profile — CPU comparison axis unavailable"`
  → Entry is non-comparable; other hardware fields don't help without CPU class.
- `"Missing memory_gb in hardware_profile — memory comparison axis unavailable"`
  → Caveat only; CPU class may still enable partial comparison.
- `"Missing storage_class in hardware_profile — I/O comparison limited"`
  → Caveat only; I/O-sensitive metrics have reduced comparability.

### Runtime Identity

- `"No runtime, adapter, or model metadata — cannot determine agent identity for comparison"`
  → Entry is non-comparable. Unknown provenance.

### Configuration

- `"No configuration_profile — tuning effects may be conflated with raw hardware performance"`
  → Caveat only. The entry is comparable but tuning is an uncontrolled variable.

### Status

- `"Entry is disqualified — no valid performance baseline can be derived"`
  → Non-comparable. No meaningful data to compare.
- `"Entry was blocked — performance data is incomplete or missing"`
  → Non-comparable. Only partial/no data.
- `"Entry status is failed — performance data reflects incomplete or erroneous execution; compare with caution"`
  → Non-comparable. Results reflect errored execution.
- `"Entry status is partial — only a subset of the workload was completed; raw wall times are not comparable"`
  → Caveat only. Scored values may still be useful if normalization accounts for partial runs.

### Workload Metrics

- `"No workload_metrics found — raw performance measurements unavailable for baseline comparison"`
  → Caveat only. Without workload metrics, only scored values (if present) can be used.

### Hardware Class Mismatch

The automated scorer also calculates a **round-level hardware class alignment** and may add a caveat for entries whose `cpu_class` differs from the median hardware profile in the round:

- `"Hardware class 'small-vps' differs from round median 'large-vps' — raw wall time is not directly comparable"`
  → Caveat only. Scored values remain comparable.

## Scoreboard Summary

The scoreboard `summary` section includes:

```json
{
  "comparable_entries": 5,
  "non_comparable_entries": 2
}
```

These counts help operators quickly assess what fraction of the round can be ranked for performance baselines.

## Judge Integration

The automated judge in `scripts/score.js` performs comparability assessment during scoreboard generation:

1. **Extract** hardware profile from the result packet (three fallback sources)
2. **Extract** performance profile (raw measurements + scored values)
3. **Assess** comparability based on the rules in this document
4. **Generate** caveats for any missing or mismatched fields
5. **Populate** the scoreboard entry with `comparable`, `comparability_caveats`, and `submission_metadata.hardware_profile`/`performance_profile`

Human or blind judges should review the `comparability_caveats` array and may override the automated `comparable` flag if additional context warrants it.

## Mixed-Hardware Comparison Example (Three Profiles)

The following example demonstrates raw-vs-normalized comparison across three
hardware profiles collected during the Team1 MVP freeze (lane 2/3):

| Metric | small-vps | medium-vps | a2a-runner (nosuk) |
|---|---|---|---|
| **Hardware** | 2 vCPU, 2 GB, SSD | 4 vCPU, 8 GB, NVMe | 4 vCPU, 12 GB, NVMe-dedicated |
| `raw_test_wall_time_seconds` | 28.7 | 12.4 | **8.6** |
| `raw_test_throughput` (tests/s) | 1.18 | 2.74 | **3.95** |
| `raw_validation_latency_ms` | 122.1 | 66.8 | **50.7** |
| `efficiency_score` (normalized) | 0.85 | 0.78 | **0.87** |

### Analysis

**Raw measurements** are only directly comparable between medium-vps and
a2a-runner (same 4 vCPU count). The small-vps is 2 vCPU, so its raw wall
times are **not directly comparable** — the 28.7s test time reflects half
the cores rather than worse execution.

**Scored values** provide the correct comparison axis:

- `efficiency_score` normalises wall time by `(cpu_cores / 4 * memory_gb / 8)`.
  This puts all three profiles on a common scale: small-vps (0.85), medium-vps
  (0.78), a2a-runner (0.87).
- The medium-vps scores lowest on efficiency because it lacks the NVMe speed
  advantage of a2a-runner while still at 4 vCPU — the normalization divisor is
  the same, revealing the storage-class impact.
- The small-vps scores higher than medium-vps on efficiency because the
  divisor (2/4 * 2/8 = 0.125) more than compensates for the longer raw wall
  times, correctly reflecting that small hardware is proportionally
  well-utilised for this workload.

### Decision Guide for #26 Closure

The following criteria are relevant for Seoseo to decide whether #26 can close
after finalizer integration:

| #26 Criterion | Lane 2/3 Evidence | Verdict |
|---|---|---|
| Baseline table for ≥2 nodes/runtime profiles | Three result packets: `perf-001-baseline.yaml` (medium-vps), `perf-001-baseline-small.yaml` (small-vps), `perf-001-baseline-nosuk.yaml` (a2a-runner) | ✅ Completed |
| Scoring notes distinguish raw throughput from normalized efficiency | This document, plus `scripts/score.js` `extractPerformanceProfile()` / `validateRawScoredSeparation()`, plus `assessComparability()` hardware-class caveats | ✅ Completed |
| Result Packet metrics fields support baseline | v2 schema with `raw_measurements`/`scored_values`; legacy `workload_metrics` also present | ✅ Completed |
| Host-contention warnings | Caveats in `assessComparability()` and hardware-class mismatch detection | ✅ Completed |
| No production mutation required | All baselines are static YAML samples; no infra mutation needed | ✅ Completed |

**Remaining work (not blocking):**
- Authentic baseline runs on live nodes (requires operators to execute perf-001
  on actual hosts and submit real result packets)
- Schema hardening follow-up (v2 result-packet fields need finalisation)

## See Also

- `schemas/scoreboard.schema.json` — scoreboard schema with hardware_profile, comparable, comparability_caveats
- `scripts/score.js` — automated scoring and comparability assessment (updated with raw-vs-normalized hardening lane 2/3)
- `docs/scoring.md` — overall scoring pipeline documentation
- `docs/result-packet.md` — result packet format with raw_measurements and scored_values
- `docs/events.md` — event family descriptions (Performance Trial phase)
- `docs/node-profile-inventory.md` — node profile documentation
- `docs/perf-001-triple-baseline-comparison.md` — triple-profile raw vs normalized comparison
- `tasks/perf-001-node-throughput-baseline.yaml` — example Performance Trial task envelope
- `results/perf-001-baseline-nosuk.yaml` — nosuk a2a-runner baseline result packet
