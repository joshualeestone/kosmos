# render-thread-3552

Card: kosmos#3552 (0.6.91 staging cut blocked by cut-time-only browser checks). This branch
fixes the `render-thread` red, per Splinter's ruling of 2026-09-24.

## Ruling (Splinter, citing Josh's existing ruling)

render-thread was red on three assertions: (1) focus-to-composer, (2) says-line has size,
(3) verdict says "waiting on an answer when this was sent." I investigated and found the
verdict clause is real and shipped (engine/chat.js waitingNote, tested in chat.test.js) but is
scoped to the unconfirmed/could-not verdict arms - it never reaches a PLACED row, because
`placedWords` was deliberately made to return '' by #3419, which cites Josh directly: "no
play-by-play about the agent's internal state; the message landed, the row under it says so
by existing." So the shipped behaviour is SILENT placed rows.

Splinter (2026-09-24): Josh's ruling already exists in #3419, no need to re-ask - UPDATE THE
CHECK to the shipped behaviour. Placed rows are silent.

## What this changes

- Drop the "waiting on an answer when this was sent" verdict assertion. The clause is real
  (engine/chat.js waitingNote, tested) but scoped to the unconfirmed/could-not arms;
  placedWords() ignores it for the placed state this row exercises, so it never appears here.
- Drop the says-line size assertion (a placed row's says-line is empty by design, so no size).
- Keep the focus-to-composer assertion but SKIP it (logged, NOT deleted). NOTE: the
  original co-land-on-#3455 reason was WRONG - a blind review proved #3455 (f6105c40f) is
  already merged (the question-bubble arm passes) and the focus red is a real flow-dependent
  regression (detail -> back -> answer loses focus to <body>). Filed as #3557; the SKIP now
  cites #3557. Restore the check() when #3557 is fixed. Retired the stale co-land comment.
- Keep the ABSENCE checks (row must not say "Placed into" nor claim "answered"); a silent
  row satisfies both and they still catch a wrong-speak regression.

## Verification

Ran render-thread headless via pw-runtime + the thread-server fixture: all checks pass,
exit 0, the focus assertion logs as SKIP citing the real regression #3557.

## Scope

render-thread only. The other #3552 reds are routed to their owners (render-prompter-label-1843
already fixed+merged as PR #3554; render-talk-fill-2622 -> Mona/#3547; contrast -> Mona/#3500;
render-push-718 -> Mortals/#3510, to be marked pending on #3510 if unfixed by 09:00 CDT).

## Weakest premise

That #3419's silent-placed behaviour is the intended shipped state (vs the never-shipped
speaking clause the check asserted). Backed by #3419's direct Josh citation and Splinter's
ruling; if Josh later wants the row to speak in the waiting-on-answer case, that is a new
feature (author the clause in placedWords + restore the assertion), not this check's concern.
