# Node Readiness Smoke Execution Pack — Adapter Samples

This directory contains adapter-specific sample output files demonstrating
how each adapter (OpenClaw, Hermes, CLI) would execute the Node Readiness
smoke execution pack defined in `tasks/smoke/node-readiness-pack/`.

## Structure

```
fixtures/node-readiness-pack/
├── README.md                           # This file
├── evidence/                           # Shared evidence files referenced by all adapters
│   ├── node-capability-report.yaml     # Sample node probe output
│   └── config-snapshot.yaml            # Sample safe config inspection
├── openclaw/                           # OpenClaw adapter samples
│   ├── node-readiness-smoke-result-packet.yaml
│   ├── node-readiness-smoke-trace.yaml
│   └── node-readiness-smoke-evidence-bundle.yaml
├── hermes/                             # Hermes adapter samples
│   ├── node-readiness-smoke-result-packet.yaml
│   ├── node-readiness-smoke-trace.yaml
│   └── node-readiness-smoke-evidence-bundle.yaml
├── cli/                                # CLI adapter samples
│   ├── node-readiness-smoke-result-packet.yaml
│   ├── node-readiness-smoke-trace.yaml
│   └── node-readiness-smoke-evidence-bundle.yaml
└── macos-arm64/                        # Second-profile smoke comparison (candidate, not live-probed)
    └── SMOKE-COMPARISON-NOTES.md       # Cross-class comparison against OpenClaw Linux reference
```

## Adapter Execution Patterns

| Adapter | Pattern | Evidence |
|---------|---------|----------|
| OpenClaw | Direct agent session — sequential tool calls for node probe, config inspection, and report generation | 3 evidence items |
| Hermes | Orchestrator/worker — workflow plan, 2 workers dispatched, commander report synthesized | 3 evidence items |
| CLI | Sequential scripted commands — 6 shell commands with exit code verification | 3 evidence items |
| macOS/arm64 (candidate) | Projected result based on candidate profile — not live-probed | Comparison notes only (see SMOKE-COMPARISON-NOTES.md) |

## Validation

Each sample output validates against the Agent Olympics schemas:

```bash
# Validate all adapter samples
node scripts/validate.js all
```

## Usage

The sample outputs in this directory serve as:
1. **Reference implementations** for adapter authors implementing node-readiness support
2. **Test fixtures** for the validator to confirm node-readiness result packets parse correctly
3. **Documentation** of the expected output format for each adapter

All data uses safe band-based metadata. No hostnames, IPs, tokens, or secrets
are present in any file.
