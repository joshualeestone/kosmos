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

## Measured
- Real CLI: 29 pass, 0 fail, 1 skipped.
- `KOSMOS_PIPED_PEEK_MS=300` -> `30000` (restored after): the open-pipe arm and the never-stopping writer of spaces
  go red (killed at 20 s).
- `KOSMOS_PIPED_PEEK_MS=300` -> `3000` (restored after): the new #9264 test goes red.

## Weakest premise
The length check reads the source, not the running CLI: a peek made longer some other way (a second timer, a sleep
before the read) would pass it. A behaviour-level check of that needs a clock, which is what this card removes.
