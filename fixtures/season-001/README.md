# Season 001 Fixture Bundles — Runner Guide

This directory contains *fixture bundles* for the Agent Olympics 2026
Season 001 events.  A fixture bundle is the external data a runner must
prepare *before* a participant starts a task.  Fixtures are
**participant-facing only** — no judge notes, answer keys, or oracle
material lives here.

## Layout

```
fixtures/
  season-001/
    manifest.yaml              ← Season-level bundle index (start here)
    README.md                  ← This file
    code-001/
      manifest.yaml            ← Bundle metadata
      ...                      ← Fixture data files
    coord-001/
      manifest.yaml
      ...
    knowledge-001/
      manifest.yaml
      ...
    node-001/
      manifest.yaml
      variants/
        practice-image-001/     ← official-practice image hardening fixture
        hidden-image-001/       ← held-out image hardening fixture
    ops-001/
      manifest.yaml
      ...
    ops-002/
      manifest.yaml
      ...
    perf-001/
      manifest.yaml
      ...
```

## Fixture Naming Convention

| Element | Convention | Example |
|---|---|---|
| Season directory | `season-XXX` | `season-001/` |
| Bundle directory | `<task_id>` | `code-001/` |
| Bundle manifest | `manifest.yaml` | `manifest.yaml` |
| Bundle identifier | `season-XXX-<task_id>-v<N>` | `season-001-code-001-v1` |
| Season manifest | `manifest.yaml` at season root | `fixtures/season-001/manifest.yaml` |

## How a Runner Selects a Fixture Bundle

### For a Dry Run

1. **Read the season manifest:**
   ```bash
   cat fixtures/season-001/manifest.yaml
   ```
   This lists every available bundle, its path, and its `dry_run_compatible`
   flag.  All Season 001 bundles are `dry_run_compatible: true`.

2. **Select the bundle for the target task:**
   Find the bundle whose `task_id` matches the task you want to run.
   Each bundle entry includes a `path` field.

3. **Read the bundle manifest:**
   ```bash
   cat fixtures/season-001/<task_id>/manifest.yaml
   ```
   The `files` section lists every fixture file the runner must prepare.
   The `preparation` section tells you how to create or obtain each file.

4. **Prepare the fixture data:**
   Follow the `preparation.description` instructions.  For most bundles
   this means:
   - Writing a few YAML or Markdown files with synthetic data
   - Running a generation script (`method: generated`)
   - Cloning an external repo (`method: external_repo`)
   - Configuring a test node (`method: env_dependent`)

5. **Place files at the expected paths:**
   The task envelope's `fixtures` field references paths relative to the
   bundle directory.  Ensure those files exist before starting the
   participant.

### For a Competitive Round

The same selection process applies, but **fixture content must be
deterministic and reproducible** so every participant sees the same
challenge.  The runner should:

- Generate fixtures from a fixed seed
- Record the seed and generation parameters in the run record
- Verify fixture integrity before each participant starts
- Use the same bundle version for all participants in a round

### Dry Run vs Competitive Selection

| Aspect | Dry Run | Competitive Round |
|---|---|---|
| Fixture content | May be simplified or abbreviated | Full, representative challenge |
| Determinism | Not required | Required (fixed seed) |
| Generation time | Fast (minutes) | May be longer (prepared in advance) |
| Judge material exposure | Zero (no oracle/keys in fixtures) | Zero |
| Repeated across participants | No | Yes |
| Version pinning | Latest bundle version | Specific bundle version (pinned in run record) |

## Integrity Checks

The runner should verify:

1. **Fixture manifest validates** against the fixture bundle schema:
   ```bash
   node scripts/validate.js fixtures/season-001/<task_id>/manifest.yaml
   ```

2. **All referenced files exist** at the expected paths.

3. **No judge material** is present in fixture files (the validator will
   warn on `secret`-like key names; the runner should also manually scan
   in competitive rounds).

4. **Dry-run compatibility** is confirmed (`dry_run_compatible: true`).

## Private Judge Material

The following directories contain **private** judge material and must
never be included in fixture bundles:

| Directory | Contents |
|---|---|
| `oracle/season-001/` | Structured answer keys and scoring guidance |
| `docs/judge-notes-season-001.md` | Full judge methodology and per-event scoring notes |

If you need to verify that no private material leaked into a fixture
bundle, run the validator in `fixtures` mode:
```bash
node scripts/validate.js fixtures
```

The validator does not *guarantee* absence of secrets (that is the
runner's responsibility), but it flags known patterns.

## Related Documents

- [Task Envelope](/docs/task-envelope.md) — How task envelopes reference
  fixtures via the `fixtures` field.
- [Task Verification](/docs/task-verification.md) — Promotion workflow
  for tasks and their fixtures.
- [Agent Olympics Competition Model](/docs/competition-model.md) —
  Overall competition structure.
- [Oracle Answer Keys](/oracle/season-001/) — Private oracle files
  (not shared with participants).
