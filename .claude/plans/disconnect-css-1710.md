# disconnect-css-1710: the disconnect confirm's armed state was invisible

kosmos#1710. Disconnecting an account arms a confirm (first press arms + relabels, second press
acts). The handler adds an `armed` class to the button, but there was NO `.acct-disconnect.armed`
rule in the page, so the class painted nothing: the only signal that a destructive action was one
press away was the button's text. It is the most destructive of the three arm-in-place controls
(vs `.skillrm` remove-a-skill and `.found-dismiss` dismiss-a-discovery) and was the only one with
no visual arming state, though both siblings have one.

## What was already done (verified on origin/main, NOT redone here)
The screen-reader half (the card's "second half") already landed via #1659/#1743: the arm handler's
`armLabel(on)` sets `aria-label` to `'Remove it? ' + REST_LABEL` on arm and back on blur (WCAG
2.5.3 label-in-name: visible text first, account identity kept). Confirmed the arm path calls
`armLabel(true)`. Left untouched.

## What this branch fixes
1. **CSS (the core fix):** add `.acct-disconnect.armed { font-weight: 600; color: var(--danger, #b3261e); }`,
   matching the danger-coloured sibling `.found-dismiss.armed`. Now the armed state reads as danger.
2. **The misleading unit-test message:** `web.ask-first-1683.test.js` asserted
   `classList.has.has('armed') === true` with the message "the armed class is what makes it look
   different". That is a class-MEMBERSHIP assertion inside a hand-rolled stub with no stylesheet, so
   it can never detect that the class paints nothing; the message is what made it read like a visual
   promise. Corrected the message to say what it actually asserts (the class is applied; the visual
   lives in CSS, guarded separately).
3. **A real regression guard for the visual:** added a source-presence test asserting the
   `.acct-disconnect.armed` rule exists and carries `var(--danger`. The behavioural stub cannot see
   CSS, so this (or a browser computed-style check) is the only thing that goes red if the rule is
   removed again. A browser computed-style check would be the stronger guard; the fleet cannot run
   Playwright here, so this source guard is the verifiable-tonight version. Proven it goes red when
   the rule is removed (perturbation).

## What finished looks like
- `.acct-disconnect.armed` rule present with the danger colour.
- `web.ask-first-1683.test.js` message corrected + a #1710 test guarding the rule's presence.
- a11y untouched (already on main).
- No em dashes.

## Decision / open question in the card
The card asked whether the armed rule should match the danger sibling. Decided yes: it is the most
destructive of the three and `.found-dismiss.armed` (the other danger one) is the closest model.
Reversible in a commit if the brand owner wants a different treatment.

## Not in scope
The a11y fix (already on main); a browser computed-style check (needs Playwright the fleet cannot
run here; the source guard covers the rule's removal); the #1786 dirty-form card (parked separately).
