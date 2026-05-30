# Season 001 Qualification Fixture Bundle — Runner Guide

This fixture bundle contains synthetic qualification data for Season 001 of
Agent Olympics. It provides example entry records in various states, a manifest
aggregating them, and seeding metadata for the round engine.

**Important:** This is a *fixture*, not live qualification data. All entries
are synthetic and built for validation, testing, and reference purposes.

## Layout

```
fixtures/season-001-qualification/
  manifest.yaml              ← Qualification manifest (aggregated roster)
  README.md                  ← This file
  entries/
    entry-operator-001.yaml  ← Open entry for sogyo (openclaw, open stack)
    entry-operator-002.yaml  ← Open entry for yukson (openclaw, open stack)
    entry-operator-003.yaml  ← Open entry for nosuk (hermes, open stack)
    entry-qualifier-001.yaml ← Qualified entry for a closed-stack agent
    entry-team-001.yaml      ← Team quota entry for team1
    entry-invited-001.yaml   ← Invited entry for a CLI baseline
    entry-universality-001.yaml ← Universality slot for human baseline
    entry-withdrawn-001.yaml ← Withdrawn entry (example of state transition)
```

## Fixture Entry Types

| Entry | Type | State | Runtime | Division |
|---|---|---|---|---|
| `entry-operator-001` | `open_entry` | `seeded` | `openclaw` | `open_stack` |
| `entry-operator-002` | `open_entry` | `accepted` | `openclaw` | `open_stack` |
| `entry-operator-003` | `open_entry` | `eligible` | `hermes` | `open_stack` |
| `entry-qualifier-001` | `qualified_entry` | `seeded` | `openclaw` | `closed_stack` |
| `entry-team-001` | `open_entry` (team quota) | `accepted` | `openclaw` | `open_stack` |
| `entry-invited-001` | `invited` | `eligible` | `cli` | `open_stack` |
| `entry-universality-001` | `universality` | `registered` | `human` | `human_baseline` |
| `entry-withdrawn-001` | `open_entry` | `withdrawn` | `openclaw` | `open_stack` |

## Usage

```bash
# Validate the qualification manifest
node scripts/validate.js qualifications

# Validate a single entry
node scripts/validate.js fixtures/season-001-qualification/entries/entry-operator-001.yaml

# Validate all entries
for f in fixtures/season-001-qualification/entries/*.yaml; do
  node scripts/validate.js "$f"
done
```

## Related Documents

- [Season 001 Qualification Specification](../../docs/season-001-qualification.md)
- [Qualification Entry Schema](../../schemas/qualification-entry.schema.json)
