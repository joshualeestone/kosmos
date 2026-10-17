# typedcode-6404: the computer Allow card asks for the joining computer's code

Card: joshualeestone/kosmos#6404 (Josh's 0.7.55 pairing test: tmnt was let in with nobody comparing the codes).
Part 1 of the card. Part 2 (an already-allowed pair finishes its code check once) is a separate change with #6406
step 2: it needs a new signed exchange in the tunnel, and only the no-sign-in ticket reads that trust.

## Finished looks like
On the allowing computer, a computer's request shows no code of its own. It says "Type the code shown on <name>, then
press Allow." over ONE field (large digits, labelled "Code on <name>"). Allow waits until six digits are typed. A wrong
code is answered on the card ("That is not the code <name> shows...") and sends nothing; the right one (with or without
the space) is sent as the tunnel wrote it, so the tunnel's own check passes. Phones and browsers are unchanged.
Screenshot the card (light and dark) and the joining computer's big code.

## How it works
- paintAsk's render: `typing` (a computer row with a code and no wait line) swaps the big code for the field; the
  Allow label no longer speaks this computer's code for a computer row.
- The field is NOT a [data-ask] control (review 1: a click on it fell through askAct to Not me); askAct now ignores any
  act other than allow and deny.
- ASK.typed[id] = { code, v }: kept across repaints, forgotten when the row's code changes (askTypedFor), cleared on a
  good Allow. The digits stay out of the markup (typing never rebuilds the live region); askWrite puts them back, with
  focus and the person's place.
- A wrong code marks the field aria-invalid; the field is described by the card's sentence (aria-describedby).
- Input on the field wakes Allow at six digits without a repaint (it stays held during a code_changed hold); Enter
  presses Allow.
- askAct checks what was typed: short of six digits says so (code_short); a mismatch reads the list once more (the other
  computer may have a new code this page has not seen) before calling it wrong (code_typed) or new (code_new). A match
  sends WHAT WAS TYPED in the tunnel's "ddd ddd" form, so the tunnel checks the person's entry too.
- Short of six digits Allow is aria-disabled, not disabled: Tab from the field reaches it (never Not me first) and a
  press says what is missing. The wait-state holds keep a real disabled.

- The joining computer (#plus-join) says to TYPE its code on the other computer: held, the steps end "Type this code
  there, then press Allow." and "Then press The codes match here."; matched while held, the code stays large ("Waiting
  for <name> to allow this computer. If you have not yet, type this code there and press Allow."); allowed, "If you typed this code on <name> to allow this computer, press The codes match."

## Calls (decided, with the weakest premise)
- The joining computer keeps "The codes match" while held (removing it would reorder #4794's whole flow). It decides only
  that computer's trust in the other key, which nothing reads yet; the protecting comparison is the typed code.
- The field lives only on the Kosmos+ section's sheet: away from it the top card is the one-line notice (#3829), so
  #askcard never draws a computer's field; its listener is there for parity, not driven by a check.
- A wrong-code sentence stays while the person retypes, until the next Allow or a new code (clearing it on input would
  repaint mid-typing); Allow checks again either way.
- A computer row with no joining_computer name (the engine refuses a name that breaks its rule) keeps the old big code
  and no field, as before this change; the tunnel then refuses its Allow (no code sent). Unchanged on purpose.
- Contrast: the field's label is measured with the sheet's other small text; the dimmed Allow (white on #2f57c4 at .8 over
  the navy) and the placeholder are not measured by the check (estimated about 5:1).
- Out-of-date open tabs (opened before this release) keep the one-click Allow until reloaded; the engine cannot tell the
  pages apart. Accepted: a release reloads the board's page, and a server marker would break every older page at once.
- Compare in the page, not only in the tunnel: the tunnel's refusal reads as "the code changed", which would be wrong
  for a typo. The tunnel still refuses any code that is not its own (sas_mismatch), so nothing is weaker.
  Weakest premise: the page holds this computer's code (d.code) to compare against; anyone reading the page source could
  copy it. The check is for a person comparing two screens, not against someone inside this computer's page.
- Rejected: holding the pair until "The codes match" on the joining computer (it protects only that computer's trust
  in the other key, which nothing reads yet). Reasons on the card.
- Remote pairing gets harder by design: the person needs the other screen (Josh's remote case). On the card.

## Steps
1. web/index.html: the field, ASK.typed, the input and Enter listeners, the compare in askAct, the words, the CSS.
2. render-connect-sheet-4637.js: the field and its label, no own code, Allow waiting, a repaint keeps the digits,
   a wrong code sends nothing, the right one sent in the tunnel's form, a new code clears the typing; CONTROL: a phone.
   mobile-shots connect-connected types the code first. README row.

## Review log
- 1 opus: a click on the field or its label sent Not me (BLOCKER, fixed: own marker + askAct guard); the test used
  fill() and recorded no denies (fixed: clicks and keyboard typing, deny log, label arm); digits out of the markup;
  aria-invalid + describedby; no maxlength; autocomplete off; placeholder contrast. The allagents/phone-offline trailer reason says "grid-area" where the token is the new display:grid rule (conclusion right; the pushed commit is left as is).
- 2 sonnet: Enter arm (5 digits nothing, 6 wrong answered, 6 right Allow, never Not me); two computers at once keep
  their own typing; askDigits tied to the tunnel's six-digit code; #askcard and the kept wrong-code sentence stated.
- 3 opus: the check's field selector had the device id's colon (`#askcode-computer:...`, invalid CSS: every arm after
  it would have thrown); the joining computer still said "check it shows this same code" and shrank its code; Allow's
  disabled state from the typed value does rebuild the region once (comment corrected); a code that changed between typing and the press says "has a new code" (code_new).
- 4 sonnet: the matched-while-held line no longer tells someone who already typed and allowed to do it again; Enter
  ignores an IME composition; the unused small-code CSS removed.
- 5 opus: Allow aria-disabled short of six digits (Tab reached Not me); Allow sends the typed digits; a mismatch reads
  the list again first; computer code_changed wording; stale comment and a check label; a dead !small assert.
- 6 sonnet: the d-nw arm never reached code_new (the page had not read the new code: it now polls first); the press
  reads only what the field shows (a blank field after a code change says "has a new code"); label contrast measured.
