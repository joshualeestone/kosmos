# #5164: the login notice says when the agents stop, not that they have

## What was measured (2026-10-03, account-e, keychain timestamps only)
- The login (refreshTokenExpiresAt) ended at 06:58 CDT.
- The access token (expiresAt) Claude Code already held ran until 13:18. The agents kept working on it.
- At 13:25 a live call failed: "OAuth session expired and could not be refreshed" (Splinter).
- The other six credentials on the box: login dates 12 to 27 days out, scattered, not clustered near 30. So the date
  is fixed at sign-in and is NOT pushed forward by refreshes; the field was right, the wording was not.

## Change
- `loginexpiry.loginTimesFor(ccd)`: both dates from the credential, numbers only. `refreshExpiryFor` is kept as is
  (connect.js watches it move to see a sign-in complete).
- `advisoriesFor`: an ended login whose access token is still in the future carries `worksUntil` (epoch ms), else null.
- Page: while `worksUntil` is ahead of the page's clock, "<n> agents stop working at about <time>", "Sign in again
  before then to keep them running." After it, the existing "has expired" copy. The day word ("tomorrow", or a date)
  is part of the repaint signature, so it is right after midnight (review 1 WARNING).
- The dismissal key separates "stops at" from "has stopped": the second is news.

## Rejected
- Suppressing the notice while the agents still work: the login IS gone, and the person has hours to act.
- Treating the stored login date as stale: measured wrong (outcome b).

## Measured after (13:21 to 13:29)
A failed refresh writes an access date of 0, which this reads as stopped. The re-sign-in at about 13:28 gave a login
709 h out (30 days) and an access token 8.0 h out. So the "stops at" window is at most 8 hours.

## Residual risk (Angel)
If the provider ever made refresh tokens slide, the stored login date would stop meaning the end, and "stop working
at" would keep moving forward each refresh. Measured today it does not slide (the seven dates are scattered).

## Copy (Mona Lisa, 13:3x)
Head kept. Tail is the not-expired sibling's verb: "Sign in again before then to keep them running." Times as
toLocaleTimeString prints them ("6:27 PM").

## Weakest premise
One measured case: the agents stop when the access token runs out. Claude Code may try its refresh a little early,
hence "about".

## Not in this change
Settings > AI Models (claudeloginlive) still keys on the login date alone: filed as a follow-up (Angel).

## Where the browser arms ran
render-login-expiry-3532 on a throwaway sandboxed board from this worktree (tools/browser-checks.sh's
boot_board_rich env, empty fleet), Chromium headless and headed, 13:2x and 13:3x: stopsat, stopsat1 and stoppedpast
PASS; stopsat FAILS on main's page (the control). The "5018: at 375" arm fails on main too there; the full harness run
on the exact head decides it.

## Review 1 (opus, blind, at 3e1a93f24)
1 WARNING FIXED: the repaint signature lacked the time's words, so "tomorrow at about 1:10 AM" painted at 23:30 stayed
after midnight. NITs: a date two days out would say "tomorrow" (FIXED: exact day, date otherwise); the shape comment
lacked worksUntil (FIXED); advKey reads the clock per call (1 ms window, accepted); the flip to "has expired" waits for
the next successful board read (true of every notice, accepted). Clean: secrets, server cache (5 min TTL overruled by
the page clock), clock skew, time zone, dismissal transitions, other callers of refreshExpiryFor.
Angel (owner, at 3e1a93f24): no blocker; plan file and the Settings follow-up (#5168) done; NITs taken.

## Day-one
Splinter, 13:31: day-one for 0.7.22 (truthful copy on a notice just shipped). Merge if it clears before the pin.
