# worldundo-8402: the Mac and Linux uninstall puts back each named Kosmos's Gemini settings record too

Card: kosmos#8402 (Splinter's ruling, 2026-11-11 14:59: Mona Lisa's; #8403 closed as its duplicate). The Mac half of #8377 (PR #8401).

## Finished looks like
`setup.sh --uninstall` puts back the Gemini values recorded under every named Kosmos's data folder (<data>/worlds/<id>/Kosmos/gemini-wrote.json), as well as the main one's, each node run still inside #8399's _kosmos_wait_bounded. One stalled mount costs one bound, not one per Kosmos, and the person reads each message once.

## Shape (decided)
- gemini_settings_undo_all "$_support" at both call sites. It calls gemini_settings_undo on the main folder, then on each worlds/<id>/Kosmos with a record.
- Only ids engine/worlds.js could make (CLEAN_ID, letters spelled out because macOS sh's a-z matches capitals in a UTF-8 locale), never "default".
- Once a node had to be stopped (_gw_stopped), later records are not tried, and the person is told once where their lists are (#8388 review 7's rule).
- _gw_say_once: a line one record said is not said again. The node's output is split in this shell, with no pipe (subshell) and no here-document (bash 3.2's temp file under a full TMPDIR ends the uninstall under set -e).
- Rejected: one node call reading every record (Renet's point: one call per folder keeps each run bounded on its own).
- Weakest premise: the folder scan, not the worlds registry, decides which Kosmoses exist. This matches engine/win32uninstall.js geminiWroteRecords. A hidden Kosmos still has its folder.

## Tests (install.uninstall-gemini-8362.test.js)
- A named Kosmos's record is put back.
- Once one undo is stopped, the rest are not tried, and that is said once (control: red without the stop).
- A line every record would say is said once (control: red without _gw_say_once).
- A re-run with the install gone names each named record, and skips a spaced name, a capitals name (under en_US.UTF-8; control: red with a-z) and worlds/default.
- The main folder has no record and a named one does.

## Review ledger
- R1 opus: 2 W (a wait per Kosmos on a stalled mount; the second call site untested), NITs (dedupe, folder-name filter). Fixed.
- R2 sonnet: 1 W (the here-document's temp file). Fixed by splitting with parameter expansion. While fixing it, a splice left the here-doc body in place, which ran output as commands (macOS `say`). The tests caught it at once (8 red); fixed before any push.
- R3 opus: 1 W (a-z matches capitals in macOS sh, measured), NITs. Fixed, with a locale test and its control.
- R4 sonnet: 0 B/W/C. Converged.

## Status
- [x] built and reviewed; uninstall suites green (35 of 35 across three files; R4 ran nine files, all green)
- [ ] rebase onto main once #8399 merges; full validation; proof; PR; mog
