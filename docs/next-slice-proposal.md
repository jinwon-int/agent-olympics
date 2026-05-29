# Next Implementation Slice — Post-Rules-Hardening Roadmap Proposal

> **Run:** `agent-olympics-team1-roadmap-ratify-20260529T2042KST`
> **Lane:** 3/3 — yukson (roadmap ratification)
> **Assigned issue:** [#101](https://github.com/jinwon-int/agent-olympics/issues/101)
> **Start comment:** [issuecomment-4574583696](https://github.com/jinwon-int/agent-olympics/issues/101#issuecomment-4574583696)
> **Date:** 2026-05-29

## 1. Current State Summary

The Agent Olympics MVP foundation has reached a stable baseline after the
Team1 agent-stack rules hardening round ([commit 416203f](../../commit/416203f)).

### What Is Done

| Area | Status | Evidence |
|---|---|---|
| **Rules hardened** | ✅ Merged | [`docs/rules.md`](rules.md) — Divisions, tool disclosure, result validity states, appeals, publication rules |
| **MVP foundation ratified** | ✅ Merged | [`docs/mvp-foundation-ratification.md`](mvp-foundation-ratification.md) — Full issue status map, risks, next-axis recommendation |
| **Task Envelope/Result Packet schemas (v1+v2)** | ✅ Frozen | `schemas/task-envelope[-v2].schema.json`, `schemas/result-packet[-v2].schema.json` |
| **Judge Record schemas (v1+v2)** | ✅ Frozen | `schemas/judge-record[-v2].schema.json` |
| **Validation tooling** | ✅ Working | `scripts/validate.js` — 0 errors on all envelope/packet/trace/bundle/judge/oracle targets |
| **Season 001 task pack** | ✅ 7 events | `tasks/season-001/` — ops-001, ops-002, node-001, perf-001, code-001, knowledge-001, coord-001 |
| **Round engine** | ✅ Working | `scripts/round.js` — init, plan, execute, resume via stub adapter |
| **Scoring engine** | ✅ Automated | `scripts/score.js` — schema validation, presence checks, secret scan, auto-judge, scoreboard |
| **Oracle/answer keys** | ✅ 7 files | `oracle/season-001/` |
| **Judge notes** | ✅ Published | `docs/judge-notes-season-001.md` — Per-event scoring checklists, penalties, worksheets |
| **Adapter Execution Contract** | ✅ Published | [`docs/adapter-execution-contract.md`](adapter-execution-contract.md) — Full contract, CLI example, redaction rules, approval boundaries |
| **Reference benchmark issues** | ✅ 9 issues | `issues/reference-*.md` — SWE-bench, AgentBench, OSWorld, WebArena, GAIA, MLE-bench, MLAgentBench, Tau-bench, Terminal-Bench |
| **Constitution** | ✅ Published | [`docs/constitution.md`](constitution.md) — Platform neutrality, evidence-first, safety, transparency |
| **Stub adapter** | ✅ Working | `scripts/stub-adapter.js`, `scripts/test-stub-adapter.sh` |
| **Performance baseline** | ✅ 1 run | `results/perf-001-baseline.yaml` — baseline result packet |
| **Node profile format** | ✅ Published | `schemas/node-profile-inventory.schema.json`, `fixtures/node-profiles/` |

### What Is Provisional or Open

| Area | Status | Issue | Notes |
|---|---|---|---|
| **Schema hardening** | ⚠️ Provisional | #1 (open) | v2 schemas coexist with v1; finalizer PR #97 integrated the operating-policy fields first introduced by PR #55, and those fields now need formal schema-hardening follow-up |
| **Soonwook profile validation** | ❌ Blocked | #17 (closed, gap) | Gateway-token setup failure; retry issue needed |
| **Web leaderboard** | 🔴 Deferred | #49 (open) | No baseline data yet; premature without working adapters |
| **OpenClaw adapter** | 🔴 Not implemented | #3/roadmap-03 | Contract defined; no adapter code |
| **Hermes adapter** | 🔴 Not implemented | #4/roadmap-04 | Contract defined; no adapter code |
| **Full judge harness** | 🔴 Incomplete | #5/roadmap-05 | Automated scoring exists; human review/appeal workflow missing |
| **Task verification** | 🔴 All draft | All tasks `tier: draft` | No tasks have been promoted to `smoke` or `verified` via baseline runs |

### Validation Verification

All validation targets pass with zero errors:

```
$ node scripts/validate.js all
Files scanned:  37 | Errors: 0 | Warnings: 16 (all expected — draft-tier notices)

$ node scripts/validate.js oracle
Files: 7 | Errors: 0 | Warnings: 0

$ node scripts/validate.js rounds
Files: 1 | Errors: 0 | Warnings: 0

$ node scripts/validate.js fixtures
Files: 37 | Errors: 0 | Warnings: 13 (3 expected — missing fixture files in ops-002 bundle)

$ node scripts/score.js run
Total entries: 2 | Auto-judge created: 1 | Errors: 0
Scoreboard: results/scoreboard.json
```

---

## 2. Ordered Next-Round Lane Proposal

The following lanes are ordered by dependency, risk reduction, and roadmap
priority. Each lane should be a separate implementation round with its own
issue, run ID, and team assignment.

### 🥇 Lane 1: OpenClaw Adapter Implementation

**Issue:** [#3 / roadmap-03-openclaw-adapter.md](../issues/roadmap-03-openclaw-adapter.md)

**Why now:** The adapter execution contract is fully defined
([`docs/adapter-execution-contract.md`](adapter-execution-contract.md) §10
has the OpenClaw-specific addenda). There is a stub adapter for testing but
no real adapter. Until a working OpenClaw adapter exists, no Season 001 task
can be run against a real agent node, and the round/score engines cannot be
tested end-to-end.

**Scope:**

1. Write `adapters/openclaw-adapter.js` (or similar) implementing the
   contract from `docs/adapter-execution-contract.md`.
   - Accept `Task Envelope` → spawn or send OpenClaw session.
   - Preserve Telegram-visible progress rules when applicable.
   - Capture session history, tool trace summary, message IDs, delivery
     probes, gateway readiness.
   - Emit `Result Packet` + `Trace Record` + `Evidence Bundle`.
2. Implement redaction rules per §9 of the contract.
3. Implement approval-boundary recording per §9.
4. Run against at least one Season 001 task (ops-001 recommended — lowest
   time limit, Telegram-focused).
5. Output validates against `schemas/result-packet-v2.schema.json`.

**Dependencies:** None (contract is stable; schemas are frozen).

**Risk:** Adapter may need adjustment when run against a real node with real
Gateway credentials. Treat first implementation as `smoke`-tier.

**Recommended agent:** sogyo (A2A runner experience, OpenClaw familiarity)

---

### 🥇 Lane 2: Hermes Adapter Implementation

**Issue:** [#4 / roadmap-04-hermes-adapter.md](../issues/roadmap-04-hermes-adapter.md)

**Why now:** Cross-runtime comparison is the core value of Agent Olympics.
Once one adapter exists, the second adapter validates the contract's
platform neutrality and reveals runtime-specific gaps.

**Scope:**

1. Write `adapters/hermes-adapter.js` (or similar).
   - Accept `Task Envelope` → invoke Hermes workflow or agent.
   - Capture worker routing, task state transitions, tool traces, memory
     retrieval summaries, final commander report.
   - Merge child worker evidence into a single evidence bundle.
   - Handle contradictory evidence across workers.
2. Run against at least one Season 001 task (coord-001 recommended — tests
   evidence merging and contradiction handling).
3. Output validates against `schemas/result-packet-v2.schema.json`.

**Dependencies:** Adapter Execution Contract (stable). Hermes environment
availability.

**Risk:** Hermes worker evidence merging and memory retrieval summarization
are open design questions (noted in roadmap-04). First implementation should
expect design iteration.

**Recommended agent:** nosuk or seoseo (depending on Hermes access)

---

### 🥈 Lane 3: Task Test-Event Promotion (Smoke Round)

**Why now:** All seven Season 001 tasks are at `tier: draft`. Before they
can be used in competitive rounds, they must first be promoted to `smoke`
(at least one adapter completes a run) and then to `verified` (baseline run
with matching judge score). Lane 1 (OpenClaw adapter) enables this.

**Scope:**

1. Run each Season 001 task through the OpenClaw adapter (Lane 1 deliverable).
2. For each task:
   - Ensure result packet and trace validate.
   - Update `tier` from `draft` to `smoke` in the task envelope.
   - Populate `baseline` block with actor identity, completion time,
     artifact reference, difficulty notes.
3. For critical-path tasks (ops-001, node-001, code-001), run a human or
   trusted baseline agent independently and promote to `verified`.
4. Fix or file issues for any mismatches discovered during baseline runs
   (per `docs/task-verification.md` mismatch policy).
5. Address fixture warnings: `ops-002` bundle is missing referenced fixture
   files (`post-update-config.yaml`, `system-status.log`).

**Dependencies:** Lane 1 (OpenClaw adapter) — must exist to run tasks.

**Risk:** Mismatches found during baseline may require envelope or oracle
adjustment. The mismatches should be filed as issues (per task-verification.md),
not silently fixed.

**Reference:** [`docs/task-verification.md`](task-verification.md)

---

### 🥈 Lane 4: Judge Harness Completion

**Issue:** [#5 / roadmap-05-judge-harness.md](../issues/roadmap-05-judge-harness.md)

**Why now:** `scripts/score.js` implements layers 1–5 of the proposed judge
harness (schema validation, required output, secret scan, timing checks,
evidence-reference completeness). Layer 6 (human/LLM-assisted subjective
scoring) and the review/appeal workflow are not implemented. As tasks are
promoted to `verified` (Lane 3), a complete judge workflow becomes necessary.

**Scope:**

1. **Human review workflow:** Script or CLI entrypoint to help a human judge
   score blind result packets (anonymize `agent_id`, `runtime`, `model`,
   `node` per `docs/judge-notes-season-001.md` §1.1).
2. **Appeal workflow:** Support recording appeals in the judge record (per
   `docs/rules.md` Appeals section — packet_id, filer, evidence, timeline,
   outcome).
3. **Blind scoring protocol:** Helper that removes identifying metadata from
   result packets before human review and re-attaches afterward.
4. **Judge record v2 integration:** Ensure `scripts/score.js` can produce and
   validate v2 judge records (`schemas/judge-record-v2.schema.json`).
5. **Scoreboard overlay support:** Support the Agent Stack scoring overlay
   (`rubrics/agent-olympics-v1.yaml` — configuration fitness, operating
   discipline, tool optimization, reliability/recovery dimensions).

**Dependencies:** Lane 3 (Smoke Round) — baseline runs produce result packets
that exercise the full scoring pipeline.

**Risk:** Overlay scoring logic is complex and may need the rubric YAML to
be machine-parseable. The current rubric file is mostly documentation.

**Recommended agent:** seoseo (Team1 broker/finalizer of record)

---

### 🥉 Lane 5: Schema Hardening (Narrow Follow-Up)

**Issues:** #1 (provisional), #97 (merged baseline)

**Why not now:** The mvp-foundation-ratification document recommended this as
the primary axis, but the assignment prioritizes adapter contracts (#3/#4),
judge harness (#5), web leaderboard (#49), and test-event readiness. Schema
hardening should follow adapter experience — the adapters will reveal schema
gaps better than a desk review.

**Scope (deferred):**

1. Promote the operating-policy fields integrated by finalizer PR #97
   (`tool_use_profile`, `operating_policy`, `publishable`, and related
   division/validity/appeal metadata) into hardened v2+ schema versions.
2. Add required-field enforcement for configuration and operating-policy
   metadata.
3. Add validation rules for tool-use/operating-policy cross-references.

**Dependencies:** finalizer PR #97 is merged; adapter implementation experience.

---

### 🥉 Lane 6: Web Leaderboard / Result Detail (#49)

**Issue:** #49 (open)

**Why deferred:** The [`docs/result-packet.md`](result-packet.md) already
contains an extensive "Web Result and Leaderboard Metadata Guidance" section
with column specs, result-detail page layout, filtering rules, and
reproducibility panel specs. Implementation requires:

1. **Data:** Actual result packets from working adapters (Lane 1–2).
2. **Scored results:** Scoreboard entries from the scoring engine (Lane 4).
3. **Design:** Static HTML/JS page or lightweight server rendering the
   scoreboard JSON.

Until lanes 1–4 produce baseline data, a web leaderboard would display
stub/adapter dummy data only.

**Recommended trigger:** After Lane 3 (Smoke Round) produces ≥5 verified
result packets with scoreboard entries.

---

## 3. Roadmap Dependency Graph

```
Lane 1: OpenClaw Adapter ──────────────────────────┐
                                                    │
Lane 2: Hermes Adapter ─────────────────────────────┤
                                                    │
Lane 3: Smoke Round (test-event promotion) ◄────────┘
                                                    │
Lane 4: Judge Harness Completion ◄──────────────────┘
                                                    │
                          ┌─────────────────────────┘
                          ▼
Lane 5: Schema Hardening ◄── (informed by adapter experience)
                          │
Lane 6: Web Leaderboard  ◄── (needs baseline data from Lane 3)
```

---

## 4. Risk Notes

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| **OpenClaw adapter (Lane 1) fails on real node** | Delays all downstream lanes | Medium | Test against stub first; ops-001 is lowest-risk |
| **Hermes adapter (Lane 2) reveals contract gaps** | Requires contract revision | Medium | Flag as design iteration; update contract incrementally |
| **Baseline mismatches (Lane 3) require envelope changes** | Delays verification | High | File issues per policy; do not silently edit |
| **Appeal workflow (Lane 4) scope under-estimated** | Lane scope creep | Medium | Limit to MVP: file + record + timeline only; no custom UI |
| **Web leaderboard needs auth/scoping decisions** | Premature development | Low | Defer until data exists; MVP can be a static HTML file |

**Known Pre-Existing Issues:**

1. **ops-002 fixture bundle** — `fixtures/season-001/ops-002/manifest.yaml`
   references `post-update-config.yaml` and `system-status.log` which do not
   exist. Adding these fixture files is a prerequisite for Lane 3 (Smoke Round).
2. **Soonwook profile validation** — #17 is closed with a blocked gap. A
   retry or reassignment issue should be created when a node environment with
   proper Gateway credentials is available.

---

## 5. Approval-Sensitive Blockers

1. **Bangtong is excluded** pending server replacement and explicit
   re-enrollment per the A2A run configuration. No lanes should be assigned
   to Bangtong.
2. **Seoseo remains Team1 broker/finalizer of record.** Lane assignments and
   PR reviews should route through seoseo.
3. **No issue should be closed** without explicit operator approval per the
   round safety rules. This document does not close #1, #2, #3, #4, #5, #49,
   #50, #51, #52, #53, #54, #55, #98, or #101.
4. **PR #55 is already closed as superseded by #97.** Lane 5 should build
   on the finalizer-integrated #97 schema/rules baseline rather than reviving
   the superseded branch.
5. **No production gateway restart, broker restart, DB mutation, credential
   movement, or force-push** is authorized by this proposal. Any of these
   requires separate explicit operator approval.

---

## 6. Changed Files

| File | Change |
|---|---|
| `docs/next-slice-proposal.md` | **NEW** — This document: ordered next-round lane proposal |
| `.gitignore` | PATCH — Add auto-generated scoreboard artifacts to ignores |

---

## 7. Verification

- All validation targets pass with zero errors (see §1 above).
- `npm test` (alias for `node scripts/validate.js all`) passes.
- `node scripts/validate.js oracle` — 7 files, 0 errors, 0 warnings.
- `node scripts/validate.js rounds` — 1 file, 0 errors, 0 warnings.
- `node scripts/score.js run` — 2 entries, 0 errors, scoreboard validated.
- No untracked OpenClaw bootstrap context files (AGENTS.md, SOUL.md, etc.)
  are present in the repository checkout.

---

*This document is part of the Agent Olympics roadmap ratification.
See [mvp-foundation-ratification.md](mvp-foundation-ratification.md) for the
previous round's ratification status. See
[issues/roadmap-03-openclaw-adapter.md](../issues/roadmap-03-openclaw-adapter.md),
[issues/roadmap-04-hermes-adapter.md](../issues/roadmap-04-hermes-adapter.md),
and [issues/roadmap-05-judge-harness.md](../issues/roadmap-05-judge-harness.md)
for lane definitions.*
