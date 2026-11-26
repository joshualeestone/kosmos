# kosmos#9105: a task's built mark carries every delivered file

Split from #9096 item 1. Design on the card (comment 7178639688), decided before code.

## What changed
- `engine/builtfiles.js` (new, no requires): `filesOf(t)`, the one definition of a built task's files, read by
  setBuilt, the task readout and `kosmos task files`. `builtFiles` holds one entry per file NAME
  `{ name, fingerprint, by, path?, at?, checkedBy, checkedByPerson?, replaces? }`, or `{ name, replaces }` for a
  withdrawn file. The single-file fields describe the first current file (else the first withdrawn one).
- `engine/tasks.js` setBuilt: the #8307 one-file lifecycle is now `stepFile`, run per file the mark touches.
  New options `files` ([{ name, fingerprint, filePath? }], max 20, unique names) and `check` (names).
  - sender's mark with files: each matched by name (an unnamed pre-#9105 file is taken by the first unmatched
    name); files not sent are kept untouched.
  - one fingerprint sent the old way: it is the first file, as always; other files kept.
  - no files: every file takes the mark as #8307 did (a check by another agent, the person's check, its own
    sender's withdrawal). With `check`, only those files; a name not on the task, the checker's own file, a
    check from the person or with files, and an unnamed checker are refused.
  - the single-file fields stay the AUTHORITY for the file they describe: a board from before #9105 changes only
    them and leaves `builtFiles` stale, so filesOf rebuilds that entry from them (drops it when they say none).
  - returns `replaced` (first replacement, old shape, no name) and `replacedFiles` (every one, named).
- `server.js`: route passes `files` (and then drops `fingerprint`/`file_path`) and `check`; tellBuiltMark takes a
  list, tells every replaced file's checkers, names which they checked; the line lists several files; several
  withdrawn files are named to the marker. One file keeps every older word.
- `install/kosmos`, `tools/windows/kosmos-cli.js`: `--file` repeatable, `--check <name>` repeatable. The first file
  is also sent the older way; an answer with no `builtFiles` says "kept only the first file". A duplicate name is
  refused before the board. A single file whose name has control characters goes the older way with no name;
  among several it is refused.
- `engine/tasklist.js`: readout lists each file (fingerprint, sender, path or the check-a-copy line, checks,
  replaced/withdrawn); `task files` checks every current file. One file reads exactly as before.

## Rejected
- A second list for "the other files": two shapes for one fact.
- Keying by position: a re-send of one file would need to know its index.
- A copy of filesOf in tasklist.js: two definitions drift; moved to engine/builtfiles.js instead.

## Weakest premise
A file's name is a stable identity across revisions. A revision renamed per version (report-v2.md) reads as a new
file beside the old one. Would change my mind: agents routinely renaming per revision; then `--replaces <name>`.
Second: a mark from two senders. A no-file mark by A withdraws A's files and checks B's (per-file #8307). The card
said "withdraws all" assuming one sender; per-file is the consistent reading.

## Proven (measured on this branch)
- engine/tasks.builtfiles-9105.test.js 16/16; server.builtfiles-9105.test.js 11/11 (route + Mac CLI + reads);
  tools.windows-kosmos-cli-builtfiles-9105.test.js 3/3.
- Mutants, each applied exactly once and each red: engine 6 (check filter, authority, path strip, same-check,
  unnamed match, mirror-to-current), route 5, Mac CLI 4, Windows CLI 4, reads 3.
- Old files green: tasks.filereplace-8307, localpaths-8585, closedhow-8552, server.filereplace-8307,
  builtsha-6330, builtwaiting-8934, builtcommit-7508, task-built-3951, cli.task-files-8214, task-show-8202,
  win32-8232/8227, windows 570/4889/parity, cli.unknown-flag-4889.
- The old tests caught three regressions in flight, fixed: a Mac name with a backslash was refused; a single
  file named with a control character was refused (it must go without a name); the one-file path line's wording.

## Reasoned, not measured
- The Mac CLI sends the first file the older way to an older board (the body is built from `fps[0]`); tested only
  that the "kept only the first" line appears when the answer lacks builtFiles (engine answer stubbed).
- Full suite not run: Splinter 17:55/18:17, heavy runs after the App Store queue clears.

## Review ledger
(filled by the challenge loop)
