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
- Auto-submit on the step from five digits to six (not on every six-digit value), so a complete
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
