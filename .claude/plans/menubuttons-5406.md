# #5406 part 2, slice C: the question's choices as buttons in its bubble

Card: joshualeestone/kosmos#5406. Stacked on menukeys-5406 (slice A, PR #5746: answering Claude's question menu by key).

## Finished looks like

In a direct conversation with a Claude agent whose screen shows a single-select question menu, the question's own message
bubble carries one button per menu choice. Pressing one sends that choice (the digit, its words, and the question's
identity) through the slice A path, and the server refuses (409) if the menu moved. Typing a reply still works. No box,
no banner (Josh #3419).

## Built

- server.js: the thread GET serves `asked` (chat.questionAbove of the question text) next to `options`, so the page
  never derives the identity a press is checked against.
- web/index.html: DM_CHOICES (set by dmChoicesFrom after the thread fetch), dmChoicesHtml (inside dmRow, guarded for
  the lifted dmRow tests), dmChoicePress (POST {text:n, chose:label, asked}), one document click listener scoped to
  #d-dmthread. DM_CHOICES is set only after paintTalk's two staleness checks, so an older read never replaces a newer
  one's. A refusal repaints; its reason is said once, on the conversation's own line (#d-say-msg), which survives a
  repaint that draws another question or none. An outcome that may have sent the key (unconfirmed, a 200 with no
  readable verdict, a failed request) says "could not confirm", never "did not go". The server
  refuses (409) a button press whose question is no longer on screen, so a stale press is never typed as a prompt;
  that check keys on `asked`, so a press whose words fail their bounds check is still checked, never typed. An answered
  question keeps its buttons off for 6 s per agent (the page's own stale poll), then a word-for-word repeat is pressable from the next 5 s poll (so up to about 11 s). Known
  limit: a word-for-word repeat drawn inside those 6 s stays off until the lock ends (typing still works), and a stale
  poll after it re-offers buttons the server then refuses (409). The setup guide's thread gets
  no `asked` (everything served there is masked, #3769), so it draws no buttons; typing still works there. CSS reuses the old answer-button
  tokens (AA both themes); labels wrap; no primary button (emphasis would recommend an answer).
- Tests: server.question-menu-5406.test.js (GET serves options + asked, and a press with it goes through);
  web.dmchoices-5406.test.js; browser check docs/browser-checks/render-dmchoices-5406.js registered (gated.txt, the browser-checks README, the CI allowlist, the reason-grep count).

## Decided

- Buttons go in the bubble, not a separate control (Josh #3419).
- The server, not the page, supplies `asked`: the page re-deriving it could drift from the POST's check.

## Where no buttons show (typing is the fallback, the safe direction)

- Agents not run by Claude (the key-answer path is Claude's); a failed thread read (its sentence replaces the thread);
  an agent whose composer is closed (presence off), the old box's rule.
- A menu with a label a press could never carry (over the length limit): typing still works.
- A screen where the two menu readers (optionsIn, claudeQuestionMenu) disagree on the options: no buttons (review 21),
  so a drawn button is always one the key path accepts.
- Defensive, not reached by any fixture: in the key path the pressed number must be on the menu the key goes to, with
  the same words (the two menu readers would have to disagree); otherwise 409.
- Focus never moves onto another question's button: each question's buttons carry a generation that changes with the
  question or its choices; after a redraw or a refusal, focus returns to a choice only for the same question, else to the message box.
- A words-only request (chose, no asked) whose number is not on the live menu was already refused by slice A; it now
  gets the "not one of the numbers" sentence instead of the files/reply one.
- Pressable never while a press or a typed send to that agent is in the air; a typed send while a press is in the air
  is refused with a try-again line (not queued). At the server, any delivery to an agent whose question is being
  answered (DM, a person's room post, a task line, a slash command) is refused busy for that ~1.2 s window, nothing
  typed; the sweeps read busy as wait, a person's room post shows could not reach that member.
- Any Claude screen that is not the single-select question menu (status.claudeQuestionMenu), such as a permission
  prompt: it reads as numbered options, but a press there would be pasted and its Enter would pick the highlighted
  option. The server also refuses (409) a press that names its question
  (`asked`) at such a screen. Typing of any kind into a permission prompt (a words-only press, a digit, a sentence) is
  #5754's delivery floor, a separate PR.
- The setup guide's thread; a question the agent reported rather than one on its screen; a question row the engine did
  not add (withQuestionRow skips it when the last stored message already says the same text).

## Weakest premise

The card must read "asking" while the menu is up (slice A's premise); if it does not, no buttons show and typing is the
fallback, which is the safe direction.
