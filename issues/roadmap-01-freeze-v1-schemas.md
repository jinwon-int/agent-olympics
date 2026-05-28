## Purpose

Freeze the first version of the platform-neutral `Task Envelope`, `Result Packet`, and `Judge Record` contracts.

## Why it matters

OpenClaw, Hermes, CLI agents, and human baselines can only be compared fairly if each participant receives the same task surface and submits the same result surface.

## Completed scope

- Reviewed `docs/task-envelope.md` and `docs/result-packet.md`.
- Validated `schemas/task-envelope.schema.json`, `schemas/result-packet.schema.json`, and `schemas/judge-record.schema.json`.
- All seven example task envelopes validate correctly.
- Example result packet and example judge record validate correctly.
- Cross-field semantic checks implemented (evidence references, timestamps, secret patterns).
- Validation tooling: `scripts/validate.js` with `npm test` / `make validate` targets.

## Fields added to v1 schemas

### Task Envelope (new optional fields)

- `expected_artifacts` — Describes expected artifacts and their required-or-optional status.
- `approval_policy` — Describes which actions require explicit approval before execution.
- `cost_limit` — Maximum allowed cost (USD, tokens, API calls).
- `model_visibility_policy` — Whether participant model identity must be reported.
- `transcript_policy` — Whether and how the participant transcript should be preserved.

### Result Packet (new optional fields)

- `packet_id` — Unique packet identifier for judge cross-referencing.
- `agent_version` — Agent software version.
- `runtime_version` — Runtime version.
- `communication_log` — Log of user-facing communication during the task.
- Enhanced action and evidence sub-schemas with additional useful fields.

## Acceptance criteria

- [x] Schema files validate the example tasks and sample result packets.
- [x] Field names are stable enough for adapter implementation.
- [x] No OpenClaw-only or Hermes-only field is required in the common schema.
- [x] Validation tooling exists and passes CI-equivalent checks.
- [x] Secret/heuristic scanning detects credential-like patterns.
- [x] Cross-field consistency rules (evidence references, timestamps) are validated.
