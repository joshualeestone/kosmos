# timing-9264: the #9238 CLI test asserts behaviour, not elapsed milliseconds

Card: kosmos#9264 (filed by Splinter 00:29 CST 11-28 after April's full run on Mortals went red on it).

## Finished looks like
`cli.community-words-and-piped-9238.test.js` has no wall-clock UPPER bound, so a busy machine cannot turn it red,
and a CLI that waits on stdin longer than the short peek still fails it.

## Change
- "words alone with <stdin> ... still post the words" (4 arms): `r.ms < 2500` removed, and "at once" left the title.
  Kept: exit 0, one post, the words as the body; an unbounded wait is still a red (run() kills at 20 s and rejects).
- "words alone with <writer> ... look, then post the words" (2 arms): the `< 2500` half removed; `cliDone >= 250`
  kept (a timer never fires early, so load cannot break a lower bound).
- "a writer that never stops (yes) is refused": `cliDone < 2500` removed; that the shell reported the CLI finished
  is kept.
- NEW: "#9264 the peek for words alone is under a second and is not the quiet read" reads install/kosmos: the
  KOSMOS_PIPED_PEEK_MS line is under 1000, `_words_and_piped` hands it to the peek, the peek's timer reads it, and the
  function never reaches `_read_stdin_quiet` / `KOSMOS_STDIN_QUIET_S`. Two inline controls (a 3000 ms peek, and the
  quiet read's length handed to the peek) must make it fail.
- `run()` no longer records `ms`, which nothing reads now.
- `run()` starts the child in its own process group and the 20 s kill takes the whole group: before, under a
  `/bin/sh` parent the CLI and its peek kept the pipes open and the test hung past its own timeout.

## Measured
- Real CLI: 29 pass, 0 fail, 1 skipped.
- `KOSMOS_PIPED_PEEK_MS=300` -> `30000` (restored after): the open-pipe arm and the never-stopping writer of spaces
  go red (killed at 20 s).
- `KOSMOS_PIPED_PEEK_MS=300` -> `3000` (restored after): the new #9264 test goes red.
- `KOSMOS_PIPED_PEEK_MS=300` -> `999999` (restored after): before the group kill the writer arms hung over 300 s;
  after it, the open-pipe and never-stopping-writer arms are red at 20 s (the `sleep 4` writer ends, so it passes).

## Rejected
- A coarse upper bound (10 to 15 s) between the 250 ms floor and the 20 s kill: it would not catch a 3 s wait, and
  it brings back load sensitivity (a run of this runner's own tests took 46 s at load 32, #6668's notes).
- Exact-text matching of the peek's lines: a harmless reformat of the embedded node script would turn it red, the
  same false red this card removes. The check matches the hand-off and the timer by pattern instead.

## Weakest premise
The length check reads `_words_and_piped`, not the running CLI: a wait added some other way (a second timer or a sleep
inside it, or a call site that probes stdin with `_read_stdin_quiet` before or instead of calling it) would pass it,
and the behaviour arms would pass a wait that ends before 20 s. A behaviour-level check of that needs a clock, which
is what this card removes.
