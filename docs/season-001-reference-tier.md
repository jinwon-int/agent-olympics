# Season 001 reference tier & oracle privacy model

This documents the resolution of the committed-answer-keys issue (#256) and the
privacy model going forward.

## Decision: Season 001 keys are public reference material

The Season 001 `oracle/season-001/*.yaml` answer keys and
[`docs/judge-notes-season-001.md`](judge-notes-season-001.md) were committed to
git (HEAD and history). Rather than rewrite history, Season 001 is treated as
**spent, public reference/practice material**:

- Season 001 answer keys, trap tokens, and judge guidance are **public**. Their
  headers say so.
- **Season 001 tasks are reference/practice tier and MUST NOT be used for blind
  competitive scoring** — a participant can read the expected answers, so a
  Season 001 "competition" score is not a blind result. Season 001 results in
  `results/` are historical/practice records, not a blind leaderboard.
- This is honest about the current state: the keys are already in git history,
  so any existing clone already has them; a history rewrite would not un-leak
  them and would break every clone/fork/PR.

## Privacy model from Season 002 onward

Real blind scoring resumes with a private oracle pipeline:

1. **Keys live outside the public repo.** Season 002+ `oracle/` and judge-notes
   are kept in private storage (a private repo / submodule / out-of-band
   judging environment), never committed to this repository.
2. **`.gitignore` blocks them.** `oracle/season-002/` and later, and
   `docs/judge-notes-season-0[2-9]*.md`, are git-ignored so they cannot be
   committed by accident.
3. **Tasks reference keys by opaque pointer.** `oracle_ref` / `judge_notes_ref`
   remain in the task envelopes but resolve only in the private judging
   environment.
4. **The validator tolerates absent keys.** `scripts/validate.js` already emits
   a *warning* (not an error) when an `oracle_ref` / `judge_notes_ref` target is
   missing on disk, so the public repo validates cleanly without the private
   keys present.

## Auditing new material

Before committing anything under `oracle/` or a `judge-notes-*.md` for a season
that is meant to be scored blind, confirm it is the private pipeline (ignored /
out-of-repo), not a public commit. See the
[artifact retention policy](artifact-retention.md).
