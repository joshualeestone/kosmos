# viewacct-5403: View account opens login.kosmosplus.com/account

Card: kosmos#5403 (follow-up to #5397). Owner: April. Started 2026-10-06 10:57 CDT.

## Why
Sign out everywhere and Delete account move off the Kosmos+ sign-in home to a new
account view, `login.kosmosplus.com/account` (kosmos-relay branch `signinclean-5397`).
Settings > Kosmos+ "View account" still opens the home, which will have neither tool.

## Decision
`PLUS_ACCOUNT_URL` does three jobs in web/index.html, and only one of them moves:
1. The Copy chip copies it: the address other devices sign in at. Stays the home.
2. The buy fallback builds on it: `PLUS_ACCOUNT_URL + 'signin#add-computer'`. Stays.
3. The View account link (`#plus-account`). Moves to `/account`.

So a new constant `PLUS_ACCOUNT_VIEW_URL = PLUS_ACCOUNT_URL + 'account'` paints only the
View account link. Rejected: the card's one-line change of `PLUS_ACCOUNT_URL` itself,
which would have made Copy hand out the account view and the buy fallback
`/accountsignin#add-computer`.

## Tests
- `web.plus-account-view-5403.test.js`: the View account constant and its painter; two
  controls (Copy and buy still use the home). On the page before the change the first
  test fails and both controls pass.
- `docs/browser-checks/render-plus-panel-3829.js`: View account expectation now `/account`;
  its Copy expectation (the home) is unchanged and acts as the control.

## Merge gate
Do NOT merge until the account view is live. At 10:57 `/account` returned 404, the same as a
made-up path, so shipping first would send View account to a 404.

The PR opens as a DRAFT with HOLD in its title, so an agent following the merge-when-green
rule cannot merge it by accident. Lift the hold only when all three hold, measured live:
- `https://login.kosmosplus.com/account` returns 200;
- its body shows Sign out everywhere and Delete account (a 200 alone could be a catch-all page);
- a made-up path on the same host still returns 404 (the control that the 200 means something).

## Weakest premise
That the relay ships the account view at exactly `/account`. If it lands elsewhere, follow it.
