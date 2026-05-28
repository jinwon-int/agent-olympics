## Purpose

Design the Hermes adapter for Agent Olympics.

## Responsibilities

- Accept a Task Envelope.
- Invoke a Hermes workflow or agent.
- Capture worker routing, task state, tool trace summaries, memory references, and final commander report.
- Emit a Result Packet.

## Open design questions

- Which Hermes workflow state should map to `completed`, `partial`, `blocked`, and `failed`?
- How should Hermes memory retrieval be summarized without leaking private data?
- How should child worker evidence be merged into a single packet?

## Acceptance criteria

- Adapter can run or simulate one Coordination Drill.
- Output validates against `schemas/result-packet.schema.json`.
- Runtime-specific metadata stays optional, not required by the common schema.
