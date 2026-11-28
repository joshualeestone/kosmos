# timing-9264: the #9238 CLI test asserts behaviour, not elapsed milliseconds

Card: kosmos#9264 (filed by Splinter 00:29 CST 11-28 after April's full run on Mortals went red on it).

## Finished looks like
`cli.community-words-and-piped-9238.test.js` has no wall-clock UPPER bound, so a busy machine cannot turn it red,
and it still fails when the CLI really waits on an open stdin.

## Change
- "words alone with <stdin> ... at once" (4 arms): drop `r.ms < 2500`. Kept: exit 0, one post, the words as the body.
- "words alone with <writer> wait only the short peek" (2 arms): drop the `< 2500` half; keep `cliDone >= 250`
  (a timer never fires early, so load cannot break a lower bound).
- "a writer that never stops (yes) is refused": drop `cliDone < 2500`; keep that the shell reported the CLI finished.

## Why this still catches a CLI that waits
`run()` kills the child at 20 s and rejects a run with no exit code. A CLI that took the 3 s quiet read on
`yes ' '` never sees quiet and never finishes; a CLI that holds an open pipe with nothing on it never finishes.

## Measured (both arms)
- Real CLI: 28 pass, 0 fail, 1 skipped.
- Perturbed CLI (`KOSMOS_PIPED_PEEK_MS=300` -> `30000` in install/kosmos, restored after): 2 red, the open-pipe arm
  (killed at 20 s) and the never-stopping writer of spaces.

## Weakest premise
A CLI that waited a bounded 3 s on an EMPTY open pipe (rather than forever) would now pass the open-pipe arm; only
the never-stopping-writer arm guards the quiet read. That is the trade the card asked for: a 3 s delay is a
performance regression a person notices; a red run on a busy box blocks everyone.
