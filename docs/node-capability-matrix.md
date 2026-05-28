# Node Capability Matrix

A **node capability matrix** is a safe, non-secret document that describes what an agent execution node can do. It is the foundation for readiness evaluation and cross-node comparison.

## Purpose

- Decide whether a node is ready for a target mission class.
- Compare two similarly-sized nodes to find configuration differences.
- Track capability changes over time as software, hardware, or configuration evolves.
- Provide structured metadata for judges without exposing credentials or private data.

## Schema

Node capability documents follow the JSON Schema defined at:

```
schemas/node-capability.schema.json
```

The schema requires these top-level fields:

| Field | Description |
|---|---|
| `schema_version` | Capability schema version (currently 1). |
| `node_id` | Node label or identifier. |
| `generated_at` | ISO 8601 timestamp. |
| `mission_class` | Optional target mission class (e.g., "ops-and-code-assist"). |
| `hardware` | CPU, memory, storage, OS, and optional GPU details. |
| `runtime` | Runtime type, version, workspace path, model routing. |
| `tools` | Available tools, count, and missing critical tools. |
| `services` | Gateway, node agent, and other service health. |
| `capability_summary` | Overall readiness verdict, gaps, recommendations. |

## Safety Rules

- **No secrets.** Capability documents must not contain credential values, tokens, API keys, or private keys.
- **No private logs.** Raw command outputs containing IP addresses, usernames, or session IDs should be redacted or summarized.
- **Path-level only.** Credential file locations may be described at the path level without exposing contents.

## Example Hardare Profile (safe)

```yaml
hardware:
  cpu: "Intel Xeon 4-core"
  memory_gb: 8
  storage:
    type: nvme
    free_gb: 45
  os:
    family: linux
    kernel: 6.8.0-117-generic
    arch: x64
```

## Example Capability Summary

```yaml
capability_summary:
  overall_readiness: ready_with_caveats
  gaps:
    - area: tool_availability
      description: "Database inspection tools are not installed."
      severity: warning
  recommendations:
    - "Install database CLI tools for data-layer diagnostics."
    - "Document model fallback behavior in the operator wiki."
```

## Compatibility with Other Schemas

The capability matrix is designed to work alongside the existing schemas:

- **Task Envelope** — node-readiness event tasks can reference `schemas/node-capability.schema.json` in their `environment.capability_schema_ref` field.
- **Result Packet** — a node capability document can appear in `outputs.node_capability_matrix` or be embedded in a result packet's `configuration_profile` section.
- **Judge Record** — judges can use the capability matrix to verify that hardware and configuration metadata were collected without exposing secrets.

## Relationship to the Smoke Suite

The smoke task `smoke-007-node-capability` generates a capability matrix as its primary output. This provides a quick readiness baseline that longer node-readiness tasks (e.g., `node-001`) can build on.

## Smoke Manifest

All smoke tasks, including the node capability report, are listed in:

```
tasks/smoke/smoke-manifest.yaml
```

The manifest is compatible with the run artifact format and references both the result packet schema and the node capability schema.
