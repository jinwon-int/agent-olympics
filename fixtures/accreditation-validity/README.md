# Accreditation Validity Fixtures

These fixtures test that `scripts/validate.js accreditations` correctly
accepts well-formed accreditation declarations and rejects
schema-valid but accreditation-invalid declarations.

## File Naming Convention

- `positive-*.yaml` — Documents expected to PASS all accreditation checks.
- `negative-*.yaml` — Documents expected to FAIL accreditation checks
  (may be schema-valid but accreditation-invalid).

## Running

```bash
node scripts/validate.js accreditations
# or
node scripts/validate.js accreditations-validity
```

## Related

- [Accreditation Schema](../../schemas/accreditation-declaration.schema.json)
- [Accreditation Fixtures](../accreditation/README.md)
