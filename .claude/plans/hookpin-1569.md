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

**Out:** `cancelled`, and the guard-collapse direction of `wantsProgress`.

🛑 **THIS SECTION WAS WRONG AND A REVIEWER DISPROVED IT USING THE FIXTURE ALREADY IN MY
OWN FILE.** It said `maySweepDownloads`, `wantsProgress` and `onProgress` were all out,
"each with the same outside-observability problem as `cancelled`". Three claims, all
false, in different ways:

- **`onProgress` IS observable.** `connect.state().progress` reports its output verbatim
  while a download is parked mid-stream, which is exactly what `serveHeldRelease` in this
  branch's test file was built to do. It is now pinned. The mutation that proves it,
  `onProgress(total, got)`, leaves the whole 3120-test suite green and reds this test.
- **`wantsProgress` is observable too.** Turning it off reds three pre-existing tests
  through `state()`. Only the collapse direction (always true) is unpinned, which is a
  different and much narrower sentence than the one written here.
- **`maySweepDownloads` was already pinned** by the existing `#458` test. Listing it as
  out on observability grounds was wrong about a guard that already existed.

⭐ **The shape, and it is the reason this is worth the space: I asserted a NEGATIVE about
what could be measured, without running the measurement.** The claim was safe-sounding,
self-deprecating, and unfalsifiable as written, so it read as rigour. A negative claim
about observability needs a probe exactly as much as a positive one does, and the probe
here was about eight lines against a harness that already existed.

⚠️ And the scope boundary itself was fine. What was wrong was the MEASUREMENT offered to
justify it, which is the half the next person would have trusted rather than re-run.

## Weakest premise, named by me

**Two of five hooks are pinned by this branch** (`onPhase`, `onProgress`), a third
(`maySweepDownloads`) was already pinned, and `wantsProgress` is pinned in one direction
and not the other. `cancelled` is genuinely unpinnable from outside and the measurement
for that is recorded in the test file rather than asserted. So the card's headline
("4 of 5 can be wrong with the suite green") is reduced but not closed, and anyone
reading the card as closed by this branch would still be wrong.
