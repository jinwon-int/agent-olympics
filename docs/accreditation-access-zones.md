# Accreditation, Access Zones, and Delegation Boundaries

> **Issue:** [#171](https://github.com/jinwon-int/agent-olympics/issues/171) — Accreditation/access-zone/adapter boundary fixtures  
> **Parent:** [#169](https://github.com/jinwon-int/agent-olympics/issues/169) — Team1 Season 001 governance source round  
> **Reference Model:** [#42 — Olympic Accreditation Model for Agent Delegation Boundaries](https://github.com/jinwon-int/agent-olympics/issues/42)

---

## 1. Purpose

This document defines the **participant accreditation model**, **access zone
taxonomy**, **delegation boundaries**, and **operating surface authorizations**
for the Agent Olympics competition framework.  It translates the Olympic
accreditation metaphor from issue #42 into concrete, schema-validatable
declarations that govern:

- **Who** (which participant) may access **what** (which zone or surface)
- **What** they may delegate to sub-agents and **under what conditions**
- **How** access boundaries compose across multiple adapters, orchestrators,
  and human operators

The model applies to all Team1 Season 001 rounds and serves as the
reference for future seasons and lanes.

---

## 2. Accreditation Classes

Issue #42 defines five accreditation classes adapted from the Olympic
model.  Each class represents a category of participant with distinct
rights, responsibilities, and constraints.

| Class | Olympic Analog | Delegation | Zone Access | Typical Subjects |
|---|---|---|---|---|
| **Competitor** | Athlete | Limited (`within_class`) | Competition zones only | Agent adapters, human baseline operators |
| **Support** | Coach/Team Staff | Within team | Competition + team staging | Tooling operators, infrastructure support |
| **Judge** | Referee/Judge | Broad (`any_accredited`) | All zones (with audit) | Scoring systems, review panels |
| **Operator** | Event Staff | Medium (`within_team`) | Operational zones | Gateway operators, pipeline runners |
| **Observer** | Spectator/Media | None (`none`) | Observation zones | Auditors, log reviewers, monitoring |

### 2.1 Class Constraints

- **Competitors** must include a `delegation_boundary` with `delegation_scope`
  set — the delegation boundary is required for active participants.
- **Judges** must set `audit_required: true` when delegation is permitted,
  ensuring all judge-delegated actions are logged.
- **Observers** must have `can_delegate: false` and `delegation_scope: "none"`.
- **Operators** may delegate within their team but must set `max_delegation_depth`
  to limit chain delegation.

---

## 3. Access Zones

Access zones are logical or physical boundaries inspired by the Olympic
venue model from issue #42.  Each zone has a defined perimeter, access
controls, and entry requirements.

### 3.1 Zone Taxonomy

| Zone | Access Class Required | Escort Policy | Examples |
|---|---|---|---|
| **Public** | None (open) | None | Repository README, documentation, public fixtures |
| **Competition Floor** | Competitor, Support, Judge, Operator | Escorted for Support-only | Task envelope execution, result submission |
| **Team Staging** | Support, Operator | None | Team-specific coordination areas, pre-run staging |
| **Judges Chamber** | Judge, Operator | Escorted for Operator-only | Scoring rubrics, verdict deliberation |
| **Operators Console** | Operator | None | Gateway controls, pipeline triggers, credential vault |
| **Observers Gallery** | Observer, Judge, Operator | Escorted for Observer-only | Read-only log feeds, audit trails |
| **Archives & Evidence** | Judge, Operator | Escorted for Judge-only | Result packets, evidence bundles, run artifacts |
| **Security Enclave** | Operator (dedicated) | Escorted only | Secrets, private keys, access tokens |

### 3.2 Zone Access Levels

Each zone accreditation grants one of three access levels:

| Level | Meaning |
|---|---|
| **Full** | Unescorted entry and independent operation within the zone. |
| **Limited** | Entry is permitted during scheduled windows or with pre-authorization. |
| **Supervised** | Entry requires an escort from a higher-accredited or zone-designated subject. |

### 3.3 Zone Declaration Format

Zones are declared in accreditation fixture files under
`fixtures/accreditation/`.  Each zone entry includes:

- `zone_id` — unique identifier
- `access_level` — one of `full`, `limited`, `supervised`
- `escort_required` — boolean
- `time_restrictions` — optional schedule constraints
- `purpose` — why this subject needs access

---

## 4. Delegation Boundaries

Delegation boundaries define how an accredited subject may extend its
authority to sub-agents, child workers, or downstream tools.  This is
the core mechanism for enforcing adapter boundaries.

### 4.1 Delegation Scope Values

| Value | Meaning |
|---|---|
| `none` | No delegation permitted. The subject must perform all work directly. |
| `within_class` | May delegate only to equally accredited subjects of the same class. |
| `within_team` | May delegate to any subject within the same team or organizational unit. |
| `any_accredited` | May delegate to any accredited subject, regardless of class or team. |
| `any` | Unrestricted delegation. Rarely granted. |

### 4.2 Delegation Depth

`max_delegation_depth` controls how deep delegation chains may go:

- **0** — The subject cannot sub-delegate. Sub-agents must operate directly.
- **1** — The subject may delegate to workers, who may not further delegate.
- **2+** — Multi-level delegation chains, with diminishing audit visibility.

### 4.3 Approval Chains

When a delegation would exceed the subject's default authority, an
`approval_chain` specifies what approvals are needed:

```yaml
delegation_boundary:
  can_delegate: true
  delegation_scope: within_class
  max_delegation_depth: 1
  subjects_revocable: true
  audit_required: true
  approval_chain:
    - action: "delegate_outside_scope"
      required_approver_role: "operator"
      notes: "Cross-class delegation requires operator consent"
    - action: "delegate_beyond_depth"
      required_approver_role: "judge"
      notes: "Delegation chains deeper than 1 require judge approval"
```

---

## 5. Operating Surfaces

Operating surfaces are the specific tools, APIs, filesystem paths,
capabilities, or services that an accredited subject is authorized to
use within each granted zone.

### 5.1 Surface Types

| Type | Description |
|---|---|
| `api` | Programmatic interface (HTTP, gRPC, WebSocket) |
| `filesystem` | Directory or file access within zone path |
| `tool` | Specific tool invocation (e.g., `read`, `exec`, `browser`) |
| `network` | Network access (ports, protocols, endpoints) |
| `capability` | Declared capability (e.g., `redaction`, `orchestration`) |
| `database` | Database or key-value store access |
| `service` | Running service (e.g., gateway, Hermes orchestrator) |

### 5.2 Allowed Actions

Each surface declares a list of allowed `action` verbs:

| Action | Meaning |
|---|---|
| `read` | Read/retrieve data from the surface |
| `write` | Write/create data on the surface |
| `modify` | Update existing data |
| `delete` | Remove data |
| `execute` | Run a command or invoke a function |
| `list` | Enumerate contents |
| `delegate` | Delegate authority further |
| `audit` | Review logs or access history |
| `configure` | Change surface settings |

### 5.3 Rate Limits

Surfaces may optionally declare rate limits:

```yaml
rate_limits:
  max_calls_per_minute: 60
  max_concurrent: 5
```

---

## 6. Adapter Boundary Enforcement

Adapter boundary declarations (in `fixtures/adapters/capabilities/*.yaml`)
are extended with an `accreditation` section that maps the adapter's
approval boundaries and task families to accreditation classes and
zones.

### 6.1 Accreditation Fields in Capability Declarations

Each adapter capability declaration may include:

```yaml
accreditation:
  default_class: competitor
  supported_zones:
    - competition-floor
    - team-staging
  delegation_compatible:
    - within_class
    - within_team
  operating_surfaces:
    - surface_id: workspace-filesystem
      surface_type: filesystem
      allowed_actions:
        - read
        - write
        - list
```

### 6.2 Pre-Run Access Checks

Before a task envelope is dispatched to an adapter, the runner MUST
verify:

1. The adapter's `default_class` is compatible with the task's required
   accreditation level.
2. The adapter is granted access to all zones the task requires.
3. The adapter's delegation boundary permits any sub-delegation the
   task envelope specifies.

If any check fails, the runner must report a blocked status with
reason `accreditation_denied: <detail>`.

---

## 7. Fixture Structure

Accreditation fixtures live under `fixtures/accreditation/`.

```
fixtures/accreditation/
  README.md                                     ← Usage guide
  access-zones.yaml                             ← Zone taxonomy definitions
  roles.yaml                                    ← Role-to-class mappings
  sample-delegation-boundary.yaml               ← Example delegation boundary
  competitor-hermes.yaml                        ← Hermes adapter as competitor
  judge-validator.yaml                          ← Schema validator as judge
```

Validity fixtures live under `fixtures/accreditation-validity/`.

```
fixtures/accreditation-validity/
  positive-competitor-accreditation.yaml        ← Valid competitor accreditation
  positive-judge-accreditation.yaml             ← Valid judge accreditation
  negative-overbroad-access.yaml                ← Invalid: escape-only zone with full access
  negative-undefined-zone.yaml                  ← Invalid: reference to undefined zone
```

---

## 8. Schema and Validation

Accreditation declarations are validated against
[`schemas/accreditation-declaration.schema.json`](../schemas/accreditation-declaration.schema.json)
via:

```bash
node scripts/validate.js accreditations
```

This validates all YAML files in `fixtures/accreditation/` and
`fixtures/accreditation-validity/` against the accreditation
declaration schema, plus cross-field semantic checks:

- Required fields are present (`schema_version`, `accreditation_id`,
  `subject`, `accreditation_class`, `granted_zones`, `delegation_boundary`)
- Zone references exist in the zone taxonomy
- Delegation scope is valid for the accreditation class
- Operating surface types are from the approved enum
- No secrets, paths, or credentials in free-text fields

---

## 9. Cross-References

| Reference | Description |
|---|---|
| [Issue #42](https://github.com/jinwon-int/agent-olympics/issues/42) | Original Olympic accreditation model adapted for agent delegation boundaries |
| [Issue #171](https://github.com/jinwon-int/agent-olympics/issues/171) | This issue — accreditation/access-zone/adapter boundary fixtures |
| [Issue #169](https://github.com/jinwon-int/agent-olympics/issues/169) | Parent — Team1 Season 001 governance source round |
| [Accreditation Schema](../schemas/accreditation-declaration.schema.json) | JSON Schema for accreditation declarations |
| [Adapter Capability Declaration](../fixtures/adapters/adapter-capability-declaration.yaml) | Adapter-level capability and boundary format |
| [Adapter Execution Contract](adapter-execution-contract.md) | Overall adapter contract including accreditation sections |
| [Competition Model](competition-model.md) | High-level competition framework |
| [Accreditation Fixtures README](../fixtures/accreditation/README.md) | Fixture entry point and usage |

---

## 10. Changelog

| Date | Change | Author |
|---|---|---|
| 2026-05-30 | Initial specification — accreditation classes, zones, boundaries, surfaces. Cross-references #42, #169, #171. | Team1 Governance |
