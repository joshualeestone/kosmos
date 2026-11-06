# heldload-7693: the [loop-held] line says the machine's load (kosmos#7693)

## Problem
#7693's next measure is blocking ms per hour "at comparable load". board.log has no load, so the read on 11-06
could not say whether #8035 helped: held time fell from 452 s to 12 s between two hours with no change to the board.

## Finished means
board.log records the load on each [loop-held] line and every 10 minutes between them, so the next read on the
release carrying it can compare held time at like load, including hours with no stall.

## Change
engine/loopheld.js: os.loadavg()[0] on both [loop-held] lines, and a [load] N.NN line every LOAD_EVERY_MS from the
existing tick. Left out when there is none to report (Windows answers 0; a bad number; a figure that rounds to 0.00),
and a failed read never loses the line it goes on.

## Decided
- One-minute figure, not five: stalls are seconds to a minute long.
- A [load] line as well as the field (review 2): with the field alone an hour with no stalls has no reading, so a fix
  that removed the stalls would look just like a quiet machine. About 144 lines a day, on the same tick, no new timer.
- Left the [loop-held] line's existing text unchanged, so anything reading it by prefix still matches.
- Load on the gap line too (review 2): it can be the longest real stall.

## Limits for whoever reads the log
- One moment, not an average over the stall.
- The per-minute cap drops [loop-held] lines when stalls cluster, so high-load hours are undercounted. The [load]
  line does not go through the cap (review 3): one line every 10 minutes cannot flood the log.
- A nap under ASLEEP_MS reads as a stall and lands in the load seen on waking.
- No [load] line reads as "no figure", not "idle": a machine at a true 0.00 (an idle Linux box or VM) writes none, and
  neither does a board that restarted within the 10 minutes. The read this card needs is on a busy Mac.

## Evidence behind the change (read 11-06 from board.log on one Mac; on #7693)
452 s held in the 16:00 hour on 11-05, 12 s at 17:00, no restart between them.

## Weakest premise
That a reading every 10 minutes is frequent enough to place an hour's stalls by load. A load swing inside 10 minutes
is smoothed by the one-minute average only partly; hours are the unit the card compares, so it should hold.
