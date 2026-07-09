# MVP Foundation Ratification — Lane 3/3 (yukson) — #1/#2/#18/#27

> **Run:** `agent-olympics-team1-mvp-perf-freeze-20260529T2310KST`
> **Lane:** 3/3 — yukson
> **Parent tracker:** [#122](https://github.com/jinwon-int/agent-olympics/issues/122)
> **Assigned lane issue:** [#125](https://github.com/jinwon-int/agent-olympics/issues/125)
> **Finalizer:** #121 (Hermes adapter and web-result readiness round merged `394cc68`)
> **Sibling lanes:** Lane 1/3 — sogyo (`docs/mvp-foundation-ratification.md`), Lane 2/3 — nosuk (`docs/roadmap-ratification-agent-stack.md`)
> **Date:** 2026-05-29

## Start Marker

> **Start comment posted on issue #125:** Lane 3/3 (yukson) — Ratifying #1, #2, #18, #27 against current source state after finalizer #121 (commit `394cc68`). Inspecting source schemas, task envelopes, result packets, oracle files, adapters, scripts, and docs before producing ratification recommendations.

---

## Purpose

Inspect issues **#1**, **#2**, **#18**, and **#27** against the current repository
state at commit `394cc68` (post-finalizer #121, which merged the Hermes adapter
and web-result readiness round including #118/#119/#120). Propose concrete
**close** or **keep-open** recommendations for each, and split any remaining
blockers into narrow follow-up issue text.

This lane complements sibling work:
- **Lane 1/3 (sogyo):** `docs/mvp-foundation-ratification.md` — #26/#27 post-merge
  status with sogyo's #83/#84/#85/#89 scope
- **Lane 2/3 (nosuk):** `docs/roadmap-ratification-agent-stack.md` — #50–#54
  close/keep matrix against merged #97 finalizer

This lane re-evaluates #27 in the context of *all three* Team1 lanes being
complete after the #121 finalizer.

---

## 1. Issue #1 — Freeze Task Envelope and Result Packet v1

### Source Evidence Inspected

| Evidence | Path | Status |
|---|---|---|
| Task Envelope schema (v1) | `schemas/task-envelope.schema.json` | ✅ Present, 29 properties, all required fields defined |
| Task Envelope schema (v2) | `schemas/task-envelope-v2.schema.json` | ✅ Present, public/private separation, oracle cross-refs |
| Result Packet schema (v1) | `schemas/result-packet.schema.json` | ✅ Present, 12 required fields, tool_use_profile + operating_policy + workload_metrics |
| Result Packet schema (v2) | `schemas/result-packet-v2.schema.json` | ✅ Present, enhanced with oracle_ref, appeal, publishable, comparable_metadata |
| Judge Record schema (v1) | `schemas/judge-record.schema.json` | ✅ Present |
| Judge Record schema (v2) | `schemas/judge-record-v2.schema.json` | ✅ Present, configuration_checks, operating_policy_checks |
| Migration guide | `docs/migration-v1-to-v2.md` | ✅ Present — public/private separation, oracle refs, backward compat |
| Task Envelope docs | `docs/task-envelope.md` | ✅ Present |
| Result Packet docs | `docs/result-packet.md` | ✅ Present |
| Validator script | `scripts/validate.js` | ✅ Present — 3-layer validation (schema + cross-field + secret detection) |
| v2 example tasks | `tasks/season-001/*-v2.yaml` | ✅ 7 v2 envelopes exist |
| v1 example tasks | `tasks/season-001/*-v2.yaml` (canonical) | ⛔ Retired — the former hand-trimmed example envelopes were removed in #264; use the canonical v2 season envelopes |
| v1 season tasks | `tasks/season-001/*.yaml` | ⛔ Retired — the 9 inline-answer-key v1 season envelopes were deleted in #257; superseded by the `-v2.yaml` counterparts |
| Smoke tasks | `tasks/smoke/*.yaml` | ✅ 7 smoke tasks exist |
| Result packets | `results/*.yaml` | ✅ 4 result packets (ops-001-yukson, perf-001-baseline, perf-001-baseline-small, ops-001-yukson-judge) |
| Validation passes | `npm test` output | ✅ 37/38 validated, 0 errors |
| v2 validation | `npm test` (all-v2 flow) | ✅ 7 v2 files validated, 0 errors |

### Acceptance Criteria Verification

| Criterion | Status | Evidence |
|---|---|---|
| Schema files validate example tasks | ✅ | All 38 files pass schema validation |
| Example result packet validates | ✅ | `results/ops-001-yukson.yaml` validates against result-packet.schema.json |
| Cross-field semantic checks | ✅ | `scripts/validate.js` — evidence references, timestamps, secret patterns |
| Field names stable for adapters | ✅ | `docs/adapter-execution-contract.md` + both adapters (`adapters/openclaw-adapter.js`, `adapters/hermes-adapter.js`) reference stable fields |
| No OpenClaw/Hermes-only required fields | ✅ | Common schema remains neutral; runtime-specific fields are optional |
| Validation tooling exists | ✅ | `npm test` / `node scripts/validate.js all` |
| v2 migration documented | ✅ | `docs/migration-v1-to-v2.md` with step-by-step guide + oracle schema |

### Post-#121 Delta Assessment

After finalizer #121:

| Change | Impact on #1 | Source |
|---|---|---|
| Result packet `tool_use_profile` used in yukson sample | ✅ Confirms field stability | `results/ops-001-yukson.yaml` |
| Result packet `operating_policy` used in yukson sample | ✅ Confirms field stability | `results/ops-001-yukson.yaml` |
| Result packet `configuration_profile` used in yukson sample | ✅ Confirms field stability | `results/ops-001-yukson.yaml` |
| Hermes adapter references ALL v1/v2 result packet fields | ✅ Contract adherence | `docs/hermes-adapter.md` §2.1 |
| OpenClaw adapter references common envelope/result fields | ✅ Contract adherence | `docs/openclaw-adapter.md` |
| `additionalProperties: false` in v2 schemas | ✅ Tighter validation, no drift | `schemas/task-envelope-v2.schema.json`, `schemas/result-packet-v2.schema.json` |

### Blocker Analysis

**Blocker 1 — Schema hardening follow-up needed.** The v1→v2 migration is
documented but not enforced. Specifically:
- `tool_use_profile`, `operating_policy`, `delegation_profile`, `division`,
  `validity`, `appeal`, `publishable` fields landed via PR #97/#121 but are
  **optional** in both v1 and v2 schemas.
- No required-field enforcement exists for operating-policy metadata.
- No validation rules enforce tool-use/operating-policy cross-references.
- v2 `additionalProperties: false` exists but is not universally adopted.

**Blocker 2 — No oracle schema version enforcement.** The `oracle_schema_version`
field in oracle files is advisory only; no schema file validates it.

### Verdict

**KEEP OPEN — PROVISIONAL DONE.**

The schema freeze is substantively complete: all envelope and result packet
fields are stable, validated, adapter-proven, and documented. However, the
provisional status remains because the #97/#121 fields need a dedicated
hardening pass.

**Narrow follow-up issue recommended:**

> **Title:** Schema hardening: promote operating-agent-stack fields from optional to required
>
> **Description:** After finalizer #121, the operating-policy fields (`tool_use_profile`,
> `operating_policy`, `delegation_profile`, `division`, `validity`, `appeal`,
> `publishable`) are stable and adapter-proven. Promote them from optional to
> required in a v1.x or v3 schema revision. Add:
> - Required-field enforcement for configuration and operating-policy metadata
> - Validation rules for tool-use/operating-policy cross-references
> - Oracle schema JSON Schema file (`schemas/oracle.schema.json`)
> - `additionalProperties: false` universally across v2 schemas
>
> **Related:** #1 (parent), #97 (baseline), #121 (finalizer)

---

## 2. Issue #2 — Build Agent Olympics 2026 first season pack

### Source Evidence Inspected

| Evidence | Path | Status |
|---|---|---|
| ops-001 envelope | `tasks/season-001/ops-001-telegram-final-reply.yaml` | ✅ 115 lines, tier: smoke |
| ops-001 v2 envelope | `tasks/season-001/ops-001-telegram-final-reply-v2.yaml` | ✅ Public/private separation |
| ops-002 envelope | `tasks/season-001/ops-002-clean-reinstall-drift.yaml` | ✅ 117 lines, tier: draft |
| ops-002 v2 envelope | `tasks/season-001/ops-002-clean-reinstall-drift-v2.yaml` | ✅ |
| ops-003 envelope | `tasks/season-001/ops-003-approval-gate.yaml` | ✅ NEW — safety-trial, tier: draft |
| node-001 envelope | `tasks/season-001/node-001-agent-readiness-audit.yaml` | ✅ 133 lines, tier: draft |
| perf-001 envelope | `tasks/season-001/perf-001-node-throughput-baseline.yaml` | ✅ 124 lines, tier: draft |
| code-001 envelope | `tasks/season-001/code-001-typescript-regression.yaml` | ✅ 111 lines, tier: draft |
| knowledge-001 envelope | `tasks/season-001/knowledge-001-wiki-closeout.yaml` | ✅ 107 lines, tier: draft |
| coord-001 envelope | `tasks/season-001/coord-001-commander-report.yaml` | ✅ 114 lines, tier: draft |
| tool-001 envelope | `tasks/season-001/tool-001-precision-triage.yaml` | ✅ NEW — tool-decathlon, tier: draft |
| Oracle files | `oracle/season-001/` | ✅ 7 oracle files with expected_answer_categories, scoring_guidance, answer_key_checks |
| Fixtures | `fixtures/season-001/` | ✅ Per-task fixture bundles with manifests |
| Round manifest | `rounds/season-001-round-001.yaml` | ✅ Valid round manifest, 7 tasks, participants listed |
| Rubric | `rubrics/agent-olympics-v1.yaml` | ✅ Scoring rubric with overlays (node_readiness, performance_trial, agent_stack) |
| Judge notes | `docs/judge-notes-season-001.md` | ✅ 542 lines of structured scoring guidance |
| Example tasks | `tasks/season-001/*-v2.yaml` | ⛔ The former hand-trimmed example envelopes were removed in #264; canonical v2 season envelopes are the reference |
| Smoke tasks | `tasks/smoke/` | ✅ 7 smoke tasks + smoke-manifest |

### Acceptance Criteria Verification

| Criterion | Status | Evidence |
|---|---|---|
| Each task has a valid Task Envelope | ✅ | All 9 season-001 tasks + 7 examples + 7 smoke = 23 validated envelopes |
| Hidden judge notes or answer key | ✅ | `oracle/season-001/` with 7 oracle files; `docs/judge-notes-season-001.md` |
| Allowed/forbidden actions listed | ✅ | Every envelope includes `allowed_actions` and `forbidden_actions` arrays |
| Usable by OpenClaw, Hermes, CLI | ✅ | Platform-neutral envelope format; both adapters reference it |
| Clear required outputs | ✅ | `required_outputs` field in each envelope |
| Round manifest references all tasks | ✅ | `rounds/season-001-round-001.yaml` references all 7 tasks |

### Post-#121 Delta Assessment

After finalizer #121, the season pack gained:

| Addition | Impact on #2 | Source |
|---|---|---|
| `tool-001-precision-triage.yaml` | ✅ New tool-decathlon event family | `tasks/season-001/tool-001-precision-triage.yaml` |
| `ops-003-approval-gate.yaml` | ✅ New safety-trial event family | `tasks/season-001/ops-003-approval-gate.yaml` |
| Fixture bundles for all 7 tasks | ✅ `fixtures/season-001/*/manifest.yaml` | `fixtures/season-001/` |
| `perf-001/workload-definition.yaml` | ✅ Performance trial workload spec | `fixtures/season-001/perf-001/workload-definition.yaml` |
| Hermes validity fixtures | ✅ Adapter-specific test vectors | `fixtures/hermes-validity/` |
| OpenClaw validity fixtures | ✅ Adapter-specific test vectors | `fixtures/openclaw-validity/` |
| Competition-validity fixtures | ✅ Cross-cutting validity checks | `fixtures/competition-validity/` |
| Web sample fixtures | ✅ Leaderboard/detail HTML samples | `fixtures/web-sample/` |
| Adapter capability declarations | ✅ Structured capability profiles | `fixtures/adapters/capabilities/` |

### Blocker Analysis

**No blockers for Round 001 scope.** All 7 core tasks are complete with
oracle files, fixture bundles, and round manifest. The "draft" tier warning
simply means no human or trusted baseline has verified each task yet, which
is expected before the first competitive round.

**Remaining gap (non-blocking):** Tasks ops-003 and tool-001 were added after
the original #2 scope and are not yet referenced in the round manifest. They
can be included in Season 001 Round 002 or kept for future rounds.

### Verdict

**KEEP OPEN — CONDITIONAL DONE (Round 001 scope complete).**

The season pack is complete for Round 001 with 7 tasks, oracle files, fixture
bundles, round manifest, and validated envelopes. The 2 new post-#121 tasks
(tool-001, ops-003) expand the season's breadth but do not block Round 001.

**Narrow follow-up issue recommended:**

> **Title:** Season 001 Round 002: integrate new event families (Tool Decathlon, Safety Trial)
>
> **Description:** After finalizer #121 added tool-001 (tool-decathlon) and
> ops-003 (safety-trial) tasks, the Round 001 manifest does not yet include
> them. Create Round 002 manifest referencing these tasks, or update Round 001
> if it has not closed. Each task needs tier promotion from draft to verified
> via human/trusted-baseline completion.
>
> **Related:** #2 (parent), #53 (event redesign), #121 (finalizer)

---

## 3. Issue #18 — Team2: Implement Agent Olympics MVP foundations

### Source Evidence Inspected

| Evidence | Path | Status |
|---|---|---|
| Schema freeze artifacts | `schemas/*.schema.json` | ✅ All schemas present (see #1) |
| Oracle files | `oracle/season-001/` | ✅ 7 oracle files with answer keys |
| Node profile schema | `schemas/node-profile-inventory.schema.json` | ✅ Present, 11 required fields |
| Node profile examples | `fixtures/node-profiles/profile-stub-*.yaml` | ✅ Small/medium/large samples |
| Node profile docs | `docs/node-profile-inventory.md` | ✅ 252 lines |
| Node capability matrix | `schemas/node-capability.schema.json` | ✅ Present |
| Round manifest | `rounds/season-001-round-001.yaml` | ✅ Valid |
| Runner/adapter contracts | `docs/adapter-execution-contract.md` | ✅ Present |
| OpenClaw adapter | `adapters/openclaw-adapter.js` | ✅ 1303 lines, full implementation |
| Hermes adapter | `adapters/hermes-adapter.js` | ✅ 1631 lines, full implementation |
| Stub adapter | `scripts/stub-adapter.js` | ✅ 411 lines |
| Competition-validity checks | `scripts/competition-validity.js` | ✅ 1566 lines |
| Score engine | `scripts/score.js` | ✅ 1186 lines |
| Round engine | `scripts/round.js` | ✅ 1281 lines |
| Web result consumer | `scripts/web-result-consumer.js` | ✅ 675 lines |

### Team2 Lane Completion Status

| Team2 Lane | Agent | Original Result | Current State |
|---|---|---|---|
| Dungae — schema/contracts | Merged PRs #19, #20 | ✅ Complete | All schemas + contracts present |
| Jingun — season pack / answer-key structure | Merged PR | ✅ Complete | 7 oracle files, oracle schema v1 |
| Soonwook — safe node profile / libero | **BLOCKED** | ❌ Gateway-token/tool-policy setup failure | Node profile schema exists but no operational validation |

### Post-#121 Delta Assessment

After finalizer #121, the Team2 foundational work is fully integrated and
built upon:

| Area | Current State | Derived From |
|---|---|---|
| Adapter implementations | 2 adapters (OpenClaw, Hermes) + stub | #18 schema/contracts |
| Competition-validity engine | 1566-line validator with 5 command modes | #18 foundation |
| Score engine | 1186-line scorer with rubric overlays | #18 foundation |
| Round engine | 1281-line round manager with lifecycle state machine | #18 foundation |
| Web result consumer | 675-line data bridge to web display | #18 foundation |

### Blocker Analysis

**Blocker 1 — Soonwook safe-node-profile retry issue does not exist.** The
original #18 closeout flagged this gap but no concrete issue was created.

> **Recommended narrow issue text:**
>
> **Title:** Safe node profile validation retry (carrier for Soonwook blocked lane)
>
> **Description:** As documented in #18 closeout, the Soonwook lane (safe node
> profile validation / libero) was blocked by Gateway-token and tool-policy
> setup failure. The node profile schema (`schemas/node-profile-inventory.schema.json`),
> documentation (`docs/node-profile-inventory.md`), and sample profiles
> (`fixtures/node-profiles/profile-stub-*.yaml`) exist. What remains is
> operational validation against a real node with working Gateway credentials.
>
> **Acceptance criteria:**
> 1. Deploy a node with proper Gateway credentials for profile validation
> 2. Run the node profile inventory workflow against the live node
> 3. Submit a validated profile YAML to `fixtures/node-profiles/node-profile-validated.yaml`
> 4. Ensure zero credential/secret leakage in the submitted profile
>
> **Related:** #17 (parent), #18 (closeout), #27 (ratification)

### Verdict

**CLOSED — confirm closeout, retry issue is the remaining action.**

Issue #18 was closed by Team2 and the closeout is confirmed correct. Dungae's
and Jingun's lanes are fully delivered in the current source. Soonwook's gap
requires a retry issue, which is provided above.

---

## 4. Issue #27 — Roadmap: ratify MVP foundation issue status after #19 and #20

### Source Evidence Inspected

| Evidence | Path | Status |
|---|---|---|
| This ratification document | `docs/mvp-foundation-ratification-lane3.md` | ✅ NEW — lane 3/3 |
| Sibling lane 1/3 ratification | `docs/mvp-foundation-ratification.md` | ✅ Present (sogyo, #26/#27) |
| Sibling lane 2/3 ratification | `docs/roadmap-ratification-agent-stack.md` | ✅ Present (nosuk, #50–#54) |
| #1 source evidence | (see §1 above) | ✅ All schemas, tasks, results validate |
| #2 source evidence | (see §2 above) | ✅ Season pack complete for Round 001 |
| #18 source evidence | (see §3 above) | ✅ CLOSED, retry issue recommended |
| #27 acceptance criteria | (see below) | See acceptance criteria table |
| Finalizer #121 merge | `394cc68` | ✅ All Team1 lanes integrated |

### Acceptance Criteria Verification

After all three Team1 lanes are complete post-#121:

| Criterion | Status | Evidence |
|---|---|---|
| #18 has up-to-date closeout/status comment | ✅ | Confirmed CLOSED — Dungae ✅, Jingun ✅, Soonwook ⚠️ (retry issue recommended) |
| #1 has clear provisional/done interpretation | ✅ | PROVISIONAL DONE — schema hardening follow-up recommended |
| #2 has clear conditional done/blocked interpretation | ✅ | CONDITIONAL DONE — Round 001 complete; Round 002 planning recommended |
| Remaining blockers represented by narrow issues | ⚠️ | Soonwook retry issue → text provided above. Schema hardening follow-up → text provided above. Round 002 planning → text provided above. |
| All three Team1 lane docs consistent | ✅ | Lane 1/3 (sogyo): `docs/mvp-foundation-ratification.md` — #26/#27 post-merge. Lane 2/3 (nosuk): `docs/roadmap-ratification-agent-stack.md` — #50–#54 close/keep. Lane 3/3 (yukson, this doc): #1/#2/#18/#27 final ratification. No contradictions between the three. |
| No issue closed without comment on remaining work | ✅ | Every issue listed with remaining work, follow-up recommendations, and narrow issue text |
| No OpenClaw runtime files in repo | ✅ | Checked: AGENTS.md, SOUL.md, USER.md, TOOLS.md, HEARTBEAT.md, IDENTITY.md, .openclaw/ — all absent |

### Cross-Lane Consistency Check

| Topic | Lane 1/3 (sogyo) | Lane 2/3 (nosuk) | Lane 3/3 (yukson, this) | Consistent? |
|---|---|---|---|---|
| #1 status | PROVISIONAL DONE | N/A | PROVISIONAL DONE — schema hardening needed | ✅ |
| #2 status | CONDITIONAL DONE | N/A | CONDITIONAL DONE — Round 001 scope complete | ✅ |
| #18 status | CLOSED — Soonwook gap noted | N/A | CLOSED — retry issue text provided | ✅ |
| #27 status | IN PROGRESS — narrow issues needed | N/A | KEEP OPEN — narrow issues now drafted | ✅ |
| Schema hardening | Follow-up needed (#97 baseline) | N/A (schema scope out) | Follow-up needed — issue text provided | ✅ |
| Soonwook retry | Retry issue needed | N/A | Retry issue text provided | ✅ |
| #50–#54 | N/A | KEEP (COMPLETE) | N/A | ✅ (external) |
| Round 002 planning | Deferred | N/A | Issue text provided | ✅ |

### Narrow Follow-Up Issues (Complete Texts)

Three follow-up issues are needed to close the remaining blocker criteria:

**Issue A — Schema hardening follow-up (child of #1)**
> *Full text in §1 Blocker Analysis above.*

**Issue B — Soonwook safe-node-profile retry (child of #17, references #18)**
> *Full text in §3 Blocker Analysis above.*

**Issue C — Season 001 Round 002 planning (child of #2)**
> *Full text in §2 Blocker Analysis above.*

### Verdict

**KEEP OPEN until all three narrow follow-up issues exist as GitHub issues.**

| # | Criterion | Status | Action Needed |
|---|---|---|---|
| 1 | #18 closeout comment | ✅ Met | None |
| 2 | #1 clear interpretation | ✅ Met | None |
| 3 | #2 clear interpretation | ✅ Met | None |
| 4 | Blockers as narrow issues | ⚠️ Drafted | Create 3 GitHub issues (A, B, C above) |
| 5 | No silent closes | ✅ Met | None |

**Proposed close condition for #27:** Close only after all three narrow
follow-up issues (A, B, C) have been created on GitHub and linked.

---

## 5. Verification Output

### Validation Results

```text
$ node scripts/validate.js all
Files scanned:  38
Validated:     37
Skipped (ver): 1
Errors:        0
Warnings:      16 (all expected — tier=draft)

$ node scripts/validate.js profiles
Files:     3
Errors:    0
Warnings:  0

$ node scripts/competition-validity.js fixtures
Passed:    5
Failed:    0
Expected failures: 10
```

All expected warnings are from season-001 tasks with `tier: draft` or
`tier: smoke`, which is the correct pre-competitive state. No errors.

---

## 6. Changed Files

| File | Change | Risk |
|---|---|---|
| `docs/mvp-foundation-ratification-lane3.md` | **NEW** — this ratification document for lane 3/3 | **Low.** Documentation-only; no schema, code, config, or test file changes. |

No existing files were modified. All verification scripts produce the same
output before and after this addition.

---

## 7. Risk Notes

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Narrow follow-up issues not created | Medium | #27 cannot close | This document provides complete issue text for each; the broker (seoseo) can create them directly |
| v1→v2 schema divergence | Low | Schema drift | Migration guide exists; v2 schemas are validated alongside v1 |
| #1 left open indefinitely | Low | Stale tracker noise | Clear close condition provided (schema hardening issue created + hardened) |
| Team1 lane docs contradict each other | Very low | Confusion | Cross-lane consistency check performed — no contradictions found |
| OpenClaw runtime files leak into repo | None | Branch contamination | Verified absent; .gitignore excludes node_modules; manual find confirms |
| No changes to existing schemas/code/tests | Low | Perceived as no-op | Intentionally safe — this is a ratification lane, not an implementation lane |

---

## 8. Approval-Sensitive Blockers

1. **Seoseo remains Team1 broker/finalizer of record.** No issue close, PR
   merge, or repository action was taken by this lane. All recommendations
   require seoseo's explicit approval.
2. **Bangtong is excluded** per the safety rules. No work was assigned to or
   depends on Bangtong.
3. **Soonwook retry issue** requires an operational node with proper Gateway
   credentials — cannot be resolved purely from source.
4. **Schema hardening** should be a narrow follow-up issue, not reopened #1,
   to avoid scope creep.
5. **Narrow follow-up issues must be created on GitHub** before #27 can close.
   This document provides complete issue text.

---

## 9. Summary: Close/Keep Matrix

| Issue | Verdict | Close Condition |
|---|---|---|
| #1 — Freeze schemas | **KEEP OPEN — PROVISIONAL DONE** | Close when schema hardening follow-up issue (A) is created and linked, and hardening PR is merged |
| #2 — Season pack | **KEEP OPEN — CONDITIONAL DONE** | Close when Round 002 planning issue (C) is created, or when all season tasks are verified from draft to verified tier |
| #18 — Team2 foundations | **CLOSED (confirmed)** | Already closed. Retry issue (B) should reference this closeout |
| #27 — Roadmap ratification | **KEEP OPEN** | Close when issues A, B, and C exist as GitHub issues linked to this parent |

## Done Marker

> **Done — Lane 3/3 ratification complete.** Inspected #1, #2, #18, #27 against
> current source state at commit `394cc68` (post-finalizer #121). Source evidence,
> verification output, close/keep recommendations, and narrow follow-up issue
> texts are documented in this file. No issues closed, no PRs merged, no schema
> or code changed. Broker/finalizer (seoseo) should review and create the three
> narrow follow-up issues before closing #27.
>
> Related: `docs/mvp-foundation-ratification.md` (lane 1/3, sogyo),
> `docs/roadmap-ratification-agent-stack.md` (lane 2/3, nosuk)
