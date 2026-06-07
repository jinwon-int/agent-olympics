# Agent Olympics

Agent Olympics is a platform-neutral competition for evaluating how well the whole operating agent stack executes real missions across ops, coding, knowledge, safety, coordination, and performance events.

The project is intentionally not tied to OpenClaw. OpenClaw, Hermes, Codex, Claude Code, shell-based agents, and human baselines should all be able to compete by accepting the same task envelope and submitting the same result packet.

## Motto

Measure the whole operating agent stack, not just the model.

Agent Olympics is not an AI model benchmark alone. It is an olympics for the combined performance of the AI model, agent harness, tools, runtime, agent configuration, and operating principles in real mission work.

See [Constitution and Public Positioning](docs/constitution.md) for the
competition's guiding principles, platform-neutrality commitment, English
motto, and Korean working line.

## Current Status

Agent Olympics is an MVP evaluation framework with source packs, schemas,
validation tooling, adapter fixtures, and dry-run examples. It is ready for
schema and harness development. It is not yet a fully verified public
competition: most Season 001 tasks remain draft-tier until baseline runs and
judge records promote them to smoke or verified status.

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

See [Universal Participant Eligibility](docs/participant-eligibility.md) for
the adapter-neutral path that lets OpenClaw, Hermes, generic CLI/shell agents,
coding agents, future runtimes, and human baselines participate through the
same Task Envelope -> Result Packet interface.

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

Single-number leaderboards are useful, but they are not enough. A useful agent evaluation should expose strengths by dimension:

- Correctness
- Evidence quality
- Safety
- Autonomy
- Tool discipline
- Recovery behavior
- Configuration fitness
- Hardware and resource efficiency
- Communication
- Durability
- Cost and latency
- Configuration fitness
- Operating discipline

The default score is:

```text
final_score = quality_score
            + evidence_score
            + safety_score
            + durability_score
            - risk_penalty
            - unsupported_claim_penalty
            - secret_penalty
```

An agent that safely stops with a well-supported partial result should score higher than an agent that guesses, mutates production state without approval, or claims success without evidence.

Model identity should be visible for analysis, but it is only one part of the result. A smaller model with a disciplined harness, good tools, strong configuration, and reliable operating principles can beat a stronger raw model that uses tools poorly or violates safety constraints.

## Repository Layout

```text
schemas/
  task-envelope.schema.json       — Envelope schema (v1)
  result-packet.schema.json       — Result packet schema (v1)
  judge-record.schema.json        — Judge record schema (v1)
  task-envelope-v2.schema.json    — Envelope schema (v2)
  result-packet-v2.schema.json    — Result packet schema (v2)
  judge-record-v2.schema.json     — Judge record schema (v2)
oracle/
  season-001/                     — Private judge answer keys (oracle files)
    ops-001-telegram-final-reply.yaml
rubrics/
  agent-olympics-v1.yaml          — Scoring rubric
schemas/
  node-capability.schema.json     — Node capability matrix schema
  node-profile-inventory.schema.json — Node profile inventory schema
tasks/examples/
  ops-001-telegram-final-reply.yaml
  ops-002-clean-reinstall-drift.yaml
  node-001-agent-readiness-audit.yaml
  perf-001-node-throughput-baseline.yaml
  code-001-typescript-regression.yaml
  knowledge-001-wiki-closeout.yaml
  coord-001-commander-report.yaml
tasks/season-001/
  *-v2.yaml                       — v2 migration example(s)
tasks/smoke/
  smoke-manifest.yaml             — Smoke suite manifest (5+ candidate tasks)
  smoke-001-gateway-liveness.yaml
  smoke-002-model-roundtrip.yaml
  smoke-003-tool-readiness.yaml
  smoke-004-file-sanity.yaml
  smoke-005-config-inspection.yaml
  smoke-006-network-diagnostic.yaml
  smoke-007-node-capability.yaml
results/
  *.yaml                          — Example and submitted result packets
docs/
  rules.md
  competition-model.md
  live-runner-boundary-season-001.md — Season 001 live runner/A2A boundary
  task-envelope.md
  result-packet.md
  rubric.md
  events.md
  adapters.md
  reproducible-submission-contract.md
  references.md
  migration-v1-to-v2.md           — Migration guide
  judge-notes-season-001.md       — Judge notes (v1 method)
  node-capability-matrix.md       — Node capability documentation
  node-profile-inventory.md       — Node profile inventory documentation
  mvp-foundation-ratification.md  — MVP foundation issue status and follow-up map
scripts/
  validate.js                     — Schema + semantic validator (v1 + v2)
issues/
  reference-*.md
  roadmap-*.md
Makefile                          — Build/validation targets (requires make)
```

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
# Validate all task envelopes (tasks/examples/*.yaml, tasks/season-001/*.yaml)
node scripts/validate.js envelopes

# Validate only smoke suite tasks (tasks/smoke/*.yaml)
node scripts/validate.js smoke

# Validate all result packets and judge records (results/*.yaml)
node scripts/validate.js packets

# Validate all judge records only
node scripts/validate.js judges

# Validate v2 schemas specifically
node scripts/validate.js envelopes-v2
node scripts/validate.js all-v2
```

### Validate a Single File

```bash
node scripts/validate.js tasks/examples/ops-001-telegram-final-reply.yaml
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

The v1 schemas are frozen:
- `schemas/task-envelope.schema.json` — Task Envelope v1
- `schemas/result-packet.schema.json` — Result Packet v1
- `schemas/judge-record.schema.json` — Judge Record v1
- `schemas/node-capability.schema.json` — Node Capability Matrix v1

v2 schemas add public/private separation and oracle cross-referencing:
- `schemas/task-envelope-v2.schema.json` — Task Envelope v2
- `schemas/result-packet-v2.schema.json` — Result Packet v2
- `schemas/judge-record-v2.schema.json` — Judge Record v2

See [docs/migration-v1-to-v2.md](docs/migration-v1-to-v2.md) for the migration guide.
