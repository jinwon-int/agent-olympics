# ccc-node Harness Participant

`ccc-node` is a sanitized node bootstrap and validation harness for Hermes/Claude Code-style nodes. In Agent Olympics it should be registered as a **harness/support adapter**, not as a standalone reasoning model.

## Identity

| Field | Value |
|---|---|
| Adapter capability | `fixtures/adapters/capabilities/ccc-node-harness.yaml` |
| Node profile | `fixtures/node-profiles/profile-ccc-node-harness-vps7.yaml` |
| Source-only runner fixture | `fixtures/live-runner/runner-config-ccc-node-harness.yaml` |
| Runtime family | CLI/Hermes support harness |

The harness can produce reproducible setup, validation, readiness, and redaction evidence. A competitive result packet must still disclose the paired reasoning runtime, such as Hermes or a generic CLI coding agent.

## What it may contribute

- no-network smoke test output;
- schema and harness validation output;
- bridge, memory, and `agent-cron status --json` summaries;
- read-only fleet-matrix summaries over already-collected evidence;
- documentation/readiness evidence and approval-boundary reports.

## What it must not imply

Registering the harness does **not** approve or perform:

- Gateway, broker, bridge, or production service restarts;
- Telegram/provider canaries or live sends;
- database migration, prune, replay, or manual ACK/replay;
- credential movement or secret reads;
- remote-node mutation.

Those remain separate operator-approved live actions. Public fixtures must stay source-only and value-free.

## Registration path

1. Validate the adapter capability declaration:

   ```bash
   node scripts/validate.js adapter-capabilities
   ```

2. Validate the node profile:

   ```bash
   node scripts/validate.js profiles
   ```

3. Exercise the source-only runner fixture:

   ```bash
   node scripts/live-runner.js run fixtures/live-runner/round-live-runner-fixture.yaml \
     --config fixtures/live-runner/runner-config-ccc-node-harness.yaml
   ```

4. For a real competitive run, register the participant in the target round manifest and point the runner config at the approved harness/runtime command. The result packet must attribute the finalizer and any supporting A2A/Hermes workers in `delegation_profile`.

## Safety note

Use `ccc-node-harness` for reproducibility and readiness evidence. In operator-facing summaries, display it as the named ccc-node harness fleet — 노숙/nosuk, 순욱/soonwook, 등애/dungae, 공융/gongyung, 대교/daegyo — instead of an anonymous single node. Do not score it as a model unless the round explicitly evaluates harness quality rather than reasoning output.

See also [ccc-node Named Harnesses](ccc-node-named-harnesses.md).
