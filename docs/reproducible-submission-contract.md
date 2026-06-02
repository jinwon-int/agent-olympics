# Reproducible Submission Contract

> Related issue: [#48](https://github.com/jinwon-int/agent-olympics/issues/48)

Agent Olympics adapters must be runnable by the judge harness in a clean
environment. The competition may provide starter kits for OpenClaw, Hermes,
generic CLI agents, and human-baseline operators, but every participant follows
the same submission shape.

## Required Submission Shape

Each adapter submission declares:

- `adapter_id`: stable public adapter identifier.
- `adapter_type`: runtime class, such as `openclaw`, `hermes`, `cli`, or
  `human-baseline`.
- `setup_command`: deterministic setup command, or `none` when the adapter is
  already available in the runner image.
- `test_entrypoint`: command the judge harness runs against a task envelope.
- `result_dir`: directory where the adapter writes `result-packet.yaml`,
  `trace.yaml`, and `evidence-bundle.yaml`.
- `declared_limits`: wall time, tool calls, external requests, and cost
  ceilings for the entry.
- `network_policy`: whether outbound network access is denied, allowlisted, or
  operator-approved.
- `redaction_policy`: named rules used before any artifact becomes
  publishable.

The entrypoint must accept at least:

```bash
<test_entrypoint> <task-envelope.yaml> --run-dir <result_dir> --seed <seed>
```

The runner may pass additional options, but an adapter must not require hidden
credentials, private hostnames, or operator-only paths to produce a valid
synthetic result.

## Clean-Environment Rule

The judge harness may execute a submitted adapter in a fresh checkout,
container, VM, or dedicated node slot. A valid submission must:

- rebuild or verify dependencies from declared files,
- avoid relying on untracked local state,
- produce the standard result triplet,
- preserve enough trace evidence to reproduce the decision path,
- fail closed when required approvals, tools, or credentials are unavailable.

For human baselines, the "entrypoint" is a documented operator procedure and
timestamped action log. It must still produce the same result triplet and judge
record.

## Held-Out Variants

Season tasks may include multiple fixture variants:

- `public`: participant-facing examples or smoke fixtures.
- `generated`: synthetic variants generated from a seed.
- `held_out`: runner-visible fixtures used for final scoring.

Held-out variants must not include oracle files, judge notes, or answer keys in
participant-facing paths. They may reuse the same task envelope when the
objective is unchanged, or declare a variant-specific fixture bundle when only
the evidence changes.

The runner records the variant seed in the trace or run manifest. Published
results can expose the seed after the round closes unless doing so would leak a
future reusable test case.

## Normalized Variant Scoring

Raw scores stay attached to each judge record. Aggregate scoring normalizes by
variant so a single easy or hard fixture does not dominate the event:

1. Score each run against the task rubric.
2. Normalize the raw score by the maximum score available for that variant.
3. Apply disqualification or safety penalties before aggregation.
4. Average normalized scores across required variants.
5. Report caveats when a variant was skipped, blocked, or non-comparable.

For performance-trial tasks, raw measurements remain separate from normalized
scores. Hardware class, adapter identity, and configuration profile must remain
visible enough for comparison without exposing secrets.

## Minimum Acceptance Gate

A new adapter or season task is not ready for scored competition until:

- its submission entrypoint can run from a clean checkout or approved runner,
- at least one public or generated fixture validates,
- result packet, trace, evidence bundle, and judge record validate,
- score aggregation rules are documented for public and held-out variants,
- the task envelope states whether held-out variants are required for final
  scoring.
