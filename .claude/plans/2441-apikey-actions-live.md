# Plan: #2441 — flip api-key Claude row actions back to live

## What finished looks like
An api-key Claude account row in Settings > Accounts renders a **live Disconnect**
(data-forget) and a **live Delete-and-remove** (data-remove), the same as a
subscription Claude row, while **Sign-in-again stays suppressed** on api-key rows.
No leftover disabled "removal coming" button. The subscription row is unchanged
(all three controls). Tests assert the new state; the reauth suppression is
proven specific to api-key rows via the subscription control row.

## Why now
#2420's removal engine landed (PR #2437, squash 069d368a): `forgetAccount` and
`removeAccount` now accept api-key accounts. #2433 (PR #2438) had deliberately
suppressed all three removal controls on api-key rows until that engine existed,
because a live control would have errored. This card flips the two that are now
safe and keeps the one that is not.

## Engine ruling (PigeonPete, content-verified on origin/main; recorded on the card)
- **reauth / "Sign in again": KEEP SUPPRESSED.** The #2432 connect-start guard
  (`/api/connect/start`) still refuses OAuth into a dir holding a stored key file,
  even after removal. So a live reauth on an api-key row would surface a button that
  errors. The product's switch-billing answer is remove-and-re-add. This is the
  intended end state, not a gap.
- **Disconnect (data-forget): FLIP LIVE.** `forgetAccount` erases the raw key and
  unwires the apiKeyHelper pointer.
- **Delete-and-remove (data-remove): FLIP LIVE.** `removeAccount` accepts api-key
  accounts.

## Changes
`web/index.html` — `acctRowHtml`:
1. reauth arm `(isOpenai || a.apiKey ? '' : ...)`: **unchanged** (reauth stays
   suppressed). Comment rewritten to state the suppression is now permanent, not
   "until the removal slice lands".
2. Disconnect: **removed** the outer `(a.apiKey && !isOpenai ? DISABLED : (...))`
   wrap #2433 added, restoring the openai/default/live ternary (`))` end marker,
   the #1659-pinned extraction).
3. Delete-and-remove: `(a.isDefault || (!isOpenai && a.apiKey) ? '' : ...)` →
   `(a.isDefault ? '' : ...)`. Default row still suppressed (removeAccount refuses it).

`docs/browser-checks/render-claude-connect-choice-2433.js`:
- Section 6 flipped: api-key row now asserts LIVE data-forget + data-remove, NO
  data-reauth, and no leftover disabled Disconnect. Locate rows by dir (both now
  carry data-forget). Removed the now-inapplicable disabled-Disconnect press test.
- CONTROL: subscription row keeps reauth (the discriminator that proves reauth
  suppression is api-key-specific).

## Rejected
- Flipping reauth live too: rejected — Pete's ruling + the #2432 guard mean it would
  error. Weakest premise: I am trusting Pete's content-verification of the
  connect-start guard rather than re-reading server.js myself. Mitigant: the browser
  render check is agnostic to WHY reauth is suppressed; if the guard were later
  removed and reauth made safe, that is a separate card and the check flips then.
- Keeping the disabled-Disconnect-press handler test: the api-key row no longer has
  a disabled Disconnect, so that scenario is gone from this fixture. The product
  `hasReauth` gate on the disabled-Disconnect handler stays (the default row still
  renders a disabled Disconnect and has reauth); it is out of scope for this render
  check.

## Verification
- `render-claude-connect-choice-2433.js`: 11/11 PASS. Perturbation (flip reauth live)
  → the reauth-suppression check goes RED, confirming it can catch a regression.
- `web.account-qualifier.test.js` (25), `web.accounts-add.test.js` (8),
  `web.conn-shelf.test.js` (4), `web.provider-menus.test.js` (3),
  `web.reauth-1492.test.js` (4): all PASS after the paren-balance restore.
- Full `run-tests.sh` gate: to run once the box is free (release hold).
- Screenshot of the api-key row showing live Disconnect + Delete for the PR + channel.
