# external-participant-http-json fixtures

No-live conformance fixtures for the [HTTP/JSON participant protocol](../../docs/http-json-participant-protocol.md)
(#287). Validated by `scripts/validate-participant-protocol.js`
(`make external-participant-protocol-check`) with no network or credentials.

- `*-valid.json` — positive samples that MUST pass their protocol schema.
- `negative-*.json` — samples that MUST be rejected (oracle access requested,
  non-source-only claim mode, malformed artifact hash, illegal status state).
- `artifact-submission-valid.json` embeds a real result-packet-v2 / trace /
  evidence-bundle so the wrapper's inner artifacts are validated against the
  competition schemas too.

All examples use placeholders only (no real participant, node, model, endpoint,
or credential).
