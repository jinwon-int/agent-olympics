# Dry-Run Evidence

This directory is reserved for generated Season 001 source-only dry-run evidence.

Expected files include:

- `readiness-evidence.json` from `node scripts/dry-run-gates.js readiness`.
- `publication-evidence.json` from `node scripts/dry-run-gates.js publication`.
- `redaction-check.json` from `node scripts/dry-run-gates.js redaction-check`.
- `safe-metadata.json` from `node scripts/dry-run-gates.js safe-metadata`.
- `finalizer-evidence.json` from `node scripts/dry-run-gates.js finalizer-ready`.

Generated evidence may be committed only when it is deterministic, free of
secrets, and useful as a fixture. Runtime-local reports should stay untracked
unless a finalizer explicitly promotes them as source evidence.
