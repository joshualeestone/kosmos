# rebootcap-8297: restart-note follow-ups from #8287

Addresses #8297 (follow-ups from the review of #8287, PR #8296, merged 2026-11-09 16:33Z).

## Finished means

1. The page's one-minute re-check of the restart note runs only in the first 15 minutes after Kosmos came back; the ten-minute re-check still runs after that.
2. When the file check could not look at some records and found others damaged, the line says the damaged count is a floor and how many could not be checked; "could not be read" no longer labels records that were read and found damaged.
3. `storecheck.lastScan`'s comment states the rule plainly.

## Decision

- **Cap measured from the note's `upAt`** (when Kosmos came back), not from when this page first saw the note. Agents return in the minutes after the restart, which is the reason the re-check exists; a page opened two hours later has nothing to wait for. Rejected: a per-page counter (a page opened late would poll for 15 minutes for no reason). A `upAt` the page cannot parse gives NaN, and `NaN < cap` is false, so no one-minute re-check: the ten-minute one still runs.
- **`unread` travels beside `damaged`** through `storecheck.lastScan` -> `restartnote.atStart` -> the kept note -> `checksFor` -> the page, via one helper (`filesOf`) that drops it unless it is a positive integer. A note written before this change has no `unread` and reads as before.
- **Words:** "N of Kosmos's main records are damaged" ("is" for one), matching the board's own damaged-files notice ("Kosmos found N damaged files"). With unread: "at least N of Kosmos's main records are damaged (some others could not be checked)". No number for the unread ones: `unread` counts a folder it could not list as one, and a folder holds many records (review 1). Rejected: keeping "could not be read" (false for an empty or blank file, which was read).
- `checked` semantics unchanged: unread with nothing damaged drops the files clause entirely (never "read fine", never "at least 0"). Review 1: enforced in `filesOf` (returns null) at every step, and in the page, not only at `atStart`, so a note on disk saying so cannot bring it back.

## Weakest part

- The cap uses the page's clock against the board's `upAt`. On a remote page whose clock is behind, the one-minute re-check runs up to that skew longer; ahead, it stops early and the ten-minute re-check covers it. Bounded either way.
- "damaged" also covers a file Kosmos was refused (`unopenable`) or one over the size limit. The damaged-files notice already calls all of these damaged, so the restart note agrees with it.

## Not done

- The card's "decided and not part of this" item (an agent stopped inside the 15-minute carry) is left as decided.

## Tests

- `engine/restartnote-8287.test.js`: lastScan shapes carry `unread`; new test that `unread` travels scan -> note -> kept note -> checks -> page, drops 0 and junk, and an old note reads as before. Mutation checked (removing the `unread` copy in `filesOf` turns it red).
- `server.restartnote-8287.test.js`: start() hands atStart `unread` too.
- `docs/browser-checks/render-reboot-note-5359.js`: wording arms (`not-back` new words, `one-damaged`, `floor`) and a re-check arm past 15 minutes (does not ask again), with the existing upAt-now arm as its control. Run locally on a sandbox board: 79 PASS, 0 FAIL. Mutation checked (removing the cap turns the new arm red).
