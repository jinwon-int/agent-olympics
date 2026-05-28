## Purpose

Freeze the first version of the platform-neutral `Task Envelope` and `Result Packet` contracts.

## Why it matters

OpenClaw, Hermes, CLI agents, and human baselines can only be compared fairly if each participant receives the same task surface and submits the same result surface.

## Proposed scope

- Review `docs/task-envelope.md`.
- Review `docs/result-packet.md`.
- Validate `schemas/task-envelope.schema.json`.
- Validate `schemas/result-packet.schema.json`.
- Decide which fields are required for v1 and which stay optional.
- Add one known-good example for each event family.

## Acceptance criteria

- Schema files validate the example tasks and a sample result packet.
- Field names are stable enough for adapter implementation.
- No OpenClaw-only or Hermes-only field is required in the common schema.
