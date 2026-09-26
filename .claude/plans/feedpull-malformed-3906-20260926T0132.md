# kosmos#3906: a pull whose every listed report is malformed is not a success

Deferred from #3878's review loop (kosmos#3904, iteration 8). `pull` already answered `ok: false` when reports were listed and none could be READ. A listing whose reports were all malformed (bad JSON, the wrong shape, or an entry with no string `url`), or all failed to write, still ended `ok: true`, "pulled 0 (N skipped)".

## Change
- The failure condition is `written === 0 && skipped > 0`, whatever the reason.
- The message lists each reason that applies:
  - the shared `unreadableClause` for reports that could not be read;
  - "N could not be saved in <dir> (last error: ...)" for local write failures, which are counted apart and carry the error (review iteration 1);
  - "N malformed" for bad records.
- A partial pull stays ok. So does an empty listing, which already has its own line in `summaryLines`.

## Tests
`engine/feedbackpull.test.js`:
- all malformed;
- an entry with no url;
- a real local write failure (a directory where the file would go);
- controls: one good report among bad ones, and an empty listing.

The mutation that restores the old condition runs red.

## Weakest premise
That the last write error is enough to diagnose a local failure. It is one error for N failed files, the same as the read path.
