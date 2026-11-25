# loginended-9031: an account whose Claude login has run out is seen, said, and not used (kosmos#9031)

## Problem
Measured 2026-11-24 (Mortals 0.8.21, Claude Code 2.1.332):
1. Claude Code's "Login reached its time limit" line matches no pattern of ours (screen, Windows stream, Check now), and its
   "Not logged in" line matches neither the screen's nor Check now's. An agent stopped on either reads idle, so its account
   never gets a rejection.
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
- usagepoll says `login-ended` when the access token AND the login's own date have both passed. Both, so a renewal still
  reads `token-expired`.

## Rejected
- A probe per list read: a turn per account per read, and `claude auth status` cannot see a dead login (#874).
- Moving agents off by itself. automove rule 3 (#7548) leaves a stopped login to the person, and its first build of that was
  removed in review (a refused agent reads auth_failed, so it is never movable). The would-move line is recorded, as before.

## Weakest premise
That an account with both dates past cannot start a turn. Claude Code's error for it says so, but I did not see one refused.
A live renewal moves the dates, so the row recovers by itself at the next read.

## Test
engine/loginended-9031.test.js, 8 tests with controls; 20 mutations, all red.
