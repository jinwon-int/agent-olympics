# Node Profile Samples

This directory contains safe, non-secret node profile inventory samples
for pre-season planning and validation.

## Files

| Profile | Class | CPU Cores | RAM (GB) | Storage | Runners | Best For |
|---|---|---|---|---|---|---|
| `profile-stub-small.yaml` | small-vps | 1-2 | 1-2 | SSD 5+ GB | 1 | Smoke, safety, minimal resource tests |
| `profile-stub-medium.yaml` | medium-vps | 2-4 | 4-8 | NVMe 20+ GB | 2 | Ops, code, knowledge, coordination |
| `profile-stub-large.yaml` | large-vps | 8-16 | 16-32 | NVMe 100+ GB | 4 | Performance, multi-agent, throughput |
| `profile-live-openclaw-medium-20260530.yaml` | large-vps | 8 | 16-24 | Hybrid 70+ GB | 3 | Live validated OpenClaw node-readiness and performance smoke |

## Usage

Add more profiles for new node classes (e.g., `m1-mac`, `gpu-worker`, `raspberry-pi-5`).

Season-specific profiles go in a versioned subdirectory:

```
fixtures/node-profiles/season-002/
```

## Closeout Status

Issue [#15 (Node Readiness Events)](https://github.com/jinwon-int/agent-olympics/issues/15)
source/spec scope has been declared complete as of 2026-05-30. See the
[closeout pack](../../docs/node-readiness-closeout-15.md) for the full
evidence inventory, verification output, and remaining work split into
follow-up issues.

## Validation

### Standard profile validation

```bash
node scripts/validate.js profiles
```

### Live-probe enhanced redaction check

Profiles sourced from live node inventory should also pass the enhanced
redaction and forbidden-field validator:

```bash
# Validate a single profile
node scripts/validate.js live-probe fixtures/node-profiles/profile-live-openclaw-medium-20260530.yaml

# Validate all profiles with enhanced checks
node scripts/validate.js live-probe

# Run against the validity test fixtures
node scripts/validate.js live-probe fixtures/node-profiles/validity/live-probe/positive-clean.yaml
node scripts/validate.js live-probe fixtures/node-profiles/validity/live-probe/negative-forbidden-values.yaml
```

### Validity test fixtures

See [`fixtures/node-profiles/validity/live-probe/README.md`](validity/live-probe/README.md)
for positive and negative test cases exercising the live-probe validator.

## Compare with Result Metadata

Result packets from node-readiness and performance events should reference
the matching node profile via a `node_profile_ref` field. This lets judges:

- Attribute hardware differences correctly.
- Compare wall-clock times against declared capacity.
- Check whether the runner limits matched what was declared.

## Remaining Work

- [Tier promotion and additional profiles](../../issues/followup-node-readiness-tier-promotion.md)
- [Live qualification policy](../../issues/followup-node-readiness-live-qualification.md)
