# musecut-6319: a Meta Muse DM answer was cut at 4000 characters with no marker (kosmos#6319)

## Change
- `engine/musefront.js`: `finalCopy(text)` keeps an answer of up to FINAL_MAX (4000) characters whole; a longer
  one is cut short enough to end with FINAL_CUT_MARK, "... (the answer is longer; the rest is in the agent's own
  window)", inside the 4000. The board's own cap (`selfreport.finalOf`, 4000) would otherwise cut a marker
  appended after the limit.
- `engine/selfreport.js`: exports `finalOf` (pure) so the test can run the board's cap without writing a record.

## Wording
Matches #6316's spill marker style ("(long message, N words; the full text is in ...)"): plain, says there is
more and where. Decided here; overridable in a line.

## Checks
`engine/musefront.test.js` #6319: a 5999-character answer through the real front harness is <= 4000, ends with
the marker, keeps the start of the answer, and keeps the marker through `finalOf`. Controls: exactly 4000 is
untouched; 4000 emoji are 4000 characters; one more is marked. Mutants red: the old silent slice, and a marker
appended past the limit.

## Weakest premise
That "the agent's own window" is where the person can find the rest. It is where Muse wrote it; whether the
person opens it from the agent's page is not measured here.
