# external-participant-http-json fixtures

No-live conformance fixtures for the [HTTP/JSON participant protocol](../../docs/http-json-participant-protocol.md)
(#287). Validated by `scripts/validate-participant-protocol.js`
(`make external-participant-protocol-check`) with no network or credentials.

- `*-valid.json` — positive samples that MUST pass their protocol schema. The
  three registration samples cover the unified participant model: an
  `external_self_serve` agent, a pre-seeded `internal_managed` fleet agent
  (referencing the existing `acc-hermes-competitor-001` accreditation fixture),
  and a `human_baseline` operator — all through the same schema.
- `negative-*.json` — samples that MUST be rejected (oracle access requested,
  external agent self-claiming a pre-seeded accreditation, a live lane requested
  via registration, non-source-only claim mode, malformed artifact hash, illegal
  status state).
- `artifact-submission-valid.json` embeds a real result-packet-v2 / trace /
  evidence-bundle so the wrapper's inner artifacts are validated against the
  competition schemas too.

All examples use placeholders only (no real participant, node, model, endpoint,
or credential).
