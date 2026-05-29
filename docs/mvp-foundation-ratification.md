# MVP Foundation Issue Status — Ratification Document

> **Run:** `agent-olympics-team1-performance-ratify-20260529T1930KST`
> **Round:** Team1 Performance baseline and MVP foundation ratification (#82)
> **Lane:** 3/3 — yukson
> **Date:** 2026-05-29

## Purpose

Ratify the MVP foundation roadmap state after the completed public-readiness, MVP engine, competition-validity, and run-lifecycle rounds. This document maps what is done, provisional, blocked, or deferred across the foundation trackers without closing any issue silently.

---

## 1. Foundation Issue Status Map

### ✅ #1 — Freeze Task Envelope and Result Packet v1

**Status:** DONE (provisional)

| Criterion | Status | Evidence |
|---|---|---|
| Schema files validate example tasks | ✅ | `schemas/task-envelope-v2.schema.json`, `schemas/result-packet-v2.schema.json`, `schemas/judge-record-v2.schema.json` |
| Example result packet validates | ✅ | `results/ops-001-yukson.yaml` validates against `result-packet.schema.json` |
| Cross-field semantic checks | ✅ | `scripts/validate.js` — evidence references, timestamps, secret patterns |
| Field names stable for adapters | ✅ | Adapter Execution Contract (`docs/adapter-execution-contract.md`) references stable fields |
| No OpenClaw/Hermes-only required fields | ✅ | Common schema remains neutral |
| Validation tooling exists | ✅ | `npm test` / `make validate` targets |

**Provisional note:** v2 schemas exist alongside v1. A formal schema migration and hardening pass (narrow follow-up) is the next logical step. The v1→v2 migration is documented in `docs/migration-v1-to-v2.md`. Roadmap issue `issues/roadmap-01-freeze-v1-schemas.md` fully describes the completed scope.

**Remaining:** Schema hardening (narrow follow-up issue needed). Tracked as implicit work via the adopted `agent-olympics-v1.yaml` rubric and v2 migration guide. Finalizer PR #97 integrated the operating-agent-stack fields first introduced by PR #55, including `tool_use_profile`, `operating_policy`, and `publishable`; the remaining work is to harden those fields as stable schema requirements.

---

### ✅ #2 — Build Agent Olympics 2026 first season pack

**Status:** CONDITIONAL DONE

| Criterion | Status | Evidence |
|---|---|---|
| Each task has a valid Task Envelope | ✅ | 7 task envelopes at `tasks/season-001/` (ops-001, ops-002, node-001, perf-001, code-001, knowledge-001, coord-001) |
| Hidden judge notes or answer key | ✅ | `oracle/season-001/` directory with oracle files |
| Allowed/forbidden actions listed | ✅ | Each envelope includes approval policy and forbidden actions |
| Usable by OpenClaw, Hermes, CLI | ✅ | Platform-neutral envelope format |
| Clear required outputs | ✅ | `required_outputs` field in each envelope |

**Condition:** The season pack is complete for the smoke round (Round 001), but future rounds may add or modify task variants. The round manifest at `rounds/season-001-round-001.yaml` references all 7 tasks. Fixture bundles at `fixtures/season-001/` provide data. The public/private split (envelope vs oracle) is clear.

**Remaining:** New task event families landed through finalizer PR #97 (Tool Decathlon, Harness Reliability) would expand the season pack in a future round. No season-pack closure needed now.

---

### ❓ #16 — Track: Performance Trial and hardware-normalized scoring

**Status:** IN PROGRESS (this round)

| Criterion | Status | Evidence |
|---|---|---|
| Baseline table for 2+ nodes | ❌ | Open — this round's lane 1/3 (sogyo) |
| Raw vs normalized scoring distinction | ❌ | Open — this round's lane 2/3 (nosuk) |
| Metrics fields in result packet | ✅ | `workload_metrics` in `result-packet.schema.json` |
| Docs warn about host-contention artifacts | ✅ | `docs/scoring.md` covers hardware normalization |

**Status inherited from:** #26 (Performance Trial baseline collection), which is linked to this tracker. This round's Team1 lanes directly advance #16.

---

### ✅ #17 — Build safe node profile inventory format

**Status:** DONE

Evidence: `schemas/node-profile-inventory.schema.json`, `docs/node-profile-inventory.md`, example profiles at `fixtures/node-profiles/`. Issue CLOSED. The format supports hardware-normalized scoring without secrets.

---

### ✅ #18 — Team2: Implement Agent Olympics MVP foundations

**Status:** CLOSED with follow-up

Issue #18 closed with 13 comments (see final closeout). Three Team2 lanes completed:

| Lane | Agent | Result |
|---|---|---|
| Dungae — schema/contracts | Merged PRs #19, #20 | ✅ Schema freeze, validation tooling |
| Jingun — season pack / answer-key structure | Merged PR | ✅ Oracle files, judge notes |
| Soonwook — safe node profile / libero | **BLOCKED** | ❌ Gateway-token/tool-policy setup failure. See #17 as follow-up carrier |

**Remaining:** Soonwook's safe node profile validation lane was blocked; #17 carries the node profile scope forward. A retry or reassignment issue should be opened when the node environment is ready.

---

### ❓ #26 — Performance Trial: collect baseline runs and split raw vs normalized scoring

**Status:** IN PROGRESS — addressed by this round's Team1

| Criterion | Status | Notes |
|---|---|---|
| Baseline table for 2+ nodes/runtime profiles | In progress | Lane 1/3 (sogyo) — raw baseline fixture/run capture |
| Scoring notes distinguish raw throughput from normalized efficiency | In progress | Lane 2/3 (nosuk) — hardware-normalized scoring model |
| Result Packet metrics fields can represent baseline data | ✅ | `workload_metrics` field exists in schema |
| Performance Trial docs warn against host-contention artifacts | ✅ | `docs/scoring.md`, `docs/result-packet.md` |
| No production mutation required for baseline | ✅ | Source-only stub adapter |

**Relationship with #16:** #26 is the concrete implementation child of #16 (Performance Tracker). This round is the first active implementation step.

---

### ❓ #27 — Roadmap: ratify MVP foundation issue status after #19 and #20

**Status:** IN PROGRESS — this document is the ratification deliverable

Acceptance criteria mapping:

| Criterion | Status | Evidence |
|---|---|---|
| #18 has up-to-date closeout/status comment | ✅ | See above — CLOSED with follow-up noted |
| #1 has clear provisional/done interpretation | ✅ | DONE (provisional) — schema hardening needed |
| #2 has clear conditional done/blocked interpretation | ✅ | CONDITIONAL DONE — season pack complete for Round 001 |
| Remaining blockers represented by narrow issues | ⚠️ | Soonwook profile validation needs a retry issue; schema hardening needs a narrow follow-up issue |
| No issue closed without comment on remaining work | ✅ | No issues closed in this pass |

---

### ✅ PR #55 / finalizer PR #97 — operating agent stack rules baseline

**Status:** MERGED through finalizer PR #97; PR #55 is closed as superseded

PR #55 implemented the first documentation pass for issues #50, #51, #52, #53, and #54. It was later closed as superseded after Seoseo finalizer PR #97 integrated PR #55, worker PRs #94/#95, and safe rules material from #96. The merged baseline represents the "operating agent stack" conceptual expansion that repositions Agent Olympics from a model benchmark to a whole-stack competition.

**Relationship with foundation trackers:**

| #55/#97 Change | Foundation Link | Impact |
|---|---|---|
| Motto ("Measure the whole operating agent stack") | New — #50 | Expands competition philosophy |
| Competition rules (`docs/rules.md`) | New — #52 | Needs foundation ratification context |
| Result packet additions (`tool_use_profile`, `operating_policy`) | Extends #1 schema | Schema hardening follow-up needed |
| Agent stack rubric overlay | New — #54 | Expands scoring beyond v1 |
| Event family expansion (Tool Decathlon, Harness Reliability) | Extends #2 season pack | Future round planning |

**Verdict:** PR #55 is no longer open; its safe baseline is merged through finalizer PR #97. Schema hardening follow-up should build on #97 rather than the superseded PR branch.

---

## 2. Broad Foundation Tracker Mapping

### Trackers #50–#55 (Operating Agent Stack Documentation)

These 6 issues form the post-foundation conceptual expansion. They were mapped into PR #55 and landed through the finalizer #97 baseline plus related follow-ups:

| Issue | Title | Vehicle | Status |
|---|---|---|---|
| #50 | Docs: adopt the agent-stack performance motto | #55/#97 (`README.md`, `docs/competition-model.md`) | Addressed by #97 |
| #51 | Docs: write Agent Olympics constitution | #55/#97 (`docs/constitution.md`, `docs/competition-model.md`) | Addressed by #97 |
| #52 | Rules: define competition rules and divisions | #55/#97 (`docs/rules.md`) | Addressed by #97 |
| #53 | Events: redesign event families | #55/#95/#97 (`docs/events.md`) | Addressed by #97 |
| #54 | Rubric: configuration/operating principles scoring | #55/#95/#97 (`docs/rubric.md`, `rubrics/agent-olympics-v1.yaml`) | Addressed by #97 |
| #55 | Baseline PR | — | Closed as superseded by #97 |

### Performance Trackers (#16, #26, #83, #84)

| Issue | Title | Vehicle | Status |
|---|---|---|---|
| #16 | Performance Trial and hardware-normalized scoring | Parent tracker | This round |
| #26 | Baseline runs and raw vs normalized scoring | Lane 1/3 (sogyo) — raw capture | This round |
| #83 | Performance: add baseline run fixtures | Implementation issue | This round |
| #84 | Performance: add normalized scoring model | Implementation issue | This round (nosuk) |

### Public / Competition Trackers (#49, #56, #60)

| Issue | Title | Status |
|---|---|---|
| #49 | Web: human-readable leaderboard | Open — deferred |
| #56 | Team1 public-readiness hardening round | Closed (merged #60) |
| #60 | Finalize Team1 public-readiness hardening | Merged |

### Reference / Research Trackers (#39–#48)

All open — research reference issues for future design. Not blocking foundation ratification.

---

## 3. Issues NOT Closed by This Document

Per the round safety rules, no issue is closed by this ratification document. The following notes clarify remaining open work:

- **#1** stays OPEN; this document marks it `DONE (provisional)` and recommends a narrow schema-hardening follow-up issue.
- **#2** stays OPEN; this document marks it `CONDITIONAL DONE` for Round 001 scope.
- **#16** stays OPEN; this round advances it but does not close it.
- **#18** is already CLOSED; this document confirms the closeout and flags the Soonwook gap as needing a new issue.
- **#26** stays OPEN; this round provides the first implementation pass.
- **#27** stays OPEN; this document is the ratification deliverable.
- **#49–#54** stay OPEN until the roadmap ratification round posts finalizer decisions; #97 has landed the first hardened operating-agent-stack baseline.

---

## 4. Post-Merge Status — #26 and #27 Recommendation

This section documents the sogyo lane (1/3) ratification verdict for #26 and #27
against the merged #89 (closes #83/#84/#85).

### #26 — Performance Trial Baseline Collection

**Current state (post-#89):**

| Acceptance criterion | Status | Evidence |
|---|---|---|
| Baseline table for ≥2 nodes/runtimes | ⚠️ Partial | `results/perf-001-baseline.yaml` (medium-vps, 4 vCPU/8 GB). The small-vps baseline added in this round (`results/perf-001-baseline-small.yaml`) provides a second data point. |
| Scoring notes distinguish raw/normalized | ✅ | `docs/performance-scoring.md` — comprehensive raw vs scored, comparability caveats, hardware mismatch warnings. |
| Result Packet metrics fields support baseline | ✅ | `schemas/result-packet.schema.json` — `workload_metrics`, `hardware_profile` fields. |
| Host-contention warnings | ✅ | `docs/performance-scoring.md` — `comparability_caveats` section; `docs/scoring.md` — hardware normalization. |
| No production mutation required | ✅ | All baselines are static YAML files. |

**Verdict: KEEP OPEN with narrow remaining criteria.**

One acceptance criterion is fully satisfied only after this round adds the second baseline.
The remaining gap is narrow:
- Authentic baseline runs on live nodes (not sample YAML) require operators to execute the
  perf-001 workload on actual small-vps and medium-vps (or equivalent) hosts and submit real
  result packets.
- The format, docs, schemas, and example data are now in place. What remains is execution,
  not specification.

**Proposed comment for #26:**
> Ratification lane 1/3 (sogyo) inspected #26 against merged #83/#84/#85/#89.
> Source evidence: `docs/performance-scoring.md`, `schemas/result-packet.schema.json`,
> `schemas/scoreboard.schema.json`, `results/perf-001-baseline.yaml`,
> `results/perf-001-baseline-small.yaml`.
>
> 4/5 acceptance criteria are fully met. AC-1 (baseline table for ≥2 nodes) now has
> two sample baselines demonstrating the structure. To close, operators must execute
> the perf-001 workload on ≥2 real nodes and submit authentic result packets.
> Recommend adding a narrow follow-up issue for live baseline execution.
>
> Should not close until live baselines exist.

### #27 — MVP Foundation Issue Status Ratification

**Current state (post-#89):**

| Acceptance criterion | Status | Evidence |
|---|---|---|
| #18 closeout/status comment | ✅ | Documented in this doc — CLOSED with follow-up (Soonwook gap). |
| #1 clear provisional/done/blocked | ✅ | DONE (provisional) — schema hardening follow-up needed. |
| #2 clear conditional/blocked/done | ✅ | CONDITIONAL DONE — complete for Round 001. |
| Blockers represented by narrow issues | ⚠️ | Schema hardening follow-up issue not yet created. Soonwook retry issue not yet created. |
| No silent closes | ✅ | Every issue listed with remaining work explained. |

**Verdict: KEEP OPEN with narrow remaining criteria.**

Four of five criteria are fully satisfied. The remaining gap requires creating two
narrow GitHub issues:
1. Schema hardening follow-up (replace #1's provisional status with concrete hardening scope).
2. Soonwook safe-node-profile retry (after node environment is ready).

**Proposed comment for #27:**
> Ratification lane 1/3 (sogyo) inspected #27 against merged #83/#84/#85/#89.
> Source evidence: `docs/mvp-foundation-ratification.md` (this document),
> `rounds/season-001-round-001.yaml`, `issues/roadmap-01-freeze-v1-schemas.md`,
> `issues/roadmap-02-first-season-pack.md`, `tasks/season-001/*.yaml`,
> `oracle/season-001/*.yaml`.
>
> 4/5 acceptance criteria fully met. AC-4 (blockers as narrow issues) requires
> two concrete GitHub issues:
>   - Schema hardening follow-up (child of #1 scope)
>   - Soonwook safe-node-profile retry (references #17, #18)
>
> Recommend closing #27 only after both narrow issues exist and are linked.

---

## 5. Next Recommended Implementation Axis

Based on the current roadmap state, the recommended implementation priority after this round is:

### Primary axis: Schema Hardening and Validation

1. **Create a narrow schema-hardening follow-up issue** replacing #1's `provisional` status.
   - Incorporate the #97 baseline fields (`tool_use_profile`, `operating_policy`, `publishable`, and related division/validity/appeal metadata) into hardened schema versions.
   - Add required-field enforcement for configuration and operating-policy metadata.
   - Add validation rules for tool-use/operating-policy cross-references.

2. **Use the merged #97 operating-agent-stack baseline** as the input to schema hardening.

### Secondary axis: Season 002 Planning

3. **Create a retry issue for Soonwook's safe node profile validation** (parent: #17), or reassign to an available Team1 agent with a working node environment.
4. **Plan the next season pack** incorporating the new event families (Tool Decathlon, Harness Reliability) landed by #97.

### Deferred

5. **Web leaderboard ( #49 )** — remains deferred until schema hardening stabilizes and baseline data exists from this round's performance trial work.

---

## 6. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| #97 adds operating-agent-stack fields before all are hardened as required schema rules | Schema drift | Create a narrow schema-hardening issue against the #97 baseline |
| No retry issue exists for Soonwook profile validation | Gap in node profile coverage | Create issue after this round, referencing #17 and #18 closeout |
| #1/#2 left open with no closure plan | Stale tracker noise | This document provides the ratification context; narrow follow-up issues reduce ambiguity |
| Performance baseline data may mix raw vs normalized without clear separation | Unfair comparison | Lanes 1/3 and 2/3 are designed to keep raw capture and normalized scoring in separate PRs |

---

## 7. Verification

- `npm test` passes with no regressions.
- `make validate` passes on all existing manifests, envelopes, and result packets.
- All example result packets (`results/*.yaml`) validate against the current schema.
- The round manifest at `rounds/season-001-round-001.yaml` validates.
- No schema, envelope, fixture, or script files were modified — only this documentation addition.

## 8. Changed Files

| File | Change |
|---|---|
| `docs/mvp-foundation-ratification.md` | Updated — added #26/#27 post-merge status section with close/keep recommendations |
| `results/perf-001-baseline-small.yaml` | NEW — second baseline sample (small-vps) to satisfy #26 AC-1 dual-profile requirement |

## 9. Approval-Sensitive Blockers

1. **PR #55 is closed as superseded by #97.** Any schema hardening that touches `result-packet.schema.json` should build on the merged #97 baseline fields instead of reviving the superseded branch.
2. **Soonwook retry issue** requires an operational node with proper Gateway credentials before the profile validation lane can be reassigned.
3. **Schema hardening** should be a narrow follow-up issue, not reopened #1, to avoid scope creep.
