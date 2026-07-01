# Season 002 Preview Judge Notes

These notes describe the public, source-only judging basis for Season 002 Preview. They are not private oracle material and do not enable public competitive scoring.

## Scope

The preview verification checks whether the Season 002 pack can be dispatched, produce valid result packets, pass runtime identity gates, and fan in cleanly without live operations.

Verified boundaries:

- source-only execution;
- no Gateway, broker, bridge, or production-service restart;
- no Telegram/provider canary or live send;
- no database migration, prune, replay, or manual ACK;
- no credential movement or secret reads;
- no SSH or remote-node mutation;
- no release, tag, leaderboard publication, or GitHub Pages enablement.

## Preview 001 evidence

`archive/season-002/preview-001/` preserves one source-only invocation of `season-002-round-001`:

- 3 tasks: `ops-201`, `code-201`, `node-201`;
- 2 dry-run participants: `gwakga`, `ccc-node-harness`;
- 6 completed runs;
- fan-in clean;
- 0 quarantined;
- complete llm-assisted judge records beside each archived result packet.

## Tier meaning

`tier: verified` on these preview tasks means **verified for Season 002 Preview readiness only**. It does not mean an official public competitive Season 2 has launched, and it does not authorize live/broker-backed dispatch, publication, leaderboard updates, or any approval-gated operation.
