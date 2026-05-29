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

A reference implementation is available at [`adapters/openclaw-adapter.js`](../adapters/openclaw-adapter.js)
with full documentation at [`docs/openclaw-adapter.md`](openclaw-adapter.md).

### Responsibilities

- Accept a Task Envelope and create an OpenClaw session.
- Preserve Telegram-visible progress behavior when the task is user-facing.
- Capture session history, tool calls, message delivery evidence, and final report.
- Normalize outputs into a Result Packet, Trace Record, Evidence Bundle, and Artifact Manifest.
- Declare adapter metadata, supported capabilities, and evidence kinds.
- Apply value-free redaction rules to protect secrets.

### Useful Evidence

- `session_id` — OpenClaw session UUID
- `message_id` — Telegram/gateway message delivery ID
- `gateway_readiness` — Gateway readiness journal entry (redacted)
- `delivery_probe` — Channel delivery probe result
- `tool_call_summary` — Tool call trace with action, target, duration, redaction
- `command_summary` — Shell command summary with exit code
- `session_transcript` — Transcript excerpt (redacted, safe lines only)
- `wiki_pr_ref` — Link to Wiki PR or issue for durable knowledge

### Adapter Metadata

| Field | Value |
|---|---|
| `adapter` | `openclaw` |
| `adapter_version` | `1.0.0` |
| `supported_envelope_versions` | 1, 2 |
| `supported_event_families` | ops, code, smoke, node, wiki, general |
| `modes` | openstack, closedstack, human_baseline |
| `evidence_kinds` | 12 kinds (see docs) |
| `default_timeout` | 600s |

### Contract Addenda (see [§10](adapter-execution-contract.md#10-adapter-specific-contract-addenda))

- Capture session metadata.
- Preserve Telegram progress behavior.
- Normalize and redact tool call output.
- Use the Gateway readiness journal for evidence.

### Usage Examples

```bash
# Basic ops task
node adapters/openclaw-adapter.js tasks/season-001/ops-001.yaml \
  --agent-id sogyo --mode openstack --event-family ops

# Closed stack code task with deterministic output
node adapters/openclaw-adapter.js tasks/season-001/code-001.yaml \
  --agent-id sogyo --mode closedstack --event-family code --seed ci-v1

# Failure simulation
node adapters/openclaw-adapter.js tasks/season-001/ops-001.yaml \
  --agent-id sogyo --exit 1 --seed test-fail

# See also: docs/openclaw-adapter.md for full reference
```

### Validation Fixtures

Validation examples for the OpenClaw adapter are in [`fixtures/openclaw-validity/`](../fixtures/openclaw-validity/).
Positive fixtures test valid outputs; negative fixtures test expected failure modes.

```bash
# Validate a positive fixture
node scripts/validate.js fixtures/openclaw-validity/positive/ops-completed-result-packet.yaml

# Validate all openclaw fixture files
for f in fixtures/openclaw-validity/positive/*.yaml; do
  node scripts/validate.js "$f"
done
```

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

### Stub Adapter (scripts/stub-adapter.js)

A deterministic stub adapter is provided at [`scripts/stub-adapter.js`](../scripts/stub-adapter.js)
for testing the runner integration, CI validation, and development workflow
without needing live runtime credentials.

**Purpose:**

- Accept any task envelope and emit a valid result packet + trace + evidence bundle.
- Simulate success (exit 0 / `completed`), failure (exit 1 / `failed`), and
  timeout (exit 2 / `partial`) modes via `--exit` flag.
- Produce deterministic output when `--seed` is provided — same seed → same IDs.
- Self-validate output against JSON schemas after generation.
- Record stdout/stderr/exit status metadata in the run directory.

**Usage:**

```bash
# Basic run (exit 0 → completed)
node scripts/stub-adapter.js tasks/stub-test/stub-hello-envelope.yaml

# Simulate failure
node scripts/stub-adapter.js tasks/stub-test/stub-hello-envelope.yaml --exit 1

# Deterministic run with fixed seed
node scripts/stub-adapter.js tasks/stub-test/stub-hello-envelope.yaml --seed ci-v1

# Explicit output directory
node scripts/stub-adapter.js tasks/stub-test/stub-hello-envelope.yaml \
  --run-dir /tmp/my-run --agent-id my-agent --runtime my-runtime
```

**Output artifacts:**

| File | Schema | Description |
|---|---|---|
| `result-packet.yaml` | `result-packet.schema.json` | v1 result packet |
| `trace.yaml` | `trace-record.schema.json` | v1 trace record |
| `evidence-bundle.yaml` | `evidence-bundle.schema.json` | v1 evidence bundle |
| `run.yaml` | (run metadata) | Envelope path, exit code, status, timing, artifact list |
| `envelope-copy.yaml` | (input copy) | Deterministic copy of the input envelope |
| `adapter.log` | (plain text) | Captured stdout/stderr from the adapter run |

**Exit code mapping:**

| `--exit` | Packet Status | Adapter Meaning |
|---|---|---|
| `0` | `completed` | Normal success |
| `1` | `failed` | Wrong answer or incomplete work |
| `2` | `partial` | Timeout or partial result |
| _missing envelope_ | — (exit 3) | Prereq / argument error |

**Makefile targets:**

```bash
make stub-adapter      # Run against the stub test envelope (expects success)
make stub-adapter-fail # Run against the stub test envelope (expects failure)
make test-stub         # Full test suite
```

## Human Baseline Adapter

Responsibilities:

- Let a human operator submit the same Result Packet.
- Record time, actions, evidence, and final recommendation.
- Provide a useful baseline for what "good enough" looks like.

Human baselines are valuable because the benchmark is about operational work quality, not only model capability.
