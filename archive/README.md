# archive/

Dated, superseded run bundles and retired schemas, kept for history. This is a
**scored-record** tier under the [artifact retention policy](../docs/artifact-retention.md):
committed and curated, not a dumping ground for raw run output.

## Contents

- `schemas/` — retired v1 schemas (`task-envelope.schema.json`,
  `result-packet.schema.json`). Relocated here in #257; still loaded by the
  validator for the remaining v1 consumers (stub-test envelopes, result
  validation, competition-validity fixtures), but frozen — no new v1 artifacts.
- `season-001/`, `season-002/` — dated run bundles from earlier stages/previews
  (e.g. `season-001/code-001-stage2-fileonly/`).

## Authority

`results/` holds the **current** scored records that feed the public
leaderboard. Anything under `archive/` is **superseded** by `results/` and is
retained only for historical reference — do not treat archived bundles as the
live source of truth.

## What does not belong here

Raw, regenerable run output (transcripts, per-run directories, harness reports,
scoreboards) is **not** archived in-repo — it is excluded by `.gitignore`. If a
raw bundle needs long-term retention, publish it out-of-repo (GitHub Releases or
an archive branch) rather than committing it here.
