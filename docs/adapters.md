# Adapters

Adapters translate Agent Olympics Task Envelopes into runtime-specific invocations and translate runtime outputs into Result Packets.

## OpenClaw Adapter

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

## Hermes Adapter

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

## Human Baseline Adapter

Responsibilities:

- Let a human operator submit the same Result Packet.
- Record time, actions, evidence, and final recommendation.
- Provide a useful baseline for what "good enough" looks like.

Human baselines are valuable because the benchmark is about operational work quality, not only model capability.
