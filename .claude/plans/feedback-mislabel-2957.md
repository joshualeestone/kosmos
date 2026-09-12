# Plan: #2957 fix the SendFeedback opt-in/opt-out MISLABEL (comment-only)

## Finding

`engine/feedbacksend.js` `sendDailyOnce()` sends a daily report to
installkosmos.com/api/feedback and is DEFAULT-ON (`read()` returns `{on:true}` on
ENOENT; server.js:4759 "Default is ON ... the person opts out here"). But three
comments call it "opt-in", which is opt-OUT behavior. This is why an outbound
inventory tagged it "feedback(opt-in)" -- it trusted the label, not the default gate.

Reconciled against #2623 (which deleted the OTHER phone-home telemetry and kept this
one) in the #1760 audit. Splinter's split: the DEFAULT is Josh's call (do not change
it here); the MISLABEL is a real defect to fix now; the install-time disclosure
(PR-C2) is drafted in the card and held for Josh.

## Scope (comment-only; NO behavior, NO default, NO user-facing string change)

Fix the "opt-in" mislabels of this send path to match the opt-out behavior. Eight
comment sites across six files (the initial three, plus feedbackpull.js and the
ping.js header found in iter 1, install/kosmos and feedback.js found in the iter-2
proactive sweep, and a second server.js site found in iter 4):

1. `server.js:410` -- the require comment: "the opt-in-gated send layer" ->
   "daily-report send layer -- DEFAULT-ON / opt-out (#2013/#2957), not opt-in".
2. `engine/ping.js:24-31` -- the installId privacy comment. It falsely reassured
   that installId is "read only by features the person opted into" and "None of
   those send it anywhere the person did not ask for". Corrected: installId leaves
   the Mac BY DEFAULT via the default-on feedback report until the person opts out;
   the store use never leaves the Mac. This is the most important fix -- the old
   text was a false privacy reassurance in the install-fingerprint documentation.
3. `engine/ping.js:4` -- the header line "Nothing here leaves the Mac." tightened:
   this file sends nothing itself (#2623), but the id it makes can leave via the
   default-on feedback report -- so the absolute claim would mislead a skimmer.
4. `engine/feedbackpull.js:8` -- the loop-overview comment "(opt-in gated, ...)"
   -> "(DEFAULT-ON / opt-out per #2013, secrets + home-paths scrubbed)".
5. `install/kosmos:1410` -- "Transmission is a separate, opt-in-gated slice." ->
   names engine/feedbacksend.js and "DEFAULT-ON / opt-out per #2013, not opt-in".
6. `web/index.html:12220` -- HTML comment opening "the daily product-feedback report
   opt-in" -> "... toggle -- DEFAULT-ON / opt-out (#2013/#2957), NOT opt-in". (The
   rest of that comment already said "ships ON by default ... opt-OUT" correctly;
   only the opening word was wrong.)
7. `engine/feedback.js:13` -- "The opt-in switch governs TRANSMISSION only" ->
   "The send switch (default-on / opt-out, #2013) governs TRANSMISSION only", and
   "reads a send/opt-in flag" -> "reads a send flag". (This file stores locally
   regardless of the switch; the switch is the send toggle, not an opt-in.)
8. `server.js:4785` -- the LOCAL feedback route comment "this route never touches
   a send/opt-in flag" -> "never touches the send flag (default-on / opt-out, #2013)".
   Same bare phrase as feedback.js:13, in the sibling local-read route.

Note on the surviving "opt-in" references NOT changed: server.js:4757, server.js:12406,
feedbacksend.js:68/422 each pair "opt-in" with an explicit "default ON / opts out",
which is the repo's accepted "default-checked opt-in" terminology, so they are accurate
in context and left as-is. Only the BARE, unqualified "opt-in" labels were mislabels.

One bare instance is DELIBERATELY left for a follow-up: `feedbacksend.js:344`
("a send only happens when the opt-in is on") is unqualified, but feedbacksend.js is
the DEFAULT's own file, kept untouched here so this label-only PR does not intersect
the default change (Josh's call). Noted on card #2957 for a follow-up sweep of
feedbacksend.js's own internal "opt-in" phrasings once the default is ruled.

## Explicitly out of scope

- The DEFAULT (`read()`'s `on:true`) is NOT changed -- Josh's ruling, folds into the
  telemetry picture Splinter is bringing him.
- The install-time disclosure (PR-C2) is drafted in card #2957 and held for Josh; not
  wired here.
- No user-facing copy changes -- the Settings switch is correctly aria-checked="true".

## Browser-check

The web/index.html change is an HTML-comment-only edit; no rendered DOM surface, id,
or copy changes, so no browser-check assertion applies. Carried with a
`Browser-check:` trailer.
