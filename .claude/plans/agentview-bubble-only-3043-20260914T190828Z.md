# agentview-bubble-only-3043: show only the status bubble in the agent-view header (#3043)

Branch: `agentview-bubble-only-3043`  ·  Card: #3043 (josh-review, 6.65)  ·  Owner: Mona Lisa

## The report (Josh, 6.63 testing, verbatim)
On the agent view screen there is still a status line printed to the right of the status bubble.
"I only want to show the status bubble. I don't want the status line printed out because sometimes
it prints out really long stuff that I don't need. I just need to know if it's idle, or if it's
working, or if it needs something. I don't need to know a printed status up there. It's just garbage
text."

## Done condition
On the agent-view header, the self-reported "really long stuff" no longer prints beside the status
bubble (#d-state). The bubble alone carries idle / working / needs-you. A reported agent's reason
still has a surface (it moves to the #d-why explanation note below the name, per #2833). The short
engine-state reassurances stay. Grid/list cards unaffected. Verified by the node suites and the
render-detail-header-1841 browser-check; Josh confirms in-app on 6.65.

## The change (web/index.html only)
The "printed status line beside the bubble" is `#d-task` (the `.dtask` span to the right of the
`#d-state` badge in `.dnamerow`), which printed `taskLine(a)`. Its long content is the agent's own
self-reported sentence (`stateReported && a.because`, rendered as a quote by stateReason).

- openDetail painter: `const reportedQuote = a.stateReported === true && a.because;` then
  `dtask.textContent = reportedQuote ? '' : taskLine(a);` -- blanks the reported quote beside the
  bubble, KEEPS the short engine-state sentences (restarting #2019, auth #874, rate-limit #215),
  which are not the long self-reported text Josh flagged.
- `#d-why` gate: dropped the `(a.stateReported === true && !reason.includes('\n'))` suppression, so
  the reported reason (single or multi line) shows in the explanation note for every reported state
  except needs_you (the Talk waiting box carries that, #2833).
- `taskLine` / `stateReason` UNCHANGED -> the grid/list cards that share them are unaffected (this
  card is scoped to the agent view; #986 already took the quote off the cards via noQuote).

## Rulings reconciled
- #3043 (2026-09-14, newest): only the bubble, no printed status beside it.
- #2833 (2026-09-11): a reported agent's reason must keep a surface -> relocated to #d-why, not dropped.
- #2019 / #874 / #215: short engine-state reassurances stay on the task line.
- #1841 (2026-09-02): its premise (d-task carries the reported single-line reason) is what #3043
  removes, so its d-why suppression lifts. #1996 (multi-line shows in d-why) is preserved and now
  also covers the single-line case.

## Rejected
- Blanket-hide #d-task entirely (bubble only, no relocation): would strip the #2019 restart
  reassurance and leave a reported/blocked reason with no header surface (overrides #2019 and #2833
  silently). Rejected -- under-removing (Josh can extend in-app) is the safe error direction.

## Weakest premise
That relocating the reported reason to #d-why as a PLAIN sentence is acceptable. Consequence: #d-why
now renders both a reported reason ("Finished responding.") and a non-reported inferred reason ("It
is sitting at its prompt.") in the same plain form, so the #569 "in its own words" quotation-mark
distinction (statement vs guess) is not shown on the header. That distinction was already gone from
the grid/list cards (#986); #3043 extends that to the header. If Josh wants the distinction back, the
reported case in #d-why can be quoted (a small conditional) -- a reversible follow-up. Also: if Josh
wants the header status area ENTIRELY quiet (no #d-why reason either), that is a further one-line
change he can direct in-app.

## Tests
- server.test.js "the detail badge ... task is a separate element" (isolation slice, sees d-task):
  reported needs_you and reported blocked now assert d-task EMPTY (quote relocated); rate_limited
  control still shows its engine sentence (so not a vacuous "always empty" test).
- server.test.js "the detail panel carries the explanation the card gave up" (d-why slice): reported
  single-line now asserts VISIBLE in d-why ("Finished responding."); multi-line and needs_you cases
  unchanged.
- web.quoted-line-986.test.js: stateReason contract unchanged (still returns the quote); the header
  source-grep now pins `reportedQuote` + `dtask.textContent = reportedQuote ? '' : taskLine(a)`.
- render-detail-header-1841.js Part 3: asserts d-task dropped the quote AND d-why carries the reason
  for a reported state; non-reported keeps its why-line. Browser-check PASSES all parts headless.
- Full run: web.*.test.js 1427/1427; server.test.js 297/297; page parses.
