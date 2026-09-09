# Plan: #2499 Connections + Kosmos+ copy, discharge the design-lane placeholder flags

## Context
While shipping #529, Ice Cream Kitty left three "placeholder until Mona Lisa says them" / "Mona Lisa
may replace them" flags across the Connections and Kosmos+ copy, deferring final copy authority to the
design lane. #529 discharged the three svc-door flags; these three remained. This card discharges them.

## What ships (comment-only, no rendered change)
Three flag comments in web/index.html are replaced with a reviewed-and-blessed note, so the code stops
advertising the copy as pending the design lane. The copy strings themselves are unchanged: each surface
was reviewed for Josh's voice (short, plain, no jargon, no em dashes) and accuracy against its flow, and
blessed as-is.

1. `CON_SHELF_WORDS` (~22500): the Connections category-shelf status strings (soon "Nothing to connect
   yet", none "Nothing connected", cannot "Could not check", some "N connected: ..."). Terse status
   labels, already plain and in-voice. The only flag that implied UNFINISHED ("placeholders until Mona
   Lisa says them"); discharged.
2. `plus-next` / `plus-enrol` (~11450): the #1014 "where to go / sign-in is expected / this Mac asks
   next" guidance and the enrol field labels. Already clear and plain. Flag discharged; the load-bearing
   technical notes in the same comment (the #1014 reasoning, the "do not quote the gate's exact sentence"
   e2e note) are preserved untouched.
3. `plus-second` "I lost my phone" (~11502): the second-factor recovery copy. Flag discharged. 🛑 The
   verbatim Josh ruling embedded below it ("The phone verification will ALWAYS happen... It is true
   two-factor.", 2026-08-29) is NOT reworded, and the reasoned decision about not naming the
   authenticator app is left as-is.

## Decisions (mine, reversible)
- Discharged all three flags rather than only CON_SHELF_WORDS. The plus-enrol/plus-second flags read
  "Mona Lisa may replace them" (accurate: I hold replace authority); after review I bless the copy, so
  the truthful state is "reviewed and left as-is", which closes the card's intent (the design lane HAS
  reviewed) rather than leaving an open "may replace" that reads as pending action.
- Did NOT pin the CON_SHELF_WORDS strings in a test. They are terse status labels, not the card's
  deliverable (the deliverable is the flag discharge). #529 pinned the svc-doors because those 18 strings
  WERE its deliverable; here a test pin would be coverage the card did not ask for. Reversible: a future
  Connections copy pass can add one if the strings become load-bearing.
- Out of scope, left untouched: the #815 "theme colour and app title are placeholders for Mona Lisa"
  flag (a different card), and the verbatim Josh rulings.

## Gate
Copy/comment-only web/ change, render path unchanged and already exercised, so a Browser-check trailer
covers the #1720 gate (no docs/browser-checks/ touch needed).
