# plusmember-3360: the Kosmos+ member line in the user menu (#3360)

## Goal
The user dropdown shows "Kosmos+ member" (instead of the "Log in to Kosmos+" promo) for an account
that is an authenticated Kosmos+ member in good standing, and the promo again after a lapse.

## Done looks like
- `plusMember()` in web/index.html returns true exactly when `<html>` carries `data-fed-member`.
- `data-fed-member` comes from the existing producer, `fedGateStamp()`, which toggles it from
  `/api/status`'s `kosmos_plus` (server: `fedKosmosPlusNow()`). No new signal, no second account call.
- render-user-menu-3051.js drives `fedGateStamp()` through member, click-through (opens Settings >
  Kosmos Plus and closes the menu) and lapse states, then puts back what it changed (the fed
  attributes, the two invite-button titles, the Agents tab).
- A control (plusMember back to `return false`) turns the check red.

## Decisions
- Reuse the federation gate's field rather than a separate membership call (PigeonPete's call on
  #3360, 2026-09-28): one source, so the menu cannot disagree with the gate.
- Re-checked on every menu open (the existing syncUserpopPlus path), so a change shows on the next
  open after the poll that saw it; no live re-render of an already-open menu.

## Weakest premise
That `kosmos_plus` (fedKosmosPlusNow) means "member in good standing" and not merely "signed in".
Read on origin/main 2026-09-28; if that function's meaning changes, this line changes with it.

## Surface gate
render-plus-signin-3478.js is flagged only because comments naming #plus-state2 were rewritten;
covered by a Browser-check-surface trailer, and that check passes.
