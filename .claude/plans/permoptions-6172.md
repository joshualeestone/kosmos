# permoptions-6172: every permission-prompt option is a button; a lasting one takes a second press (#6172)

## Problem
A person (via Josh, 10-14 15:17): Claude Code's prompt lists "1. Yes / 2. Yes, and don't ask again for: cd * / 3. No",
and the agent page draws only 1 Yes and 3 No. #6054 review 5 left the lasting options out on purpose ("never a
one-tap button, so a mis-tap on a phone cannot change what the agent may do from now on", by analogy with #5051's
safeguards menu). That was an agent's decision, not a ruling from Josh.

## Decision (reversible)
Draw every option the prompt lists, labelled with its own text, and keep review 5's mis-tap guard as a second press:
- engine/status.js claudePermissionPrompt returns every option; the ones other than "Yes" and the one "No" are marked
  `lasting` (an allow rule, auto mode, accept edits). Still refused unless option 1 is "Yes" and exactly one starts "No".
- engine/chat.js optionsIn passes `lasting` through, so the GET serves it.
- server.js refuses a press of a lasting option without `lasting: true` (409, before any key), so a page from before
  this change cannot one-tap it. It is a mis-tap guard, not access control: a request that sets `lasting` is honoured.
- web/index.html: the first press of a lasting button arms it (drawn, said "This one changes what the agent may do
  from now on. Press it again to choose it.", kept across repaints for 15 s, for the same question only); the second
  press sends it with `lasting: true`, but not sooner than 600 ms after arming (a double-click or double-tap is one
  gesture), and a held Enter's repeats do not press a choice button.

Rejected: leaving them out (the person's ask; the choice exists on the screen and the page hid it); one-tap buttons
(review 5's mis-tap risk is real on a phone, and auto mode stops the agent asking about anything); a modal dialog
(heavier than the page's other choices; the inline second press says the same thing where the finger already is).

## Weakest premise
That pressing 2 in Claude Code saves the rule (the card's done-when: the same command no longer prompts). It is what
the option says and what Claude Code does by key, but it is not measured here: no fleet agent runs with permission
prompts, and a throwaway Claude pane on this Mac shares tmux with the fleet board (Splinter, 10-14). Measure on the
next real prompt, or on the M6 Mac.

## Tests
- server.permission-answer-6054.test.js: every option served with `lasting` marks (real 2.1.296 captures); the card's
  `cd *` prompt serves option 2 with the prompt's words; a lasting press without `lasting` is refused and sends no key,
  with it sends the bare 2; Yes and No need no second press (CONTROL); the page arms before it sends.
- server.question-menu-5406.test.js: the edit prompt's three options, option 2 lasting.
- docs/browser-checks/render-dmchoices-5406.js `lasting` arm, light and dark: three buttons in the prompt's words; the
  first press posts nothing and arms (kept by a repaint); the second posts lasting; No on one press (CONTROL).
