# Agent Olympics

Agent Olympics is a platform-neutral competition for evaluating how well autonomous agents and their nodes are configured to execute real missions across ops, coding, knowledge, safety, coordination, and performance events.

The project is intentionally not tied to OpenClaw. OpenClaw, Hermes, Codex, Claude Code, shell-based agents, and human baselines should all be able to compete by accepting the same task envelope and submitting the same result packet.

## Goals

- Compare agent work quality, not vendor branding or runtime internals.
- Measure node-agent readiness: model/provider setup, runtime configuration, tool availability, memory policy, liveness behavior, and recovery posture.
- Evaluate practical operations work: diagnosis, safe recovery, code changes, documentation, and command of other agents.
- Separate raw hardware capacity from configuration quality so stronger machines are recognized without hiding tuning or setup problems.
- Reward evidence-backed conclusions over fast unsupported answers.
- Penalize unsafe actions, secret exposure, destructive changes, and false completion claims.
- Preserve reusable results as tasks, rubrics, transcripts, issues, and wiki-ready runbooks.

## Core Model

Agent Olympics has three stable concepts.

1. Task Envelope

   A platform-neutral input file that describes the task, limits, allowed actions, forbidden actions, required outputs, and scoring rubric.

2. Result Packet

   A platform-neutral output file submitted by the participant. It records the runtime, model metadata, action trace summary, evidence, findings, risks, final answer, and durable-memory decision.

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

## Repository Layout

```text
schemas/
  task-envelope.schema.json   — Envelope schema (v1)
  result-packet.schema.json   — Result packet schema (v1)
  judge-record.schema.json    — Judge record schema (v1)
rubrics/
  agent-olympics-v1.yaml      — Scoring rubric
tasks/examples/
  ops-001-telegram-final-reply.yaml
  ops-002-clean-reinstall-drift.yaml
  node-001-agent-readiness-audit.yaml
  perf-001-node-throughput-baseline.yaml
  code-001-typescript-regression.yaml
  knowledge-001-wiki-closeout.yaml
  coord-001-commander-report.yaml
results/
  *.yaml                      — Example and submitted result packets
docs/
  competition-model.md
  task-envelope.md
  result-packet.md
  rubric.md
  events.md
  adapters.md
  references.md
scripts/
  validate.js                 — Schema + semantic validator
issues/
  reference-*.md
  roadmap-*.md
Makefile                      — Build/validation targets (requires make)
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
3. Implement adapters for OpenClaw, Hermes, and generic CLI agents.
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
# Validate all task envelopes (tasks/examples/*.yaml)
node scripts/validate.js envelopes

# Validate all result packets and judge records (results/*.yaml)
node scripts/validate.js packets
```

### Validate a Single File

```bash
node scripts/validate.js tasks/examples/ops-001-telegram-final-reply.yaml
```

The validator runs three layers of checks:

1. **Schema conformance** — YAML documents must match the JSON Schema
2. **Cross-field rules** — Evidence references must exist, timestamps must be consistent
3. **Secret detection** — Known credential patterns (API keys, tokens, private keys) should not appear

### Using Make (optional)

```bash
make validate       # Validate all
make validate-envelopes
make validate-packets
```

## Status

This repository starts as a planning and benchmark-design repo. It should become executable only after the schema, task fixtures, and adapter contracts are stable.

The v1 schemas are frozen:
- `schemas/task-envelope.schema.json` — Task Envelope v1
- `schemas/result-packet.schema.json` — Result Packet v1
- `schemas/judge-record.schema.json` — Judge Record v1
