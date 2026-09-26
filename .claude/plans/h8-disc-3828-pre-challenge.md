---
pre_challenge: true
method: challenge-loop
branch: h8-disc-3828
diff_hash: 59a2150ff0c0de82d9e816c36547af9e665ef5180815b2f97aecd88ba43edb16
subdir_audit: passed
timestamp: 2026-09-26T00:26:12Z
converged: false
---

## Challenge loop: h8-disc-3828 (the stale H8 that stopped the third 0.6.95 re-cut)

ONE blind review (opus). It found no BLOCKER; its WARNING and CONVENTION are fixed and verified
on a real board. A second blind pass over those fixes was NOT run, to keep the cut's window:
hence converged: false, stated rather than claimed.

## Findings and dispositions
- [WARNING] H19's precondition had the same URL-only wait as H8, silently timing out since #3828
  (a 6 s sleep) --> FIXED: a chk on a shared, self-contained predicate (waitFor serialises the
  function into the page, so H19 has its own copy with the visibility check).
- [CONVENTION] the initial regex was looser than render-assistant-bubble-3034's --> FIXED:
  />J<\/text>/.
- [NIT] the URL arm is unreachable with this fixture --> kept, for a guide with a picture.
- [NIT] stale H8 comment --> FIXED. [NIT] no naturalWidth check --> not acted on (B2 covers it).

## Proof
- Red: H8 on origin/main (Mortals): FAIL. Green at 1ca344b31 (Mortals): H8 PASS, all four H19
  preconditions PASS, render-assistant-hosted-3660 PASS.
- Full 3b set on this branch (bdfd5beb2, Mortals, main 81da9bc + the H8 fix): all page checks
  passed (render-type-to-focus-3283 needed its retry: a flake).
- browser-checks indexed/selectors/reason-grep: 10/10.
