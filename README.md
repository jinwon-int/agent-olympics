# Agent Olympics

Agent Olympics is a platform-neutral competition for evaluating how well the whole operating agent stack executes real missions across ops, coding, knowledge, safety, coordination, and performance events.

The project is intentionally not tied to OpenClaw. OpenClaw, Hermes, Codex, Claude Code, shell-based agents, and human baselines should all be able to compete by accepting the same task envelope and submitting the same result packet.

## Motto

Measure the whole operating agent stack, not just the model.

Agent Olympics is not an AI model benchmark alone. It is an olympics for the combined performance of the AI model, agent harness, tools, runtime, agent configuration, and operating principles in real mission work.

See [Constitution and Public Positioning](docs/constitution.md) for the
competition's guiding principles, platform-neutrality commitment, English
motto, and Korean working line. The [documentation index](docs/README.md) links
every doc, including the [glossary](docs/glossary.md) and the runnable
[end-to-end walkthrough](docs/walkthrough.md).

## Current Status

Agent Olympics is an MVP evaluation framework with source packs, schemas,
validation tooling, adapter fixtures, and dry-run examples. It is ready for
schema and harness development. It is public-source-ready for schema and harness review, but it is not yet a fully verified public
competition: most Season 001 tasks remain draft-tier until baseline runs and
judge records promote them to smoke or verified status.

A blind public leaderboard can be published to GitHub Pages from the committed
judge records (participant identity, models, and nodes are withheld); it is
opt-in and inert until the repository owner enables Pages. See
[Public Leaderboard](docs/public-leaderboard.md).

## Quickstart

```bash
npm ci
npm test
make validate
node scripts/round.js plan rounds/season-001-round-001.yaml
```

Use `npm test` for the primary schema/semantic validator. Use `make validate`
for the full repository validation suite, including fixtures, profiles,
qualifications, scoring support, and adapter smoke checks.

Use `npm run test:proof_token_verify` for CyberLympics-style proof-token
verification fixtures that award points only when a packet submits the expected
challenge proof and reproducible solution artifact.

See [Universal Participant Eligibility](docs/participant-eligibility.md) for
the adapter-neutral path that lets OpenClaw, Hermes, generic CLI/shell agents,
coding agents, future runtimes, and human baselines participate through the
same Task Envelope -> Result Packet interface.

Season 002 Preview is available as a source-only rehearsal pack; see
[Season 002 Preview Plan](docs/season-002-preview.md). It validates the
second-season task/round shape and ccc-node harness dry-run path without making
any live-operation or public-scoring approval.

For the shortest participant onboarding path, see
[Participant Quickstart](docs/participant-quickstart.md). External and harness
participants may also use the persistent, loopback-only
[HTTP/JSON participant server](docs/http-json-participant-protocol.md); it stores
claims and submissions and feeds accepted artifacts through the same validator,
judge, and scoreboard pipeline without authorizing a production deployment.
The core architecture is:

```text
Task Envelope -> Adapter -> Result Packet -> Judge Record -> Scoreboard
```

## Goals

- Compare agent work quality, not vendor branding or runtime internals.
- Measure node-agent readiness: model/provider setup, runtime configuration, tool availability, memory policy, liveness behavior, operating principles, and recovery posture.
- Evaluate practical operations work: diagnosis, safe recovery, code changes, documentation, and command of other agents.
- Separate raw hardware capacity from configuration quality so stronger machines are recognized without hiding tuning or setup problems.
- Treat tool discipline, configuration fitness, approval boundaries, evidence standards, and delegation policy as first-class performance dimensions.
- Reward evidence-backed conclusions over fast unsupported answers.
- Penalize unsafe actions, secret exposure, destructive changes, and false completion claims.
- Preserve reusable results as tasks, rubrics, transcripts, issues, and wiki-ready runbooks.

## Core Model

Agent Olympics has three stable concepts.

The evaluated unit is the **operating agent stack**:

- Model and provider behavior.
- Agent harness, context management, and runtime.
- Tools, adapters, permissions, and network/sandbox mode.
- Agent configuration: routing, memory policy, retries, timeouts, concurrency, resource limits, and liveness behavior.
- Operating principles: approval boundaries, secret handling, destructive-action discipline, evidence standards, escalation, delegation, and final-report discipline.
- Node or hardware environment, where relevant.

1. Task Envelope

   A platform-neutral input file that describes the task, limits, allowed actions, forbidden actions, required outputs, and scoring rubric.

2. Result Packet

   A platform-neutral output file submitted by the participant. It records the runtime, model metadata, configuration profile, operating policy, action trace summary, evidence, findings, risks, final answer, and durable-memory decision.

3. Judge Record

   A human or automated scoring record. The judge should score the submitted packet against a rubric without depending on private runtime details.

## Event Families

- Ops Relay: incident diagnosis, runtime drift detection, safe recovery plans, gateway or queue liveness checks.
- Node Readiness: evaluate whether an agent node is configured well enough for mission work, including model routing, tool access, typing/liveness, resource limits, memory, and update posture.
- Performance Trial: measure hardware-backed mission throughput, latency, parallelism, build/test capacity, and resource efficiency under controlled workloads.
- Code Sprint: focused bug fixes, tests, CI triage, PR body quality.
- Wiki Marathon: transcript closeout, runbook extraction, memory conflict cleanup, canonical documentation.
- Safety Trial: secret handling, destructive-action avoidance, approval boundaries, rollback thinking.
- Coordination Drill: multi-agent delegation, contradictory evidence synthesis, commander reports.
- Tool Decathlon: optimized use of multiple tools under a mission budget.
- Harness Reliability: state preservation, progress reporting, recovery, timeout handling, and complete result emission.

## Scoring Philosophy

Single-number leaderboards are useful, but they are not enough. A useful agent
evaluation should expose strengths by dimension rather than collapsing to one
number.

**[`docs/scoring.md`](docs/scoring.md) is the single source of truth for the
scoring model.** In summary, the base score is 100 points across six dimensions:

| Phase | Dimension | Points |
|---|---|---:|
| Automatic | Evidence quality | 20 |
| Automatic | Safety | 15 |
| Automatic | Execution | 15 |
| Human / blind judge | Correctness | 30 |
| Human / blind judge | Communication | 10 |
| Human / blind judge | Durability | 10 |

The three automatic dimensions (50 points) are computed from packet content by
the validator/scorer; the three pending dimensions (50 points) require human or
blind-judge review. Penalties (unsupported claims, unguarded destructive
actions, leaked secrets) and comparable-metadata handling are defined in
[`docs/scoring.md`](docs/scoring.md).

An agent that safely stops with a well-supported partial result should score higher than an agent that guesses, mutates production state without approval, or claims success without evidence.

Model identity should be visible for analysis, but it is only one part of the result. A smaller model with a disciplined harness, good tools, strong configuration, and reliable operating principles can beat a stronger raw model that uses tools poorly or violates safety constraints.

## Repository Layout

One line per top-level directory (file-level listings drift, so they are kept in
each area's own README/doc instead):

| Path | Purpose |
|---|---|
| `schemas/` | JSON Schemas for every artifact class (task envelopes, result packets, judge records, node profiles, adapters, oracle, …). v2 schemas are current. |
| `archive/schemas/` | Retired v1 envelope/result-packet schemas, kept loadable for backward compatibility (see #257). |
| `tasks/` | Task envelopes: `season-001/` canonical v2 envelopes, `season-002/`, `smoke/` readiness pack, and `stub-test/`. |
| `rounds/` | Round manifests that bind tasks × participants into a scored round. |
| `fixtures/` | Positive/negative validation fixtures for every gate (adapters, node profiles, competition-validity, live-runner, accreditation, …). |
| `adapters/` | Participant runtime adapters (stub, OpenClaw, Hermes) and shared adapter library. |
| `rubrics/` | Scoring rubric definitions. |
| `oracle/` | Private judge answer keys per season (handling model tracked in #256). |
| `results/` | Per-participant scored run output and judge records that feed the leaderboard. |
| `runs/` | Captured run directories (live-runner and round-engine output examples). |
| `evidence/` | Dry-run evidence bundles. |
| `archive/` | Dated run bundles retained for history (see also `archive/schemas/`). |
| `scripts/` | Validator, round engine, scorer, live runner, adapters, and the shared `scripts/lib/` helpers. |
| `test/` | `node:test` unit tests for the tooling's pure helpers. |
| `docs/` | Reference documentation (scoring, round engine, adapters, quickstart, migration, …). |
| `issues/` | Historical/reference notes and roadmap slices; GitHub Issues are the current tracker. |
| `Makefile` | Build/validation targets (requires `make`). |

See [`docs/scoring.md`](docs/scoring.md), [`docs/round-engine.md`](docs/round-engine.md),
and the per-directory READMEs for details.

## MVP Plan

1. Freeze Task Envelope v1 and Result Packet v1.
2. Create the first season pack with seven events:
   - ops-001: Telegram final reply does not appear.
   - ops-002: Decide whether clean reinstall is needed.
   - node-001: Audit whether a node agent is configured for reliable mission execution.
   - perf-001: Measure node throughput and resource behavior on a controlled workload.
   - code-001: TypeScript regression fix with targeted tests.
   - knowledge-001: Convert incident transcript into wiki-ready runbook.
   - coord-001: Merge contradictory node reports into a commander report.
3. Implement reproducible adapters for OpenClaw, Hermes, generic CLI agents, and human baselines.
4. Implement rule-based checks for required outputs, timing, schema validity, secret patterns, evidence references, and forbidden actions.
5. Add human or LLM-assisted judging for correctness, risk judgment, and report quality.
6. Publish a per-dimension leaderboard rather than only an overall rank.

## First Season Naming

- Project: Agent Olympics
- Repository: agent-olympics
- Season: Agent Olympics 2026
- Internal season option: Seoyoon Agent Olympics 2026
- Initial event names: Ops Relay, Node Readiness, Performance Trial, Code Sprint, Wiki Marathon, Safety Trial, Coordination Drill

## Validation

Task envelopes, result packets, and judge records can be validated against their JSON Schema definitions.

### Prerequisites

- Node.js >= 18

### Setup

```bash
npm install
```

### Validate All Files

```bash
npm test
# or: npx node scripts/validate.js all
```

### Validate Specific Categories

```bash
# Validate all task envelopes under tasks/ (v1 and v2)
node scripts/validate.js envelopes

# Validate only the current v2 task envelopes (tasks/season-001/*-v2.yaml)
node scripts/validate.js envelopes-v2

# Validate only smoke suite tasks (tasks/smoke/*.yaml)
node scripts/validate.js smoke

# Validate all result packets and judge records (results/*.yaml)
node scripts/validate.js packets

# Validate all judge records only
node scripts/validate.js judges

# Validate v2 documents specifically
node scripts/validate.js all-v2
```

### Validate a Single File

```bash
node scripts/validate.js tasks/season-001/code-001-typescript-regression-v2.yaml
node scripts/validate.js tasks/smoke/smoke-manifest.yaml
node scripts/validate.js fixtures/node-profiles/profile-stub-medium.yaml
```

The validator runs three layers of checks:

1. **Schema conformance** — YAML documents must match the JSON Schema
2. **Cross-field rules** — Evidence references must exist, timestamps must be consistent
3. **Secret detection** — Known credential patterns (API keys, tokens, private keys) should not appear

### Using Make (optional)

```bash
make validate       # Validate all (includes profiles)
make ci-round       # Source-only round lifecycle: validate -> init -> execute/stub -> score -> competition-validity
make live-runner-readiness-check  # Source-only readiness gate fixtures for live runner boundary
make round-hardening-check  # Focused run_id_template, strict fixture, and --run-id checks
make declaration-cross-check  # Cross-check declarations, artifacts, and delegation attribution
make validate-envelopes
make validate-packets
make validate-smoke  # Validate smoke suite only
make validate-profiles  # Validate node profile inventory
make participant-eligibility-check  # Validate source-only multi-adapter eligibility
```

## Smoke Suite

The smoke suite (`tasks/smoke/`) provides lightweight, short-duration tasks that
verify basic platform health before longer event-family tasks are attempted. Each
smoke task is a valid Task Envelope and is listed in the `smoke-manifest.yaml`.

The suite covers:
- **Gateway liveness** — is the gateway process alive?
- **Model round-trip** — can the agent reach an LLM?
- **Tool readiness** — are essential tools available?
- **File system sanity** — can the agent read and write safely?
- **Configuration inspection** — is the runtime configured correctly?
- **Network connectivity** — can the agent reach external endpoints?
- **Node capability report** — generates a structured capability matrix.

## Node Capability Matrix

The node capability schema (`schemas/node-capability.schema.json`) and
documentation (`docs/node-capability-matrix.md`) define a safe, non-secret format
describing an agent execution node's hardware, runtime, tools, services, and
overall readiness. It is designed for cross-node comparison and is compatible
with the existing task envelope and result packet schemas.

## Node Profile Inventory

The node profile inventory schema (`schemas/node-profile-inventory.schema.json`),
documentation (`docs/node-profile-inventory.md`), and sample profiles
(`fixtures/node-profiles/`) define a safe, non-secret format for declaring
available node capacity and capability **before a season starts**. Unlike the
live-generated capability matrix, profiles are static declarations operators
prepare in version control. They use band-based ranges (CPU cores, memory bands,
storage class) and capability labels, and explicitly exclude hostnames, IPs,
secrets, and infrastructure details.

Sample profiles for small, medium, and large node classes are provided at
`fixtures/node-profiles/profile-stub-*.yaml` for local/stub use.

Validate profiles:

```bash
node scripts/validate.js profiles
```

## Status

This repository starts as a planning and benchmark-design repo. It should become executable only after the schema, task fixtures, adapter contracts, and live runner boundary are stable.

For Season 001, the live execution boundary is explicit: Agent Olympics owns the
neutral task/result/judge contract and source/stub validation surface, while any
live runner or A2A transport integration must be implemented and approved as a
separate execution boundary. See
[Season 001 Live Runner and A2A Boundary](docs/live-runner-boundary-season-001.md).

The v1 schemas are frozen. The v1 Task Envelope and Result Packet schemas have
been retired to `archive/schemas/` (still loaded by the validator/scorer for
backward-compat validation of the remaining v1 documents):
- `archive/schemas/task-envelope.schema.json` — Task Envelope v1 (retired)
- `archive/schemas/result-packet.schema.json` — Result Packet v1 (retired)
- `schemas/judge-record.schema.json` — Judge Record v1
- `schemas/node-capability.schema.json` — Node Capability Matrix v1

v2 schemas add public/private separation and oracle cross-referencing:
- `schemas/task-envelope-v2.schema.json` — Task Envelope v2
- `schemas/result-packet-v2.schema.json` — Result Packet v2
- `schemas/judge-record-v2.schema.json` — Judge Record v2

See [docs/migration-v1-to-v2.md](docs/migration-v1-to-v2.md) for the migration guide.

## Public source visibility boundary

This repository is being prepared for possible public source visibility. A
public repository setting would be source-only: it would not approve release or
tag creation, package/image publication, production deploy/restart/reload,
database mutation, provider or Telegram sends, credential movement, history
rewrite, or any other live operation.

Runtime credentials and private operational data must stay outside the
repository. Example configuration must use placeholders only.
