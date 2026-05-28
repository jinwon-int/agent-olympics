## Purpose

Design the OpenClaw adapter for Agent Olympics.

## Responsibilities

- Accept a Task Envelope.
- Invoke an OpenClaw session.
- Preserve Telegram-visible progress rules when the event is user-facing.
- Capture session history, tool trace summary, message ids, and delivery probes.
- Emit a Result Packet.

## Evidence to capture

- Session id.
- Message id, when applicable.
- Gateway readiness and channel delivery probe, when applicable.
- Command summaries with redaction status.
- Wiki PR, GitHub PR, or issue links when durability is required.

## Acceptance criteria

- Adapter can run one example Ops Relay task.
- Adapter output validates against `schemas/result-packet.schema.json`.
- Secret values are redacted before packet creation.
