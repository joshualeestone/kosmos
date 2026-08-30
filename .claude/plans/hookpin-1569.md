# hookpin-1569: pin runFlow's hook wiring, and report what cannot be pinned

Card kosmos#1569. Angel, 2026-08-30.

## What finished looks like

A hook in `runFlow` that is wired to a **wrong implementation** reds the suite. Not a
missing hook, which already throws.

## What was already covered, so this does not duplicate it

`installClaudeCode` type-guards all five hooks (`connect.js:1093`): a missing or
non-function hook throws. And it has 17 contract tests. **Every one of them sits on the
CALLEE's side of the seam and supplies its own hooks**, which is exactly why the card's
measured mutations left the whole suite green: nothing tested what the CALLER passes.

## Delivered: the phase-write shape

`onPhase` writes `progress: {got:0,total:null}` alongside DOWNLOADING because `writeState`
**replaces rather than merges**. Dropping that field leaves a previous flow's numbers on
screen under a fresh download.

**Pinned and proven**: removing the zeroed progress reds the test.

## 🛑 NOT delivered: `cancelled`, and this is a measurement, not a gap I ran out of time on

The card proposes driving `start()` twice so the second claim replaces the first owner,
then asserting the first flow never installs. **I built exactly that. It passed, and it
passed just as happily with `cancelled: () => false` wired in** -- so it pinned nothing,
which is the defect this card exists to fix. **I removed it rather than shipping it.**

**The shape needs two conditions that cannot both hold on this code:**

- a second `start()` **refuses** while a driver exists (`if (driver) return state();`,
  `connect.js:830`), so the driver is never replaced by simply starting again;
- so `cancel()` must run first, and **it destroys the in-flight request directly**, so
  flow A's download dies whatever the hook returns.

⇒ **On the download path, `cancelled` has no observable effect from outside the module.**
The only route to a replaced driver also kills the thing the hook would have stopped.

**What would pin it:** a seam that replaces the driver without cancelling, or a
callee-side test supplying its own hooks. The second already exists and is why the
mutation went unnoticed.

## Scope

**In:** one new test file. **`engine/connect.js` is not edited** -- it is contended, and
the pin needs no production change. That was a pre-committed boundary and it held.

**Out:** `maySweepDownloads`, `wantsProgress` and `onProgress`. Each has the same
outside-observability problem as `cancelled` to a greater or lesser degree, and claiming
them without a proven mutation would be the same error.

## Weakest premise, named by me

**One of five hooks is pinned.** The card's headline is "4 of 5 can be wrong with the suite
green", and this reduces that to three, not zero. Anyone reading the card as closed by this
branch would be wrong, which is why the card comment says so plainly.
