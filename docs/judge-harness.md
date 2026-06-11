# Agent Olympics Judge Harness — Subjective Scoring Layer

This document describes `scripts/judge.js`, the layer-6 completion of the
judge harness ([roadmap-05](../issues/roadmap-05-judge-harness.md)).
`scripts/score.js` auto-scores evidence_quality, safety, and execution;
this harness lets a human judge score the remaining three dimensions
(correctness, communication, durability) and produces a **complete** judge
record that the scoreboard consumes.

---

## 1. Workflow

```
result packet (results/<task>-<agent>.yaml)
  │
  ├── node scripts/judge.js oracle-check <packet>     (judge-only, stdout)
  │       heuristic packet-vs-oracle comparison
  │       → SUGGESTED correctness band (never auto-final)
  │
  ├── node scripts/judge.js template <packet> --output <decl>
  │       judge declaration template with oracle scoring guidance embedded
  │
  ├── human judge fills the declaration
  │       scores + short reason per dimension, optional penalties,
  │       optional overrides of the three auto dimensions
  │
  ├── node scripts/judge.js finalize <packet> --declaration <decl> [--blind]
  │       auto dims (score.js logic) + human dims + penalties
  │       → <packet-base>-judge.yaml  (schema-valid judge record v1)
  │
  └── node scripts/score.js run
          findJudgeFiles picks up the record → entry shows the complete
          total, judge_type, and zero pending dimensions
```

All six rubric categories of `rubrics/agent-olympics-v1.yaml` are scorable;
penalties are recorded separately in `penalties_applied`; every dimension
carries a short reason (finalize rejects declarations with empty reasons).

### judge_type

Finalized records use `judge_type: hybrid` — they mix machine-scored
dimensions with human-scored ones. A record becomes `judge_type: human` only
when the declaration overrides **all three** automatic dimensions and
declares `judge_type: human`. Both values are in the judge-record schema enum.

### Verdict

A declaration may set `verdict` explicitly. Otherwise finalize derives it:

| Condition | Verdict |
|---|---|
| packet status `disqualified` | `disqualification` |
| packet status `failed` | `fail` |
| total ≥ 60% of max (after penalties, floor 0) | `pass` |
| total ≥ 40% of max | `conditional_pass` |
| otherwise | `fail` |

---

## 2. Oracle privacy

Oracle files under `oracle/season-001/` are private judge material.

- `oracle-check` output and the declaration **template** are judge-facing —
  quoting oracle guidance there is intended.
- The finalized judge record contains only the scores and reasons the judge
  wrote plus short auto-score reasons. `finalize` enforces this with an
  oracle-leak guard (rejects verbatim oracle fragments in the record) and a
  secret-pattern scan.

---

## 3. Blind judging

`finalize --blind` satisfies the roadmap-05 acceptance criterion that the
harness can hide runtime, model, node, and agent id:

- `packet_id` and `judge_record_id` are replaced with hash-derived blinded
  identifiers.
- The record is scanned for the packet's `agent_id`, `runtime`, `model`,
  `model_provider`, and `node` values; finalize fails if the judge's reasons
  or notes mention any of them.
- Pass `--output` into a blind review directory so the default filename
  (which contains the packet basename) does not reveal identity.

This complements `score.js --blind`, which anonymizes packets before
auto-scoring (see [scoring.md](scoring.md)).

---

## 4. Promotion check

```
node scripts/judge.js promotion-check [--tasks-dir tasks/season-001] [--results-dir results] [--strict]
make promotion-check
```

Read-only report per task envelope (prefers `-v2` files): recorded `tier`,
whether a validating result packet exists, whether a complete judge record
(all six dimensions scored) exists, verdict, and `baseline` block presence.
It concludes which tier the evidence supports:

- **smoke** — a validating result packet exists for the task.
- **verified** — validating packet **and** complete judge record **and**
  baseline block.

The tool never edits envelopes — promotion is a manual envelope change (see
[task-verification.md](task-verification.md)). Exit code is 0; with
`--strict` it exits 1 when a recorded tier exceeds the evidence-supported
tier (`retired` is a manual decision and is not evidence-evaluated).

---

## 5. Commands and fixtures

| Command | Purpose |
|---|---|
| `node scripts/judge.js oracle-check <packet>` | Heuristic oracle comparison + suggested correctness band |
| `node scripts/judge.js template <packet> [--output f]` | Generate judge declaration template |
| `node scripts/judge.js finalize <packet> --declaration f [--blind] [--output f] [--force]` | Produce complete judge record |
| `node scripts/judge.js promotion-check [--strict]` | Tier evidence report |
| `node scripts/judge.js fixtures` / `make judge-fixtures` / `npm run test:judge_fixtures` | Fixture suite |

Fixtures live in `fixtures/judge-harness/`: one positive declaration that
finalizes (including a blind pass) against the committed sample packet
`results/ops-001-yukson.yaml`, and three negative declarations (score over
rubric max, task_id mismatch, missing reason) that must be rejected with
clear errors. Fixture outputs are written to a temp directory and cleaned up.

---

## 6. What stays manual

- Scoring correctness, communication, and durability — the oracle-check
  band is a keyword heuristic and is labeled SUGGESTION only.
- Choosing penalty kinds/amounts beyond the automatic semantic-error
  penalties (`-5` per cross-field error, same mapping as the auto-judge).
- Promoting a task tier (editing the envelope and `baseline` block).
- Appeals (`appeal_record` in the judge-record schema) — recorded by hand.
- Overlay rubrics (node_readiness, performance_trial, agent_stack) — the
  harness scores the core six-dimension rubric only.
