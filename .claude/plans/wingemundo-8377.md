# wingemundo-8377: the Windows uninstall puts back the Gemini settings Kosmos recorded writing

Card: kosmos#8377 (follow-up to #8362 / PR #8376, which records each value Kosmos fills into a ~/.gemini/settings.json in <data>/gemini-wrote.json and gives geminisettings.undoWrites).

## Finished looks like
On Windows, Uninstall Kosmos removes every recorded value that still holds what Kosmos wrote, keeps and names any value the person changed, names a file it could not finish, and says so in the report, before the data folder (which holds the record) is deleted. Same behaviour and wording as setup.sh's gemini_settings_undo on the Mac.

## Shape (decided)
- engine/win32uninstall.js geminiWroteRecords(home, env): the data folder's record plus every named Kosmos's (a named Kosmos's board has its own data folder, worlds.envOverridesFor, and create.js supportDir() follows it), the same root create.js writes to.
- undoGeminiWrites(rec, done, notes) maps undoWrites' {done, restored, kept, left, because} into the report. Everything it could not finish is a NOTE, as setup.sh says it: undoWrites' `left` mixes a broken settings file (no rerun fixes it) with a race, so LEFT would fail every later uninstall for good.
- A record still holding anything is kept out of the --delete-data deletion (deleteAllExcept keep list), so "the list is in <record>" is always true and a later run can finish.
- Called right after the hook removal (step 7), each record in its own try, before steps 8-9.
- Rejected: wording chosen from --delete-data (round 1-2 shape). Step 9 can refuse or partly fail, so the flag did not say whether the record went (round 3).
- Rejected: running it from the PowerShell uninstaller. The JS uninstaller owns every settings.json step and the report.
- Weakest premise: the uninstall's home/env resolve the data root the running boards used. True for every other dataRootFor call in this file; Homer's box check confirms it.
- Not in this change: install/setup.sh reads only the main data folder's record, so on the Mac a named Kosmos's record is missed too. Raised on the card as a follow-up.
- Accepted as-is: the kept-value note names the dotted key (general.enableAutoUpdate), word for word as setup.sh; a plainer wording should change both together.

## Tests
- engine/win32uninstall.geminiwrote-8377.test.js: restores and keeps-and-names (record used up); no record (control); unreadable record; a file it could not finish is a note; a record that still holds something stays; records list incl. a named Kosmos and the APPDATA default (Windows-only).
- engine/win32uninstall.unhooks-5999.test.js: through uninstall(): restores from the record in the data folder; --delete-data keeps the unfinished record with a real deletion (control: another data file goes) (both Windows-only, as #8361's).

## Review ledger
- R1 opus: 5 W (left vs note, record pointer under --delete-data, no wiring test, real-path test, plus NITs). Fixed.
- R2 sonnet: 1 W (--delete-data wiring through uninstall()). Fixed.
- R3 opus: 4 W (named Kosmos records missed; pointer chosen by flag not by outcome; keys lost with the record; .gemini- account folders), 1 C (create.js comment). Fixed by keeping unfinished records and listing every Kosmos's.

## Status
- [x] built; uninstall suites green here (51 pass, 0 fail, Windows-only skipped)
- R4 sonnet: 2 W (file-keeping arm of deleteAllExcept untested off Windows; the same note once per record). Fixed: cross-platform deleteAllExcept test, notes deduped.
- R5 opus: 1 B (retire-6391 source-order guard pinned the deleteAllExcept line's exact text; red on every platform). Fixed, guard anchored on the stable prefix; every engine/win32uninstall*.test.js and geminisettings*.test.js now run each round (98 pass here). NITs fixed: junction worlds, done deduped, deleted-line says the list was kept, clearer list wording, comment.
- R6 sonnet: 0 B/W/C, NITs only (Mac-parity wording, left as is). Converged on engine/.
- Full validation on the rebased head (onto #8376's merge) failed 1: engine.reachable.test.js, the three test seams. Excused by name; validation then PASSED (ea5a7980bda4).
- R7 opus, WHOLE branch (R4-R6 read engine/ only, so the root-level excuse edit was unread): 0 B, 2 W (a dangling-link record kept and reported as a list; filelock's "we" reasons in the report). Fixed: existsSync in both places, plainBecause. NITs fixed.
- [ ] R8 (cap) on the whole branch
- [ ] rebase onto main once #8376 merges; validation; PR; mog
- [ ] Homer's Windows box check
