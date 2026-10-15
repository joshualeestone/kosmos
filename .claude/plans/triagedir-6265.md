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
  collected ones, and the daily job reads the pulled folder). Rejected: refusing with no --dir (the person ran the
  plain command; reading the obvious folder and saying so is kinder).

## Evidence
- engine/feedback.triagedir-6265.test.js 5/5 (pulled read and named; CONTROL own reports with the empty-pull note;
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
