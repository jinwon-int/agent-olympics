# CLI Participant (generic coding-agent CLI)

Agent Olympics is platform-neutral: OpenClaw, Hermes, CLI coding agents (Claude
Code, Codex, any argv command), and human baselines all compete through the same
task-envelope / result-packet contract. This document describes the **CLI
participant** path — a generic coding-agent CLI run as a live-runner
participant — and how it exercises whether the schemas/gates/scoring are
genuinely runtime-neutral.

> **Boundary honesty.** This is the **simulation / source-only slice**. The
> committed fixtures point the wrapper at an offline fake `claude`-like binary
> (`fixtures/live-runner/transports/fake-claude-cli.js`) so the whole path runs
> with no network and no credentials. Pointing the wrapper at a real Claude
> Code / Codex install is an **operator extension** — this repository does not
> own model endpoints or credentials.

## Pieces

| Piece | File | Role |
|---|---|---|
| Skeleton generator | `scripts/cli-adapter.js` | Produces a schema-valid **result-packet v2** baseline labelled `runtime: cli` / `adapter: cli`, matching the CLI capability declaration (`fixtures/adapters/capabilities/cli.yaml`). Solo: `delegation_profile.subagents_used: false`, no `a2a_workers`. CLI-native evidence kinds (`command_output` / `log` / `file_diff` / `config_snippet` / `transcript_excerpt`). |
| Mission wrapper | `adapters/wrappers/cli-mission-wrapper.sh` | The CLI analogue of `hermes-mission-wrapper.sh`: bootstraps the skeleton, invokes the coding-agent CLI with the same marker-wrapped-JSON mission prompt contract, merges, validates, and applies the parse-fallback → partial / exit-2 discipline, wall-time measurement, and model attestation. |
| Merge (shared) | `scripts/cli-mission-result-merge.js` → `scripts/lib/mission-result-merge.js` (`cli` profile) | Merges the captured CLI output into the skeleton. Shared with the Hermes wrapper (the merge core is parameterized by an evidence-id mapping + execution shape, not forked). Redacts secrets before persisting, normalizes hallucinated evidence ids against the packet's real evidence set, downgrades a parse-fallback packet to `partial`. |
| Model attestation | `scripts/cli-model-detect.js` → `scripts/lib/model-detect.js` | Detects the routed model from the CLI (`--version` / config commands) and records `model_source` honestly: `cli_config` / `operator_env` / `unknown`. Shared parser with the Hermes model probe. |
| Simulation transport | `fixtures/live-runner/transports/fake-claude-cli.js` | A tiny offline fake `claude`-like binary so the CLI participant runs fully offline. |

The CLI wrapper **reuses, never forks**: it shares the live runner, the merge
logic (generalized), the secret-patterns, and the attestation parser rather
than duplicating them.

## Registering a CLI agent

1. **Register the participant in a round manifest** with `runtime: cli`:

   ```yaml
   participants:
     - agent_id: claude-cli
       runtime: cli
       label: generic coding-agent CLI participant
       enabled: true
   ```

2. **Add a runner-config participant** whose `adapter` is `cli` (it must match
   the manifest `runtime` — the `runtime_identity` gate enforces this) and
   whose `command` invokes the wrapper. Point `CLI_AGENT_BIN` at the agent
   binary via `env` (no shell — `env` is a real argv[0]):

   ```yaml
   participants:
     - participant_id: claude-cli
       adapter: cli
       transport: local_exec
       execution_profile: dry_run
       command:
         - env
         - CLI_AGENT_BIN=fixtures/live-runner/transports/fake-claude-cli.js
         - bash
         - adapters/wrappers/cli-mission-wrapper.sh
         - '{envelope}'
         - '{run_dir}'
         - '{agent_id}'
   ```

   A working example lives at `fixtures/live-runner/runner-config-cli.yaml`.

3. **Dispatch**:

   ```bash
   node scripts/live-runner.js run fixtures/live-runner/round-live-runner-fixture.yaml \
     --config fixtures/live-runner/runner-config-cli.yaml
   ```

## Wrapper environment variables

| Variable | Default | Purpose |
|---|---|---|
| `CLI_AGENT_BIN` | `claude` | The coding-agent CLI binary to invoke. Set to `codex`, a real `claude`, or any argv command. |
| `CLI_AGENT_ARGS` | (empty) | Space-separated run subcommand/flags the agent needs (e.g. `-p` for print mode). The wrapper appends the mission prompt as the final argument. |
| `CLI_AGENT_INFO_ARGS` | (auto-probe) | Overrides the model-attestation info invocation when the CLI prints its `Model:` line under a non-standard command. |
| `CLI_AGENT_MODEL` / `CLI_AGENT_MODEL_PROVIDER` | (unset) | **Fallback only**: used when model detection from the CLI fails. A successful detection wins over the env; a mismatch prints a warning. Unresolved values are recorded as `unknown`, never a fabricated default. |
| `CLI_NODE` | `unknown` | Records the node identity in the packet's comparable metadata. |
| `AGENT_OLYMPICS_REPO` | (auto) | Repo root when invoking the wrapper from outside this checkout. |

## Model-attestation story

`CLI_AGENT_MODEL` env labels are trust-based. The wrapper detects the routed
model directly from the CLI (`scripts/cli-model-detect.js` parses a `Model:`
line from `--version` / config commands) and records which path won in the
packet's probe evidence (`ev-cli-probe`):

```
model_source=cli_config   # detected from the CLI
model_source=operator_env # detected failed, fell back to CLI_AGENT_MODEL
model_source=unknown      # neither available — recorded as "unknown", not faked
```

This mirrors the Hermes model-attestation story (a real fleet run shipped a
wrong env label, so detection-over-env closes that gap). It catches honest
mistakes, not adversarial spoofing.

## Mission prompt constraints

The wrapper tells the CLI agent to use only participant-facing/public files and
**not** to read oracle files, judge notes, hidden judge notes, or private answer
keys — the same constraints as the Hermes wrapper. If the agent returns non-JSON
text, the merge script preserves the raw output (secret-redacted) in
`mission-result.raw.txt`, writes a fallback result that still validates, flags
the parse fallback, and the wrapper exits 2 so the runner maps the run to
`partial`.

## Runtime neutrality

A genuine CLI participant is detected as `cli` by all three runtime-identity
layers:

- **Layer 1 (declaration):** the `runtime_identity` gate accepts `cli` as
  cleanly as `hermes` (config `adapter: cli` == manifest `runtime: cli`).
- **Layer 2 (attestation):** the optional `identify_command` probe attests the
  binary; recorded value-free.
- **Layer 3 (fingerprint):** `scripts/lib/runtime-fingerprint.js` detects `cli`
  from the artifact shape — CLI-native evidence kinds (`transcript_excerpt` /
  `file_diff`), `ev-cli-*` evidence ids, adapter mode `cli`, and the solo
  `delegation_profile` (no subagents, no a2a_workers). This is the
  distinguishing shape of a bare coding-agent CLI vs an orchestrator.

The CLI participant fixture (`make live-runner-fixtures`) asserts all of the
above end-to-end against the offline fake binary.
