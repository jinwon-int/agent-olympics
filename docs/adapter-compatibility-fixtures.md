# Adapter Compatibility Fixtures

This document describes the shared adapter fixture data under
`fixtures/adapters/`.  These fixtures exist to support adapter
development, validation, and contract compliance testing for the
three non-OpenClaw adapter paths: **Hermes**, **CLI**, and
**Human Baseline**.

## Purpose

The primary goals of the adapter compatibility fixtures are:

1. **Enable adapter development without live runtimes.**
   A developer implementing the Hermes adapter can validate their
   result-packet generation against the sample Hermes workflow plans
   and worker traces, without needing a running Hermes orchestrator.

2. **Provide deterministic, safe sample data for CI.**
   Every YAML file in the adapter fixtures tree is safe for CI
   pipelines — no secrets, no host-specific paths, no credentials.

3. **Document adapter-specific behavior.**
   The capability declarations explain what evidence kinds, statuses,
   runtime fields, redaction rules, and approval boundaries each
   adapter supports, serving as living documentation that evolves
   alongside the adapter implementation.

4. **Validate schema compliance.**
   Sample result packets and evidence bundles in the fixture tree
   can be validated against the existing JSON Schemas to confirm
   that the schemas correctly accept real adapter output.

## Structure

```
fixtures/adapters/
  README.md                                 ← Entry point and usage guide
  adapter-capability-declaration.yaml        ← Field reference / pseudo-schema
  capabilities/
    hermes.yaml                              ← Hermes adapter capability declaration
    cli.yaml                                 ← CLI adapter capability declaration
    human-baseline.yaml                      ← Human baseline adapter capability declaration
  hermes/
    sample-workflow-plan.yaml                ← Hermes workflow plan (task decomposition)
    sample-worker-trace.yaml                 ← Hermes worker delegation trace
    sample-memory-summary.yaml               ← Hermes memory retrieval summary
  cli/
    sample-command-log.txt                   ← Raw terminal transcript
    sample-commands.yaml                     ← Structured command record
    sample-result-packet-stub.yaml           ← Validatable result packet
  human-baseline/
    sample-timestamp-log.yaml                ← Operator timestamp log
    sample-actions.yaml                      ← Structured action descriptions
    sample-evidence-bundle-stub.yaml         ← Validatable evidence bundle
```

## Capability Declarations

Each adapter has a capability declaration that answers:

- **What evidence kinds can this adapter produce?**
  (e.g., Hermes produces `log`, `command_output`, `api_response`, `url`;
  CLI produces `command_output`, `file_diff`, `config_snippet`)

- **What statuses can this adapter report?**
  Internal adapter states and their mapping to the five standard
  statuses (`completed`, `partial`, `blocked`, `failed`, `disqualified`).

- **What adapter-specific runtime fields does it add?**
  Fields beyond the common set defined in the Adapter Execution Contract.

- **What redaction rules does it support?**
  Named rules that describe what gets redacted, from which evidence
  kinds, and targeting which data classes.

- **What approval boundaries does it observe?**
  Classification of actions into `always_requires_approval`,
  `context_dependent`, and `default_allowed`.

- **What are its known limitations?**
  Open design questions, implementation gaps, and caveats.

See the individual declarations for details:
- [`fixtures/adapters/capabilities/hermes.yaml`](../fixtures/adapters/capabilities/hermes.yaml)
- [`fixtures/adapters/capabilities/cli.yaml`](../fixtures/adapters/capabilities/cli.yaml)
- [`fixtures/adapters/capabilities/human-baseline.yaml`](../fixtures/adapters/capabilities/human-baseline.yaml)

## Sample Fixture Data

### Hermes Samples

| File | Description |
|---|---|
| `sample-workflow-plan.yaml` | Task decomposition into 4 steps (connectivity, config integrity, log inspection, synthesis). Demonstrates dependency chaining, parallelism, and worker profiles. |
| `sample-worker-trace.yaml` | Trace from one Hermes worker performing log inspection, with timeline events and structured findings. |
| `sample-memory-summary.yaml` | Memory retrieval log showing what the worker consulted, what it found (4 keys requested, 2 found), and what it wrote back. Notable: cache-hit ratio of 0.5. |

### CLI Samples

| File | Description |
|---|---|
| `sample-command-log.txt` | Raw terminal transcript showing 5 commands with their outputs. |
| `sample-commands.yaml` | Structured version of the same session with durations, exit codes, and safe output summaries. |
| `sample-result-packet-stub.yaml` | Validatable result packet conforming to `result-packet.schema.json`. |

### Human Baseline Samples

| File | Description |
|---|---|
| `sample-timestamp-log.yaml` | 8-entry operator action log with timestamps, durations, and results. Total session time: 32 minutes. |
| `sample-actions.yaml` | Structured action descriptions with tool usage, output contributions, and difficulty ratings. |
| `sample-evidence-bundle-stub.yaml` | Validatable evidence bundle conforming to `evidence-bundle.schema.json`. |

## Platform-Neutral Adapter Fields

All three adapter paths share a common set of result-packet fields.
These are documented in [Platform-Neutral Adapter Fields](platform-neutral-adapter-fields.md).

The key insight: every adapter must produce `runtime`, `agent_id`,
`status`, `summary`, `evidence`, `findings`, `outputs`, `started_at`,
and `ended_at`.  Adapter-specific fields (like `workflow_plan` for
Hermes or `terminal_history` for CLI) sit alongside these common
fields.

## Validation

### Validate Individual Files

```bash
# CLI result packet (validated against result-packet.schema.json)
node scripts/validate.js fixtures/adapters/cli/sample-result-packet-stub.yaml

# Human baseline evidence bundle (validated against evidence-bundle.schema.json)
node scripts/validate.js fixtures/adapters/human-baseline/sample-evidence-bundle-stub.yaml
```

### Validate All YAML Syntax

```bash
node scripts/validate.js fixtures
```

The fixture validation mode will discover all YAML files in the
`fixtures/` tree, including the adapter compatibility files.  Files
that do not match a known bundle schema will be reported as skipped
(not as errors).

### Validate All Adapter Fixtures

To validate only adapter fixture files with strict schema checking,
add a dedicated Make target or validate each schematized file
individually:

```bash
for f in \
  fixtures/adapters/cli/sample-result-packet-stub.yaml \
  fixtures/adapters/human-baseline/sample-evidence-bundle-stub.yaml; do
  node scripts/validate.js "$f"
done
```

## Adding a New Adapter

To add fixture data for a new adapter (e.g., `openclaw`):

1. Create `fixtures/adapters/capabilities/<adapter>.yaml` following
   the structure in `adapter-capability-declaration.yaml`.
2. Create `fixtures/adapters/<adapter>/` with sample data files.
3. Document any new adapter-specific fields in
   [Platform-Neutral Adapter Fields](platform-neutral-adapter-fields.md).
4. Update this document's Structure table.

## Related Documents

- [Adapter Execution Contract](adapter-execution-contract.md) —
  Defines inputs, outputs, timeouts, status mapping, evidence,
  redaction, and approval for all adapters.
- [Platform-Neutral Adapter Fields](platform-neutral-adapter-fields.md) —
  Reference for the common fields every adapter result packet must
  contain.
- [Hermes Adapter Issue](../issues/roadmap-04-hermes-adapter.md) —
  Design issue and open questions for the Hermes adapter.
- [Fixtures README](../fixtures/adapters/README.md) — Entry point for
  fixture developers.
