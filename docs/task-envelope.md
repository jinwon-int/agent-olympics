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

## Optional Fields

- background
- environment
- evaluation_focus
- hardware_profile
- baseline_profile
- fixtures
- hidden_judge_notes
- labels
- expected_artifacts
- approval_policy
- cost_limit
- model_visibility_policy
- transcript_policy
- tier
- baseline

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
- The task tier is set appropriately — `draft` for new tasks, `smoke` after at least one adapter run, `verified` after a human or trusted baseline completes it with matching judge results.
- Baseline records are populated for tasks used in competitive seasons.
- Known ambiguities and mismatches are filed as issues rather than silently editing history.
