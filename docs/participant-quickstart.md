# Participant Quickstart

This guide is the shortest path from a fresh checkout to a valid source-only
submission shape. It is platform-neutral: OpenClaw, Hermes, CLI agents, coding
agents, future runtimes, and human baselines all use the same public contract.

Season 001 still runs in source-only/stub mode unless a live runner is
implemented and separately approved. Do not add credentials or live endpoints to
fixtures, result packets, traces, or issue comments.

## Architecture Flow

```text
Task Envelope
  -> Adapter or human procedure
  -> Result Packet
  -> Trace Record + Evidence Bundle
  -> Declaration Cross-Check
  -> Judge Record
  -> Scoreboard
```

| Stage | Owner | Main files |
|---|---|---|
| Task Envelope | Curator | `tasks/season-001/*-v2.yaml`, `schemas/task-envelope-v2.schema.json` |
| Adapter declaration | Participant/operator | `fixtures/adapters/capabilities/*.yaml` |
| Run selection | Runner/curator | `rounds/season-001-round-*.yaml` |
| Result Packet | Participant | `schemas/result-packet-v2.schema.json`, `results/*.yaml` |
| Trace/evidence | Participant/adapter | `schemas/trace-record.schema.json`, `schemas/evidence-bundle.schema.json` |
| Declaration check | Runner/judge | `scripts/declaration-cross-check.js` |
| Judge Record | Judge | `schemas/judge-record-v2.schema.json` |
| Scoreboard | Runner/judge | `scripts/score.js`, `schemas/scoreboard.schema.json` |

## Fast Local Smoke Path

```bash
npm ci
npm test
make validate
node scripts/round.js plan rounds/season-001-round-001.yaml
make ci-round
```

This proves the repository schemas, fixtures, adapter samples, round planning,
stub execution, scoring, and competition-validity checks all work locally.

## How To Participate

1. Choose a division.

   Use `closed_stack`, `open_stack`, `human_baseline`, or `node_class`. See
   [Competition Model](competition-model.md) and [Rules](rules.md).

2. Pick an adapter path.

   Use an existing capability declaration under
   `fixtures/adapters/capabilities/`, or add a new platform-neutral declaration
   following `schemas/adapter-capability-declaration.schema.json`. The adapter
   declaration says what the runtime can produce and what redaction rules it
   applies.

3. Inspect the task envelope.

   Start with a public Season 001 envelope in `tasks/season-001/`. Read the
   allowed actions, forbidden actions, required outputs, fixture references, and
   scoring rubric. Do not use oracle or hidden judge notes as participant
   input.

4. Produce a result packet.

   Submit a `result-packet.yaml` that declares safe labels for runtime, model,
   node/config profile, tool use, operating policy, delegation, evidence,
   findings, and outputs. Use the v2 schema when possible.

5. Attach trace and evidence.

   Include a trace record and evidence bundle when the adapter can produce
   them. Evidence should point to concrete files, logs, commands, PRs, test
   output, or transcripts, with secrets redacted by value-free reasons.

6. Run source-only checks.

   ```bash
   npm test
   make declaration-cross-check
   make validate
   ```

   Use `make ci-round` when checking the round lifecycle itself.

7. Submit for judging.

   Judges score the result packet and evidence, then write a judge record and
   update the scoreboard. For delegated work, the top-level
   `result_packet.agent_id` remains the owner of record; supporting agents are
   attributed in `delegation_profile.supported_by` or
   `delegation_profile.a2a_workers`.

## Minimal Stub Submission

The deterministic local smoke path uses the stub adapter:

```bash
node scripts/round.js init rounds/season-001-round-001.yaml --strict
node scripts/round.js execute rounds/season-001-round-001.yaml --seed local-smoke
```

For a clean one-command source-only lifecycle check, prefer:

```bash
make ci-round
```

The output under `.tmp/ci-round/` is disposable. It demonstrates the artifact
shape without claiming a live competitive result.

## What Not To Put In A Submission

- Raw credentials, tokens, private keys, cookies, hostnames, IP addresses, or
  private paths.
- Oracle files, hidden judge notes, or answer keys.
- Live dispatch claims unless the live runner boundary has been implemented and
  approved for that round.
- Unattributed subagent, A2A worker, background job, or human assistance.

## Issue Files

Checked-in `issues/*.md` files are design notes, historical roadmap slices, or
reference material captured before/alongside GitHub issues. Current work
tracking lives in GitHub issues and PRs. Treat `issues/*.md` as context unless a
current GitHub issue explicitly points to one.
