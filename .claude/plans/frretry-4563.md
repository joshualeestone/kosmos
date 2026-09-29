# frretry-4563: click-first-run's retry opens About-you already answered

Card: #4563 (follows #3030, whose close-out premise this reverses). Found chasing PR #4536's CI.

## Call
- `YOU` is `path.join(path.dirname(FLAG), 'you.json')`: since #1848, engine/you.js writes through store.ROOT, the
  directory first-run.json is in. The old grandparent path meant fresh() cleared nothing, so a run_one retry always
  failed "Continue waits for the two required answers" and "one answer alone does not arm it", on every branch.
- Section 1 asserts `fs.existsSync(YOU)` after the walk, so a future drift reds on attempt 1 instead of hiding until a retry.
- The first overlay read waits (bounded, 10 s) for `#firstrun` visible before the instant `isVisible`. It had a 500 ms
  margin after networkidle; one load measured 837 ms under an 8x CPU throttle.

## Rejected
- Fixing inside voice-4409: it would put an unrelated check change into the voice diff and invalidate its proof, and every branch has this bug.
- Making run_one reboot a fresh board for the retry: larger, it touches every check's retry, and it would hide exactly this kind of state leak.
- Deleting you.json at both paths: that keeps the wrong path alive as a second reference.

## Weakest premise
The overlay wait is REASONED to keep catching a never-shown overlay (the wait times out, the read is false, FAIL). I did not force a never-shown overlay to watch it red.

## Measured
- origin/main 7584512d1 and main+voice d5950584b: two runs against one board, attempt 1 rc 0, attempt 2 rc 1 (the two FAILs).
- 6b21f3999: attempt 1 rc 0, attempt 2 rc 0. you.json is cleared afterwards.
- Mutation (old YOU path): attempt 1 rc 1 on the new guard; attempt 2 rc 1 with the two original FAILs plus the guard.

## Deviation: validation order
6.0's baseline full validation was not run before review 1: the Mac's suite slot has been held by other agents' runs
for 40+ minutes, and the change is one check file I had already run alone (both arms, plus a mutation). The full
validation runs through the queue as the closing gate, before the proof.

## Review iteration 1 (blind, opus)
0 BLOCKER, 1 WARNING, taken:
- (W) section 3 presses Escape straight after fresh(), and section 10 after a fixed 400 ms, so the same late-overlay
  race reds them "Escape closed it" for a load reason. The wait is now one helper, waitOverlay(), called by fresh()
  (every fresh() caller expects the overlay) and by section 10. Sections 2 and 5 assert NO overlay and do not use fresh().
- (N) the never-shown-overlay premise was reasoned: measured below.
- (N) tools/test-install.sh seeds data/you.json at the pre-#1848 path; nothing breaks (it is fingerprint content), noted
  on #4563 as a follow-up rather than changed here.
