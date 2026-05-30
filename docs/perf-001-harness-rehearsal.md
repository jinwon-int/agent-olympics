# perf-001 Rehearsal Artifact — Source-Only Publication Path

> **Run:** `agent-olympics-team1-v1-tracker-closeout-20260530T0948KST`
> **Worker:** nosuk (team1, lane 2/3)
> **Timestamp:** 2026-05-30T00:51:55Z
> **Branch:** `a2a-patch-*`
> **Related:** #140, #138, #26, #155, #153

## Pipeline Execution

The full source-only Performance Trial publication path was executed end-to-end:

### Step 1: Harness Run — `scripts/perf-harness.js`

```bash
node scripts/perf-harness.js --iterations 3 --hardware a2a-runner
```

- **Iterations:** 3 (default)
- **Hardware profile:** a2a-runner (2 vCPU, 4 GB RAM, container storage)
- **Phases executed:** Repo scan (A), Validation (B), Tests (C), Probes (D)
- **Outputs:**
  - `results/perf-harness-report-2026-05-30T00-51-55-695Z.json` — machine report (14.6 KB)
  - `results/perf-harness-report-2026-05-30T00-51-55-695Z.yaml` — human report (11.9 KB)

#### Per-Iteration Results

| Iteration | Wall Time | Efficiency | Validation Wall | Test Throughput |
|-----------|-----------|------------|-----------------|-----------------|
| 1         | 2.302s    | 0.11       | 0.81s           | 53.04/s         |
| 2         | 1.914s    | 0.13       | 0.70s           | 64.89/s         |
| 3         | 2.010s    | 0.12       | 0.71s           | 60.40/s         |

- **Mean wall time:** 2.08s, **CV:** 0.08 (stable)
- **Raw/scored separation:** CLEAN

### Step 2: Harness-to-Packet Transform — `scripts/harness-to-packet.js`

```bash
node scripts/harness-to-packet.js results/perf-harness-report-*.json --agent-id nosuk --verbose
```

Generated 4 v2 result packets:

| Packet | Description | Evidence | Findings |
|--------|-------------|----------|----------|
| `pkt-harness-...-iter-1.yaml` | Iteration 1 | 9 | 5 |
| `pkt-harness-...-iter-2.yaml` | Iteration 2 | 9 | 5 |
| `pkt-harness-...-iter-3.yaml` | Iteration 3 | 9 | 5 |
| `pkt-harness-...-summary.yaml` | Aggregate (3 iters) | 12 | 3 |

Each packet preserves:
- **`raw_measurements`:** 29+ fields (`wall_time_seconds`, `action_count`, all `raw_`-prefixed)
- **`scored_values`:** 5 fields (`efficiency_score`, `evidence_quality_score`, `safety_score`, `execution_score`, `normalization`)
- **Risks:** Source-only mode, container environment, zero model calls documented

### Step 3: Scoring and Scoreboard — `scripts/score.js aggregate`

```bash
node scripts/score.js aggregate
```

- **Total entries:** 11 (7 existing + 4 harness)
- **Participants:** 7
- **Auto-judge created:** 10
- **All passes:** 33 automated checks pass

### Step 4: Publication Readiness Gates — `scripts/dry-run-gates.js publication`

```
✓ P3.1  — All result packets present
✓ P3.1b — No manifest lifecycle issues
✓ P3.3  — All result packets schema-valid
✓ P3.4  — Scoreboard generated
✓ P3.5  — Web-display fields present
✓ P3.10 — Competition-validity fixtures pass
✓ P3.11 — All schemas validate repo-wide
```

**All 7 gates pass.** Scoreboard written to `results/scoreboard.json`.

## Comparability Caveats (Harness Entries)

After the fix in `scripts/score.js`, harness entries in the scoreboard carry the following comparability caveats:

1. **Source-only harness run** — probes ran sequentially, zero model calls, wall times reflect local command execution
2. **Container environment** — resource limits, filesystem caching, CPU throttling differ from dedicated host
3. **CLI adapter with no LLM calls** — scored values may not reflect the same quality dimensions as live agent runs

These caveats ensure scoreboard consumers can account for source-only bias when comparing with live agent runs.

## Raw/Scored Separation

The harness enforces strict namespace separation:
- `raw_measurements` contains only `raw_`-prefixed fields and canonical instrumented fields
- `scored_values` contains only score-suffixed fields
- Validation (`validateRawScoredSeparation()`) verifies no field name collision
- All 4 harness packets passed separation checks

## Scoreboard Entry Distribution

| Entry ID | Count | Notes |
|----------|-------|-------|
| `perf-001-nosuk` | 5 | 1 existing baseline + 4 harness (3 iter + 1 summary) |
| `perf-001-baseline-agent-small` | 1 | Existing v1 baseline |
| `perf-001-sogyo` | 1 | Existing v1 baseline |
| `perf-001-baseline-agent` | 1 | Existing v1 baseline |
| `perf-001-seoseo-cli-probe-live` | 1 | Existing v2 live packet |
| `perf-001-seoseo-openclaw-codex-live` | 1 | Existing v2 live packet |
| `ops-001-yukson` | 1 | Existing ops entry |

> **Note:** Multiple packets sharing the same `perf-001-nosuk` entry_id is expected for multiple runs of the same agent+task. The scoreboard schema (v1) groups by `task_id-agent_id` and consumers distinguish by `packet_id` and `packet_ref`.

## Source-Only Limitations (Explicit)

| Limitation | Impact |
|------------|--------|
| **No LLM calls** | Efficiency, safety, and execution scores are computed from local measurements only. Actual agent runtime scores will differ. |
| **Sequential probes** | Speedup factor is always 1.0. Real agents with concurrency will show higher parallel efficiency. |
| **Container execution** | Wall times may differ from dedicated host due to throttling and filesystem caching. |
| **No tool/agent policy** | Tool selection, delegation, and policy compliance are not exercised. |
| **No model cost/quality** | Token counts, latency distributions, and model quality effects are not captured. |
| **Cache effects** | Iteration 1 is cold; iterations 2+ benefit from filesystem cache. |
| **Entry ID collision** | Multiple packets from the same agent+task use the same `entry_id`. Consumers should use `packet_id` for uniqueness. |

## Changes in This Patch

| File | Change |
|------|--------|
| `scripts/score.js` | Added source-only/container/CLI-adapter caveat detection in `assessComparability()` |
| `docs/perf-001-harness-rehearsal.md` | This rehearsal artifact |

## Verification Output

All generated artifacts:

```
results/perf-harness-report-*.json          — harness machine report (14.6 KB)
results/perf-harness-report-*.yaml          — harness human report (11.9 KB)
results/pkt-harness-*-iter-1.yaml           — iter 1 v2 packet (7.8 KB)
results/pkt-harness-*-iter-1-auto-judge.yaml — iter 1 auto-judge (1.5 KB)
results/pkt-harness-*-iter-2.yaml           — iter 2 v2 packet (7.9 KB)
results/pkt-harness-*-iter-2-auto-judge.yaml — iter 2 auto-judge (1.5 KB)
results/pkt-harness-*-iter-3.yaml           — iter 3 v2 packet (7.9 KB)
results/pkt-harness-*-iter-3-auto-judge.yaml — iter 3 auto-judge (1.5 KB)
results/pkt-harness-*-summary.yaml          — summary v2 packet (9.4 KB)
results/pkt-harness-*-summary-auto-judge.yaml — summary auto-judge (1.8 KB)
results/scoreboard.json                     — scoreboard (38.9 KB)
```

## Risk Notes

- **Entry ID collision:** All 5 nosuk/perf-001 entries share `entry_id: perf-001-nosuk`. This is by design (scoreboard groups by task+agent) but consumers must use `packet_id` for disambiguation. If unique entry IDs are required, the `entry_id` formula in `score.js` could be extended to include `packet_id`.
- **Score stability across iterations:** The harness scored values are identical across iterations (`evidence_quality_score: 0.85`, `safety_score: 0.95`, `execution_score: 0.90`). This is because the auto-judge dimensions are currently the same for all baseline packets. A future enhancement could differentiate by actual measurement variance.
- **Bangtong excluded:** Per operator instructions, Bangtong is excluded pending explicit re-enrollment. No Bangtong packets were modified, created, or replayed.

## Approval-Sensitive Blockers

- [x] No production deploy
- [x] No Gateway/broker/worker restart or reload
- [x] No live provider/Telegram canary
- [x] No production DB mutation/prune/migration
- [x] No manual Terminal Brief ACK/replay
- [x] No historical outbox replay
- [x] No release/tag/npm publish
- [x] No credential movement/change/value disclosure
- [x] No repo visibility change or history rewrite
- [x] No issue close/finalizer comment execution
- [x] No PR merge
- [x] No force-push
