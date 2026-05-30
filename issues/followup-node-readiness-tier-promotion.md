# Follow-Up Issue Proposal: Node Readiness — Tier Promotion and Additional Profiles

> **Proposed by:** [Node Readiness #15 Closeout Pack](../docs/node-readiness-closeout-15.md)
> **Source tracker:** [#15 (Node Readiness Events)](https://github.com/jinwon-int/agent-olympics/issues/15)
> **Created:** 2026-05-30
> **Scope:** source/docs/fixtures only

---

## Motivation

The Node Readiness source/spec work for #15 is complete, but only one
node class (large-vps / live OpenClaw) has been profiled from a live
inventory. To promote the `node-001` task envelope from `draft` to
`smoke` (or higher), the competition needs:

1. A **second approved, redacted node profile** for a distinct node class.
2. **Cross-class smoke evidence comparison** showing the node readiness
   pack produces consistent, comparable results across different hardware.
3. A **tier promotion** of the `node-001` and `node-001-v2` envelopes
   after verification.

## Recommended Title

> **Node Readiness: add second approved node profile and compare smoke evidence**

## Scope

Source/docs/fixtures only. No live service mutation, no credential access,
no production deploy.

### Tasks

1. **Add a new node profile fixture** for a distinct class not yet represented:
   - Candidate: macOS/arm64 (e.g., M1/M2/M3 Mac Mini or MacBook)
   - Candidate: GPU worker (e.g., single-GPU Linux server)
   - Candidate: Raspberry Pi 5 or other ARM SBC
   - Candidate: Container-minimal (512 MB RAM, no swap, ephemeral storage)
   
   Follow the safe band-based format from `fixtures/node-profiles/profile-stub-medium.yaml`.
   Validate with `node scripts/validate.js profiles`.

2. **Collect smoke evidence** using the node readiness smoke pack from
   `tasks/smoke/node-readiness-pack/pack-manifest.yaml`:
   - Run the pack on the new node
   - Produce a result packet, trace, and evidence bundle
   - Compare against the existing OpenClaw fixture outputs at
     `fixtures/node-readiness-pack/openclaw/`

3. **Update qualification notes** in `docs/node-profile-inventory.md`:
   - Add the new profile to the sample table
   - Note any class-specific readiness differences

4. **Promote `node-001` envelope tier** (if both profiles produce valid,
   schema-conforming results):
   - Update `tasks/season-001/node-001-agent-readiness-audit.yaml`:
     `tier: smoke`
   - Update `tasks/season-001/node-001-agent-readiness-audit-v2.yaml`:
     `tier: smoke`

## Safety Boundaries

| Constraint | Rule |
|---|---|
| Live probes | Read-only node inspection only (no process spawn, no install, no config mutation) |
| Credential handling | No credential values may appear in profile files |
| Host details | No hostnames, IPs, MACs, serials, or exact model numbers |
| Production services | No restart, reload, or reconfiguration of gateway/broker/worker |
| Bangtong | Excluded pending explicit re-enrollment |

## Success Criteria

- A second valid node profile fixture is committed and passes validation.
- Smoke evidence from the new node is comparable (same schema, same structure)
  to the OpenClaw reference.
- `node-001` envelopes are promoted to `smoke` tier (or a clear blocker is
  documented explaining why promotion is not yet appropriate).

## Dependencies

- An operator-approved read-only node to profile (see
  [follow-up: live qualification policy](followup-node-readiness-live-qualification.md)
  for the approval process).

---

*Agent Olympics v1 — Follow-up issue proposal for Node Readiness tier promotion.*
