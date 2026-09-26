# kosmos#3906: a pull whose every listed report is malformed is not a success

Deferred from #3878's review loop (kosmos#3904, iteration 8). `pull` already answered `ok: false` when reports were listed and none could be READ. A listing whose reports were all malformed (bad JSON, the wrong shape, or an entry with no string `url`), or all failed to write, still ended `ok: true`, "pulled 0 (N skipped)".

## Change
- The failure condition is `written === 0 && skipped > 0`, whatever the reason.
- The message lists the reasons that apply: the shared `unreadableClause` for unreadable reports, and "N malformed or not written" for the rest.
- A partial pull stays ok. So does an empty listing, which already has its own line in `summaryLines`.

## Tests
`engine/feedbackpull.test.js`:
- all malformed;
- an entry with no url;
- controls: one good report among bad ones, and an empty listing.

The mutation that restores the old condition runs red.

## Weakest premise
That "malformed or not written" is precise enough. A write failure on the local disk and a bad record are counted together, as they were before this change.
