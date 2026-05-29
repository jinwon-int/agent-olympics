# Hermes adapter validation fixtures

These fixtures validate Hermes adapter output against Agent Olympics
schemas and competition-validity checks.

## Positive fixtures

Schema-valid AND competition-valid Hermes result examples.
Each tests a specific event-family / status combination.

## Negative fixtures

Schema-valid but competition-invalid Hermes result examples.
Each tests a specific failure mode.

## Running

```bash
node scripts/validate.js fixtures/hermes-validity/positive/ops-completed-result-packet.yaml
node scripts/validate.js fixtures/hermes-validity/negative/missing-evidence-result-packet.yaml
```
