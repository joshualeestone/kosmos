# triage-4415: the daily reports get read (kosmos#4415 slice 2)

## Why
Josh, #admin 2026-09-28 15:16 CDT: "are we looking at those and processing them". The daily agent reports were
stored (kosmos#3878) and a triage engine existed (engine/feedback-triage.js, #2246), but nothing ran it, and run on
the 39 live reports it made 158 "candidates", topped by "Nothing appears broken" (the classifier cannot see a
negation). Slices 1 and 4 (the /admin Reports inbox) merged as chaoskosmos-site#168; this is the digest half.

## Call
- feedback-triage reads negations ("nothing is broken", "no errors", "rather than stuck"): an item whose only
  problem words are negated is clean. The report form's own questions and the pulled frontmatter are no longer
  items. Bare connectives are out of the action list. Measured on the 39 live reports: 158 candidates became 105,
  and the top ones are real bugs.
- Two pure functions for the daily job: freshSince (reports that arrived after the last post, by their own
  generated_at; an undated report is left out, not guessed) and adminSummary (counts, top five, the link to /admin
  Reports; '' when nothing is new, so nothing is posted).
- tools/feedback-digest-daily.sh: pull, keep what is new, triage, post five lines to #admin. The watermark moves only
  on a 200, so a failed post retries. The bot token never reaches argv. Stub seams for the reports folder, the card
  list and the post, driven by tools/test-feedback-digest-daily.sh (wired into test:shell).
- engine/createdbeacon.js: a comment only, now that the site counts versions (chaoskosmos-site#169).

- Review iteration 1 (Opus) found the negation rule too eager and fixed here: a negation reaches only within its own
  clause (a comma, full stop, "and" or "but" ends it), a negated word is neutral rather than proof of a clean report,
  and only explicit clean phrases ("no errors", "worked fine", "rather than stuck") mark an item clean. The form's
  questions are matched exactly (roles.js, pinned by a test); a short line ending in ":" that starts like a question
  is a heading. Re-measured on the 39 live reports: 108 candidates (105 before), the top ones real bugs, 21 clean.
- The daily job writes the RUN START as its watermark, drops reports stamped over ten minutes in the future (an
  install's clock), strips the pulled frontmatter itself (triage() no longer does it for every caller), and posts
  report text as inline code so a markdown link cannot render in #admin.

- Review iteration 3 (Opus): (WARNING) the window was (since, now + 10 min] while the job writes its run START as the
  next watermark, so the next window overlapped and a report stamped just after the start was posted twice. Now the
  window is (since, run start], and a later stamp (mid-run, or a fast clock) is DEFERRED to the digest that reaches it:
  exactly once, never dropped. The start is taken one second back so a same-second stamp is not lost between windows.
  (WARNING) the watermark test passed for a post-time watermark too; the post stub now records when it ran and plants
  a report during the post, which must be in exactly the next digest. (WARNING) a negation reached past its verb onto
  the verb's object ("did not fix the crash"); it now takes one problem word and carries past it only across "or" /
  "nor", and "could not / cannot / unable to / no way to" counts as the problem. NITs: the watermark is written
  beside and renamed, and a failed write exits 2 instead of logging "posted"; one run at a time (a pid lock taken
  over from a dead run); at-least-once delivery on a lost Discord answer is stated in the header.
- Review iteration 4 (Sonnet): (WARNING) the lock's races: an empty pid (a run starting) was treated as dead, a
  takeover was not exclusive, and the exit trap removed another run's lock. Now an empty pid is "starting" for a
  minute, a live pid counts for an hour only (pid reuse), a stale lock is taken over by renaming it away (one winner;
  what was moved is put back if it was not the stale lock judged), and a run removes the lock only if it is its own.
  (WARNING) "could not / cannot" counted praise ("cannot wait", "can't recommend it enough", "no way to break it",
  "could not be happier", "could not find any errors"): those are skipped, and one statement is counted once.
  NITs: a watermark in the future is treated as unreadable (last day); gh is bounded at 120 s; the dead-holder arm
  asserts the run posted. The shell test drives a lock taken over mid-post. Residual, stated: two runs judging the
  same stale lock in the same instant is narrowed by the rename, not proven impossible.
- Review iteration 5 (Opus): two BLOCKERs in my own iteration-1 and iteration-4 rules. (1) A clean phrase with a
  negation just before it ("not working correctly", "never works correctly", "has not worked well") marked the report
  clean: now only an un-negated clean phrase does. (2) "be", "stop", "break" and "ask" in the praise list hid the most
  common failure wording ("cannot be created", "could not be opened", "cannot stop the agent"): praise is now only
  whole idioms ("be happier", "break it", "wait", "recommend"). (WARNING) "could not see a button" read as nothing
  found: only "any / anything / no" means absent. NIT: every "could not" in a clause is examined. ACCEPTED: a run hung
  past the hour, taken over, then waking to post, can move the watermark back and repost a window (at least once, as
  stated); the same-instant takeover race can skip one day, which the next run recovers (iteration-4 residual).
## Rejected
- Opening cards from the digest: a person decides (#2246).
- A digest over all reports every day: the same wall each morning. Only what arrived since the last post.

## Not done, deliberately
- The daily job is NOT installed. Its default engine is the installed app's, and until this triage fix is in a
  release it would post the noisy version to #admin. Install it (a launchd job, once a day) after the release.

## Weakest premise
That a report's generated_at is close to when it arrived. It is not always: it is when the app wrote it, so a
report written before the last digest but delivered after it is DROPPED by the digest for good (its generated_at
is older than the watermark), and an install that was offline is exactly the one likely to have problems. The
digest's "new since the last digest" is therefore not complete, and the #admin post says so ("one delivered late
is only in the inbox"). The /admin Reports inbox lists every report. Using the store's upload time would close
this; the pull does not carry it today.
