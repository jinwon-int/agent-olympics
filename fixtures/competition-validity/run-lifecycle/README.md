# Run Lifecycle Validation Fixtures

These fixtures simulate full run directories (inside a round's `run_directory`)
to test that `scripts/competition-validity.js` correctly validates the entire
run lifecycle: manifests, engine outputs, cross-document consistency, and
forbidden/unsafe artifact references.

## Fixture Layout

```
run-lifecycle/
  README.md
  season-001-round-001/              # Simulated round directory
    run-yukson-complete/             # Fully valid run — should PASS all checks
    run-yukson-incomplete/           # Missing engine outputs — should FAIL completeness
    run-yukson-corrupted/            # Malformed manifest — should FAIL manifest integrity
    run-yukson-unsafe/               # Secrets, destructive actions, bad refs — should FAIL safety
```

Each `run-*/` directory simulates a run subdirectory inside a round's
`run_directory`. The directory name format `run-{agent_id}-{descriptor}`
is used for fixture testing.

## File Naming Convention

- `run-yukson-complete/` — Run expected to PASS all competition-validity checks
- `run-yukson-incomplete/` — Run expected to FAIL completeness checks
- `run-yukson-corrupted/` — Run expected to FAIL manifest integrity
- `run-yukson-unsafe/` — Run expected to FAIL safety/forbidden-metadata checks

## Running

```bash
# Run full competition-validity check on the round directory
node scripts/competition-validity.js all fixtures/competition-validity/run-lifecycle/season-001-round-001

# Generate compact lifecycle summary (JSON) for leaderboard/import tooling
node scripts/competition-validity.js lifecycle-summary fixtures/competition-validity/run-lifecycle/season-001-round-001
```

## Validation Coverage

| Run Dir | Manifest | Engine Outputs | Cross-Doc | Forbidden Metadata |
|---|---|---|---|---|
| `run-yukson-complete` | ✓ valid | ✓ all present | ✓ consistent | ✓ none |
| `run-yukson-incomplete` | ✓ present | ✗ missing packet/trace/judge | — | — |
| `run-yukson-corrupted` | ✗ invalid lifecycle, missing fields | — | ✗ task_id mismatch | — |
| `run-yukson-unsafe` | ✓ present | ✓ present | — | ✗ secrets, destructive, bad refs |

## Lifecycle Summary Output

The `lifecycle-summary` command produces a compact JSON document with:

- Per-run validation status, lifecycle state, and packet status
- Cross-document field consistency checks
- Raw measurements and scored values (for leaderboard)
- Judge scores (total_score, verdict, dimension scores)
- Comparable metadata (runtime, model, node, config)
- Task and agent aggregation (valid/invalid counts per task and per agent)

Example:

```bash
node scripts/competition-validity.js lifecycle-summary \
  fixtures/competition-validity/run-lifecycle/season-001-round-001
```

## Related

- [Competition-Validity README](../README.md) — Parent fixture documentation
- `scripts/competition-validity.js` — The validator that uses these fixtures
- `scripts/round.js` — Round engine that produces run directories
