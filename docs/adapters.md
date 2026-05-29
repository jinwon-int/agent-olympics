# Adapters

Adapters translate Agent Olympics Task Envelopes into runtime-specific invocations and translate runtime outputs into Result Packets.

Every adapter must satisfy the [**Adapter Execution Contract**](adapter-execution-contract.md), which defines:

- Required inputs, outputs, and artifacts.
- Timeout behavior and status mapping.
- Evidence capture rules.
- Redaction and approval boundaries.
- Concrete CLI invocation example.
- Validation commands.

This document provides a high-level overview of each adapter's responsibilities
and useful evidence kinds. For the full contract, see the link above.

## OpenClaw Adapter

See [`issues/roadmap-03-openclaw-adapter.md`](../issues/roadmap-03-openclaw-adapter.md) for the full design issue.

Responsibilities:

- Spawn or send a session with the Task Envelope.
- Preserve Telegram-visible progress behavior when the task is user-facing.
- Capture session history, tool calls, message delivery evidence, and final report.
- Normalize outputs into a Result Packet.

Useful evidence:

- session id
- message id
- gateway readiness
- channel delivery probe
- wiki PR or issue link
- command summaries with redaction status

Contract addenda (see [§10](adapter-execution-contract.md#10-adapter-specific-contract-addenda)):

- Capture session metadata.
- Preserve Telegram progress behavior.
- Normalize and redact tool call output.
- Use the Gateway readiness journal for evidence.

## Hermes Adapter

See [`issues/roadmap-04-hermes-adapter.md`](../issues/roadmap-04-hermes-adapter.md) for the full design issue.

Responsibilities:

- Invoke the Hermes agent or workflow with the Task Envelope.
- Capture plans, delegated tasks, tool traces, memory usage, and final answer.
- Normalize Hermes-specific orchestration evidence into common packet fields.

Useful evidence:

- workflow id
- worker assignment
- memory retrieval summary
- tool trace summary
- final commander report

Contract addenda (see [§10](adapter-execution-contract.md#10-adapter-specific-contract-addenda)):

- Capture workflow state transitions.
- Summarize memory retrieval (no secrets).
- Merge child worker evidence.
- Handle contradictory evidence.

## CLI Adapter

Responsibilities:

- Run a local CLI agent or scripted human baseline in a controlled workspace.
- Capture stdout, stderr, git diff, test results, and timing.
- Convert the transcript and artifacts into a Result Packet.

Useful evidence:

- working directory
- commit or diff
- test command and result
- PR or branch URL
- terminal transcript path

See the [CLI invocation example](adapter-execution-contract.md#8-cli-invocation-example) in the contract for a concrete walkthrough.

## Human Baseline Adapter

Responsibilities:

- Let a human operator submit the same Result Packet.
- Record time, actions, evidence, and final recommendation.
- Provide a useful baseline for what "good enough" looks like.

Human baselines are valuable because the benchmark is about operational work quality, not only model capability.
