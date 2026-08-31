# verdicts-1684: the form reports a success for a block that never landed

kosmos#1684.

## Problem

`PUT /api/you` (the About-you form) runs **three** managed-block syncs and builds its answer from **one**:

```
you.syncEveryone(roster)          -> becomes `told`, sent to the screen
reports.syncEveryone(roster)      -> verdicts DISCARDED, throw swallowed
connections.syncEveryone(roster)  -> verdicts DISCARDED, throw swallowed
```

⇒ **The reports-to block can be refused for every agent while the person saving the form is told every agent was told.**

Not a missing detail. `told` is the entire answer to the only question that screen asks, and two thirds of the work it summarises is not represented in it at all.

## The rationale I am narrowing, which was not wrong

Both discarding sites carried `catch { /* carried by the marker, not here */ }`.

**The marker is real.** It is #323's stale-block marker. But it marks a block stale **in the agent's file, to be discovered later, by someone who goes and looks**. It cannot tell the person standing at the form that the write did not land. Two different jobs; only one belongs to this route.

Recorded as a narrowing rather than as somebody's mistake.

## The fix already existed, 1,871 lines below the defect

`server.js:7413`, the boot caller of `connections.syncEveryone`, already consumes its verdicts, filters `state !== TOLD`, and names the reason, under a comment reading *"NAME THE REASON, not just the count. This runs at boot with nobody watching, so 'could not refresh 1 of 1' is a line that cannot be acted on."*

Same file, same argument. I copied that shape rather than inventing one.

## Change

Capture both sibling verdict lists and **downgrade** the matching `told` row.

**Why downgrade rather than concatenate:** one row per agent is the UI contract; three lists would show each agent three times. A row moves `TOLD -> not-TOLD` only, never the other way. The `because` is prefixed with the block's plain-English name ("who they report to: ..."), because the reader is an operator at a form, not someone reading `engine/reports.js`.

A `null` agent is the whole-roster verdict those modules return when the roster is unreadable, so it downgrades every row.

## Why the test was the hard part

The three modules share four refusal paths (no folder, not editable, unreadable, unknown record) that fire **together**. A fixture failing all three proves nothing: `you` would report `COULD_NOT` by itself and the route would look correct **without** the fix.

They diverge on exactly one condition: each splices a **different marker pair**, and `projects.findBlock` (`engine/projects.js:1875`) answers `ambiguous` for more than one pair.

⇒ A file carrying **two copies of the reports block** refuses in `reports` and writes cleanly in `you` and `connections`. Realistic: it is what a person gets by hand-copying part of their agent's instructions.

## Verification

Perturbed in both directions. Reverting `server.js` to `origin/main` with the test kept:

| arm | result |
|---|---|
| defect test | **RED**, intended message |
| control | **still green** |

The control staying green is the half usually skipped: one that moved with the perturbation would show the test keys on something incidental.

Suite: **exit code 0**, 3262 pass, 0 fail, 0 shell failures.

## Limits

- A row can only move `TOLD -> not-TOLD`. If `you` fails while the siblings succeed, the row keeps the `you` reason.
- The whole-roster (`agent: null`) path is handled but not exercised end to end: constructing an unreadable roster in this harness also breaks the `you` sync, which stops isolating anything.
