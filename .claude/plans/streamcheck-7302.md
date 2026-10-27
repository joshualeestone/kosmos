# #7302: the #6734 download memory check holds under a busy runner

## Seen
server.attachment-stream-6734's "a 64 MB file held by a paused client costs the board far less than 64 MB" went red in
CI twice on 2026-10-26 on unrelated PRs (#7279, #7291), and passed alone both times. One red was the instrument's own
control: a 64 MB Buffer.alloc raised arrayBuffers by less than 60 MB.

## Cause (corrected in review 1; reasoned, with the mechanism measured in probes, not the CI red itself)
Both readings are differences of process.memoryUsage().arrayBuffers. A baseline taken while an earlier 64 MB Buffer is
still counted (CONTROL 1's own `held` after `held = null`, or a just-closed server's buffer) already includes 64 MB.
- A collection that frees it while a new 64 MB is allocated makes the allocation read as near zero: the CONTROL red.
- A board that buffers can hide the same way: the old check passed a board reading the file whole with fs.readSync.
- One forced gc() does not settle it. Measured by the reviewer: a dropped 64 MB Buffer was still counted after gc() in
  up to 7 of 10 tries, and a closed server's buffer stayed reachable for tens of ms.
(My first account blamed a 64 MB source Buffer written by storedOf. Wrong: storedOf writes 1 MB blocks. My second blamed
late sampling alone. Also wrong: late sampling still sees a buffering server; the dirty baseline is what hides it.)

## The call (test only)
- `settled(floor)`: collect, wait 10 ms, repeat until three readings agree within 1 MB AND (when a floor is given) the
  reading is back within 2 MB of it; it fails the test by name if that never happens. The board's and the control's
  baselines use the reading taken before CONTROL 1 as their floor; the upload-at-cap test uses it too.
- The board is measured FIRST and the buffering control second, so a leftover in a baseline can only make the control
  read low, which fails red.
- A buffering server in the same process (readFileSync then res.end), measured the same way just after the board, must
  hold at least 48 MB: the instrument can see buffering on this run.
- The board must hold under 8 MB and under an eighth of the control (it measures 0 to about 1 MB). The old 24 MB bound
  passed a board buffering 20 MB.
- Sampling every 2 ms from before the request. The readFileSync spy stays. A guard fails clearly if gc() is unavailable.

## Rejected
- Raising the ceiling, or retrying the test: either makes a real regression pass or intermittent.

## Proof
- The file: 33 of 33. Twenty runs on the final shape (round 2): 20 of 20 at 1-minute load 4.1 to 80.5.
- Mutations, each red and restored:
  - the board reads the whole range into one Buffer (fs.readSync, unseen by the spy): "the board held 64.3 MB";
  - the board buffers its first 20 MB and streams the rest: "the board held 20.4 MB" (the old bounds passed this).
- Both controls hold (Buffer.alloc 64 MB seen; the buffering server held 64 MB).

## Weakest premise
That a settled baseline is reached on a busy runner within its 100 tries (about a second). If it is not, the test fails
by name ("arrayBuffers never settled"), not by a wrong memory figure; CI over the coming days is the measurement. The control is measured
just after the board, not at the same moment, so it shares the run's conditions, not each instant's.

## Review rounds
1. (default model, 23:4x CDT) 2 BLOCKERs, 2 WARNINGs, 3 NITs, all applied: a baseline could still hold the control's
   64 MB (board now first, control second); one gc() does not settle (settled() polls); a 20 MB partial buffer passed
   (now under 8 MB and an eighth); my cause and false-pass explanations were wrong (corrected above); the "both sides"
   overclaim, a gc() guard, and a leftover `void held` line.
2. (sonnet, 23:5x CDT) 1 BLOCKER, 2 WARNINGs, 1 NIT, all applied. (B) Agreeing readings could both still hold CONTROL 1's
   64 MB, then free it mid-window and hide a buffering board: baselines now need a floor (back to the pre-CONTROL-1
   reading) and three agreeing readings. (W) The silent fallback is now a named failure. (W) The upload-at-cap test had
   the same unsettled baseline; it uses settled() now. (N) "a fifth" corrected to "an eighth". Both mutations red;
   20 of 20 at load 4.1 to 80.5.
