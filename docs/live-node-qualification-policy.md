# Live Node Qualification Policy — Read-Only Inventory

> **Issue:** [#161](https://github.com/jinwon-int/agent-olympics/issues/161)
> **Parent:** [#164](https://github.com/jinwon-int/agent-olympics/issues/164)
> **Approved:** 2026-05-30
> **Status:** Published
> **Broker-of-record:** Seoseo (team1)
> **Worker:** sogyo

---

## 1. Purpose

This document defines the **approved, operator-approved procedure** for
capturing live node inventory data and transforming it into a safe,
non-secret [Node Profile Inventory](node-profile-inventory.md) YAML
document. It covers:

1. What a read-only node probe may and may not do.
2. Which fields are retained and which are forbidden.
3. Who may approve each node qualification.
4. How raw probe output is handled and disposed of.
5. How profiles are validated against the forbidden-field schema.

This policy is a companion to the [Node Profile Inventory](node-profile-inventory.md)
format specification. All live-qualified profiles must satisfy **both**
the schema constraints and the policy rules below.

---

## 2. Read-Only Probe Command Chain

### 2.1 Permitted Commands

The following commands are **approved** for read-only inventory collection.
They report OS/hardware diagnostics, runtime versions, and disposable metrics.
No command in this list writes files, modifies configuration, or accesses
credential stores.

| Category | Command | Purpose |
|---|---|---|
| OS identity | `uname -a` | Kernel name, release, architecture |
| CPU | `lscpu` | Architecture, core counts, thread info |
| Memory | `free -g` or `free -m` | Total/available/free RAM in bands |
| Disk | `df -h` | Filesystem free-space bands (mount paths **redacted**) |
| Runtime | `<app> version` | CLI/daemon version string |
| Service | `<app> status` | Active/running/enabled state (no config body) |
| Config schema | `<app> config --validate` | Structural validation pass/fail only |

### 2.2 Prohibited Commands

These commands are **never** permitted in a live inventory probe:

| Prohibited | Reason |
|---|---|
| `cat`, `head`, `tail` of config files | May contain tokens, keys, paths |
| `env`, `printenv`, `export` | Exposes environment variables with credentials |
| `history` | Command history may contain secrets or session data |
| `journalctl`, `syslog`, `dmesg` | Logs may contain PII, IPs, session tokens |
| `find /home`, `ls -la /home/*` | Username disclosure, path enumeration |
| `ss`, `netstat`, `ip a`, `ifconfig` | IP addresses, MACs, network topology |
| `hostname`, `hostnamectl` | Hostname disclosure (captured value is never written) |
| `curl`, `wget` to discovery endpoints | Internal service probing |
| `cat /proc/cpuinfo` (raw) | Use `lscpu` instead to avoid model numbers |
| `htop`, `top`, `ps aux` | Process lists may leak arguments containing secrets |
| `cat /etc/shadow`, `/etc/passwd` | Credential material |
| `systemctl list-units --all` | Service enumeration (use targeted status only) |

### 2.3 Probe Command Template

```
# OS
$ uname -a

# CPU architecture and cores
$ lscpu

# Memory (gigabyte bands)
$ free -g

# Disk free (redact mount paths before storing)
$ df -h

# Runtime version
$ openclaw version

# Gateway service state
$ openclaw gateway status

# Config structural validation (pass/fail only — do not copy config body)
$ openclaw config --validate
```

---

## 3. Retained Fields

After collecting raw probe output, the operator extracts only these
safe, band-based fields for the profile YAML:

| Field | Source | Redaction Rule |
|---|---|---|
| `os_family` | `uname -s` → map to enum | `linux`, `darwin`, `windows`, `unknown` only |
| `cpu.class` | `lscpu` architecture field | Architecture family (e.g., `x86-64`, `arm64`) — never exact model |
| `cpu.cores_min` / `cpu.cores_max` | `lscpu` logical core count | Band range; exact count is acceptable but floor/ceil preferred |
| `cpu.description` | Operator judgement | "cloud vCPU", "consumer-grade", "entry-level" — no model numbers |
| `memory_gb.min` / `memory_gb.max` | `free -g` total | Rounded down/up; "16.0–24.0" not "18332 MB" |
| `storage_class.min_free_gb` | `df -h` output | Rounded down to nearest 5 or 10 GB |
| `storage_class.type` | Operator judgement | `nvme`, `ssd`, `hdd`, `hybrid`, `unknown` |
| `network_class.class` | Operator judgement | `low`, `medium`, `high`, `unknown` |
| `network_class.public_egress` | Observed connectivity | `true` / `false` |
| `runner_limits.*` | Operator judgement | Concurrency and duration limits derived from observed capacity |
| `capability_labels` | Operator judgement | Safe slugs matching task envelope labels |
| `profile_class` | Operator judgement | Generic class label for capacity planning |
| `notes` | Operator summary | Free-text but must be secret-free |

### 3.1 Allowed Runner Types

Profiles may include an optional `allowed_runner_types` array listing
compatible runtime adapters:

```yaml
allowed_runner_types:
  - openclaw
  - codex
  - cli
```

These labels are safe slugs and must not reference specific hostnames,
credentials, or infrastructure identifiers.

---

## 4. Forbidden Fields

### 4.1 Never Include in a Live Profile

The following are **strictly forbidden** in any committed node profile.
These rules apply to both field **values** and field **key names**:

| Category | Examples |
|---|---|
| Hostnames | `web-01.example.com`, `my-laptop`, `server-xyz` |
| IP addresses | `192.168.1.1`, `10.0.0.5`, `::1` |
| MAC addresses | `aa:bb:cc:dd:ee:ff` |
| Tokens | `sk-abc123...`, `ghp_xxxx...`, `xoxb-...` |
| Private keys | `-----BEGIN PRIVATE KEY-----` |
| Credentials | Passwords, API secrets, session cookies |
| Absolute paths | `/home/user/...`, `/etc/openclaw/...`, `/var/log/...` |
| SSH details | Keys, `known_hosts`, config aliases |
| Serial numbers | Device serials, motherboard UUIDs, cloud instance IDs |
| Cloud metadata | Instance IDs, VPC IDs, zone/region names, account IDs |
| Kernel details | Exact kernel version strings (`5.15.0-179-generic`) |
| CPU model numbers | `Intel(R) Xeon(R) Gold 6230`, `AMD EPYC 7763` |
| GPU exact models | `NVIDIA A100-SXM4-80GB` (use class: `gpu`, `tpu`) |
| Raw config body | Entire config file content — structural validation only |
| Environment variables | Any `KEY=VALUE` pair from process environment |
| Process lists | Running process names, PIDs, arguments |

### 4.2 Redaction Rules for Raw Output

When processing raw command output:

1. **Mount paths** in `df -h` output must be replaced with generic labels
   (`/` → `root`, `/boot` → `boot`, other → `data`).
2. **Hostnames** in `uname -a` are noted but never copied to the profile.
3. **Kernel version** is noted internally for operator reference but written
   only as the `os_family` enum in the profile.
4. **Token-like patterns** (`sk-...`, `ghp_...`, `-----BEGIN...`) must be
   visually confirmed absent from the extracted profile before commit.
5. **IP addresses** in any output are discarded immediately.

---

## 5. Raw-Output Disposal

### 5.1 Disposal Policy

Raw probe output (terminal transcripts, command logs, scrollback dumps)
**must be discarded** once the profile YAML has been written.

- **Storage:** Raw output may only exist as ephemeral terminal scrollback.
  It must not be saved to a file, pasted into an issue comment, or committed
  to any repository branch.
- **Duration:** Raw output must be discarded within 5 minutes of the profile
  YAML being written.
- **Verification:** The operator self-certifies disposal by dating the
  `last_updated` field in the profile at or after the probe timestamp.
- **Exception:** One-line version strings (e.g., `openclaw version`) may be
  preserved as a reference in the profile `notes` field if the operator
  confirms they contain no secret identifiers.

### 5.2 Disposal Certification

The profile YAML's `notes` field should state the date and time of the
original probe. The `last_updated` timestamp confirms when the profile
was finalised. If both values are within the same session, the operator
is presumed to have disposed of raw output.

---

## 6. Operator Approval Chain

### 6.1 Who May Approve

| Role | May Approve Probes For | Approval Method |
|---|---|---|
| **Broker-of-record** (Seoseo) | Any node in scope | Issue comment, PR review approval, or sign-off file |
| **Team lead** (Team1) | Team1-provisioned nodes | PR review approval on the profile PR |
| **Issue assignee** (Worker) | Self only | Own sign-off in the issue or PR |
| **Repository admin** | Any node | GitHub review or admin-merge of the profile PR |

### 6.2 Approval Documentation

Each live qualification must be accompanied by:

1. **An issue comment or PR review** stating explicit approval.
2. **The probe date and operator name** in the profile `notes` field.
3. **A reference to this policy** (`docs/live-node-qualification-policy.md`)
   in the PR or issue body.
4. **A link to the validator run** showing the profile passed `live-probe`
   redaction checks.

### 6.3 Approval Flow

```
1. Operator identifies a candidate node
2. Operator collects read-only inventory (per §2)
3. Operator writes profile YAML with band-based values (per §3)
4. Operator runs validator:  node scripts/validate.js live-probe <profile>
5. Operator creates PR with profile and validator output
6. Approver reviews and signs off on PR
7. After merge, broker records the qualification in the tracker
```

### 6.4 Documentation String

Every live-qualified profile must include a `notes` field that documents
the probe context, per the example below:

```yaml
notes: >
  Validated from read-only live inventory on 2026-05-30: OS family and
  architecture, logical CPU count, memory band, disk-free band, version
  string, gateway active state, and config schema pass/fail. Raw output
  discarded after profile written.
```

---

## 7. Validator Mode

A dedicated `live-probe` validator mode is provided in
[`scripts/validate.js`](../scripts/validate.js). It performs:

1. **Schema validation** — the profile must satisfy
   `schemas/node-profile-inventory.schema.json`.
2. **Cross-field semantic checks** — `cores_max >= cores_min`,
   `memory_gb.max >= memory_gb.min`, etc.
3. **Tier-2 forbidden field scan** — checks every string value in the
   profile against known secret patterns, IP address regexes, hostname
   patterns, absolute path prefixes, and key material headers.
4. **Secret key-name scan** — flags field keys that suggest credential
   data (`token`, `password`, `api_key`, `secret`, etc.).
5. **Redaction confirmation** — verifies that no raw diagnostic values
   (kernel version strings, exact mount paths) leaked into the profile.

### 7.1 Usage

```bash
# Validate a single candidate live profile
node scripts/validate.js live-probe fixtures/node-profiles/candidate.yaml

# Validate all live profiles in a directory
node scripts/validate.js live-probe fixtures/node-profiles/

# Validate all existing node profiles with live-probe rules
node scripts/validate.js live-probe fixtures/node-profiles/
```

Exit code: `0` = all checks passed, `1` = any check failed.

---

## 8. Retaining the Existing Live Profile

The existing live profile at
[`fixtures/node-profiles/profile-live-openclaw-medium-20260530.yaml`](../fixtures/node-profiles/profile-live-openclaw-medium-20260530.yaml)
was collected during the #15 source-complete work. It pre-dates this
formal policy but satisfies all its requirements:

- ✅ Read-only probe commands (uname, lscpu, free, df, version, status,
  config --validate)
- ✅ No hostnames, IPs, tokens, or paths in the committed YAML
- ✅ Band-based values (8 cores, 16–24 GB RAM, 70+ GB free)
- ✅ Raw output discarded
- ✅ Operator notes documenting the probe scope
- ✅ Validates against the schema with zero errors and zero warnings

The live profile is grandfathered under this policy.

---

## 9. Relationship to Other Documents

| Document | Relationship |
|---|---|
| [Node Profile Inventory](node-profile-inventory.md) | Defines the profile format; this policy defines the live collection procedure |
| [Node Capability Matrix](node-capability-matrix.md) | Runtime capability matrix; live profile feeds into this at season time |
| [Node Readiness #15 Closeout](node-readiness-closeout-15.md) | Closeout that identified this policy as a follow-up |
| [Tier Promotion Follow-Up](../issues/followup-node-readiness-tier-promotion.md) | Consumes qualified profiles from this policy |
| [Issue #161](https://github.com/jinwon-int/agent-olympics/issues/161) | Tracks this policy |

---

## 10. Change History

| Date | Change | Approver |
|---|---|---|
| 2026-05-30 | Initial policy — published as part of #161 source slice | Seoseo (broker-of-record) |

---

*Agent Olympics v1 — Live Node Qualification Policy*
*Companion to the [Node Profile Inventory](node-profile-inventory.md).*
