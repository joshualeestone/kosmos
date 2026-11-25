# pgreplook-9045: the running-anchor test looks again when pgrep itself failed (kosmos#9045)

## Problem
`tools/test-running-anchor-5470.sh` reds a whole validation when one real `pgrep` call fails on a loaded Mac: the helper answers 2
("could not tell"), which is right, and the test took it as a wrong answer. pgrep's own message was thrown away. Seen once, 02:40 CST
11-25, load 17.57; not reproduced by load.

## Call
- The test's three live reads go through `look`: up to six, half a second apart, and only a 2 is looked at again. Every failed look
  prints pgrep's code and words.
- The helper (`tools/lib/cut-guard.sh`) is untouched: a caller that cannot tell must wait or refuse.

## Rejected
- A retry in the helper: it would hide a failing pgrep from the guards that act on it.
- Taking a 2 as a pass: a pgrep that never works must stay red.

## Left, declared
- The test's other direct pgrep calls (`settle`, the CONTROL's unanchored one, the #6799 sibling wait) have no second look: `settle`
  and the sibling wait already loop, and the CONTROL reds with its own words.

## Weakest premise
That the failure is short. If pgrep fails for longer than about 3 s on this Mac, the test is red, now with the reason printed.

## Test
Three new arms with a stand-in pgrep. A pgrep on PATH that fails its first call: main's version red with the card's own line, this one
green with one note; failing three times, green; failing always, red. Six mutations, all red.
