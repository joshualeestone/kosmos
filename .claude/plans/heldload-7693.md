# heldload-7693: the [loop-held] line says the machine's load (kosmos#7693)

## Problem
#7693's next measure is blocking ms per hour "at comparable load". board.log has no load, so the read on 11-06
could not say whether #8035 helped: held time fell from 452 s to 12 s between two hours with no change to the board.

## Finished means
A [loop-held] line on a board with a load ends ", load N.NN", and the next read on the release carrying it can group
stalls by load. Then this card can answer.

## Change
engine/loopheld.js: append os.loadavg()[0] to the stall line. Not to the sleep-gap line (a computer waking has no
load worth comparing). Left out when there is none (Windows answers 0; a bad number; a failed read), and a failed
read never loses the line. Read only on a stalled tick, so no cost on a free thread (also for a line the per-minute cap then drops: one cheap read).

## Decided
- One-minute figure, not five: stalls are seconds to a minute long.
- Rejected: a separate sampler logging load every minute. More lines and a new timer for what one field does.
- Left the line's existing text unchanged, so anything reading it by prefix still matches.

## Weakest premise
One moment at the end of a stall is not the stall's average, and a long stall raises nothing by itself but sits inside
the window it averages. It still separates a quiet machine from one at load 200, which is the split the card needs.
