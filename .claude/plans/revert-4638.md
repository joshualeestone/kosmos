# Revert #4638 (#4677): hold the second-computer auto-naming until Josh has read the north star

#4677 merged 11:47 CDT under the CI-starved rule; at 11:56 Splinter put #4638 on hold under Josh's 11:38 ruling (an
address is bought on the website; the app signs in to one, it does not create one) and the north star replaces this
sign-in with "pick an address you bought". Splinter confirmed the revert at 11:58.

## Change
A plain git revert of 844b2372a: `git diff 844b2372a~1 HEAD` is empty (main returns exactly to its tree before the
merge; nobody merged after it). The squash stays in history to re-land if Josh keeps the design.

## Checks
- Plus, sign-in, allow-card and reason-grep test files: 250 pass, 0 fail. The surface gate is clean with per-check
  trailers for the three checks whose surface the revert moves back.
