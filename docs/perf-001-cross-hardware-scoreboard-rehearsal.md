# perf-001 Cross-Hardware Scoreboard Publication Rehearsal

> **Run:** `agent-olympics-team1-live-tier-source-20260530T1152KST`
> **Worker:** yukson (team1, lane 3/3)
> **Timestamp:** 2026-05-30T02:56:02Z
> **Related:** #162, #164, #26, #155, #140, #138

## Scope

This rehearsal exercises the **cross-hardware scoreboard publication path** using
**only existing safe/static/live-approved result packets and fixtures**. No new
live baselines, provider calls, or canary work was performed.

The following hardware classes are represented among existing perf-001 result
packets:

| Hardware Class | Packet | Agent | Division | Schema |
|---|---:|---|---|---|
| `small-vps` | `results/perf-001-baseline-small.yaml` | baseline-agent-small | v1 baseline | v1 |
| `medium-vps` | `results/perf-001-baseline.yaml` | baseline-agent | v1 baseline | v1 |
| `medium-vps` | `results/perf-001-baseline-sogyo.yaml` | sogyo | v1 baseline | v1 |
| `a2a-runner` | `results/perf-001-baseline-nosuk.yaml` | nosuk | closed_stack | v2 |
| `large-vps` | `results/perf-001-live-cli-probe-20260530.yaml` | seoseo-cli-probe-live | node_class | v2 |
| `large-vps` | `results/perf-001-live-openclaw-codex-20260530.yaml` | seoseo-openclaw-codex-live | closed_stack | v2 |

Source-only caveat: 3 of 6 perf-001 results are v1 baseline packets with no
`scored_values`. They carry a legacy `workload_metrics` block instead of the
v2 `raw_measurements`/`scored_values` split.

---

## Pipeline Execution

### Step 0: Bootstrap Guard — No OpenClaw Context in Branch

Before any work began, the repository was checked for OpenClaw bootstrap context
files that could leak into the branch or artifacts:

```bash
# Banned: AGENTS.md, SOUL.md, USER.md, TOOLS.md, HEARTBEAT.md, IDENTITY.md, MEMORY.md, BOOTSTRAP.md
# Banned dirs: .openclaw/, memory/
```

No banned files or directories were present in `/work/repo/`. The guard passed
cleanly. (This step is enforced by the A2A runner before PR creation.)

### Step 1: Clean State — Remove stale auto-judge artifacts

```bash
rm -f results/*-auto-judge.yaml results/scoreboard.json
```

Ensures the scoring pipeline starts from a clean production state. No existing
judge records or manual scoring state was destroyed — only auto-generated files
from prior dry runs were removed.

### Step 2: Scoreboard Aggregation — `scripts/score.js aggregate`

```bash
node scripts/score.js aggregate
```

This step validates all result packets, generates auto-judge records, builds
the scoreboard JSON, adds **cross-hardware comparison caveats**, and validates
the scoreboard against its schema.

#### Result Summary

| Metric | Value |
|---|---|
| Result packets found | 8 (7 perf-001 + 1 ops-001) |
| Schema-valid | 7/7 entries |
| Auto-judge records created | 6 |
| Existing judge records used | 1 (ops-001-yukson) |
| Pending human dimensions | 21 |
| Per-entry automated checks | 21 |
| Hardware classes detected | **4** (small-vps, medium-vps, a2a-runner, large-vps) |

#### Cross-Hardware Caveats

The round-level cross-hardware comparison logic identified **4 distinct hardware
classes** among the perf-001 entries and emitted the following caveats:

**Round-level cross-class caveat** (added to every perf-001 entry):

> Cross-hardware scoreboard: round contains entries from 4 hardware classes
> (a2a-runner, large-vps, medium-vps, small-vps). Raw measurement values are
> NOT directly comparable across hardware classes. Use scored_values for
> cross-class comparison when available.

**Per-entry caveats by class:**

| Entry | Class | Entry-Level Caveats |
|---|---|---|
| `perf-001-nosuk` | a2a-runner | Cross-hardware round caveat only |
| `perf-001-seoseo-cli-probe-live` | large-vps | Cross-hardware round caveat only |
| `perf-001-seoseo-openclaw-codex-live` | large-vps | Cross-hardware round caveat only |
| `perf-001-baseline-agent` | medium-vps | Cross-hardware + no scored_values + legacy workload_metrics |
| `perf-001-sogyo` | medium-vps | Cross-hardware + no scored_values + legacy workload_metrics |
| `perf-001-baseline-agent-small` | small-vps | Cross-hardware + no scored_values + legacy workload_metrics |

The `medium-vps` and `small-vps` entries carry additional caveats because they
use the v1 result packet schema without `scored_values`. This means raw
measurements are only directly comparable with entries of the same class.

**All 6 perf-001 entries have `comparable: false`** because the round contains
entries from multiple hardware classes. Direct raw comparison is not valid
across classes.

#### Scoreboard Summary (schema-validated)

```json
{
  "distinct_hardware_classes": ["a2a-runner", "large-vps", "medium-vps", "small-vps"],
  "comparable_entries": 0,
  "non_comparable_entries": 7
}
```

### Step 3: Web Consumer — Static Publication Snapshot

```bash
# Public mode
node scripts/web-result-consumer.js results/scoreboard.json \
  --output-dir fixtures/web-sample/cross-hardware \
  --title "Agent Olympics — Cross-Hardware Scoreboard Rehearsal"

# Blind mode
node scripts/web-result-consumer.js results/scoreboard.json \
  --output-dir fixtures/web-sample/cross-hardware/blind \
  --blind \
  --title "Agent Olympics — Cross-Hardware Scoreboard Rehearsal (Blind)"
```

Generated output:

```
fixtures/web-sample/cross-hardware/
├── index.html                          # Leaderboard (9 HTML pages total)
├── detail/                             # 7 per-entry detail pages
│   ├── ops-001-yukson.html
│   ├── perf-001-nosuk.html
│   ├── perf-001-baseline-agent-small.html
│   ├── perf-001-sogyo.html
│   ├── perf-001-baseline-agent.html
│   ├── perf-001-seoseo-cli-probe-live.html
│   └── perf-001-seoseo-openclaw-codex-live.html
├── compare/
│   └── perf-001.html                   # Cross-hardware comparison view
└── blind/                              # Blind-mode snapshot
    ├── index.html
    ├── detail/
    └── compare/
```

Each detail page shows:
- Scorecard with per-dimension scores and judge type
- Participant metadata with hardware profile
- Evidence panel with source summaries
- Comparability caveats (including cross-hardware caveats)
- Performance profile (raw measurements + scored values)

The comparison view shows all 6 perf-001 entries side-by-side with:
- Hardware profile comparison (cpu_class, memory_gb, storage_class)
- Caveat display for each entry
- Warning banner for cross-hardware comparison

### Step 4: Competition-Validity Fixtures Check

```bash
node scripts/competition-validity.js fixtures fixtures/competition-validity
```

All 5 positive fixtures pass. All 10 negative fixtures produce expected failures.

### Step 5: Schema Validation

```bash
node -e 'const fs=require("fs");const Ajv=require("ajv/dist/2020");const addFormats=require("ajv-formats");const ajv=new Ajv({allErrors:true,verbose:true});addFormats(ajv);const schema=JSON.parse(fs.readFileSync("schemas/scoreboard.schema.json","utf8"));ajv.addSchema(schema,schema.$id);const validate=ajv.getSchema(schema.$id);const sb=JSON.parse(fs.readFileSync("results/scoreboard.json","utf8"));console.log("Scoreboard schema valid:",validate(sb));'
```

Output: `Scoreboard schema valid: true`

---

## Raw/Scored Separation

All 6 perf-001 entries maintain strict raw/scored namespace separation:

| Entry | Measured By | `raw_measurements` | `scored_values` | Legacy `workload_metrics` |
|---|---|---|---|---|
| perf-001-nosuk | v2 direct | ✓ (23 fields) | ✓ (5 fields) | — |
| perf-001-seoseo-cli-probe-live | v2 direct | ✓ (21 fields) | ✓ (5 fields) | — |
| perf-001-seoseo-openclaw-codex-live | v2 direct | ✓ (21 fields) | ✓ (5 fields) | — |
| perf-001-baseline-agent | v1 legacy | — (sourced from `workload_metrics`) | ✗ | ✓ |
| perf-001-sogyo | v1 legacy | — (sourced from `workload_metrics`) | ✗ | ✓ |
| perf-001-baseline-agent-small | v1 legacy | — (sourced from `workload_metrics`) | ✗ | ✓ |

The 3 v1 entries trigger a `Raw/scored separation issue` caveat noting that
their raw measurements were sourced from legacy `workload_metrics` and only
`raw_`-prefixed fields were included.

---

## Source-Only / Container / Cache Caveats

The following caveats remain visible in the published scoreboard and web output:

1. **Cross-hardware round caveat** — all perf-001 entries carry information
   about the other hardware classes present in the round.
2. **No scored_values on v1 entries** — `small-vps` and `medium-vps` entries
   lack normalized scores, so raw measurements can only be compared within
   the same hardware class.
3. **Legacy workload_metrics** — v1 baseline packets sourced from
   `workload_metrics` rather than the v2 `raw_measurements`/`scored_values`
   split. Only `raw_`-prefixed fields were extracted.
4. **Comparability forced to false** — the round-level cross-class detection
   marks all perf-001 entries as non-comparable when multiple hardware classes
   are present.

---

## Additional Approved Hardware Evidence Required

Before a **higher-tier claim** (live publication, official dry-run finalization,
or cross-season comparison) can be made, the following additional evidence is
needed:

### Required Hardware Coverage

| Gap | Current State | Required Evidence |
|---|---|---|
| **v2 scored_values for small-vps** | Only v1 baseline exists (no `scored_values`). | Recollect `perf-001-baseline-small` as v2 packet with `raw_measurements` and `scored_values`. |
| **v2 scored_values for medium-vps (baseline-agent)** | Only v1 baseline exists. | Recollect `perf-001-baseline` as v2 packet with `raw_measurements` and `scored_values`. |
| **v2 scored_values for medium-vps (sogyo, OpenClaw)** | Only v1 baseline exists. | Recollect `perf-001-baseline-sogyo` as v2 packet with `raw_measurements` and `scored_values`. |
| **Large-vps v2 packets** | 2 live-approved v2 packets exist (seoseo-cli-probe, seoseo-openclaw-codex). | Publishable; no additional capture needed. |
| **A2A-runner v2 packet** | 1 existing v2 packet (nosuk). Publishable. | Publishable; no additional capture needed. |

### Required Integration Steps

| Step | Description | Depends On |
|---|---|---|
| **Fresh harness run on ≥2 hardware classes** | Run `perf-harness.js` on small-vps AND medium-vps nodes to produce consistent v2 packets with `scored_values`. | Harness is ready; nodes must be provisioned and approved. |
| **Scoreboard re-aggregation** | Re-run `score.js aggregate` with ≥2 v2 scored packets for cross-hardware scored comparison. | Fresh harness packets. |
| **Publication readiness gates** | Run `dry-run-gates.js publication` to confirm all gates pass. | Scoreboard with scored cross-hardware entries. |
| **Web data bridge validation** | Run `test-web-consumer.sh` and `validate-web-bridge` to confirm web output. | Scoreboard ready. |
| **Finalizer review** | Seoseo (broker-of-record) reviews and finalizes the publication. | All above steps pass. |

### Not In Scope

- **Live provider canary**: Not required for source-only publication. Separate
  operator approval needed.
- **Production DB mutation**: Not required. All artifacts are file-based.
- **Telegram/Terminal Brief ACK**: Not required for publication rehearsal.
- **Bangtong**: Explicitly excluded pending re-enrollment (per operator
  directive). No Bangtong profiles, packets, or fixtures were modified.

---

## Changes in This Patch

| File | Change |
|---|---|
| `scripts/score.js` | Added round-level cross-hardware comparison caveat generation in `buildScoreboard()`. After all entries are assembled, identifies distinct hardware classes among perf-001 entries and emits cross-class caveats. Sets `comparable: false` when multiple classes exist. Adds `distinct_hardware_classes` to scoreboard summary. |
| `docs/perf-001-cross-hardware-scoreboard-rehearsal.md` | This rehearsal artifact. |
| `fixtures/web-sample/cross-hardware/` | Static publication snapshot (leaderboard, detail pages, comparison view, blind mode). |

## Verification Output

All generated artifacts:

```
results/scoreboard.json                          — Cross-hardware scoreboard (7 entries, 4 HW classes)
results/*-auto-judge.yaml                        — 6 auto-generated judge records
fixtures/web-sample/cross-hardware/index.html    — Public leaderboard
fixtures/web-sample/cross-hardware/detail/*.html — Per-entry detail pages (7)
fixtures/web-sample/cross-hardware/compare/perf-001.html — Cross-hardware comparison view
fixtures/web-sample/cross-hardware/blind/        — Blind-mode snapshot
```

## Risk Notes

- **v1 baseline packets without scored_values**: The `small-vps` and
  `medium-vps` entries are v1 result packets with legacy `workload_metrics`.
  They have no `scored_values`, so cross-hardware comparison is limited to
  raw measurements within the same class. Adding v2 scored_values for these
  classes is recommended before higher-tier publication.
- **Non-comparable all entries**: Because 4 distinct hardware classes are
  present, all perf-001 entries are marked as non-comparable. This is correct
  — direct raw comparison across classes is not valid. Comparison should use
  `scored_values` when available.
- **Output consistency**: When new result packets are added, re-running
  `scripts/score.js aggregate` will regenerate the scoreboard with updated
  class detection. The cross-hardware caveat will automatically adjust.

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
- [x] No new live baselines or provider calls
- [x] No Bangtong profiles, packets, or fixtures modified
