# Tracker Ratification For #15 And #16

> **Context:** Team1 Season 001 v1 tracker closeout and publication rehearsal
> round (#153).
> **Source baseline:** #152 plus finalizer additions from this round.

This document records the current evidence-backed status of the two remaining
broad Agent Olympics parent trackers.

> **Update 2026-05-30:** #153 ratified source/spec completion for #15 and
> #16. Remaining live/tier work was split into #160, #161, and #162, so the
> broad parent trackers can close with those follow-ups as their continuation.

## #15 Node Readiness Events

**Decision:** source/spec complete; close broad tracker after finalizer merge.

**Conditional completion for source/spec scope:**

- Node profile inventory format exists.
- Redacted live OpenClaw node profile fixture exists.
- Source-only node readiness smoke pack exists.
- Dry-run readiness gates exist and can emit finalizer evidence.
- No credential value or live provider delivery is required for source-only
  validation.

**Remaining execution gap now split:**

- Official dry-run execution sample exists from #146/#152 and validates through
  the #153 finalizer.
- More approved node classes need safe profile fixtures before tier promotion:
  tracked by #160.
- Any additional live node qualification must remain read-only unless
  separately approved: tracked by #161.

**Recommended follow-up issues:**

1. **Tier Promotion and Additional Profiles**
   Title: `Node Readiness: add second approved node profile and compare smoke evidence`
   Issue: #160
   File: [`issues/followup-node-readiness-tier-promotion.md`](../issues/followup-node-readiness-tier-promotion.md)
   Scope: source/docs/fixtures only unless the operator approves a read-only live
   inventory. Add one additional redacted node profile, compare smoke evidence
   against the current OpenClaw fixture, and update qualification notes.

2. **Live Qualification Policy**
   Title: `Node Readiness: define and approve live read-only inventory policy for additional nodes`
   Issue: #161
   File: [`issues/followup-node-readiness-live-qualification.md`](../issues/followup-node-readiness-live-qualification.md)
   Scope: policy/docs only. Document approved safe-inventory procedure, define
   operator approval chain, extend profile validator with live-probe redaction
   check, and qualify at least one additional operator node.

See the [closeout pack](node-readiness-closeout-15.md) for full evidence inventory,
verification output, risk notes, and approval-sensitive blockers.

## #16 Performance Trial

**Decision:** source/spec complete; close broad tracker after finalizer merge.

**Conditional completion for source/spec scope:**

- Static and live `perf-001` baseline packets exist.
- Repeatable source-only performance harness exists.
- Harness output can be transformed toward scoreboard-compatible result packets.
- Raw measurements and scored values are separated and validator-backed.
- Caveats for hardware, cache, container runtime, and source-only mode are
  documented.

**Remaining execution gap now split:**

- Fresh repeat harness publication rehearsal validates through #153.
- Add more approved hardware classes before claiming official tier comparison:
  tracked by #162.
- Exercise overlay scoring with multiple real agent/runtime profiles and
  cross-hardware scoreboard output: tracked by #162.

**Recommended follow-up issue:**

Title: `Performance Trial: run official harness-to-scoreboard publication rehearsal`

Issue: #162

Scope: run cross-hardware scoreboard publication rehearsal after additional
approved node classes are available. No live provider sends, production service
changes, or credential access.

## Closure Rule

#15 and #16 should not close just because source-side readiness exists. As of
#153, their source/spec and publication-rehearsal criteria are satisfied and the
remaining live/tier work is split into narrow follow-ups, so both broad trackers
are close-ready after finalizer merge:

1. The official dry-run path produces reproducible run/output evidence.
2. The publication bundle passes redaction, metadata, scoring, and integrity
   checks.
3. Any remaining live-node or performance-tier work is split into narrow
   follow-up issues with explicit safety boundaries.

Continuation issues: #160, #161, #162.
