# triagedir-6265: triage with no --dir reads the folder `kosmos feedback pull` fills, and says which it read

Card: #6265 (filed by Angel from Splinter's report, 2026-10-15). Finished looks like: a triage run right after a pull
reads the pulled reports with no flag, and every run names the folder it read.

## Cause
feedback.reportsForTriage with no --dir read feedback.dir() (this computer's own daily reports). pull writes to
feedbackpull.defaultDir() (`<data>/collected-feedback`). Nothing said which folder triage read.

## Call
- No --dir: read the pulled folder when it holds any .md report, else this computer's own reports. Each case adds a
  note naming the folder (and, for the fallback, that the pulled folder had none). Both commands already print
  reportsForTriage's notes on stderr (install/kosmos, tools/windows/kosmos-cli.js), so the change is in the engine
  only. --dir is unchanged except for a note naming it. The result also carries `read` (the folder).
- Rejected: changing pull to write into the own-reports store (it would mix this computer's own reports with
  collected ones, whose names and frontmatter differ; the daily digest job pulls into its own temp folder, so it is
  not affected either way). Rejected: refusing with no --dir (the person ran the
  plain command; reading the obvious folder and saying so is kinder).

## Evidence
- engine/feedback.triagedir-6265.test.js 11/11 (was 5 at first) (pulled read and named; CONTROL own reports with the empty-pull note;
  --dir unchanged and named; --since on the pulled folder with a both-dates CONTROL). Against the old engine: 4 fail.
- feedback 25, feedback-triage 23, feedbackpull 37, the Windows CLI suites (verbs 15, 570 45, parity 12, body-file
  11), engine.reachable, fixture-discipline, comment-deferral, windows-tests-1777: pass.
- docs/feedback-triage.md step 1 now describes the default.

## Weakest premise
A pulled folder holding any report wins over this computer's own reports. Someone who wants their own reports after
a pull needs --dir; the note on every run tells them which folder was read.

## Review 1 (opus), and what changed
- WARNING: the reportsForTriage doc was separated from it and stale: moved back and updated (the default, `read`, the
  folder note). WARNING: hasReports counted a subdirectory named x.md: now regular files only (test + CONTROL).
  CONVENTION: the install/kosmos triage comment and feedbackpull's header described the old default: updated. NITs
  taken: fixtures use pull's real file names, and an undated pulled report is pinned. Left: the note carries an
  absolute path (stderr only; the daily digest job does not call this); the own store is listed newest first and the
  folders oldest first (as before for --dir; the digest does not depend on order).

## Review 2 (sonnet), and what changed
- No BLOCKER. WARNING (the pulled folder always wins once it holds a report): the weakest premise, already stated; the
  note now also names `--dir <own folder>` for reading this computer's own. WARNING: a pulled folder that vanished
  between the two looks was described as having no reports: the note now says it could not be read. CONVENTION: a
  doc line rewrapped.

## Review 3 (opus), and what changed
- No BLOCKER. WARNING: the note offered `--dir <own folder>`, which read it as a plain folder (keeping #5317's section
  markers as digest items): --dir naming this computer's own store now reads it as the store does (test with a
  two-writer day; CONTROL a plain copy keeps the markers; mutant red). WARNING: the age of the pulled data: the note
  says the newest pulled report's date. NITs taken: a linked report counts (stat follows links, as the reader does);
  a pull into the default folder ends `next: kosmos feedback triage` (feedbackpull.nextLine, both commands); the doc
  says every run that reads names the folder. CONVENTION: this plan's test count and its rejected-option reason
  (the daily job pulls into its own temp folder, not this one).
- tools/test-feedback-triage.sh and tools/test-feedback-digest-daily.sh pass.

## Review 4 (sonnet), and what changed
- No BLOCKER. WARNING (the pulled folder wins however old) is the stated weakest premise; the note already dates the
  pulled data (review 3). WARNING: on Windows a --dir naming the store in other capitals or slashes could miss it:
  samePath now compares realpathSync.native and folds case on Windows. NIT: nextLine moved above fileName's doc block.

## Review 5 (opus), and what changed
- No BLOCKER. WARNING: --since leaving nothing in the pulled folder gave an empty digest with no word why: the note
  says "none on or after <since>" and names --dir for the own store. WARNING: --dir naming a missing own store no
  longer refused: refused again (test); its order is the store's, newest first (the digest does not depend on order).
  NITs taken: nextLine compares paths as triage does and quotes a path with a space; the pull comment in
  install/kosmos and the doc mention the own-store case. CONVENTION: the rejected-option reason now in the Call.
