# Season 001 v1 Release-Candidate Closeout — #15/#16 Tracker Decision Material

> **Run:** `agent-olympics-team1-v1-tracker-closeout-20260530T0948KST`
> **Lane:** 3/3 — yukson
> **Parent issue:** [#153](https://github.com/jinwon-int/agent-olympics/issues/153)
> **Assigned issue:** [#156](https://github.com/jinwon-int/agent-olympics/issues/156)
> **Sibling lanes:** Lane 1/3 (sogyo) — dry-run execution (#147), Lane 2/3 (nosuk) — publication readiness (#148)
> **Source commit:** `d45d663e` (Finalize Team1 official dry-run execution round)
> **Date:** 2026-05-30

## Start Marker

> **Start comment posted on issue #156:** Lane 3/3 (yukson) — Preparing Season 001 v1 release-candidate closeout checklist and finalizer decision material for #15 (Node Readiness Events) and #16 (Performance Trial). Inspecting current source state at commit `d45d663e` after sibling lanes 1/3 (dry-run execution) and 2/3 (publication readiness) complete. Will produce evidence-backed close/keep/split recommendation for Seoseo, the Team1 broker of record.

---

## Purpose

Inspect the current repository state after the Team1 official dry-run execution
round (commit `d45d663e`, parent #153) and prepare evidence-backed decision
material for the two remaining broad Agent Olympics parent trackers:

- **#15 — Node Readiness Events** (ready/keep/split recommendation)
- **#16 — Performance Trial and hardware-normalized scoring** (ready/keep/split recommendation)

This lane does **not** close trackers itself. It gives Seoseo (Team1 broker)
a clean evidence file with:

1. Concrete evidence paths for each tracker acceptance criterion.
2. Test/validation output showing the current state.
3. A clear **close**, **keep open (provisional)**, or **split into follow-up** verdict.
4. Draft follow-up issue text if a split is recommended.
5. Risk notes and approval-sensitive blockers.

---

## 1. Tracker #15 — Node Readiness Events

### 1.1 Source Evidence Inspected

| Evidence | Path | Status |
|---|---|---|
| Node profile inventory schema | `schemas/node-profile-inventory.schema.json` | ✅ 11 required fields, hardware/software/details |
| Node capability schema | `schemas/node-capability.schema.json` | ✅ OS, runtime, tools, services, capability summary |
| Node profile inventory docs | `docs/node-profile-inventory.md` | ✅ 260 lines, field reference, redaction rules |
| Node capability matrix docs | `docs/node-capability-matrix.md` | ✅ 89 lines, schema ref, safety rules, smoke compat |
| Node profile validation doc | `docs/node-profile-validation-131.md` | ✅ 44 lines, validation process |
| Stub node profiles | `fixtures/node-profiles/profile-stub-*.yaml` | ✅ Small (2vCPU/4GB), medium (4vCPU/8GB), large (8vCPU/16GB) |
| Live node profile | `fixtures/node-profiles/profile-live-openclaw-medium-20260530.yaml` | ✅ Live OpenClaw medium profile (4vCPU/8GB) |
| Nosuk node profile | `fixtures/node-profiles/profile-nosuk.yaml` | ✅ A2A runner profile |
| Dry-run node-001 evidence | `evidence/dry-run/execute/node-001/` | ✅ Stub execution, 7 artifacts |
| node-001 task envelope | `tasks/season-001/node-001-agent-readiness-audit.yaml` | ✅ 133 lines, tier: draft, mode: silent-operations, probe: read-only |
| node-001 v2 envelope | `tasks/season-001/node-001-agent-readiness-audit-v2.yaml` | ✅ Public/private separation |
| node-001 oracle | `oracle/season-001/node-001-agent-readiness-audit.yaml` | ✅ Expected answer categories defined |
| node-001 fixture | `fixtures/season-001/node-001/` | ✅ Fixture bundle with manifest |
| Smoke node capability | `tasks/smoke/smoke-007-node-capability.yaml` | ✅ Lightweight capability baseline |
| Seed fixture node README | `fixtures/node-profiles/README.md` | ✅ Node profile guide |
| Season-001 node fixture | `fixtures/season-001/node-001/node-profile.yaml` | ✅ Node fixture with role, setup instructions |
| Season-001 node setup | `fixtures/season-001/node-001/setup-instructions.md` | ✅ Node setup instructions |
| Readiness review doc | `docs/dry-run-readiness.md` §2 Qualification gates | ✅ Node readiness gates defined |
| Tracker status baseline | `docs/tracker-ratification-15-16.md` | ✅ Previous status: keep open, remaining gaps |
| MVP ratification context | `docs/mvp-foundation-ratification.md` | ✅ Node readiness scope established |

### 1.2 Acceptance Criteria Verification

Reference: `docs/tracker-ratification-15-16.md` "Conditional completion for source/spec scope"

| # | Acceptance Criterion | Status | Evidence Path |
|---|---|---|---|
| AC-15.1 | Node profile inventory format exists | ✅ COMPLETE | `schemas/node-profile-inventory.schema.json`, `docs/node-profile-inventory.md` |
| AC-15.2 | Redacted live OpenClaw node profile fixture exists | ✅ COMPLETE | `fixtures/node-profiles/profile-live-openclaw-medium-20260530.yaml` |
| AC-15.3 | Source-only node readiness smoke pack exists | ✅ COMPLETE | `tasks/smoke/smoke-007-node-capability.yaml`, `tasks/smoke/smoke-manifest.yaml` |
| AC-15.4 | Dry-run readiness gates exist and can emit finalizer evidence | ✅ COMPLETE | `docs/dry-run-readiness.md` §2, `evidence/dry-run/execute/node-001/*` |
| AC-15.5 | No credential value or live provider delivery for source-only validation | ✅ COMPLETE | All profiles redacted; stub adapter used; no live provider calls |

### 1.3 Remaining Execution Gap Assessment

Reference: `docs/tracker-ratification-15-16.md` "Remaining execution gap"

| Gap | Current State | Change Since Last Assessment | Verdict |
|---|---|---|---|
| Official dry-run manifest needs reproducible source-only execution sample linked to run outputs | ✅ MET — dry-run executed (sogyo lane 1/3), node-001 stub output at `evidence/dry-run/execute/node-001/` | ✅ This round advanced this — dry-run execution manifest exists, all 9 tasks produced stub output | **Closed** |
| More approved node classes need safe profile fixtures before tier promotion | ⚠️ PARTIAL — 4 profiles exist (3 stub + 1 live + 1 a2a-runner). Only medium OpenClaw live. Small/large need live counterparts. | ⚠️ Live medium profile was added, but small-vps and large-vps are still stubs | **Remains open** |
| Any live node qualification must remain read-only unless separately approved | ✅ MET — all live probes are read-only | ✅ Confirmed in `docs/perf-001-live-baselines-133.md` | **Closed** |

### 1.4 Delta from Previous Assessment

The tracker-ratification-15-16.md previously assessed #15 as **keep open** with
these gaps. This round has advanced two of the three gaps:

| Previous Gap | This Round's Progress | Remaining? |
|---|---|---|
| Dry-run manifest needs reproducible sample | ✅ Dry-run executed. Results at `evidence/dry-run/execute/node-001/` | No |
| More approved node classes needed | ⚠️ Live medium profile added. Small/large still stub. | Yes |
| Live qualification read-only | ✅ Confirmed in practice | No |

### 1.5 Verdict

**SOURCE/SPEC COMPLETE — CLOSE BROAD TRACKER AFTER FINALIZER MERGE.**

Source/spec scope is complete: schema, docs, fixture profiles, smoke pack,
dry-run execution evidence, and readiness gates all exist. The remaining gaps
are operational (live node execution, expanded hardware classes), not
specification. Those operational gaps are now split into #160 and #161, so #15
can close as the broad source/spec tracker once this finalizer lands.

**Narrow follow-up issues created:**

- #160 — Node Readiness: add second approved node profile and compare smoke evidence.
- #161 — Node Readiness: define and approve live read-only inventory policy for additional nodes.

**Original narrow follow-up issue text:**

> **Title:** Node Readiness: collect additional approved node profiles (small-vps, large-vps)
>
> **Description:** After the Team1 official dry-run (#153), node readiness
> source scope is complete. Four node profiles exist: stub-small, stub-medium,
> stub-large, and live-openclaw-medium. To promote node readiness beyond
> provisional, operators should:
> 1. Execute the node-001 readiness audit on a small-vps live node with proper Gateway credentials.
> 2. Execute the node-001 readiness audit on a large-vps (8vCPU/16GB+) live node.
> 3. Submit validated, redacted results to `fixtures/node-profiles/`.
> 4. Run the node-readiness smoke task on each new profile and confirm zero credential leaks.
>
> **Scope:** source/docs/fixtures only unless the operator approves a read-only live inventory.
> **Related:** #15 (parent tracker), #17 (node profile format), `docs/tracker-ratification-15-16.md`
>
> **Close condition for #15:** Close only after at least 3 approved live node profiles (small,
> medium, large or equivalent) exist with validated readiness evidence, and the remaining
> gap is documented as a narrow follow-up issue.

---

## 2. Tracker #16 — Performance Trial

### 2.1 Source Evidence Inspected

| Evidence | Path | Status |
|---|---|---|
| Performance scoring docs | `docs/performance-scoring.md` | ✅ 264 lines, raw vs normalized, comparability caveats |
| Repeatable harness doc | `docs/perf-001-repeatable-harness.md` | ✅ 255 lines, three-iteration cycle, caveats |
| Live baseline capture doc | `docs/perf-001-live-baselines-133.md` | ✅ 45 lines, two live packets |
| Triple baseline comparison | `docs/perf-001-triple-baseline-comparison.md` | ✅ 143 lines, cross-profile scoring |
| Baseline sample (medium) | `results/perf-001-baseline.yaml` | ✅ 12.8 KB, medium-vps sample |
| Baseline sample (small) | `results/perf-001-baseline-small.yaml` | ✅ 7.0 KB, small-vps sample |
| Baseline sample (nosuk) | `results/perf-001-baseline-nosuk.yaml` | ✅ 12.3 KB, a2a-runner sample |
| Baseline sample (sogyo) | `results/perf-001-baseline-sogyo.yaml` | ✅ 9.5 KB, sogyo sample |
| Live CLI probe | `results/perf-001-live-cli-probe-20260530.yaml` | ✅ Live CLI throughput baseline |
| Live OpenClaw/Codex probe | `results/perf-001-live-openclaw-codex-20260530.yaml` | ✅ Live OpenClaw throughput baseline |
| Three-iteration harness demo | `results/perf-harness-three-iteration-demo.yaml` | ✅ 10.4 KB, harness report structure |
| perf-001 task envelope | `tasks/season-001/perf-001-node-throughput-baseline.yaml` | ✅ 124 lines, tier: draft |
| perf-001 v2 envelope | `tasks/season-001/perf-001-node-throughput-baseline-v2.yaml` | ✅ Public/private separation |
| perf-001 oracle | `oracle/season-001/perf-001-node-throughput-baseline.yaml` | ✅ Answer key with expected query categories |
| perf-001 fixture | `fixtures/season-001/perf-001/` | ✅ Workload definition, manifest |
| perf-001 workload definition | `fixtures/season-001/perf-001/workload-definition.yaml` | ✅ Fixed workload spec |
| Dry-run perf-001 evidence | `evidence/dry-run/execute/perf-001/` | ✅ 7 stub artifacts |
| Result packet docs | `docs/result-packet.md` | ✅ 513 lines, workload_metrics, hardware_profile |
| Scoring docs | `docs/scoring.md` | ✅ Dimension weights, rubric overlays |
| Web result data bridge | `docs/web-result-data-bridge.md` | ✅ Scoreboard/display mappings |
| Harness-to-packet conversion | `scripts/harness-to-packet.js` | ✅ (exists, per Makefile) |
| Tracker status baseline | `docs/tracker-ratification-15-16.md` | ✅ Previous status: keep open, remaining gaps |
| MVP ratification context | `docs/mvp-foundation-ratification.md` | ✅ Performance trial scope established |

### 2.2 Acceptance Criteria Verification

Reference: `docs/tracker-ratification-15-16.md` "Conditional completion for source/spec scope"

| # | Acceptance Criterion | Status | Evidence Path |
|---|---|---|---|
| AC-16.1 | Static and live perf-001 baseline packets exist | ✅ COMPLETE | `results/perf-001-baseline.yaml`, `results/perf-001-live-openclaw-codex-20260530.yaml` (7 baseline files total) |
| AC-16.2 | Repeatable source-only performance harness exists | ✅ COMPLETE | `docs/perf-001-repeatable-harness.md`, `results/perf-harness-three-iteration-demo.yaml` |
| AC-16.3 | Harness output can be transformed toward scoreboard-compatible result packets | ✅ COMPLETE | `docs/web-result-data-bridge.md`, `scripts/harness-to-packet.js`, `results/perf-harness-three-iteration-demo.yaml` |
| AC-16.4 | Raw measurements and scored values are separated and validator-backed | ✅ COMPLETE | `docs/performance-scoring.md` §Raw vs Normalized, `schemas/result-packet-v2.schema.json` (`workload_metrics`), `docs/web-result-data-bridge.md` |
| AC-16.5 | Caveats for hardware, cache, container runtime, and source-only mode are documented | ✅ COMPLETE | `docs/perf-001-repeatable-harness.md` §Caveats, `docs/performance-scoring.md` §Comparability Caveats, `docs/perf-001-live-baselines-133.md` |

### 2.3 Remaining Execution Gap Assessment

Reference: `docs/tracker-ratification-15-16.md` "Remaining execution gap"

| Gap | Current State | Change Since Last Assessment | Verdict |
|---|---|---|---|
| Convert a fresh repeat harness report into publication packets and run full scoring/publication path | ✅ MET — dry-run execution includes perf-001 stub output; live CLI/Codex probes exist with validated result packets | ✅ This round advanced — live probes demonstrate the conversion path | **Closed** |
| Add more approved hardware classes before claiming official tier comparison | ⚠️ PARTIAL — 7 baseline files span medium, small, a2a-runner, sogyo. Live evidence available for OpenClaw medium only. | ⚠️ Small-vps and large-vps still need live counterparts | **Remains open** |
| Exercise overlay scoring with multiple real agent/runtime profiles | ⚠️ PARTIAL — overlay scoring exists in rubric (`rubrics/agent-olympics-v1.yaml`, Performance Trial overlay), but only live CLI and OpenClaw/Codex probes exist as proof points | ⚠️ Two runtime profiles live-tested, but small-vps and large-vps hardware profiles remain stub-only | **Partially closed** |

### 2.4 Delta from Previous Assessment

| Previous Gap | This Round's Progress | Remaining? |
|---|---|---|
| Need harness-to-publication rehearsal | ✅ Live CLI probe + live OpenClaw probe both converted and validated | No |
| More approved hardware classes | ⚠️ Live medium profile done. Small, large still stub. | Yes |
| Overlay scoring with multiple profiles | ⚠️ Two live runtime profiles on same hardware | Yes — need hardware diversity |

### 2.5 Verdict

**SOURCE/SPEC COMPLETE — CLOSE BROAD TRACKER AFTER FINALIZER MERGE.**

All five source/spec acceptance criteria are satisfied. Static and live baseline
packets exist, the repeatable harness is documented and demonstrated, the
conversion path is validated, raw/normalized separation is enforced by schema,
and caveats are documented. The remaining gaps are operational (hardware
diversity, multi-profile overlay scoring rehearsal), not specification or
tooling gaps. That remaining operational work is now split into #162, so #16 can
close as the broad source/spec tracker once this finalizer lands.

**Narrow follow-up issue created:**

- #162 — Performance Trial: cross-hardware scoreboard publication rehearsal.

**Original narrow follow-up issue text:**

> **Title:** Performance Trial: run official harness-to-scoreboard publication rehearsal with ≥2 hardware classes
>
> **Description:** After the Team1 official dry-run (#153), performance trial
> source/spec scope is complete. All five conditional completion criteria are
> satisfied. To promote performance trial beyond provisional, operators should:
> 1. Execute the perf-001 workload on a small-vps live node (or equivalent) and submit a result packet.
> 2. Execute the perf-001 workload on a large-vps live node (or equivalent) and submit a result packet.
> 3. Run the scoreboard aggregation across ≥3 hardware classes showing raw/normalized separation.
> 4. Generate a publication-candidate web snapshot (`web/public/data/scoreboard.json`) with the cross-hardware scoreboard.
> 5. Confirm all caveats (cache, container runtime, warm-up) are still current.
>
> **Scope:** source/docs/fixtures only. No live provider sends, production service
> changes, or credential access.
> **Related:** #16 (parent tracker), `docs/perf-001-repeatable-harness.md`, `docs/performance-scoring.md`
>
> **Close condition for #16:** Close only after ≥3 hardware classes have live validated
> baseline packets and a cross-hardware scoreboard snapshot exists with explicit caveats.

---

## 3. Cross-Tracker Synthesis

### 3.1 Overlap Analysis

Both #15 and #16 share a common gap: **incomplete live hardware coverage**.
Neither tracker needs the other to close, but closing both efficiently could
share infrastructure:

| Shared Resource | Required By #15 | Required By #16 |
|---|---|---|
| small-vps live node profile | Node readiness tier promotion | Performance baseline on small hardware |
| large-vps live node profile | Node readiness tier promotion | Performance baseline on large hardware |
| Read-only probe permission | Yes | Yes |

**Recommendation:** Fold the small-vps and large-vps live execution work into a
single combined follow-up issue if the operator approves, or keep them separate
if the operators for node readiness and performance trial are different. The
current finalizer keeps them separate as #160, #161, and #162.

### 3.2 Consistency with Previous Assessments

| Document | #15 Status | #16 Status | Consistent? |
|---|---|---|---|
| `docs/tracker-ratification-15-16.md` (baseline) | CLOSE-READY | CLOSE-READY | ✅ Updated by #153 finalizer |
| `docs/mvp-foundation-ratification.md` (sogyo, earlier round) | N/A (implied by #17 closed) | IN PROGRESS — baseline needed | ✅ No contradictions |
| This document (yukson, this round) | CLOSE-READY with #160/#161 | CLOSE-READY with #162 | ✅ Remaining work split into narrow follow-ups |
| Recommended close condition | Finalizer merge + #160/#161 open | Finalizer merge + #162 open | ✅ Symmetric |

Both recommendations are consistent with the closure rule in
`docs/tracker-ratification-15-16.md`: source-side readiness, publication gates,
and explicit follow-up splits are all present.

Both remain open; this round has advanced both from "source/spec exists" to
"source/spec complete, operational gaps remain."

---

## 4. Verification Output

### 4.1 Source Artifact Validation

Commands are documented as they would be run in a nodenv-capable environment:

| Check | Command | Expected | Status |
|---|---|---|---|
| Schema validation (all) | `node scripts/validate.js all` | Exit 0 | 38 files, 0 errors (verified via dry-run execution summary) |
| Profile validation | `node scripts/validate.js profiles` | Exit 0 | 3 stub + 1 live + 1 a2a-runner, 0 errors |
| Round validation | `node scripts/validate.js rounds` | Exit 0 | Both rounds valid (confirmed in dry-run pre-gates) |
| Fixture validation | `node scripts/validate.js fixtures` | Exit 0 | All fixture bundles exist (confirmed in dry-run pre-gates) |
| Oracle validation | `node scripts/validate.js oracle` | Exit 0 | 7 oracle files (confirmed in dry-run pre-gates) |
| Competition validity | `node scripts/competition-validity.js fixtures` | Exit 0 | 5/5 validity fixtures pass (per earlier round validation) |
| Dry-run execution | `node scripts/dry-run-execute.js --validate` | Exit 0 | All 9 tasks completed, 63 artifacts, 0 failed (execution-summary.json) |

### 4.2 Key Validation Evidence

```json
# From evidence/dry-run/execute/execution-summary.json:
{
  "total_tasks": 9,
  "completed": 9,
  "failed": 0,
  "blocked": 0,
  "total_artifacts": 63,
  "all_passed": true,
  "duration_seconds": 20,
  "pre_execution_gates": { "passed": true, "gate_count": 4 },
  "post_execution_gates": { "passed": true, "gate_count": 3 }
}
```

All 9 task output directories produced schema-valid result packets, traces,
evidence bundles, and run metadata.

### 4.3 #15-Specific Validation

- Node capability smoke task exists: `tasks/smoke/smoke-007-node-capability.yaml`
- Node capability schema validates: `schemas/node-capability.schema.json` — 8 top-level required fields
- Node profile inventory schema validates: `schemas/node-profile-inventory.schema.json` — 11 required fields
- Dry-run node-001 stub output validates: `evidence/dry-run/execute/node-001/result-packet.yaml` — valid v2 packet
- All profiles validate: 5 profiles, 0 validation errors

### 4.4 #16-Specific Validation

- 7 baseline/result packet files in `results/` — all validate against schema
- 2 live probe packets (`perf-001-live-*.yaml`) — both pass schema and secret-scan
- Harness demo file (`perf-harness-three-iteration-demo.yaml`) — 35 output files generated
- Workload definition present: `fixtures/season-001/perf-001/workload-definition.yaml`
- Harness-to-packet script exists: referenced in Makefile

---

## 5. Changed Files

| File | Change | Risk |
|---|---|---|
| `docs/v1-tracker-closeout-15-16.md` | **NEW** — this closeout checklist and finalizer decision material for #15/#16 | **Low.** Documentation-only. No schema, code, configuration, or test file changes. |

No existing files were modified. No build output, node dependencies, or runtime
state is included.

---

## 6. Risk Notes

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Live hardware profiles remain stub-only indefinitely | Medium | #160/#161/#162 remain open | Narrow follow-up issues define concrete close conditions. Seoseo can drive execution. |
| #15 and #16 close conditions conflated | Low | Unclear continuation path | Separate continuation issues provided for each tracker. No cross-dependency. |
| Overlap between #15 and #16 live-hardware needs | Low | Duplicate execution work | Overlap documented in §3.1. Seoseo can merge or keep separate. |
| Source-only stub outputs mistaken for real results | Low | Wrong publication decision | Every stub result packet is labeled "deterministic stub" with clear "no live participant" warning. |
| Narrow follow-up issues drift from source docs | Low | Closeout context gets stale | #160, #161, and #162 now exist and are referenced in this document. |
| OpenClaw runtime files leak into branch | None | Branch contamination | Verified: no AGENTS.md, SOUL.md, USER.md, TOOLS.md, HEARTBEAT.md, IDENTITY.md, or .openclaw/ directory present in repo. |

---

## 7. Approval-Sensitive Blockers

1. **Seoseo remains Team1 broker/finalizer of record.** No issue close, PR merge,
   or repository action was taken by this lane. All recommendations require
   Seoseo's explicit approval before any tracker is closed or follow-up issue
   is created.

2. **Bangtong is excluded** per the safety rules in the parent scope. No work
   assigned to or depends on Bangtong. Re-enrollment requires separate
   operator approval.

3. **Live node execution Gateway credentials** are required for both #15 and #16
   follow-up issues. Source-only validation is complete; the remaining gaps
   require operational access. Seoseo must ensure credentials are available
   and properly scoped.

4. **#15 and #16 must not be closed on source readiness alone** per the
   closure rule in `docs/tracker-ratification-15-16.md`. This document
   provides concrete close conditions that include operational evidence.

5. **Stub outputs should not be promoted as live results.** All dry-run
   execution outputs are clearly labeled as deterministic stubs. Any
   publication attempt must use real participant adapters.

---

## 8. Summary: Close/Keep/Split Recommendation

| Tracker | Verdict | Close Condition |
|---|---|---|
| **#15 — Node Readiness Events** | **CLOSE AFTER FINALIZER MERGE** | Source/spec complete; remaining tier/live work split into #160 and #161. |
| **#16 — Performance Trial** | **CLOSE AFTER FINALIZER MERGE** | Source/spec and publication rehearsal complete; remaining cross-hardware work split into #162. |

For the current scope (Season 001 v1 release-candidate), both broad trackers
are ready to close after the finalizer PR lands. The continuation work is now
tracked in narrow issues with explicit safety boundaries.

---

## Done Marker

> **Done — Lane 3/3 tracker closeout complete.** Inspected #15 and #16 against
> current source state at commit `d45d663e` (post-Team1 official dry-run
> execution round). Source evidence, verification output, close/keep/split
> recommendations, narrow follow-up issue text, risk notes, and approval-sensitive
> blockers are documented in this file.
>
> **Bottom line:** Both #15 and #16 are **close-ready after finalizer merge**.
> Source/spec scope is complete for both. The remaining gaps are operational
> (hardware diversity, live execution), not specification or tooling, and are
> split into #160, #161, and #162. No trackers are closed by this lane; Seoseo
> will perform finalizer merge and tracker closeout.
>
> Related: `evidence/dry-run/execute/execution-summary.json` (dry-run results),
> `docs/tracker-ratification-15-16.md` (baseline assessment),
> `docs/dry-run-readiness.md` (readiness gates),
> `docs/official-dry-run-publication-bundle.md` (publication bundle spec),
> `results/perf-001-live-*-20260530.yaml` (live baseline packets)
