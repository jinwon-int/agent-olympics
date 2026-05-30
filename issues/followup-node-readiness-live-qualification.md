# Follow-Up Issue Proposal: Node Readiness — Live Qualification Policy

> **Proposed by:** [Node Readiness #15 Closeout Pack](../docs/node-readiness-closeout-15.md)
> **Source tracker:** [#15 (Node Readiness Events)](https://github.com/jinwon-int/agent-olympics/issues/15)
> **Filed as:** [#161](https://github.com/jinwon-int/agent-olympics/issues/161)
> **Created:** 2026-05-30
> **Scope:** policy/docs only

---

## Motivation

The Node Readiness source/spec work for #15 includes a live OpenClaw
profile (`fixtures/node-profiles/profile-live-openclaw-medium-20260530.yaml`)
collected through a read-only inventory process. Before additional live
nodes can be profiled, the competition needs a documented, operator-approved
**live qualification policy** that defines:

1. What a read-only node probe may and may not do.
2. What data may be captured and what must be excluded.
3. Who can approve each node qualification.
4. How profiles are validated against the forbidden-field schema.

## Recommended Title

> **Node Readiness: define and approve live read-only inventory policy for additional nodes**

## Scope

Policy/docs only. No production node access, no credential exposure,
no service mutation.

### Tasks

1. **Document approved safe-inventory procedure** for read-only node probes:
   - Define the probe command chain (e.g., `uname -a`, `lscpu`, `free -g`,
     `df -h`, `openclaw version`)
   - Specify redaction rules for any output that may contain paths or
     identifiers
   - Declare the minimum hardware/runtime fields required for a profile
     to be considered valid

2. **Define operator approval chain** for live node qualification:
   - Who may approve a node probe request?
   - What documentation must accompany each approval?
   - How are approvals recorded (issue comment, PR review, sign-off file)?

3. **Extend the profile validator** (`scripts/validate.js`):
   - Add a `live-probe` validation mode that runs the forbidden-field scan
     on a candidate YAML before it is committed
   - Optionally, add a `--redact-check` flag that flags any value matching
     known secret patterns (SK-..., ghp_..., -----BEGIN...)

4. **Apply the policy to at least one additional operator node**:
   - Produce a second live-profile YAML following the documented procedure
   - Run the live-probe validator
   - Commit the result as a validated profile fixture

## Safety Boundaries

| Constraint | Rule |
|---|---|
| Probe scope | Read-only OS/hardware diagnostics only — no process inspection, no file content reads beyond declared config paths |
| Credential handling | No credential values, tokens, or private keys may be captured or stored |
| Host identity | No hostnames, IP addresses, MACs, serials, or cloud instance IDs in committed profiles |
| Output retention | Raw probe output must be discarded after the profile YAML is written; only the band-based safe YAML is committed |
| Approval | Each live qualification requires explicit operator sign-off (see task 2) |

## Success Criteria

- A documented, operator-approved live qualification policy exists in
  `docs/node-profile-inventory.md` (or a new `docs/live-node-qualification-policy.md`).
- The profile validator can run a live-probe redaction check.
- At least one additional live profile is committed following the policy.

## Relationship to Tier Promotion

The tier promotion follow-up issue depends on this policy for its
second approved node profile. The two issues can be worked in sequence:
first define the policy, then use it to qualify a node and promote the envelopes.

---

*Agent Olympics v1 — Follow-up issue proposal for Node Readiness live qualification policy.*
