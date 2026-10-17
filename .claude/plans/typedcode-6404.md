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
- askAct compares digits with d.code before any request. A mismatch is ASK.done error 'code_typed', worded on the card
  and dropped like the other code refusals once the code changes.

## Calls (decided, with the weakest premise)
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
  aria-invalid + describedby; no maxlength; autocomplete off; placeholder contrast; a trailer reason.
