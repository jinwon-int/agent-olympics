# Tracker Ratification For #15 And #16

> **Context:** Team1 Season 001 official dry-run execution and publication
> round (#146).
> **Source baseline:** #145 plus finalizer additions from this round.

This document records the current evidence-backed status of the two remaining
broad Agent Olympics parent trackers.

> **Update 2026-05-30:** Node Readiness #15 source/spec closeout pack created
> ([docs/node-readiness-closeout-15.md](node-readiness-closeout-15.md)).
> The source/spec scope is declared complete. Follow-up issues filed for
> tier promotion and live qualification policy. See the closeout pack for
> full evidence inventory, verification output, and decision rationale.

## #15 Node Readiness Events

**Decision:** keep open as a broad tracker.

**Conditional completion for source/spec scope:**

- Node profile inventory format exists.
- Redacted live OpenClaw node profile fixture exists.
- Source-only node readiness smoke pack exists.
- Dry-run readiness gates exist and can emit finalizer evidence.
- No credential value or live provider delivery is required for source-only
  validation.

**Remaining execution gap:**

- Official dry-run manifest needs a reproducible source-only execution sample
  linked to run outputs.
- More approved node classes need safe profile fixtures before tier promotion.
- Any live node qualification must remain read-only unless separately approved.

**Recommended follow-up issues:**

1. **Tier Promotion and Additional Profiles**
   Title: `Node Readiness: add second approved node profile and compare smoke evidence`
   File: [`issues/followup-node-readiness-tier-promotion.md`](../issues/followup-node-readiness-tier-promotion.md)
   Scope: source/docs/fixtures only unless the operator approves a read-only live
   inventory. Add one additional redacted node profile, compare smoke evidence
   against the current OpenClaw fixture, and update qualification notes.

2. **Live Qualification Policy**
   Title: `Node Readiness: define and approve live read-only inventory policy for additional nodes`
   File: [`issues/followup-node-readiness-live-qualification.md`](../issues/followup-node-readiness-live-qualification.md)
   Scope: policy/docs only. Document approved safe-inventory procedure, define
   operator approval chain, extend profile validator with live-probe redaction
   check, and qualify at least one additional operator node.

See the [closeout pack](node-readiness-closeout-15.md) for full evidence inventory,
verification output, risk notes, and approval-sensitive blockers.

## #16 Performance Trial

**Decision:** keep open as a broad tracker.

**Conditional completion for source/spec scope:**

- Static and live `perf-001` baseline packets exist.
- Repeatable source-only performance harness exists.
- Harness output can be transformed toward scoreboard-compatible result packets.
- Raw measurements and scored values are separated and validator-backed.
- Caveats for hardware, cache, container runtime, and source-only mode are
  documented.

**Remaining execution gap:**

- Convert a fresh repeat harness report into publication packets and run the
  full scoring/publication path.
- Add more approved hardware classes before claiming official tier comparison.
- Exercise overlay scoring with multiple real agent/runtime profiles.

**Recommended follow-up issue:**

Title: `Performance Trial: run official harness-to-scoreboard publication rehearsal`

Scope: generate a fresh source-only harness report, convert it into v2 packets,
validate/score/aggregate the output, and attach publication caveats. No live
provider sends, production service changes, or credential access.

## Closure Rule

#15 and #16 should not be closed just because source-side readiness exists. They
can close only after:

1. The official dry-run path produces reproducible run/output evidence.
2. The publication bundle passes redaction, metadata, scoring, and integrity
   checks.
3. Any remaining live-node or performance-tier work is split into narrow
   follow-up issues with explicit safety boundaries.

Until then, both trackers are useful as parent references for operational
readiness and performance publication work.
