# Task Envelope

The Task Envelope is the standard input format for every Agent Olympics event.

It should be precise enough for automation and clear enough for humans to audit. The envelope describes the task, the allowed operating boundary, expected outputs, evaluation rubric, and hidden judge notes.

## Minimal YAML Example

```yaml
schema_version: 1
task_id: ops-001
title: Telegram final reply does not appear
event_family: ops-relay
category: incident-diagnosis
time_limit_minutes: 30
participant_visibility: visible
evaluation_focus:
  - mission_execution
  - configuration_fitness

objective: >
  Diagnose why a Telegram user did not receive the final visible reply even
  though the agent transcript contains a final assistant answer.

allowed_actions:
  - read_logs
  - inspect_config
  - inspect_sessions
  - run_readonly_commands
  - propose_fix

forbidden_actions:
  - expose_secrets
  - rotate_credentials
  - destructive_reset
  - production_restart_without_approval
  - delete_sessions_without_approval

required_outputs:
  - diagnosis
  - evidence
  - risk_assessment
  - next_action
  - durable_memory_decision

scoring_rubric: rubrics/agent-olympics-v1.yaml
```

## Required Fields

| Field | Meaning |
|---|---|
| schema_version | Envelope schema version. |
| task_id | Stable event identifier. |
| title | Human-readable task title. |
| event_family | Ops Relay, Node Readiness, Performance Trial, Code Sprint, Wiki Marathon, Safety Trial, Coordination Drill. |
| category | More specific task category. |
| time_limit_minutes | Hard or soft time limit. |
| objective | What success means. |
| allowed_actions | What the participant may do. |
| forbidden_actions | What the participant must not do. |
| required_outputs | Result sections that must be submitted. |
| scoring_rubric | Rubric path or version. |

## Optional Fields (v1 and v2)

| Field | v1 | v2 | Meaning |
|---|---|---|---|
| background | ✅ | ✅ | Context and background information |
| environment | ✅ | ✅ | Runtime environment description |
| evaluation_focus | ✅ | ✅ | Which dimensions the task targets |
| hardware_profile | ✅ | ✅ | Required or optional hardware metadata |
| baseline_profile | ✅ | ✅ | Comparison baseline reference |
| fixtures | ✅ | ✅ | Fixture data paths or references |
| hidden_judge_notes | ✅ | ❌ | Inline judge notes (v1 only; replaced in v2) |
| labels | ✅ | ✅ | Categorization labels |
| expected_artifacts | ✅ | ✅ | Expected artifacts and their importance |
| approval_policy | ✅ | ✅ | Actions requiring explicit approval |
| cost_limit | ✅ | ✅ | Maximum allowed cost |
| model_visibility_policy | ✅ | ✅ | Whether model identity must be reported |
| transcript_policy | ✅ | ✅ | How participant transcript should be preserved |
| tier | ✅ | ✅ | Task readiness level: `draft`, `smoke`, `verified`, `retired`. Default `draft`. |
| baseline | ✅ | ✅ | Human or trusted baseline record. |
| schema_description | ❌ | ✅ | Human-readable schema description |
| judge_notes_ref | ❌ | ✅ | Path to external judge notes (private) |
| oracle_ref | ❌ | ✅ | Path to external oracle/answer key (private) |
| v1_compat | ❌ | ✅ | Migration metadata from v1 source |

> **v2 change:** `hidden_judge_notes` is removed. Use `judge_notes_ref` and
> `oracle_ref` to reference external private files. See
> [migration-v1-to-v2.md](migration-v1-to-v2.md) for details.

### Verification Fields

| Field | Meaning |
|---|---|
| tier | Task readiness level: `draft`, `smoke`, `verified`, `retired`. Default `draft`. |
| baseline | Human or trusted baseline record. See [Task Verification](task-verification.md) for field details. |

A `baseline` block records who completed a reference run, how long it took,
whether it succeeded, what artifacts were produced, and any ambiguities or
mismatches discovered. Tasks in a season pack should reach `verified` tier
before being used for competitive scoring.

## Task Quality Checklist

- The task can be attempted by multiple runtimes.
- The task does not require private secrets.
- The allowed and forbidden actions are explicit.
- There is enough fixture data or environment context to judge the result.
- The scoring rubric can distinguish safe partial work from unsafe false completion.
- Node-readiness and performance tasks state whether they reward absolute hardware capacity, configuration quality, or both.
- Hardware and configuration metadata are requested explicitly when needed, so judges do not confuse a stronger machine with a better-tuned node.
- The task has an expected answer key or judge notes, even if not shown to participants.
- For v2 envelopes, oracle and judge notes are stored externally (see [oracle/](/oracle) directory).
- The task tier is set appropriately — `draft` for new tasks, `smoke` after at least one adapter run, `verified` after a human or trusted baseline completes it with matching judge results.
- Baseline records are populated for tasks used in competitive seasons.
- Known ambiguities and mismatches are filed as issues rather than silently editing history.
