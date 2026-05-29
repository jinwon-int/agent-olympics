# Safe Node Profile Validation Retry (#131)

This note records the live-node retry that produced
`fixtures/node-profiles/profile-live-openclaw-medium-20260530.yaml`.

## Scope

The retry was read-only. It did not deploy code, restart services, rotate
credentials, mutate a database, run a live canary, or record credential values.

## Approved Live Profile

The selected node was the current OpenClaw operational hub. Public competition
fixtures use the safe profile id `live-openclaw-medium-20260530` rather than a
hostname, IP address, SSH alias, credential reference, or private path.

## Evidence Captured

The inventory used these read-only checks:

- OS family and architecture: Linux, x86-64.
- Logical CPU count: 8.
- Memory band: 16-24 GB, no swap observed.
- Disk band: 70+ GB free, local block storage class recorded as hybrid.
- Runner tooling: OpenClaw CLI 2026.5.27, Node.js 22, npm 10, GitHub CLI
  available.
- Gateway boundary: native OpenClaw Gateway service reported active/running.
- Config boundary: `openclaw config validate --json` returned a valid result.

## Credential Boundary

No secret value was read into the fixture. The retry treated Gateway credentials,
tool policy, channel tokens, private keys, session cookies, host addresses, and
runtime config bodies as operator-private. The fixture records only that the
boundary was checked and that public competition metadata can safely use the
profile.

## Validation

The profile is validated with:

```bash
node scripts/validate.js profiles
```
