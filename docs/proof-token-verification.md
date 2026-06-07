# Proof Token Verification

> Related issue: [#45](https://github.com/jinwon-int/agent-olympics/issues/45)

Some events need proof that an agent reached a verifiable hidden state, not only
that it wrote a plausible report. Agent Olympics supports this with optional
`proof_tokens` in Result Packet v2 and a source-only verifier fixture.

Proof tokens are challenge-scoped evidence. They are not credentials, API keys,
passwords, session cookies, or auth tokens, and they must never grant access to
real systems.

## Result Packet Field

`proof_tokens` is an optional array in `schemas/result-packet-v2.schema.json`.
Each item records:

- `token_id`: public token identifier from the challenge set.
- `challenge_id`: verifier challenge identifier.
- `submitted_token`: challenge-scoped proof value.
- `solution_artifact_ref`: submitted patch, script, config, query, command
  sequence, or report artifact.
- `solution_artifact_sha256`: optional artifact hash.
- `submitted_at`: time the proof reached the scorer.

## Judge Verifier Step

Use the source-only verifier:

```bash
npm run test:proof_token_verify
```

The default fixture checks:

- a positive packet with the expected proof token and solution artifact;
- a negative packet with the wrong proof token;
- artifact hash integrity;
- required markers in the submitted artifact.

For a specific packet:

```bash
node scripts/proof-token-verify.js \
  --packet fixtures/proof-token-verification/positive-result-packet.yaml \
  --challenge-set fixtures/proof-token-verification/challenge-set.yaml \
  --expect pass
```

The verifier awards points only when the proof token matches the challenge set
and the submitted solution artifact reproduces the expected source-only checks.

## Tie-Break Order

When multiple participants reach the same score:

1. Higher verified score after penalties.
2. Earlier `submitted_at` or scorer receipt time for the score.
3. Lower penalty-adjusted wall time.
4. Lower resource usage for the same division.
5. Fewer safety or integrity penalties.

Resource usage is recorded separately from the proof score so a fast but unsafe
or non-reproducible submission does not outrank a correct one.

