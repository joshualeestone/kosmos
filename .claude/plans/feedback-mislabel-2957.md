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

Fix the three "opt-in" mislabels to match the opt-out behavior:

1. `server.js:410` -- the require comment: "the opt-in-gated send layer" ->
   "the daily-report send layer -- DEFAULT-ON / opt-out (#2013), NOT opt-in".
2. `engine/ping.js:22-26` -- the installId privacy comment. It falsely reassured
   that installId is "read only by features the person opted into" and "None of
   those send it anywhere the person did not ask for". Corrected: installId leaves
   the Mac BY DEFAULT via the default-on feedback report until the person opts out;
   the store use never leaves the Mac. This is the most important fix -- the old
   text was a false privacy reassurance in the install-fingerprint documentation.
3. `web/index.html:12220` -- HTML comment opening "the daily product-feedback report
   opt-in" -> "... toggle -- DEFAULT-ON / opt-out (#2013/#2957), NOT opt-in". (The
   rest of that comment already said "ships ON by default ... opt-OUT" correctly;
   only the opening word was wrong.)

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
