# Schema Hardening Follow-Up (#130)

This document records the narrow schema-hardening decision after the MVP freeze
and Round 002 planning closeouts.

## Hardened v2 Result Packet Metadata

`schemas/result-packet-v2.schema.json` now treats the operating-agent-stack
metadata as required for v2 result packets:

- `division`
- `validity`
- `publishable`
- `tool_use_profile`
- `operating_policy`
- `delegation_profile`
- `comparable_metadata`

These fields are platform-neutral. They describe what was used, which safety
policy governed the run, and whether the packet can appear in public result
views. They do not require OpenClaw-only or Hermes-only fields.

## Cross-Field Validation

`scripts/validate.js` now checks v2 result-packet consistency beyond JSON
Schema shape:

- every declared used tool must also be declared as allowed;
- action types should appear in the used-tool list;
- `validity: appealed` requires an `appeal` block;
- `publishable: true` is rejected for `invalid`, `appealed`, or
  `disqualified` results;
- A2A worker disclosure is checked against `delegation_profile`.

## Oracle Schema

`schemas/oracle.schema.json` defines the private oracle file format used by
`oracle/season-001/*.yaml`. The oracle validation mode now runs this schema in
addition to the older semantic checks. Oracle files remain private judge
material and must not be distributed to participants.

## Migration Plan

Existing v2 result packets should be migrated by adding safe labels only:

1. Set `division` and `validity` according to `docs/rules.md`.
2. Set `publishable` only after redaction review.
3. Fill `tool_use_profile` with `classes_allowed`/`classes_used` or
   `allowed`/`used`.
4. Fill `operating_policy` with at least `approval_boundaries`,
   `secret_handling`, and `destructive_action_rules`.
5. Fill `delegation_profile` even when no delegation occurred, using explicit
   false/empty values.
6. Fill `comparable_metadata` with non-secret runtime/model/node/config/task
   labels.

Do not add raw credentials, hostnames, IP addresses, private keys, tokens,
session cookies, or raw private transcripts while migrating packets.
