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

## Local vs Live Hermes Coverage

This section documents what can be validated **locally** (without a
running Hermes orchestrator, CLI runtime, or human operator) and what
still requires a **live runtime**.

### ✅ Locally Validatable (via validate.js)

| Validation | Tooling | Local? |
|---|---|---|
| Adapter capability declaration schema | `node scripts/validate.js adapter-capabilities` | ✅ Yes — validates `fixtures/adapters/capabilities/*.yaml` against `schemas/adapter-capability-declaration.schema.json` |
| Hermes workflow plan structure | `node scripts/validate.js adapter-fixtures` | ✅ Yes — validates required fields (`workflow_id`, `steps`, `objective`) and YAML syntax |
| Hermes worker trace structure | `node scripts/validate.js adapter-fixtures` | ✅ Yes — validates `trace_id`, `timeline`, `classification` |
| Hermes memory summary structure | `node scripts/validate.js adapter-fixtures` | ✅ Yes — validates `memory_summary_id`, `worker_id`, `memory_sources_consulted` |
| CLI result packet (schema) | `node scripts/validate.js packets` | ✅ Yes — validates against `result-packet.schema.json` |
| CLI structured command record | `node scripts/validate.js adapter-fixtures` | ✅ Yes — validates `commands` array, `exit_code`, `output_summary` |
| Human baseline evidence bundle | `node scripts/validate.js bundles` | ✅ Yes — validates against `evidence-bundle.schema.json` |
| Human baseline timestamp log | `node scripts/validate.js adapter-fixtures` | ✅ Yes — validates `operator_log_id`, `entries`, basic action sequencing |
| Human baseline action descriptions | `node scripts/validate.js adapter-fixtures` | ✅ Yes — validates `operator_actions`, `tool` references, `contributes_to_outputs` |
| Forbidden pattern detection (secrets, hostnames) | All validate modes | ✅ Yes — `detectSecrets` scans all documents |

### 🔄 Requires Live Hermes Runtime

| Capability | What's Missing Locally | Hermes Runtime Needed For |
|---|---|---|
| Workflow orchestration | Sample fixture files provide deterministic plans but cannot test actual worker assignment, dependency resolution, or parallelism | Verifying that the Hermes commander correctly decomposes envelopes and assigns workers |
| Child-worker evidence merging | Merge logic is an open design question — fixture files show independent traces only | Testing the actual synthesis of multiple worker outputs into a single coherent result packet |
| Contradictory evidence resolution | No contradiction scenarios in current fixtures | Testing the Hermes resolver on real contradictory worker outputs |
| Memory retrieval with live data | Memory summaries show the format but use no real data | Testing that memory retrieval actually works and summaries contain no private content |
| Live trace event generation | Worker traces are hand-authored examples | Testing that the Hermes runtime produces valid trace records with correct timestamps and sequencing |
| Redaction rule enforcement | Redaction rules are declared but never tested against live output | Testing that credential/secret patterns are actually redacted from produced evidence |

**Bottom line:** Local fixture validation confirms that adapter output
files are **well-formed, schema-compliant, and internally consistent.**
It cannot confirm that a live Hermes runtime actually produces output
that matches these fixtures.  That requires running the Hermes adapter
against a real task envelope in a test environment.

## Validation

### Validate Adapter Capability Declarations

```bash
# All three adapter capability declarations (hermes, cli, human-baseline)
node scripts/validate.js adapter-capabilities
```

This validates against `schemas/adapter-capability-declaration.schema.json`
— checks required fields, field types, safe slug conventions, and that
no secrets or host-specific paths are present.

### Validate All Adapter Fixture Files (Recommended)

```bash
# All adapter fixture files — standard schemas + custom adapter formats
node scripts/validate.js adapter-fixtures
```

This validates:
- **Hermes:** workflow plan, worker trace, memory summary (structural checks)
- **CLI:** result packet (schema), command log (YAML + structure), commands.yaml (structure)
- **Human-baseline:** evidence bundle (schema), timestamp log (structure), actions (structure)

### Validate Individual Files

```bash
# CLI result packet (validated against result-packet.schema.json)
node scripts/validate.js fixtures/adapters/cli/sample-result-packet-stub.yaml

# Human baseline evidence bundle (validated against evidence-bundle.schema.json)
node scripts/validate.js fixtures/adapters/human-baseline/sample-evidence-bundle-stub.yaml

# Hermes workflow plan (validated with adapter-specific structural checks)
node scripts/validate.js fixtures/adapters/hermes/sample-workflow-plan.yaml
```

### Validate All YAML Syntax (includes adapter files)

```bash
node scripts/validate.js fixtures
```

The fixture validation mode discovers all YAML files in the
`fixtures/` tree, including the adapter compatibility files.  Files
that do not match a known bundle schema will be reported as skipped
(not as errors).

### Validate via Round Engine

```bash
# All adapters (hermes, cli, human-baseline)
node scripts/round.js validate-adapter-outputs

# Single adapter
node scripts/round.js validate-adapter-outputs hermes
node scripts/round.js validate-adapter-outputs cli
node scripts/round.js validate-adapter-outputs human
```

### Validate via Score Engine

```bash
# Validate result packets + adapter capability declarations
node scripts/score.js validate
```

### Make Targets

```bash
# Validate adapter capability declarations only
make validate-adapter-capabilities

# Validate all adapter fixture sample files
make validate-adapter-fixtures

# Validate Hermes-specific fixtures only
make validate-hermes-fixtures

# Full validation (includes the above three)
make validate
make all
```

## Adapter Validity Fixtures

Beyond the shared compatibility fixtures under `fixtures/adapters/`, each
adapter ships its own validation fixture directories for regression testing
and schema compliance:

### OpenClaw Validity Fixtures

Directory: `fixtures/openclaw-validity/`
- Positive: ops-completed + code-completed result packets, traces, evidence bundles, manifests
- Negative: missing evidence, redaction leak, invalid status, mode-family mismatch

### Hermes Validity Fixtures

Directory: `fixtures/hermes-validity/`
- Positive: ops-completed + code-completed result packets, traces, evidence bundles, manifests
- Negative: missing evidence, redaction leak, invalid status, mode-family mismatch

These validity fixtures are validated by dedicated Makefile targets
(`validate-openclaw`, `validate-hermes`) and CI pipelines.

## Adding a New Adapter

To add fixture data for a new adapter (e.g., `openclaw`):

1. Create `fixtures/adapters/capabilities/<adapter>.yaml` following
   the structure in `adapter-capability-declaration.yaml`.
2. Create `fixtures/adapters/<adapter>/` with sample data files.
3. Create `fixtures/<adapter>-validity/` with positive and negative validation fixtures.
4. Document any new adapter-specific fields in
   [Platform-Neutral Adapter Fields](platform-neutral-adapter-fields.md).
5. Update this document's Structure table.
6. Add Makefile targets for adapter execution and validation.

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
