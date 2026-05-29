# Adapter Compatibility Fixtures

This directory contains sample fixture data, capability declarations, and
documentation for the three non-OpenClaw adapter paths: **Hermes**, **CLI**,
and **Human Baseline**.

These fixtures serve two purposes:

1. **Adapter development** — Provide sample inputs/outputs so developers can
   implement and test adapters without a live Hermes runtime or a physical
   human operator.
2. **Validation** — Provide deterministic, schema-validatable data that the
   runner, CI, or judge can use to verify adapter contract compliance.

## Layout

```
fixtures/adapters/
  README.md                              ← This file
  adapter-capability-declaration.yaml    ← Field reference for capability declarations
  capabilities/
    hermes.yaml                          ← Hermes adapter capability declaration
    cli.yaml                             ← CLI adapter capability declaration
    human-baseline.yaml                  ← Human baseline adapter capability declaration
  hermes/
    sample-workflow-plan.yaml            ← Example Hermes workflow/task decomposition
    sample-worker-trace.yaml             ← Example Hermes worker delegation trace
    sample-memory-summary.yaml           ← Example memory retrieval summary
  cli/
    sample-command-log.txt               ← Sample terminal transcript (raw text)
    sample-commands.yaml                 ← Structured CLI command record
    sample-result-packet-stub.yaml       ← Validatable CLI result packet stub
  human-baseline/
    sample-timestamp-log.yaml            ← Sample human operator timestamp log
    sample-actions.yaml                  ← Sample human operator action descriptions
    sample-evidence-bundle-stub.yaml     ← Validatable evidence bundle stub
```

## Adapter Validity Fixtures

Each adapter also has a dedicated validity fixture directory for regression
and schema-compliance testing:

| Adapter | Validity Fixtures |
|---|---|
| OpenClaw | `fixtures/openclaw-validity/` — positive + negative result packets, traces, evidence bundles |
| Hermes   | `fixtures/hermes-validity/` — positive + negative result packets, traces, evidence bundles, manifests |

Validity fixtures follow the same naming conventions as the adapter-specific
directories. See `docs/adapter-compatibility-fixtures.md` for full documentation.

## What These Are Not

- **Not task fixture bundles.** Task-specific fixture data (gateway logs,
  config snapshots, source repos) lives in `fixtures/season-001/`. The
  data here documents _adapter behavior_ independently of any specific task.
- **Not oracle/answer keys.** No judge-only material exists in this
  directory. Everything here is suitable for dry runs and CI.
- **Not production credentials.** No real API keys, tokens, or hostnames
  appear in these files.

## Platform-Neutral Adapter Fields

All adapter result packets share a common set of required fields defined
in the [Adapter Execution Contract](../../docs/adapter-execution-contract.md):

| Field | Type | Adapter Scope | Notes |
|---|---|---|---|
| `runtime` | string | All | `"hermes"`, `"cli"`, `"human-baseline"` |
| `agent_id` | string | All | Self-chosen identifier |
| `status` | enum | All | `completed`, `partial`, `blocked`, `failed`, `disqualified` |
| `summary` | string | All | One-paragraph safe summary |
| `evidence` | array | All | ≥ 1 evidence item per packet |
| `findings` | array | All | ≥ 1 finding per packet |
| `outputs` | object | All | Must cover all `required_outputs` in envelope |
| `started_at` / `ended_at` | ISO 8601 | All | Timestamps for time compliance |

Adapter-specific fields (optional in the common schema, documented in
capability declarations below) include workflow plans, worker delegation
traces, memory summaries, terminal logs, and operator action logs.

## Capability Declarations

Each adapter has a capability declaration in `fixtures/adapters/capabilities/`.
These YAML files describe:

- What **evidence kinds** the adapter can produce.
- What **statuses** the adapter can report.
- What **runtime-specific fields** the adapter adds to result packets.
- What **redaction rules** the adapter supports.
- What **approval boundaries** the adapter observes.

Capability declarations follow the format defined in
`adapter-capability-declaration.yaml`.

## Validation

Sample result packets and evidence bundles in this directory can be
validated individually:

```bash
# Validate a sample CLI result packet stub
node scripts/validate.js fixtures/adapters/cli/sample-result-packet-stub.yaml

# Validate a sample human baseline evidence bundle
node scripts/validate.js fixtures/adapters/human-baseline/sample-evidence-bundle-stub.yaml

# Validate capability declarations (syntax check)
node scripts/validate.js fixtures/adapters/capabilities/hermes.yaml
```

Additionally, all YAML files in this directory are discovered by the
`fixtures` validation mode (the validator skips files that do not match
the fixture-bundle schema, so non-bundle YAML files appear in the skip
count but do not produce errors):

```bash
node scripts/validate.js fixtures
```

## Related Documents

- [Adapter Execution Contract](../../docs/adapter-execution-contract.md) —
  Full contract defining inputs, outputs, timeouts, status mapping, evidence,
  redaction, and approval.
- [Adapters Overview](../../docs/adapters.md) — High-level adapter
  responsibilities and evidence guidance.
- [Hermes Adapter Issue](../../issues/roadmap-04-hermes-adapter.md) — Hermes
  adapter design issue with open questions.
- [Platform-Neutral Adapter Fields](../../docs/platform-neutral-adapter-fields.md) —
  Reference for common fields across all adapter types.
