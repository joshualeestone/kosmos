# What's New for Mac 0.7.03 (Baron, 2026-09-27 07:36: 0.7.01 held at staging, never promoted)

## Finished looks like
web/whats-new.json is version 0.7.03 and passes tools/whats-new-check.js 0.7.03. Prod goes 0.6.99 -> 0.7.03 and
nobody on prod sees 0.7.01's window, so it carries 0.7.01's four lines (as frozen at 32fc398a) plus #4139, five in
all (the window's maximum). It gates the 0.7.03 cut (release.sh step 1b-ii), so it merges before Baron cuts.

## Decided
- 0.7.01's four lines verbatim: each is still true in 0.7.03. Gemini status works on agy 1.2.11; only ask_question
  broke, and Kitty's fix restores it in this cut (Baron's ruling).
- #4139 is fifth, with the "spark" icon (shield is Gemini's); the least important change goes last.
- Left out, not user-facing: #1079 regress-a-night, the #4182 quarantine guard, Android/iOS work (not in the Mac
  bundle). #4177 is a page change held by the freeze, so it is not in 0.7.03.
- Also left out: #3932 (re-tell an agent once a project notice is fixed) and #4176 (no restart for an ordinary
  permission prompt): bug fixes, and the window is at its five-line cap.
- Weakest premise: line 2's "Needs you" for Gemini agents comes from the ask_question hook (engine/agyhooks.js), the
  exact path that broke on agy 1.2.11; unchanged on main as of this PR. The line is true only once Kitty's fix merges.
  Nothing in release.sh checks that; Baron's plan cuts only after the fix merges (told him in so many words).
