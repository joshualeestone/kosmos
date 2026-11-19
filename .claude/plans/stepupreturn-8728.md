# stepupreturn-8728: back from a fresh Kosmos+ sign-in, the page reopens the Claude account it was for

Card: kosmos#8728 part 2, slice 2 (design posted on the card 11-19). Slice 1 is remoteopener-8728 (PR #8747).

## Why
A Claude "Sign in again" pressed from a remote session is refused until the person has signed in to Kosmos+ again
(email code and authenticator) within 10 minutes. The step-up ask at the foot of the page takes them through that sign-in,
and they land back on the board with nothing remembering what they were doing: they must find the account again and press
Sign in again a second time. On a phone that is the step most likely to lose them.

## What changes (web/index.html only)
- `acctAddStart`: when `/api/connect/start` answers a `remote_step_up*` refusal for an existing account's re-auth
  (`ACCT_REAUTH_DIR`), the page keeps one note in sessionStorage: `{ kind: 'claude-signin', dir, at }`.
- `accountsRead` (each good account-list read) calls `resumeStepUpReturn`: a note this page wrote, at most 10 minutes
  old (and not more than a minute in the future), for an account still listed and not an API-key account, reopens that
  account's dialog (`openAcctReauth`) with "You signed in to Kosmos+ again. Press Sign in again to sign this account in
  to Claude." The note is removed as it is read, whatever it held.
- Not now on the step-up ask forgets the note.

## Rejected
- Starting the sign-in by itself on return: a write the person did not press, and a stale note must never act.
- localStorage: it would outlive the tab and could reopen a dialog on a later visit.
- A new route to ask "would this be refused?" before the first press: the refusal plus the remembered return covers it.

## Weakest premise
That the gate's sign-in brings the person back to this same tab. If it lands in a new tab the note is not there, and the
flow is today's (no worse).

## Tests
`web.stepupreturn-8728.test.js` (functions lifted, stand-in sessionStorage): a note reopens its account once and holds
only kind, dir and at; a note over 10 minutes old, from the future, for an unlisted or API-key account opens nothing
(CONTROL: just inside the window does); other shapes are ignored and removed; Not now forgets; blocked storage breaks
nothing; and the three wiring points in the page. Existing tests that name the touched functions
(web.accounts-add, web.flowpoll-4275, web.reauth-1492, web.switch-account-1373) pass: 49 with the new file.
