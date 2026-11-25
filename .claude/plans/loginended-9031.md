# loginended-9031: an account whose Claude login has run out is seen, said, and not used (kosmos#9031)

## Problem
Measured 2026-11-24 (Mortals 0.8.21, Claude Code 2.1.332):
1. Claude Code's "Login reached its time limit" and "Not logged in" lines match neither the Mac screen's patterns nor Check
   now's, and its two headless sentences match nothing of ours. An agent stopped on one on a Mac reads idle, so its account
   never gets a rejection. (The Windows stream already read the first two, by their remedy.)
2. `kosmos accounts` ignores `loginEnded`, which the page already shows as "Login expired".
3. The mover takes such an account as signed in: the rows' badge can be unverified, and the usage reader's record says
   only `token-expired`, which is also what every healthy account says between renewals.

## Correction to the card
The account's own file was renewed at 20:41 CST, 11 minutes before the 20:53 reading, and the agent's last recorded failure
was 11-22 10:27, so "signed in" may have been true at 20:53 over an old screen. Not proven either way.

## Call
- The sentences join the one shared module, and create.js's Check now list.
- `kosmos accounts` says the sign-in has expired and what to do.
- `loginEnded` counts as a stopped login: never a target (the mover's or the page's bulk move), at risk by login.
- usagepoll says `login-ended` when Claude Code has emptied both tokens (what it does when a renewal is refused for good), or
  when the access token AND the login's own date have both passed. An ordinary renewal still reads `token-expired`.

## Rejected
- A probe per list read: a turn per account per read, and `claude auth status` cannot see a dead login (#874).
- Moving agents off by itself. automove rule 3 (#7548) leaves a stopped login to the person, and its first build of that was
  removed in review (a refused agent reads auth_failed, so it is never movable). The would-move line is recorded, as before.

- Dropping an ended login from the page's one-account pickers (the create list). Creating on one is refused at the create gate,
  which now knows these sentences; the list itself is left alone here.

- A change to the account check behind a refused screen, or to when a refusal is recorded. Round 1 built both; round 2 showed
  they took the rejected badge off an account revoked on Anthropic's side. Measured 11-24 with made-up credentials: `claude auth
  status` (2.1.332) says loggedIn false once Claude Code has emptied the tokens, so the check already sees an ended login.

## Left, declared
- An old line on an idle screen of a repaired account still records a refusal at each re-check (about every 35 s), as every
  other sign-in line does on main. Its own card.
- A login past its date whose access token still works (hours) can still be a target, as on main.
- `loginEnded` on the row needs only the login's date where the access date cannot be read, as the page shows it now.

## Weakest premise
That both tokens emptied means no agent can start a turn. Read in the 2.1.332 binary (it empties them only on a refused
renewal, and a new sign-in writes new ones); not seen live. On macOS the stored login is read from the Keychain, elsewhere
from the folder's file.

## Test
engine/loginended-9031.test.js, 8 tests with controls; 26 mutations, all red.
