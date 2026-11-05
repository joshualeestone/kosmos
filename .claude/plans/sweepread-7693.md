# #7693: two more sweeps share the roster read

Addresses #7693.

## What finished looks like
The two largest sweeps that only tell the person read the shared roster, at most 20 s old, so they stop taking a blocking capture of every pane each minute.

## Measured
On 0.7.91 since 01:10 CST: 71 slow-spawn lines, about 90 s. The delivery-stall sweep (19 lines, 28 s) and the crashloop, stuck-terminal and own-bounds tick (5 lines, 8 s) are about 40 percent of that. Most blocking on this build is under the 1 s logging line, so the real share is unmeasured.

## Decided
- Only sweeps that never type. Sweeps that type read fresh (#7793 review 1: an old idle card could put a line on a question menu). firstreply, stuck input, connlost and class-1 stay as they are.
- A stall or a stuck terminal told up to 20 s later is fine: these run once a minute. A failed read is not kept, so stuck-terminal's rule that a failed read never advances an anchor holds.
- Weakest premise: this helps the symptom. The stalls follow machine load, 47 percent of held time is outside blocking commands, and this is a small slice of the rest. It reduces work; it does not end the stalls. Next measure: blocking ms per hour in the same log at comparable load, on the release carrying this.
