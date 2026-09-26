# kosmos#3906: a pull whose every listed report is malformed is not a success

Deferred from #3878's review loop (kosmos#3904, iteration 8). `pull` already answered `ok: false` when reports were listed and none could be READ. A listing whose reports were all malformed (bad JSON, the wrong shape, or an entry with no string `url`), or all failed to write, still ended `ok: true`, "pulled 0 (N skipped)".

## Change
- The failure condition is `written === 0 && skipped > 0`, whatever the reason.
- The message lists each reason that applies:
  - the shared `unreadableClause` for reports that could not be read;
  - "N could not be saved in <dir> (last error: ...)" for local write failures, which are counted apart and carry the error (review iteration 1);
  - "N malformed" for bad records.
- A partial pull stays ok, and its summary also says how many could not be saved here, with the error (`unwrittenClause`, shared with the failure message; review iteration 2). So does an empty listing, which already has its own line in `summaryLines`.

## Review iteration 3
- The counts are derived ONCE in `pull` (malformed = skipped - unreadable - unwritten) into one result shape shared by ok and failed pulls.
- `reasonClauses` gives the reasons: the failure message joins them and the summary prints them. A partial pull's malformed remainder is now explained too.

## Review iterations 4 to 6
- A stale duplicate of the #3906 comment was deleted (iteration 4).
- "malformed" is said as "N report(s) malformed (not a valid report, or no url)". A failed save removes its .tmp (iteration 5).
- **The public-store note, decided (iterations 5 to 7):**
  - Iteration 5 hid it on save-only failures, and iteration 6 made that one rule for both paths. Iteration 7 showed the rule regressed a partial pull and still left malformed-only failures inconsistent.
  - **Final:** the note is a FACT about where the listing came from, worded conditionally ("expected until the migration has run"). It is not a diagnosis of the skip. So it follows `fromPublicStore` on every path, the same as on main.
  - Iteration 5's finding is DEFERRED on that reasoning.
- A failed save removes only a .tmp THIS call wrote (the write succeeded and the rename failed), so it never touches a concurrent pull's file. Tested with a non-empty directory at the destination.

## Tests
`engine/feedbackpull.test.js`:
- all malformed;
- an entry with no url;
- a real local write failure (a directory where the file would go);
- a partial pull with a local write failure;
- all three kinds together, each counted once;
- a partial pull explains its malformed remainder, and both results carry the same fields;
- the store note follows fromPublicStore on a failed pull and a clean one, never on a private listing;
- a failed rename removes its own .tmp;
- controls: one good report among bad ones, and an empty listing.

The mutation that restores the old condition runs red.

## Weakest premise
That the last write error is enough to diagnose a local failure. It is one error for N failed files, the same as the read path.
