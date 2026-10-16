# musecut-6319: a Meta Muse DM answer was cut at 4000 characters with no marker (kosmos#6319)

## Change
- `engine/musefront.js`: `finalCopy(text)` keeps an answer of up to FINAL_MAX (4000) characters whole; a longer
  one is cut short enough to end with FINAL_CUT_MARK, "... (the answer is longer than Kosmos can show here)",
  inside the 4000. The board's own cap (`selfreport.finalOf`, 4000) would otherwise cut a marker
  appended after the limit.
- `engine/selfreport.js`: exports `finalOf` (pure) so the test can run the board's cap without writing a record.

## Wording
Says there is more, and promises no place to find it. Review round 1 (opus): nothing in engine/ or web/ backs
"the agent's own window" as somewhere a person can open, so naming it could point at a place they cannot find.
Decided here; overridable in a line.

## Checks
`engine/musefront.test.js` #6319: a 5999-character answer through the real front harness is <= 4000, ends with
the marker, keeps the start of the answer, and keeps the marker through both caps on the way: the report bridge
(`bin/agy-report-bridge.js`), then `finalOf`. Controls: exactly 4000 is untouched; 4000 emoji are 4000
characters; one more is marked. Mutants red: the old silent slice, a marker appended past the limit, and a lower
bridge cap.

## Weakest premise
That a person reading a cut answer knows to open the agent to see the rest. The marker says only that there is more.
