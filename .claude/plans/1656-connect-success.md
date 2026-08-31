# kosmos#1656: a real success state for the provider-connect modal

## The problem
Josh, 2026-08-31, from a screenshot: on a successful provider connect, the "Add a
provider" modal keeps showing the sign-in controls (Provider, Start the sign-in)
with the word "Connected" added inline. The success is a text change inside a form
that still looks like it wants input.

## What was built
On a known-good connect the modal switches to a success state:
- The connect flow's own green check (.acct-ok, #1f7a4d) reused at hero size with a
  scale-in (.acct-ok-big), not a second check.
- "Success! Successfully connected to <account>".
- A close button.
- The sign-in controls (provider field, both provider flows, the plain Close row)
  are hidden while success shows.

## Decisions (mine, per the card's "calls for whoever takes this")
- Account label: publicView (engine/connect.js) exposes only configDir + plan to the
  client, no human email or name, and the card said not to add a lookup. So Claude
  shows "your Claude account"; OpenAI names the user's entered label, or the key tail,
  or "your OpenAI account". Naming the specific Claude account is a follow-up that
  needs the accounts-list lookup the card cautioned against.
- Close button: dismisses the modal (closeAcctAdd), the simplest reversible choice.
- Reuse: no distinct animated-check component exists in the product, so .acct-ok (the
  connect flow's own green check) is reused at size with a scale-in. Reduced motion
  drops the motion, not the check.
- Reusable panel: acctShowSuccess is written so #1659's disconnect confirm can consume
  the same panel rather than drawing a second that drifts (coordinated with Angel).

## Changes (web/index.html only)
- HTML: #acct-success panel; ids on the provider field (#acct-provider-field) and the
  form Close row (#acct-add-acts) so acctShowSuccess can hide them.
- CSS: .acct-success, .acct-ok-big (scale-in via @keyframes acct-pop), reduced-motion.
- JS: acctShowSuccess(label) shows the panel and hides the controls; closeAcctAdd puts
  the modal back to its form state on the way out so the next open is clean (kept in
  closeAcctAdd, not openAcctAdd, so openAcctAdd's DOM footprint stays as web.reauth-1492's
  strict stub expects); call acctShowSuccess on the Claude connected arm (acctFlowPaint
  phase 'connected') and the OpenAI add-success; #acct-success-close -> closeAcctAdd.
  The Close is a plain .btn (a non-primary way out, per the #1438 guard).

## Not done
- Naming the specific Claude account (needs the accounts-list lookup the card
  cautioned against). Documented as a follow-up.

## Failure state
The card said Josh described only success and not to invent a large error flow. The
existing failure arms (stuck / interrupted / failed) are unchanged: they keep the
form visible and set the note, so failure still looks like the form, which is correct
for "try again". Only the success arm switches to the new state.
