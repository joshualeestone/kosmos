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
- Final counts are in the last ledger entry (the first build had engine 16, route+Mac+reads 11, Windows 3).
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
- Round 1 (opus, blind, whole branch): 0 BLOCKER, 4 MAJOR, 7 MINOR. All fixed or answered:
  1 MAJOR an older CLI's fingerprint for a non-first file made two entries of one name: it now targets the file of
    its path's name. 2 MAJOR an older board's clear left builtFiles, so a cleared file came back: the list carries
    builtFilesAt (the builtAt it was written with), and a mismatched list is not read (says too little, never too
    much). 3 MAJOR a name could carry a Windows path: names hold no backslash; a Mac file with one goes the older
    way alone and is refused among several (fixes MINOR 8, the CLIs' parity, too). 4 MAJOR (and MINOR 10) the line
    named every file by the marker: setBuilt returns sentFiles and the line names only those. 5 MINOR the cap is
    now per task (a mark adding past 20 is refused; checks and re-sends still work). 6 MINOR a --check by the
    marker with --waiting was taken as a correction: a check never is. 7 MINOR both CLIs say when an older board
    ignored --check. 9 MINOR the Mac name keeps a trailing newline (then refused as a control character): REASONED,
    no test (a file with a newline in its name). 11 tests added for each.
  Measured after: engine 21/21, route+Mac 14/14, Windows 4/4; 7 new mutants red; 222 older tests green.
- Round 2 (sonnet, blind, whole branch): 0 BLOCKER, 0 MAJOR, 9 MINOR (path stripping, partial writes and the other
  readers of the built fields checked and found clean). Fixed: 3+4 help says a mark without --file withdraws your own
  files, and files not sent stay; 5 a --check refusal names the task's files (a one-file readout shows no name); 6
  both CLIs' task list say "1 of N files" on a multi-file mark; 7 task files says the file count when it differs.
  Found while testing 5, my own bug from the build: refusals quoted names with JSON double quotes, and the Mac CLI
  reads the error up to the first one ("no file named \."); names in refusals are now in single quotes with no
  double quote or backslash, and the Mac test asserts the whole sentence (a JSON-quote mutant turns it red).
  Decided, not changed: 8 names are exact strings (Report.pdf and report.PDF are two files; folding case would merge
  two real files on a case-sensitive disk, a worse error than a duplicate that says itself); 9 a hand-made request
  whose name and path differ is taken as sent (both CLIs send them matched); 10 an older board touching a multi-file
  mark leaves the one file it knows, without a withdrawn record: the safe direction, no notice is possible from a
  board that does not know the other files existed.
- Round 3 (opus, blind, aimed at what rounds 1-2 were not): 0 BLOCKER, 2 MAJOR, 6 MINOR. All fixed:
  1 MAJOR an old-style fingerprint without a name landed on ANOTHER sender's file (mirrorIndex picked the first
    current one): on a task with several files it now goes to the sender's own file (current or withdrawn), else it
    is a new file; a one-file task keeps the old behaviour. 2 MAJOR an added file took over a pre-#9105 unnamed file
    and deleted it, against the help: only its own sender sending exactly one file takes it over now. 3 the readout's
    q() form (NFKC, brackets to parentheses, no format characters) was refused by --check: one shownName in
    builtfiles.js, used by the readout's file label and accepted by --check (unique match only). 4 a direction
    override reached refusals and panes: names lose \p{Cf} and are single-quoted (a ' inside becomes U+2019) in
    refusals, the told line and the withdrawal summary. 5 the told line had no cap: at most 5 names, each cut to 80
    characters, then "and N more (kosmos task show ...)". 6 a no-op --check warned of an older board: not when changed
    is false. 7 the authority test's name claimed more than any board produces: renamed to say it covers a
    hand-edited store, and a test added for a real older-board replacement (one file left). 8 Windows trailing dots
    and spaces are dropped from a name.
  Measured after: engine 25, route+Mac 16, Windows 5, all green; 7 new mutants red; 297 older tests green.
- Round 4 (sonnet, blind, whole branch, asked for fixes that contradict each other and stale comments): 0 BLOCKER,
  0 MAJOR, 9 MINOR. Fixed: 1 the old-style branch's comment still said "else the first file"; 2 the sentByMarker
  comment sat above fileWord; 6 both CLIs' "1 of N files" ignored the builtFilesAt stamp (a stale list said too
  much); 7 a Windows name that trims to nothing among several files gets its own refusal; 9 the review tags I had
  put in code comments came out (the repo's own older tags inside the moved #8307 code were kept). Decided, not
  changed: 3 on a one-file task an old-style fingerprint from another sender still replaces the file, exactly as
  before #9105 (the one-file world is untouched on purpose); 4 an unnamed caller's no-file mark withdraws every
  file, as the one-file rule always did for an unnamed caller (an unnamed mark cannot be told from its sender; it
  is recoverable by re-sending); 5 a pre-#9105 unnamed file re-sent beside a second file stays as its own entry
  (the round 3 rule; the cost is a duplicate that says itself, never a lost file); 8 hand-edited stores only.
  Measured after: 343 pass, 0 fail, 7 platform skips across the new and older files; stale-list mutant red.
- Round 5 (opus, blind, end-to-end through five user scenarios): 0 BLOCKER, 3 MAJOR, 6 MINOR. Fixed:
  1 MAJOR a --check of one file cleared "waiting on a review" for the whole task: with several current files the
    wait ends only when every one has a checker other than its sender (or the person). 2 MAJOR a re-send of one
    file on a multi-file task typed the one-file words with no name: whenever the task has several files the line
    says "file 'x', fingerprint ..." and "it replaces 'x' as sent earlier". 3 MAJOR an unnamed pre-#9105 file beside
    named ones read as a valid third deliverable and became the headline file: mirrorIndex prefers a named current
    file, and the readout labels it "sent before files had names (it may be one of the others, sent again)".
    4 the same file typed in another case became a second file: both CLIs take the name as its folder lists it
    (builtfiles.js diskName: exact entry, else the one case-insensitive match, else as typed). 5 "Delivered files: 0
    (check them again ...)": now "none current: every file sent was withdrawn", and task files counts such tasks
    apart from "built without --file". 6 one withdrawal of several files is named, and says the others stay.
  Decided, not changed: 7 the person's screen mark checks every file (the person's mark has always meant "I have
  looked", and the one-file rule did the same; a screen that lists the files is a separate card if wanted); 8 an
  older CLI's plain mark checks every file (it cannot say which; --check is the answer once updated); 9 a withdrawal
  is told to the marker alone (the #8307 rule).
  Measured after: new 52/52; older 297 pass, 0 fail, 7 platform skips; 7 new mutants red (both case-name ones too,
  so the case tests ran on this disk rather than returning early).

