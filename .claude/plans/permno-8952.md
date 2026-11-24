# permno-8952: kosmos#8952 slice (c), a working Deny for a permission prompt too long to show whole

## Finished looks like
On the iPhone, an agent stopped on a Claude Code permission prompt whose box top has scrolled off its window shows a
native card in the chat: "Wants to do something that needs your permission.", "Yes needs your computer: this request
is too long to show here in full.", and Deny. Deny presses the prompt's own No and nothing else; Yes is never offered.

## Design (card comment 7120105744, item 2)
- Mac, engine/chat.js: permissionDenyOnly(text) returns the No option ({ n, label }) only when a permission prompt is
  read and its box is NOT whole (permissionAnswerable false), with exactly one No that is not lasting.
- Mac, answerQuestionMenuHeld: expect.denyOnly lets a cut box be pressed, but only its No (not lasting, no request),
  with the visible part's identity compared on the last look.
- Mac, server.js thread GET: denyOnly { n, label, asked } on the live unreported question row when the full buttons
  are not pressable, under the same conditions otherwise (Claude, not the guide thread, the live pane question).
  POST passes body.denyOnly === true into the press.
- iPhone: ChatRow.denyOnly, Choices.denyOnly, Board.choices(for:) falls back to it, pressRequest sends denyOnly,
  DenyOnlyCard in ChatChoices.swift, words in Board.denyOnlyAsk / denyOnlyYesNote.

## Rejected
- Yes from the phone on a cut box (#6054 review 3 forbids it on purpose).
- Guessing the kind ("a long command"): the title line is off screen, so the card says only what is known.
- The web board: it still shows the screen; not this slice.

## Weakest premise
Refusing a request nobody read whole is always safe. A different request with the same visible tail would be refused
instead, which is still a refusal.

## Tests
server.permdeny-8952.test.js (real routes, whole-box control, both gate halves mutation-checked),
server.permscroll-8952.test.js unchanged, LogicTests 2228/2228 + 12 run-*.sh, simulator build, light/dark shots.
