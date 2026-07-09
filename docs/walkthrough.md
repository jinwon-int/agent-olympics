# End-to-end walkthrough (stub adapter)

This tutorial runs one task through the full pipeline —
**Task Envelope → Adapter → Result Packet + Trace + Evidence → Judge Record →
Scoreboard** — with no live nodes, credentials, or providers. Everything uses
the deterministic stub adapter, so it is safe to run anywhere.

Prerequisites: Node.js ≥ 18 and `make`. Install dev/runtime deps once with
`npm ci` (or `npm install`).

## The fast path

The source-only CI gate does the whole lifecycle end to end:

```bash
make ci-round
```

This picks one task and one participant from `rounds/season-001-round-001.yaml`,
runs validate → init → execute (stub) → score → competition-validity in a
temporary workspace, and asserts every stage passes. Read on for what each stage
produces.

## The stages, one at a time

### 1. Task Envelope — the input
A [task envelope](task-envelope.md) (`tasks/season-001/*-v2.yaml`) declares the
objective, allowed/forbidden actions, required outputs, and its `rubric_ref` /
`oracle_ref` / `judge_notes_ref`. Validate it:

```bash
node scripts/validate.js tasks/season-001/ops-001-telegram-final-reply-v2.yaml
```

### 2. Round plan & init — bind tasks × participants
A [round manifest](round-engine.md) (`rounds/*.yaml`) lists the tasks and
participants. Plan (dry-run) then initialize the run directories:

```bash
node scripts/round.js plan rounds/season-001-round-001.yaml
node scripts/round.js init rounds/season-001-round-001.yaml
```

### 3. Adapter execute — produce the Result Packet
The [adapter](adapters.md) runs the task and writes a
[result packet](result-packet.md) plus a trace record and evidence bundle into
the [run directory](run-directory.md). The stub adapter is deterministic:

```bash
node scripts/round.js execute rounds/season-001-round-001.yaml
# Adapter timeout is configurable: --adapter-timeout-ms <n> (default 120000)
```

Each `run-*/` directory now contains `result-packet.yaml`, `trace.yaml`,
`evidence-bundle.yaml`, and run metadata. The engine validates these artifacts
against their schemas as it goes.

### 4. Judge Record — score the packet
A [judge record](judge-harness.md) scores the packet against the rubric. The
three automatic dimensions are computed from packet content; the three pending
dimensions need a human or [blind judge](scoring.md). Exercise the judge harness
fixtures with:

```bash
make judge-fixtures
```

### 5. Scoreboard — aggregate
`make score` regenerates `results/scoreboard.json` from the committed judge
records, and the [web result bridge](web-result-data-bridge.md) renders the
[public leaderboard](public-leaderboard.md) in blind mode:

```bash
make score
node scripts/web-result-consumer.js results/scoreboard.json --blind --output-dir public-site
```

## Where to go next
- [Scoring model](scoring.md) — how the 100 points break down
- [Live runner](live-runner.md) — running against real nodes (gated; not part of
  this source-only path)
- [Glossary](glossary.md) — term definitions
