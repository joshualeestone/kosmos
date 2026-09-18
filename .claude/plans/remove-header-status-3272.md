# remove-header-status-3272 -- remove the agent-detail status/reason line (#d-why) + lock it out

Josh, 2026-09-18 #chaoskosmos-design (with a screenshot of the agent detail page, "Finished
responding." highlighted): "How is it that the agent status lines have crept back in here, back at
the top? There's not supposed to be anything up there around what their status is getting
reported.. 'finished responding' is not supposed to be there." And: "we've got to fix this and then
lock it in: we're not going to put these up there. They keep popping back in. I don't know who keeps
adding them back in ... we don't want a status line up there." Rides a LATER build (not the demo).

## What the line is
The "Finished responding." line is `#d-why` (`.detail-why`), rendered directly under the agent
name/meta on the agent detail page. It shows `a.because` (the engine's reported reason), capitalized
and full-stopped, so "finished responding" renders as "Finished responding." It is NOT `#d-said`
(that carries the "<name>'s screen said:" evidence quote, a labelled block, shown only for problem
states) and NOT `#d-task` (that carries the SHORT engine-state sentences: restart "Nothing was
lost" #2019, auth #874, rate-limit #215, via taskLine noQuote).

## Why it keeps popping back in (the recurrence mechanism)
`#d-why` was ADDED by #3043 (Josh, 2026-09-14) to relocate the reported reason off the card and
under the name. Two tests ENFORCE #3043, so any removal of #d-why fails CI and gets reverted:
- `server.test.js` (~line 3282): a whole test that slices the `const why = document.getElementById('d-why')`
  block and asserts it renders `a.because`. Its premise comment: "the panel MUST carry it, or
  `because` ... appears nowhere in the UI at all."
- `server.test.js` (~line 9052): asserts a reported state's quote "relocat[es] ... to #d-why (#3043)".
- `web.quoted-line-986.test.js` (~line 40, 50, 86): uses `because: 'Finished responding'` and pins the
  noQuote relocation to #d-why.
So the durable fix is to REMOVE #d-why AND invert those enforcements into a guard that fails if a
status/reason line is re-added under the name. The guard IS the "lock it in".

## Scope decision (reversing #3043, authorized by Josh reversing himself)
Josh is categorical ("nothing up there around what their status is getting reported"), so remove the
line ENTIRELY rather than gating it to problem states. #3043 was Josh's own request; his 2026-09-18
instruction reverses it, so this is authorized (the record-holder reversing his own design), not a
blind-review overreach. Actionable info is NOT lost: `#d-said` still carries the screen-said evidence
for problem states, `#d-task` still carries the short engine-state sentences (auth/rate-limit/restart),
`#d-reauth` still offers the sign-in action, and the state badge still says idle/working/needs-you.
Only the free-text `a.because` reason loses its dedicated header line, which is what Josh asked for.
Weakest premise: that Josh wants `because` gone for problem states too, not only the routine
"Finished responding". His words are categorical, so removal follows the instruction; if he wants the
problem-state reason back on a surface, that is a small follow-up (restore #d-said-style, not #d-why).

## Change
1. web/index.html: remove the `<div class="detail-why" id="d-why" hidden></div>` element and the
   `const why = ...` render block (the `a.because` -> #d-why paint). Update the #3043 comments.
2. server.test.js: remove the #d-why render slice-test (~3282); update the ~9052 relocation assertion
   (the "relocates to #d-why" premise is gone -- the reported quote now shows on NO header line).
3. web.quoted-line-986.test.js: drop the #d-why relocation references (keep the card/noQuote pins).
4. NEW guard (the lock): assert web/index.html's agent-detail header does NOT contain a #d-why /
   .detail-why element and does not paint `a.because` under the name, with a clear message pointing at
   Josh's 2026-09-18 ruling so the next agent who tries to re-add it is caught in CI.

## Verification
Render the real agent-detail header (fixture agent with because='finished responding') and confirm no
status line under the name. Full run-tests green. Challenge-loop before PR.
