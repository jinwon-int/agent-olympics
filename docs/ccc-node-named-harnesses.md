# ccc-node Named Harnesses

`ccc-node` is a harness family, not a single anonymous participant. When Agent Olympics displays ccc-node coverage, prefer the named node roster below instead of only the generic `ccc-node-harness` label.

## Named roster

| Display | Romanized ID | Slot | Public role label |
|---|---|---|---|
| 노숙 | `nosuk` | VPS2 | ccc-node primary / Team1 A2A worker |
| 순욱 | `soonwook` | VPS6 | ccc-node primary / Team2 A2A worker |
| 등애 | `dungae` | VPS0 | ccc-node harness / Team2 A2A worker |
| 공융 | `gongyung` | Android/Termux | mobile harness-capable node |
| 대교 | `daegyo` | Android/Termux | mobile harness-capable node |

## Display rule

Use the generic adapter id only for schema/runtime identity:

- adapter id: `ccc-node-harness`
- source-only fixture participant: `ccc-node-harness`

Use the named roster in labels, docs, judge notes, and operator-facing summaries:

```text
ccc-node named harness fleet: 노숙/nosuk, 순욱/soonwook, 등애/dungae, 공융/gongyung, 대교/daegyo
```

## Boundary

The names above are display labels for source-only Agent Olympics artifacts. They do not imply that a live node was contacted, restarted, mutated, or scored. Live/broker-backed dispatch for any named node remains a separate approval gate.
