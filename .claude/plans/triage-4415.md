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

## Rejected
- Opening cards from the digest: a person decides (#2246).
- A digest over all reports every day: the same wall each morning. Only what arrived since the last post.

## Not done, deliberately
- The daily job is NOT installed. Its default engine is the installed app's, and until this triage fix is in a
  release it would post the noisy version to #admin. Install it (a launchd job, once a day) after the release.

## Weakest premise
That a report's generated_at is close to when it arrived. It is when the app wrote it, so a report written
before the last digest but delivered after it is MISSED by the digest (its generated_at is older than the
watermark). It is still in the /admin Reports inbox, which lists every report; only the #admin summary skips it.
Using the store's upload time instead would close that; the pull does not carry it today.
