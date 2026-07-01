# Season 002 Preview Plan

Season 002 Preview is a source-only rehearsal pack. It validates that the project can host a second-season round without live credentials, service restarts, provider sends, database replay/migration/prune, or remote-node mutation.

## Status

| Item | State |
|---|---|
| Round manifest | `rounds/season-002-round-001.yaml` |
| Task pack | `tasks/season-002/` |
| Dry-run runner config | `fixtures/live-runner/runner-config-season-002-preview.yaml` |
| Intended mode | source-only preview / invitational rehearsal |
| Official public scoring | not yet enabled |
| Preview 001 evidence | `archive/season-002/preview-001/` |
| Preview task tier | `verified` for source-only preview readiness only |

## Preview tasks

| Task | Family | Purpose |
|---|---|---|
| `ops-201` | Ops Relay | source-only incident triage and approval-gate discipline |
| `code-201` | Code Sprint | small harness validation fix with focused verification evidence |
| `node-201` | Node Readiness | ccc-node harness readiness audit and boundary reporting |

## Participants

The round manifest declares a compact preview set:

- `gwakga` — Hermes / Team2 broker profile
- `seoseo` — Hermes / Team1 broker profile
- `soonwook` — Hermes A2A profile
- `ccc-node-harness` — source-only named harness fleet: 노숙/nosuk, 순욱/soonwook, 등애/dungae, 공융/gongyung, 대교/daegyo. See [ccc-node Named Harnesses](ccc-node-named-harnesses.md).

The committed dry-run config dispatches only `gwakga` and the `ccc-node-harness` named fleet fixture so the repository can prove the pack without live broker or node calls. Other participants are declared for the preview round but require explicit operator-approved live or broker-backed dispatch before real competition use.

## Run locally

```bash
node scripts/validate.js all
node scripts/validate.js rounds
node scripts/round.js plan rounds/season-002-round-001.yaml
node scripts/live-runner.js run rounds/season-002-round-001.yaml \
  --config fixtures/live-runner/runner-config-season-002-preview.yaml
```

## Approval boundaries

Season 002 Preview does not approve:

- Gateway, broker, bridge, or production service restart;
- Telegram/provider canary or live send;
- database migration, prune, replay, or manual ACK/replay;
- credential movement or secret reads;
- SSH or remote-node mutation;
- release, tag, publication, or GitHub Pages enablement.

Those are separate explicit approval gates. Preview success means the source pack and dry-run runner path work; it does not make the event an official public competitive season.

## Promotion path

1. Keep this pack green under repository validation.
2. Run source-only dry-runs and preserve clean fan-in evidence.
3. Add judge/oracle material through private handling when tasks are promoted.
4. Record baseline and judge records for any task promoted from `smoke` to `verified`.
5. Enable leaderboard/publication only after a separate owner-approved publication decision.
