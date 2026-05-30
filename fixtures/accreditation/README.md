# Accreditation Fixtures

This directory contains accreditation declarations for the Agent Olympics
competition framework.  These fixtures define who may access which zones,
operating surfaces, and delegation boundaries following the model from
issue #42 (Olympic accreditation adapted for agent delegation).

## Files

| File | Description |
|---|---|
| `access-zones.yaml` | Formal zone taxonomy defining all access zones and their properties |
| `roles.yaml` | Role-to-accreditation-class mappings with default zone grants |
| `sample-delegation-boundary.yaml` | Example delegation boundary showing common patterns |
| `competitor-hermes.yaml` | Hermes adapter declared as a Competitor-class participant |
| `judge-validator.yaml` | AJV schema validator declared as a Judge-class participant |

## Usage

### Validate all accreditation fixtures

```bash
node scripts/validate.js accreditations
```

This validates each YAML file against `schemas/accreditation-declaration.schema.json`
and runs cross-field semantic checks.

### Validate a single accreditation

```bash
node scripts/validate.js fixtures/accreditation/competitor-hermes.yaml
```

## Related

- [Accreditation Access Zones Spec](../../docs/accreditation-access-zones.md)
- [Accreditation Schema](../../schemas/accreditation-declaration.schema.json)
- [Validity Fixtures](../accreditation-validity/README.md)
- [Issue #171](https://github.com/jinwon-int/agent-olympics/issues/171)
