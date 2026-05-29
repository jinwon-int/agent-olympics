# Competition-Validity Fixtures

These fixtures test that `scripts/competition-validity.js` correctly rejects
schema-valid but competition-invalid submissions.

## File Naming Convention

- `*-positive-*.yaml` — Documents expected to PASS all competition-validity checks.
- `*-negative-*.yaml` — Documents expected to FAIL competition-validity checks
  (schema-valid but competition-invalid).

## Running

```bash
node scripts/competition-validity.js fixtures
# or
node scripts/validate.js competition-validity fixtures fixtues/competition-validity
```
