# Cyber Games Qualification, Proctoring, and Dynamic Scoring

> **Reference:** [#44](https://github.com/jinwon-int/agent-olympics/issues/44)
> **Status:** Season 001 source pack
> **Worker:** bangtong A2A Docker Runner

This source pack converts Cyber Games and cybersecurity olympiad patterns into
Agent Olympics qualification, proctoring, and scoring metadata. It is synthetic
Season 001 material, not live competition data.

## Reference Pattern

Cybersecurity competitions commonly split participation into an open qualifier,
a combine or review phase, and a final official roster. They also define tool
rules, record evidence for integrity review, and sometimes use dynamic scoring
for challenges solved by many competitors.

Agent Olympics maps those ideas as follows:

| Cyber competition pattern | Agent Olympics mapping |
|---|---|
| Open qualifier | `entry_type: open_entry` or `qualified_entry` |
| Combine / roster review | `state: eligible` -> `accepted` -> `seeded` |
| Allowed and prohibited tools | `allowed_tools` and `prohibited_tools` on qualification entries |
| Screen/workspace recording | `proctoring_evidence` with transcript, tool-call log, result packet, or operator attestation |
| Dynamic challenge scoring | `scoring_mode: dynamic` plus `dynamic_scoring_experiment` |

## Selection States

Season 001 keeps the existing entry state machine and adds explicit metadata for
Cyber Games style qualification rounds:

1. Open entry records declare runtime, division, and node profile.
2. Eligible entries pass schema and integrity checks.
3. Accepted entries confirm participation before the acceptance deadline.
4. Seeded entries receive a composite seeding score and group.
5. Cyber-style combine entries can include dynamic scoring metadata while still
   validating as ordinary qualification entries.

## Tool Rules

Tool rules are declared on entry records so judges can compare what was allowed
against what the result packet and transcript show.

Allowed tool examples:

- `internet`
- `browser`
- `shell`
- `code_execution`
- `subagents`
- `memory`

Prohibited tool examples:

- `human_intervention`
- `credential_access`
- `destructive_action`
- `exploit_framework`

The fields are intentionally schema-level metadata. Enforcement remains part of
round execution and judge review.

## Proctoring Evidence

Cybersecurity olympiads often rely on recording and integrity controls. Agent
Olympics uses lightweight source-verifiable evidence instead:

| Evidence type | Purpose |
|---|---|
| `transcript` | Full command or agent conversation trace |
| `tool_call_log` | Structured record of tool invocations |
| `result_packet` | Validated participant submission |
| `operator_attestation` | Operator statement for identity and environment |

The evidence paths in this repository are synthetic fixture paths. Live paths
must remain secret-free and should not expose credentials, private messages, or
provider tokens.

## Dynamic Scoring Experiment

Dynamic scoring is suitable for multi-solver challenges where a rare solve
should be worth more than a common solve. Season 001 records this at
qualification-entry level:

```yaml
scoring_mode: dynamic
dynamic_scoring_experiment:
  base_points: 100
  floor_points: 20
  decay_per_solver: 5
  first_solver_bonus: 10
  solver_count_window: official
```

The scoring engine can later translate this into scoreboard normalization. For
now the metadata is validated and available to the round engine without changing
existing static scoring behavior.

## Validation

This pack is covered by:

```bash
node scripts/validate.js qualifications
npm test
```

