# #3942: code entry as one big box per digit, in-app half (Josh, 2026-09-26 06:42)

## Finished looks like
- The in-app Kosmos+ sign-in's three code fields (the email code, the second-step code, and the
  set-up confirm code) are six big boxes. One paste (spaces and hyphens included) fills every box;
  the sixth digit presses the step's own button, once; the button stays for anyone who clicks.
- Kosmos+ styling (the wizard's navy field and #7ea0f0 focus blue), not a Muse copy.
- Keyboard and accessibility: the ONE real input keeps its label, inputmode="numeric" and
  autocomplete="one-time-code" (a phone offers the SMS code); the boxes are drawn behind it and are
  aria-hidden, so a screen reader reads an ordinary text field.
- The web half (login.kosmosplus.com, coordinator signin.html) is kosmos-relay branch codebox-3942.

## Calls
- Boxes behind one input, not six inputs: paste, autofill, Backspace and screen readers then work
  natively; six inputs need a paste splitter, focus hopping, and still confuse autofill.
- (Superseded in review round 1, see below.) First version: auto-submit on the step from five digits to six, so a complete
  code after a wrong-code answer is not re-sent until it changes; focus re-reads the count because
  plusSiClear clears fields without an input event.
- Typing always continues at the end (caret moved to the end on focus and click): the common code
  box behaviour, and it keeps one digit per box.
- The input is exactly the boxes' width and its text scroll is reset (the spacing after the sixth
  digit would scroll it); the wrapper uses overflow: clip, because a hidden-overflow box still
  scrolls to show a focused child. Both measured by browser-check arms that fail without them.
- Not changed: the Claude account sign-in code (acct-code: not a Kosmos+ six-digit code) and the
  older Plus address form (plus-code: a name field follows it, so auto-submit would be wrong).

## Tests
- docs/browser-checks/render-plus-signin-3478.js: #3796's compact-field assertion becomes #3942's
  six big boxes; the first scenario pastes "123 456" and counts exactly one verify; no-sideways-
  scroll at five digits and six; every fill now relies on auto-submit (no click), so reaching the
  next step is the auto-submit; the input-colour check reads the boxes' fill under a boxed field.
- web.lost-phone.test.js runs this stretch of top-level code on stub elements: a field with no
  parent is skipped.

## Review round 1 (app side, measured): the auto-submit rule
- Auto-submit is "six digits that are not the code last sent", not "the step from five to six":
  after a wrong code the field stayed full, so a new code pasted over it was never sent. A code
  completed while a request is in flight goes when the button is free (its disabled attribute is
  watched). Deleting a digit, or focusing a field that is not full (the page clears fields without
  an input event), forgets the last code.
- A paste carrying a whole code replaces the field (no splice of typed digits and pasted ones, no
  paste dropped by a full field); focusing a full field selects the whole code.
- A screen reader is told, before it happens, that the sixth digit checks the code (WCAG 3.2.2);
  forced-colours mode gives the current box a thick Highlight edge.
- Not taken: widening the input past its boxes so the caret never scrolls it. The phone check
  flags that overhang on narrow screens; the scroll reset is kept, and a check arm fails without it.

## Review round 1 (web side, measured)
- The row scales to its width: a fixed-size row clipped the sixth box at 320 to 375px in both
  engines. An .otp-fit wrapper is the size container; font-size min(1.75rem, 9cqw) keeps six boxes
  plus gaps (about 10.9em of monospace) inside it; the 1.75rem stands where container units are
  missing. signin-phone.browser.mjs now asserts, on every phone size and a 320-wide pass, that all
  six boxes sit inside their row with digits of at least 18px (it fails without the scaling).
- (Superseded in round 2, see below.) First code-finder: a standalone six digits; it still picked
  dates and phone numbers, measured.
- The input handler waits for an input method to commit; autofill keeps the digits' ink colour.

## Review round 2 (app side, measured): fixing one digit
- The outlined box follows the caret (selectionStart), not the digit count: Home or a click to fix
  one digit lights that box; a selected full code lights the first box (typing replaces from there).
- Arriving in the field (Tab, or the page moving focus there) still selects a full code or puts the
  caret at the end; a click inside a field that already has focus is left alone, so a mouse or
  touch user can put the caret on one digit. (A call, reversible: the alternative, re-selecting on
  every click, left mouse users no way to fix one digit.)
- App: Send again clears the old code from the boxes (the web page already did). Not covered by the
  browser check (its only resend answers with a cooldown); reasoned from the handler.
- plusSiClear carries a note that clearing the fields before re-enabling the buttons is load-bearing
  for the auto-submit's button watch.

## Review round 2 (web side, measured)
- After a wrong code, still in the field, the refused code is selected when the button comes back,
  so typing the right code replaces it (before: a full field with the caret at its end refused every
  keystroke, and blurring in the check hid it). The checks now test this with no blur.
- The paste code-finder is one function (app: plusSiCodeFromPaste, web: codeFromPaste) with unit
  tests: a run of exactly six digits (single spaces or hyphens inside), so dates, phone numbers and
  order numbers are not codes; two six-digit runs, the one after "code", else nothing. With no one
  code, the paste inserts NOTHING (the browser's own paste kept the first six digits of any number
  and sent them); a short run of digits alone still pastes. A paste resets the last code sent (an
  intent to send, e.g. after a network failure).
- The button watch sends only a code that was waiting on the button (queued), and only while its
  step is on screen, so a code finished after a success cannot go to a step the person has left.
- Sizing: 7.5vw before the cqw line for browsers without container units (Safari before 16);
  8.6cqw rather than 9 (WebKit's monospace runs wider, measured 2px over at 9). The phone check now
  measures the row against its container (.otp-fit), not the screen, so it fails at 375 as well as
  320 without the scaling (measured).

## Review round 3 (app side, measured)
- Fixing one digit: in a complete code, a typed digit REPLACES the digit after the caret (the
  outlined box) instead of inserting and pushing the last digit off, which made a different code and
  sent it. At the end of a full code, a digit starts the code again. Checked with distinct digits
  (314159 -> 317159; inserting gives 317415), since repeated digits hid the difference.
- App only: below 40rem, a settings-wide rule set every input to 16px (so iOS does not zoom on
  focus) and outranked the boxed input, pulling the digits off their boxes. The boxed input is
  also listed with #panel-settings in front; checked at 520px wide.
- The outline follows the caret on selectionchange (a held arrow key); an input method's finished
  word is cleaned on compositionend.
- App check: a code finished while an answer is in flight is sent when the button frees, once.
