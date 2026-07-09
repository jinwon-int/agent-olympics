# Glossary

Definitions of the custom terms used across Agent Olympics. See the
[documentation index](README.md) for where each concept is specified in full.

## Core artifacts

- **Operating agent stack** — the full system under evaluation: the model plus
  its harness, tools, configuration, and operating principles. Agent Olympics
  scores the *stack*, not the raw model. (Motto: *운영 에이전트 스택 전체를
  측정한다* — "measure the whole operating agent stack".)
- **Task Envelope** — a platform-neutral input file describing a task: objective,
  limits, allowed/forbidden actions, required outputs, and rubric reference. See
  [task-envelope.md](task-envelope.md).
- **Result Packet** — the participant's output for a task: status, evidence,
  findings, outputs, and (v2) tool-use / operating-policy / delegation /
  comparable-metadata blocks. See [result-packet.md](result-packet.md).
- **Trace Record / Evidence Bundle** — the action trace and collected evidence
  artifacts produced alongside a result packet in a run directory. See
  [run-directory.md](run-directory.md).
- **Judge Record** — a human or automated scoring record for a result packet,
  scored against the rubric without depending on private runtime details. See
  [judge-harness.md](judge-harness.md).
- **Oracle** — the private judge answer key for a task (`oracle/<season>/…`),
  referenced by tasks via `oracle_ref`. Never shipped to participants.
- **Rubric** — the scoring definition; see [rubric.md](rubric.md) and
  [scoring.md](scoring.md).

## Scoring & judging

- **Blind judge** — a judging mode that withholds participant identity, model,
  and node, scoring only from packet content so identity can't bias the score.
- **Comparable metadata** — the normalized participant / runtime / model / node /
  task descriptors on a v2 result packet used for cross-run comparison.
- **A2A effectiveness** — a measure of how much an agent-to-agent (multi-worker)
  setup helped versus a solo run. See
  [a2a-effectiveness-benchmark.md](a2a-effectiveness-benchmark.md).
- **Longitudinal snapshot** — a point-in-time capture used to track a
  participant's results across rounds/seasons. See
  [longitudinal-measurement.md](longitudinal-measurement.md).
- **Proof-token** — a verifiable token asserting a claimed fact (e.g. a run was
  produced under stated conditions). See
  [proof-token-verification.md](proof-token-verification.md).
- **Human baseline** — a reference run completed by a human (or trusted baseline
  agent) used to calibrate difficulty and verify tasks. See
  [human-baseline.md](human-baseline.md).

## Execution & governance

- **Round** — a manifest binding tasks × participants that is planned, executed,
  scored, and archived. See [round-engine.md](round-engine.md).
- **Fan-in report** — the aggregation of many per-run outputs from a round into a
  single dispatch/results summary.
- **Broker finalizer** — in the A2A worker model, the single worker responsible
  for finalizing a claimed task with evidence (one finalizer per task).
- **Accreditation access zones** — the scoped access grants (and delegation
  boundaries) an accredited participant/observer is entitled to. See
  [accreditation-access-zones.md](accreditation-access-zones.md).
- **Node profile inventory** — the declared hardware/OS/runner-limit profile of a
  competition node. See [node-profile-inventory.md](node-profile-inventory.md).

## Event families

The task categories a season draws from — see [events.md](events.md):
`ops`, `code`, `coord` (coordination), `knowledge`, `node`, `perf`
(performance), `tool`, and `cyber` (remediation / safety-trial).

## Participant codenames

Participants use romanized Korean codenames rather than node/model identities
(withheld under blind judging): **sogyo, seoseo, nosuk, dungae, bangtong,
yukson, soonwook, gwakga, jingun, gongyung, daegyo**, plus infrastructure
harnesses such as **ccc-node-harness**. The authoritative set is derived from
`rounds/` and `results/` (see `scripts/identity-blocklist.js`).
