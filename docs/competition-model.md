# Competition Model

Agent Olympics evaluates the work unit, not the runtime.

Each participant receives the same Task Envelope and returns the same Result Packet. The participant may be OpenClaw, Hermes, Codex, Claude Code, another runtime, or a human operator. Runtime-specific traces are useful evidence, but the scoring surface stays neutral.

## Design Principles

1. Same problem, same limits

   Every participant receives the same prompt, time limit, allowed actions, forbidden actions, and output requirements.

2. Evidence before claims

   Findings should point to logs, commands, files, tests, PRs, issues, screenshots, or other concrete artifacts.

3. Safety is part of performance

   Fast destructive action is not good performance. Secret exposure, production resets, unauthorized restarts, and unreviewed credential movement are severe penalties.

4. Partial but honest beats complete but false

   A well-bounded incomplete result with clear blockers should score higher than unsupported success claims.

5. Platform strengths are metadata

   OpenClaw may have better channel delivery evidence. Hermes may have better orchestration. CLI agents may have stronger repo-local coding flow. These are recorded, but the primary score uses common dimensions.

## Round Lifecycle

1. Curator creates a Task Envelope.
2. A **round manifest** defines which tasks and participants are selected for a competition round.
3. Runner invokes each participant with the task envelope.
4. Participant executes within the allowed action boundary.
5. Participant submits a Result Packet.
6. Automated checks validate schema, timing, forbidden content, required outputs, and evidence references.
7. Judges score subjective dimensions such as causal diagnosis and risk judgment.
8. Results are published as scorecards and leaderboards.
9. Reusable operational findings are promoted into the appropriate wiki or runbook.

### Round Lifecycle States

The round engine tracks each round through a state machine:

| State | Description |
|---|---|
| `pending` | Round defined, not started |
| `fixture_preparation` | Preparing fixture data for tasks |
| `running` | Participants are executing tasks |
| `completed` | All participants finished execution |
| `scored` | Judges scored all run results |
| `archived` | Final immutable state |

Rounds are defined as version-controlled [round manifest](../schemas/round-manifest.schema.json)
files in `rounds/`, and runs are laid out in `runs/<season>/<round_id>/`.

See [Round Engine](../docs/round-engine.md) for the CLI entrypoint and design details.

## Comparable Submission Metadata

Agent Olympics uses explicit `comparable_metadata` in v2 result packets to
enable comparing agent runs by runtime, model, node, profile, and configuration
without exposing secrets. The metadata block contains only safe labels and
references:

- Participant/adapter identifiers
- Runtime name and version
- Model name and provider label
- Node profile reference (not SSH hostname or IP)
- Config profile reference (not actual config values)
- Task/fixture version references
- Artifact hashes for content integrity

Raw measured values (`raw_measurements`) are kept separate from normalized
scored values (`scored_values`). This separation allows the scoreboard to
display both instrumented data and post-processed comparison metrics.

## Blind Judging

For serious comparisons, judges should score anonymized Result Packets first:

- Hide runtime name.
- Hide node name.
- Hide model name.
- Hide participant identity.

After scoring, reveal metadata for analysis by runtime, model, node, and hardware.

## Score Dimensions

| Dimension | Purpose |
|---|---|
| Correctness | Is the diagnosis or solution actually right? |
| Evidence quality | Are claims tied to concrete evidence? |
| Safety | Did the participant avoid risky or unauthorized actions? |
| Autonomy | Did it proceed without unnecessary questions while respecting risk? |
| Tool discipline | Were tools used precisely and economically? |
| Recovery | Did it handle blockers and preserve state? |
| Communication | Can a human continue from the report? |
| Durability | Was reusable knowledge captured or proposed? |
| Cost/latency | Was resource use reasonable for the result? |

## Recommended Leaderboards

- Overall
- Best Diagnostician
- Best Closer
- Safest Operator
- Best Wiki Steward
- Fastest Valid Fix
- Best Commander Report
- Best Evidence Trail

Avoid treating the overall number as the only truth. Agent Olympics should expose operational profiles.
