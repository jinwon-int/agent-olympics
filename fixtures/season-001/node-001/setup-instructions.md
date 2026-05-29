# Node-001 Fixture Setup Instructions

> ⚠ These instructions are for the **runner** — not shown to the participant.

## Profile: stub-node-001-audit-v1

Provision a medium-VPS class Linux node with the following characteristics:

### Hardware

- **CPU:** 4 x86-64 cores, no hyperthreading
- **RAM:** 8 GB dedicated, no swap
- **Storage:** 80 GB total (OS on SSD, workspace on HDD), leave exactly 20 GB free
- **Network:** Outbound HTTPS enabled, inbound ports firewalled

### Software

- **OS:** Ubuntu 24.04 LTS (or equivalent Debian-based distribution)
- **OpenClaw:** Latest stable from the 2026.5 release channel
- **Git:** 2.x
- **Node.js:** 20.x LTS
- **npm:** 10.x

### Intentional Misconfigurations

1. **Low disk space:** Ensure only 20 GB free on the primary partition.
2. **No swap:** Do not configure swap despite the 8 GB RAM (intentional risk for memory pressure).

### Verification

After provisioning, run the node capability probe:

```bash
./scripts/node-capability-probe.sh --profile stag
```

The probe output must match `node-profile.yaml` for the participant to have a consistent audit target.

### Dry Run Mode

For dry runs without a live node, set the environment variable `DRY_RUN=true`. The profile will be loaded from the fixture file directly.
