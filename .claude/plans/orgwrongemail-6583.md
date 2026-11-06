# orgwrongemail-6583: the board says a bound org invite's refusal (#6583, S-11)

## Problem
Seen live 2026-11-06 09:52Z (#6746 test-board sitting): a Testville invite bound to hello+test-b@, tried from a board
signed in as another test account, is refused by the coordinator with 403 `org_wrong_email` (relay c85f2652b, 10-19).
engine/orgenroll.js knows `org_wrong_domain` but not `org_wrong_email`, so codeOf() returns null and the person reads
the fallback "The code could not be checked through Kosmos+ just now. Nothing was joined; try again in a minute."
Retrying can never work.

## Change
One entry in orgenroll's SAY map: `org_wrong_email`, a sentence that names no address and no company (said the same
to a family). CODES is built from SAY's keys, so preview and enroll both recognise it.

## Tests
engine/orgenroll-wrongemail-6583.test.js: the live refusal line, word for word, on preview and enroll; CONTROL:
org_wrong_domain keeps its sentence, an unknown refusal is still the fallback; the sentence names no company.
Mutation: removing the entry turns two tests red.

## Decided
Copy: written here, plain and fixed (Mona Lisa owns copy; flagged on the card for her). Weakest premise: that no
page code keys on the list of org codes (grep: only engine/orgenroll.js and its tests do).

## Review round 1 (sonnet)
- WARNING taken: org_pilot_full (a company pilot with no free seat, kosmos#7585) had the same gap on the same screens:
  preview and enroll said "try again in a minute". Added a SAY entry in the coordinator's own words; tested with the
  board's refusal-line shape on preview and enroll; mutation red.
- NITs taken: clearer wrong-address wording ("invite the address you sign in with to Kosmos+"); org_wrong_email added
  to familysay-6251's "refused before any org is known" guard; the uncheckable relay sha dropped from the comment.
- Noted, not this card: org_not_accepted is in CODES with no SAY entry (falls to the log path).

## Review round 2 (opus)
- WARNING taken: the wrong-address sentence now gives the coordinator's two ways out, "Sign in with the address it
  was sent to, or ask whoever sent it for a new one", and no longer says "to Kosmos+".
- NIT taken: a comment that pilots are company-only, so org_pilot_full is never said to a family.
- Noted, not this card: review_account (the store-review account only) is still uncoded on these screens;
  org_wrong_domain's older sentence reads close to org_wrong_email's.
