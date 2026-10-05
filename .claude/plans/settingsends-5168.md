# #5168: Settings > AI Models says when an ended login's agents stop

Stacked on #5164 (loginends-5164): reuses loginexpiry.loginTimesFor and the page's loginAdvWhen. Merges after #5164,
and after Monday (not day-one).

## Change
- claudeloginlive.validUntil caches both dates from its one keychain read (loginTimesFor); new worksUntil(row) answers
  from that cache only (no read of its own): the access token's time when the login has ended and the token is live.
- server.js /api/accounts: a Claude row carries connection.loginStopsAt in that state, never over 'rejected' or
  'signed_out'.
- Settings row: "Signed in · stops working at about 6:38 PM", amber, title "This account's sign-in has run out. Its
  agents keep working on the access they already hold until about 6:38 PM, then stop. Sign in again before then to
  keep them running." It outranks "Signed in · active" (true now, wrong in a few hours). The page's clock decides.

## Rejected
- A second keychain read for the access date: the row's validUntil read already has the body.
- Painting it red: the agents still work; amber is the existing "signed in, not confirmed" tone.

## Weakest premise
That `claude auth status` still answers signed in for an ended login (the row's connected state gates the read).
Measured indirectly only: the board kept these rows connected all morning on account-e.

## Tests
claudeloginlive 10/10 (worksUntil arms: live token, run-out token, the 0 a failed refresh writes, a login not ended,
no access date, a plain-number reader, no read of its own). 6 related files 136/136.
render-claude-login-green-3997: dana (ended, token alive) says the stop time; cleo (ended, no token) does not (control);
with the server field removed, the dana arms FAIL (control run 13:5x).
