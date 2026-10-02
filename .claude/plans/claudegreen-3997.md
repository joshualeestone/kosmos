# claudegreen-3997: a signed-in Claude account with a valid, unexpired login is green (kosmos#3997, ruling A)

Written 2026-10-02 08:14 CDT. Reassigned from Raiden by Splinter at Josh's live 0.7.17 test.

## Ask
Josh, 07:54: "claude continues to be the only one that will not show in green that I am signed in". Ruling A: green
when the login is valid and unexpired, without a claude -p turn; a real failure stays non-green with its reason.

## Decided
Turn on Raiden's GREEN_FROM_LOGIN (#4369 built the path behind it). Same words, green, own title.
Rejected: a new live check (the switch, its server path and the page's green branch were already built and reviewed).
Weakest premise: the login date says the sign-in exists and has not run out, not that Anthropic would answer right now.

## Review rounds
1 (opus): SHOULD-FIX a failed Check now (403, disabled org) recorded nothing, so the row stayed green. Fixed:
  create.claudeAccountCheck {state, refused}; Check now marks the folder; loginGood honours it; capacity keeps green.
  NITs taken: a login-green row with no date falls back to unverified; stale ruling-C comments.
2 (sonnet): SHOULD-FIX the comment on what counts as failed was wrong (a timeout is 1 in the real probe). Fixed.
3 (opus): SHOULD-FIX the page did not repaint after a failed Check now; SHOULD-FIX a working account could be held amber.
  Fixed: repaint and put the sentence on the rebuilt button; the mark carries its time and a newer outcome outranks it.
4 (sonnet): 0 BLOCKER, 0 SHOULD-FIX = CONVERGED. NITs not taken: a capacity answer also repaints (a placeholder
  flash); an agent OK that landed during the check is held until the next outcome (negligible); loginOkWhy reachable
  only with the switch off (documented).

## Validation
- render-claude-login-green-3997 (gated): on the branch all arms pass; on main the two green arms fail (grey
  acct-loginok), the controls pass.
- 9 focused unit files (93 tests on the first head); the full suite on Mortals.
