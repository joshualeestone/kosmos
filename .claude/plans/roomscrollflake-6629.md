# roomscrollflake-6629: the failed-send arm of render-room-scroll flakes under cut load

Card: kosmos#6629.

## Finished looks like
The arm measures the room after it has come to rest. It cannot fail on a busy box because it measured too early, and it still fails when a failed send really leaves the reader off the floor.

## Measured (from the card)
In the 0.7.60 cut, the arm failed twice with `afterFail.gap = 50` (it wants 8 or less). The same check run alone on the same tree passed every arm.

## Cause (found in review, iteration 1; read from source, not reproduced under load)
A product defect. In `pjPostSend`'s `failed()`, `verdict(line)` writes the note under the box BEFORE `notKept` reads `onFloor()`. In the consolidated view `#pj-room-msg` goes from `:empty { display: none }` to shown and takes its height from the room, so a reader on the floor reads as above it. `keepFloor` comes out false, the taller failed pill is painted with no re-pin, and only the resize observer can rescue them. On a busy page the press-time scroll event can land after the room has shrunk, mark them off the floor (`__wasOnFloor = false`), and make the observer leave them where they are. A 50 px gap, only under load: what the cut saw.
My first reading (the check measured too early) was wrong: the note and the repaint happen before PJ_POSTING clears.

## Decided
- Fix the product: `failed()` reads the floor before `verdict(line)` writes the note, and hands it to `notKept`. notKept's own read stays as the fallback for any other caller (there is none today).
- The check waits two animation frames before measuring (the product pins at once and again a frame later), and no longer. A 1 s settle (iteration 1's version) would also pass a reader rescued late, which is the regression (review 2).
- Rejected: a wider tolerance (gap <= 64). It would pass a real 50 px regression.
- Rejected: a fixed sleep. It is load-dependent in the same way.

## Weakest premise
That this ordering is the cut's failure. It is reasoned from the source and matches the shape (50 px, consolidated view, only under load), but the load race is not reproduced on demand. If the arm fails again in a cut after this, the next suspect is the scroll listener marking the reader off the floor before the re-pin.

## Measured
- Before the product fix, three runs of the check pass alone.
- Control: with the product's press-time jump removed (jumpToOwnSend), the arm fails in both views (afterFail gap 3709 and so on), so it can catch a reader left short.

## Review log
### Iteration 1 (opus)
- [WARNING] fixed: my stated cause was wrong. The note and the repaint happen BEFORE PJ_POSTING clears, so my note wait did nothing. The reviewer found the product ordering defect, which is fixed here.
- [WARNING] noted: the sibling "did not move" arms measure once. That errs toward a false pass, not a flake. Out of scope here.
### Iteration 2 (sonnet)
No bug in the product change; the diagnosis is consistent with the source. Covered: restoreUnsent and the pill repaint, every failed() call site, the handed-over branch, and no unwanted pin.
- [WARNING] accepted and stated: **the fix is reasoned, not measured.** The cut's race was never reproduced. The only control (jumpToOwnSend removed) shows the arm can catch a reader left short, not that it would catch this ordering with the fix reverted. Forcing the race (the answer handled before the first frame after the press) needs control over the page's frame timing that the check does not have.
- [WARNING] fixed: settleAtFloor's 1 s wait made the arm pass a reader rescued late. It now waits two frames.
- [NIT] filed separately: the success path's ambiguous-name note (`msg.textContent = ambig`) can shrink the room the same way before loadRoom repaints.
- [NIT] fixed: the product comment says why the early read matters (the press-time scroll event's ordering), so it is not deleted as redundant.
### Iteration 3 (opus)
- [BLOCKER] fixed: the surface gate refused the branch. My two new product comments named `#pj-room-msg` (owned by render-room-reply-3745.js) and "consolidated" (render-shell-noscroll-4872.js). I had run the gate before committing the change, and it compares committed history, so it never saw them. Reworded ("the note under the box", "the one-page layout"); both gates now pass on the committed branch.
- [NIT] fixed: two commit messages described the dropped settle wait. The unpushed branch is folded into one commit with an accurate message.
- Confirmed by reading: the early read is taken before any height change, no reader is pinned against their will, and the check's two frames are always queued after the product's second pin.

### Runs (light lane, beside a heavy holder, so the box was loaded)
On 563d0d17 (the product fix and the two-frame arm), three runs:
- runs 1 and 2 passed every arm;
- run 3 timed out on a different wait earlier in the consolidated section, and two later sections failed downstream ("only ... proves nothing"). The changed arm passed in the plain view, and the consolidated run did not reach it.
The control in that turn did not run (its board refused the connection), so it is not counted. Re-queued.
