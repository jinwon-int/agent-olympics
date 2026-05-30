# Live-Probe Validity Fixtures

These fixtures test the `live-probe` enhanced redaction and forbidden-field
validator mode in `scripts/validate.js`.

## Files

| File | Expected Result | Purpose |
|---|---|---|
| `positive-clean.yaml` | PASS | Schema-compliant, properly redacted live profile |
| `negative-forbidden-values.yaml` | FAIL | Contains raw diagnostic output, CPU model numbers, kernel version, IPs, tokens, instance IDs, and mount paths |

## Usage

```bash
node scripts/validate.js live-probe fixtures/node-profiles/validity/live-probe/positive-clean.yaml
node scripts/validate.js live-probe fixtures/node-profiles/validity/live-probe/negative-forbidden-values.yaml
node scripts/validate.js live-probe fixtures/node-profiles/validity/live-probe/
```
