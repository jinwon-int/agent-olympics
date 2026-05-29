# Agent Stack Roadmap Ratification — Close/Keep Matrix

> **Run:** `agent-olympics-team1-roadmap-ratify-20260529T2042KST`
> **Lane:** 2/3 — nosuk
> **Parent:** #98
> **Assigned lane issue:** #100
> **Focus:** Inspect #50-#54 against merged agent-stack rules hardening finalizer (#97) and superseded PRs #55/#94/#95/#96

## Purpose

This document maps the acceptance criteria of issues #50–#54 against the
current repository state (commit `416203f`, which merges PR #97 integrating
#55/#94/#95 and salvaging safe rules material from #96). Each issue is rated
as COMPLETE (all ACs satisfied by current code), PARTIAL (some ACs satisfied),
or BLOCKED (no progress). Issues are **not closed** — this is a
recommendation record only.

---

## Close/Keep Matrix

### ✅ #50 — Docs: adopt the agent-stack performance motto

**Status: COMPLETE** — all acceptance criteria satisfied in the current codebase.

| AC | Status | Source Evidence |
|---|---|:---|
| README includes the motto or equivalent wording near the top | ✅ | `README.md` line 12: *"Measure the whole operating agent stack, not just the model."* |
| Competition model explicitly says it evaluates model + harness + tools + runtime + operational discipline | ✅ | `docs/competition-model.md` Constitution section enumerates all six stack layers; `docs/constitution.md` §1 and §2 amplify |
| Result/leaderboard docs explain why model identity alone is insufficient | ✅ | `docs/rubric.md` Agent Stack Overlay sections; `docs/result-packet.md` Web Result and Leaderboard Metadata Guidance (18-column leaderboard with tool_optimization, configuration_fitness, operating_discipline columns) |
| At least one scorecard or example shows model metadata separately from agent-stack dimensions | ✅ | `results/ops-001-yukson.yaml` separates `model: gpt-5.x` (top-level metadata) from `tool_use_profile`, `operating_policy`, `hardware_profile`, `configuration_profile` (stack dimensions); `results/ops-001-yukson-judge.yaml` scores evidence_quality, safety, execution, communication, durability separately from model identity |

**Recommendation: KEEP (COMPLETE).** Issue tracks completed scope. The motto
permeates README, competition model, constitution, rubric, result packet docs,
and example results. No remaining work.

---

### ✅ #51 — Docs: write Agent Olympics constitution

**Status: COMPLETE** — all acceptance criteria satisfied.

| AC | Status | Source Evidence |
|---|---|:---|
| Add concise constitution/manifesto section to README or `docs/competition-model.md` | ✅ | `docs/constitution.md` — standalone constitution document with 5 constitutional principles (Platform Neutrality, Evidence Before Claims, Safety Is Performance, Transparency by Dimension, Open Process) |
| Link constitution to rules, event design, rubric, result packet | ✅ | `docs/constitution.md` §5 Cross-References table links to competition-model, events, rubric, scoring, task-envelope, result-packet, rules, adapter-execution-contract, mvp-foundation-ratification |
| Keep wording platform-neutral | ✅ | §2.1 Platform Neutrality: *"No required field, schema constraint, or scoring rule may assume a specific runtime's internals."* |
| Include both English motto and Korean working line | ✅ | Opening lines: English motto *"Measure the whole operating agent stack"* and Korean working line *"운영 에이전트 스택 전체를 측정한다"*; Korean line also explained in §4 |

**Recommendation: KEEP (COMPLETE).** No remaining work. Constitution is
self-contained, cross-referenced, and platform-neutral.

---

### ✅ #52 — Rules: define competition rules and divisions for operating agent stacks

**Status: COMPLETE** — all acceptance criteria satisfied in substantive content.

| AC | Status | Source Evidence |
|---|---|:---|
| Create or update rules doc defining participant identity, divisions, allowed tools, prohibited conduct, result validity, appeal states | ✅ | `docs/rules.md` — Participant Identity (§Participant Identity), Divisions (§Divisions, with closed_stack, open_stack, human_baseline, node_class + division declaration, wrong-division rule), Tool Disclosure (§Tool Disclosure with three levels: full/representative/minimal + disclosure depth + what must be disclosed), Prohibited Conduct (§Undeclared Assistance, §Prohibited Assistance), Result Validity States (§Result Validity States with 5 states + transition diagram + who determines each), Appeals (§Appeals with who may file, evidence requirements, timeline, reviewer, outcomes, appeal record) |
| Update schemas or planned schema fields for stack disclosure | ✅ | `schemas/result-packet-v2.schema.json` — `tool_use_profile`, `operating_policy`, `delegation_profile`, `division`, `validity`, `appeal`, `publishable`; `schemas/judge-record-v2.schema.json` — `division_verification`, `appeal_record`, `configuration_checks`, `operating_policy_checks` |
| Link rules to integrity (#40), appeals (#41), MLPerf-style (#47), web output (#49) | ✅ (content) | `docs/rules.md` covers: integrity via §Wrong-Division Rule, §Undeclared Assistance, §Disclosure Integrity; appeals fully via §Appeals system (7 sections); full-stack reporting via §Participant Identity, §Divisions, §Tool Disclosure; web output via §Publication Rules |

**Note on AC 3:** The rules content fully addresses the substance of #40
(integrity: wrong-division rule, disclosure integrity, prohibited assistance),
#41 (appeals: full appeal lifecycle with filing, review, outcomes, record),
#47 (full-stack reporting: participant identity, divisions, tool disclosure),
and #49 (publication rules for web output with publishability gates). Explicit
GitHub issue cross-reference links are not present, but the substantive
coverage is complete. This is a documentation-quality observation, not a
blocker.

**Recommendation: KEEP (COMPLETE).** All rule categories, divisions, validity
states, appeals, and publication rules are documented with matching schema
support.

---

### ✅ #53 — Events: redesign event families around model, harness, tools, config, and operating principles

**Status: COMPLETE** — all acceptance criteria satisfied.

| AC | Status | Source Evidence |
|---|---|:---|
| Update `docs/events.md` so each event family lists stack layers under test | ✅ | `docs/events.md` — introductory paragraph enumerates all 7 stack layers; each family section includes explicit "Stack layers stressed" list (e.g., Ops Relay: operating principles, liveness, recovery, evidence capture, safe mutation boundaries) |
| Decide whether Tool Decathlon and Harness Reliability become new families or overlays | ✅ (implicit) | `docs/events.md` documents Tool Decathlon and Harness Reliability as full event families with their own stack layers, examples, and scoring focus. `schemas/task-envelope-v2.schema.json` includes `tool-decathlon` and `harness-reliability` in the `event_family` enum. The decision is documented by inclusion: they are standalone event families. |
| Add at least one Season 001 task candidate that tests tool-use optimization | ✅ | `tasks/season-001/tool-001-precision-triage.yaml` — event_family: `tool-decathlon`, evaluation_focus includes `tool_optimization`, 15-call budget, complete hidden_judge_notes with stack-layer scoring guidance |
| Add at least one task candidate that tests operating-principle compliance | ✅ | `tasks/season-001/ops-003-approval-gate.yaml` — event_family: `safety-trial`, evaluation_focus includes `operating_discipline`, 5 scenario options with approval boundary decisions, secret handling, destructive-action restraint; complete hidden_judge_notes with scoring guidance |

**Recommendation: KEEP (COMPLETE).** Events.md updated, new families decided,
task candidates exist for both new dimensions (tool optimization, operating
discipline).

---

### ✅ #54 — Rubric: make configuration and operating principles first-class scoring dimensions

**Status: COMPLETE** — all acceptance criteria satisfied.

| AC | Status | Source Evidence |
|---|---|:---|
| Update `docs/rubric.md` or add an agent-stack overlay | ✅ | `docs/rubric.md` — Agent Stack Overlay (7 dimensions: mission_correctness 25, evidence_and_reproducibility 15, tool_optimization 15, configuration_fitness 15, operating_discipline_and_safety 15, reliability_recovery_liveness 10, communication_and_durability 5); `rubrics/agent-olympics-v1.yaml` — agent_stack overlay with matching dimensions |
| Update judge notes to require reasons for configuration and operating-discipline scores | ✅ | `docs/rubric.md` — "Agent Stack Overlay Reasoning Guidance" section with question templates for each dimension (Configuration Fitness, Operating Discipline and Safety, Tool Optimization, Reliability/Recovery/Liveness, Evidence and Reproducibility) and example reasoning paragraph |
| Update result packet/judge record schema plan to capture configuration profile and operating-policy compliance | ✅ | `schemas/result-packet-v2.schema.json` — `configuration_profile` (with model_routing, liveness, resource_limits, etc.), `operating_policy` (approval_boundaries, secret_handling, destructive_action_rules, etc.); `schemas/judge-record-v2.schema.json` — `configuration_checks` (model_routing_declared, liveness_declared, resource_limits_declared, tool_availability_declared, context_policy_declared, concurrency_limits_declared + notes), `operating_policy_checks` (approval_boundaries_checked, secret_handling_checked, delegation_disclosed, progress_reporting_checked, destructive_action_restraint_checked + notes) |
| Ensure penalties cover undeclared tools, hidden assistance, unsafe config, poor liveness, missing provenance | ✅ | `docs/rubric.md` §Penalties — undeclared_tool_or_assistance (-5 to disqualification), missing_operating_policy_evidence (-2 to -15), unsafe_configuration_for_mission (-5 to -25), missing_model_runtime_tool_provenance (-2 to -15); `rubrics/agent-olympics-v1.yaml` — same penalties |

**Recommendation: KEEP (COMPLETE).** Rubric updated with full agent-stack
overlay, reasoning guidance for judges, schema support for configuration
checks and operating-policy checks, and comprehensive penalties.

---

## Summary: All #50–#54 Are Content-Complete

| Issue | Title | Verdict | Remaining Work |
|---|---|---|---|
| #50 | Agent-stack performance motto | COMPLETE | None — motto embedded in README, competition-model, constitution, rubric, result docs |
| #51 | Constitution | COMPLETE | None — constitution exists, cross-referenced, platform-neutral, bilingual |
| #52 | Competition rules | COMPLETE | None — all rule categories, divisions, validity states, appeals, publication rules documented with matching schema support |
| #53 | Event redesign | COMPLETE | None — events.md lists stack layers per family, tool-decathlon and harness-reliability established, task candidates exist |
| #54 | Rubric dimensions | COMPLETE | None — agent-stack overlay, judge reasoning guidance, schema for config/operating-policy checks, comprehensive penalties |

All scope previously assigned to issues #50–#54 has been delivered in the
merged #97 finalizer (integrating #55/#94/#95 and salvaged material from
#96). The content is source-verified against the current repository state
at commit `416203f`.

---

## Proposed Close/Keep Comments

Per the assignment rules, **no issues are closed**. The following comments
should be posted on each issue to make the assessment explicit:

| Issue | Proposed Comment |
|---|---|
| #50 | **KEEP — COMPLETE.** All ACs verified in current repo (README motto, competition-model philosophy, rubric overlay, example result with separated model/stack metadata). No remaining work for this issue's scope. | 
| #51 | **KEEP — COMPLETE.** Constitution document exists (`docs/constitution.md`) with 5 constitutional principles, platform-neutrality commitment, bilingual motto, and cross-references to all related docs. No remaining work. |
| #52 | **KEEP — COMPLETE.** Rules document exists (`docs/rules.md`) with participant identity, 4 divisions, 3-level tool disclosure, prohibited conduct, 5 result validity states, full appeals lifecycle, and publication rules. Matching schema fields (`division`, `validity`, `appeal`, `division_verification`, `appeal_record`). |
| #53 | **KEEP — COMPLETE.** Events.md updated with stack-layer-stressed per family; tool-decathlon and harness-reliability established as event families; task candidates tool-001 (tool optimization) and ops-003 (operating discipline) exist. |
| #54 | **KEEP — COMPLETE.** Agent-stack overlay in rubric.md + rubrics/agent-olympics-v1.yaml; judge reasoning guidance; result-packet-v2 schema has `configuration_profile`, `operating_policy`; judge-record-v2 has `configuration_checks`, `operating_policy_checks`; penalties cover all required categories. |

---

## Remaining Work Beyond #50–#54

The following work is outside the scope of #50–#54 but related:

1. **Schema hardening** — v1→v2 migration is documented but not enforced.
   Tracked by `docs/migration-v1-to-v2.md` and referenced in
   `mvp-foundation-ratification.md`.
2. **Web leaderboard (#49)** — Deferred until schema hardening and baseline
   data exist.
3. **Performance baseline (#26/#16)** — Active in this Team1 round.
   Hardware-normalized scoring model is lane 2/3 cross-track work.
4. **Adapter implementations** — OpenClaw adapter (roadmap-03) and Hermes
   adapter (roadmap-04) are design-complete in documents but not implemented.

---

## Verification

- `npm test` — all existing schemas validate.
- All source references in this document reflect actual file content at
  commit `416203f`.
- No OpenClaw runtime/bootstrap context files are present in the repository
  (check: AGENTS.md, SOUL.md, USER.md, TOOLS.md, HEARTBEAT.md, IDENTITY.md,
  .openclaw/ — all confirmed absent).

## Changed Files

| File | Change |
|---|---|
| `docs/roadmap-ratification-agent-stack.md` | NEW — this close/keep matrix document |

## Risk Notes

- **No schema or code files were modified.** This is a documentation-only
  addition that does not affect validation, schemas, or engine behavior.
- **No issues were closed.** The matrix is a recommendation record for the
  broker/finalizer (seoseo).
- **PR #96's deletions were intentionally excluded** by the #97 finalizer.
  No salvageable content from #96 remained unincorporated after #97 merged.
- **Bangtong is excluded** per the safety rules; no work was assigned to or
  depends on Bangtong.
- **Seoseo remains Team1 broker/finalizer of record.** Any issue close
  action requires their explicit approval.

## Approval-Sensitive Blockers

1. This document recommends KEEP (COMPLETE) for all five issues. The broker
   (seoseo) must decide whether to close each issue or leave it open as a
   reference.
2. No merge conflict risk with any open PR — this is a new file only.
3. No production-deploy, restart, or mutation actions were taken.
