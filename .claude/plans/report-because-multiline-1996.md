# report-because-multiline-1996 -- show a reported multi-line "because" in full (#1996 follow-up)

## Why
PigeonPete's #1996 (PR #2045) made the SERVER store keep paragraph breaks in an
agent's report "because". The frontend then had a gap PigeonPete flagged and handed
to me. A REPORTED state's because renders in the agent detail panel via #d-task
(`.dtask`, white-space:nowrap + ellipsis -- one truncated line), and #1841
deliberately SUPPRESSES the full-text surface #d-why when stateReported (to avoid
duplicating the top line). For a single-line because that is right -- d-task shows
it whole. For a MULTI-LINE because (the case #1996 just enabled) d-task can only
show the first truncated line, and with #d-why suppressed the full text appears
NOWHERE in the panel -- and it is not in a chat bubble either (.dm-b is the project
thread, pjWords, not the agent-state report).

## What (frontend only; no server change)
- `why.hidden` now keeps #d-why VISIBLE when the reported because is multi-line
  (`!reason.includes('\n')` added to the #1841 suppression). A single-line reported
  because still hides #d-why (d-task shows it) -- #1841's no-exact-duplicate intent
  is preserved; a multi-line one is a summary-vs-full split, not an exact duplicate.
- `.detail-why` gets `white-space: pre-line` so the stored paragraph breaks render
  rather than collapsing to spaces.
- #d-task is deliberately UNCHANGED: it is the one-line scannable summary header; a
  status line that grows to N lines is worse. The full text lives in #d-why below.

## Decision / rejected
- REJECTED making #d-task multi-line (a header that grows is worse than a summary +
  full-body pair).
- REJECTED doing nothing (a reported multi-line because would lose all but its
  truncated first line, with no in-panel full surface -- real info loss for exactly
  the case #1996 enables).
- WEAKEST PREMISE: multi-line reported becauses are currently RARE (agents mostly
  emit single-line engine sentences), so today's impact is low; this is a
  correctness fix for when they appear, not a hot bug. PigeonPete owns the report
  feature and handed the frontend render decision to me; the call is mine and
  reversible.

## Verification
- server.test.js d-why drive test extended: a reported MULTI-LINE because stays
  visible with its breaks; the single-line reported case still hides. Non-vacuous
  (reds on the old `|| a.stateReported === true`).
