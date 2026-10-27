# #7302: the #6734 download memory check holds under a busy runner

## Seen
server.attachment-stream-6734's "a 64 MB file held by a paused client costs the board far less than 64 MB" went red in
CI twice on 2026-10-26 on unrelated PRs (#7279, #7291), and passed alone both times. One red was the instrument's own
control: a 64 MB Buffer.alloc raised arrayBuffers by less than 60 MB.

## Cause (reasoned from the code; the red was not reproduced on demand)
Both readings are differences of process.memoryUsage().arrayBuffers, and garbage is collected when the runtime chooses.
storedOf(64 MB) leaves a 64 MB source Buffer as garbage; a collection landing between "before" and "after" frees it
while the control allocates 64 MB, so the difference reads near zero. The same drift can leave earlier buffers in the
paused download's peak. A busy runner moves when collections land, which is why it appears only in CI.

## The call (test only)
- A full collection on demand before every baseline (v8.setFlagsFromString('--expose-gc'), then vm's gc), so earlier
  garbage cannot cancel or inflate a reading.
- A second control in the same process: a tiny server that DOES buffer the same file (readFileSync then res.end),
  measured with the same paused-client helper under the same load. It must hold at least 48 MB, which proves the
  instrument sees buffering right now.
- The board's download must hold under 24 MB (as before) AND under a third of the buffering server's figure.
- The readFileSync spy stays.

## Rejected
- Raising the 24 MB ceiling: hides a partial-buffer regression and does not touch the control's failure.
- Retrying the test: makes a real regression intermittent instead of red.
- Sampling starts BEFORE the request goes out, every 2 ms. Found while proving the negative arm (below).

## Found while proving the negative arm: the old check could not see a buffering download
A mutation that makes the board read the whole range into one Buffer (fs.readSync, not readFileSync, so the spy
does not catch it) and send it with res.end PASSED the old check and my first version of this one. Logged: the board's
arrayBuffers went 65 -> 129 MB at the allocation, and back to 66 MB by the end. Sampling started in the client's
response callback, and by its first sample the 64 MB had been handed on and collected, so the peak read 0 MB. Sampled
from before the request, the same mutation reads 64 MB held (the board streaming reads 1 MB), and the test goes red:
"the board held 64 MB for a paused 64 MB download (a buffering server held 64 MB)".

## Proof
- The file: 33 of 33. Twenty runs on the final shape: 20 of 20, at 1-minute load 4.2 to 5.4 (this Mac with other
  agents' work; not a full suite beside it, which the queue forbids here; CI is where the load case is met).
- Negative arm: the board buffering through fs.readSync reds the memory assert (64 MB against 64 MB buffered).
  Restored, cmp-checked.
- Both controls hold: Buffer.alloc 64 MB seen (>= 60 MB); the buffering server measured 64 MB.

## Weakest premise
That the CI reds were garbage-collection timing, not something else on the runner. It is reasoned from the code and
the control's failure shape, not reproduced. The forced collection removes that cause; the same-process buffered
control makes any remaining load effect hit both sides.

## Review rounds
