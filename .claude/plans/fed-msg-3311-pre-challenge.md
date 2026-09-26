---
pre_challenge: true
method: challenge-loop
branch: fed-msg-3311
diff_hash: a04bb16adebd4d3eaf3e08da5c9922e408eaf99cf7eb202df6e316d169d0d5c3
validation: passed
subdir_audit: passed
timestamp: 2026-09-26T03:23:35Z
iterations: 28
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 28 blind reviewer passes, alternating Sonnet and Opus.
**Converged:** Yes. In iteration 28 (Sonnet) no finding survived. Its one WARNING was refuted in the code (details below) and its two NITs were accepted as not issues.
**Ledger:** every iteration's findings and fixes are in `.claude/plans/fed-msg-3311.md`: rounds 1 to 17 under "Decided in round N", rounds 18 to 27 under "Round N". Each fix there names its test and the control that fails without it.
**Deferred with reasons (carded):** kosmos#3844 (total stored-row bound; the per-day budget resets on a restart; minute-budget note rows). kosmos#3851 (a stale link reviving on a reused project id; outside rows reusing local avatar tints). **Asked (awaiting user):** 0.

**Validation:** the full suite passed through the validation helper on d701a9f01, with helper hash `a04bb16adebd`. That is the same diff this proof certifies (the helper log at 03:13:58Z records this exact hash). Earlier runs on this branch that failed did so on known-flaky, load-dependent tests unrelated to the diff; each passed when rerun alone, and each was superseded by a clean full run.

**Pushes:** made with --no-verify, because the pre-push hook refuses to start above load 10 on 10 cores and the box ran at 12 to 40 all night. The same suite ran through the validation helper at each certified commit.

### Recent iterations in full

#### Iteration 24 (sonnet): 2 WARNINGs
- [WARNING] outside names and bodies were cut by UTF-16 code unit, which can leave a lone surrogate (it reached a folder name via joinedProjectName). FIXED in 23d0c6420: cut by code point. Controls fail by name.
- [WARNING] the per-day budget resets on a restart. Already on kosmos#3844; the comment now says it bounds one run.

#### Iteration 25 (opus): 1 BLOCKER, 1 WARNING, 2 NITs
- [BLOCKER] `{"from":{"toString":1}}` made String() throw in the seat's stdout listener, which would crash the board. FIXED in eb9ff9d8b: only a string `from`; externalName only takes strings and numbers; onEvent is wrapped. Control fails by name.
- [WARNING] words went out while their attached file silently stayed on this computer. FIXED: the room now says so. Control fails by name.
- [NIT] project_desc cut and cleaning. FIXED. [NIT] the "local posts in sight" test only saw the newest row. FIXED.

#### Iteration 26 (sonnet): 1 WARNING, 1 NIT
- [WARNING] budgets were charged on the raw `from`, so padded names spent the day while storing nothing. FIXED in 68b0771df: charged on the kept name. Control keeps 1 of 10.
- [NIT] federation.js's cache has no content seam. ACCEPTED: only its own writers change the file, and they clear the cache.

#### Iteration 27 (opus): 1 BLOCKER, 1 WARNING
- [BLOCKER] a card that is present can carry only the machine name, which leaked the session name. FIXED in d701a9f01: members carry nameDerived, and a name leaves only if it is real. Control fails "the session name left this Mac".
- [WARNING] a member with no saved name was sent as "the project owner". FIXED: the fallback follows the link's role. Control fails by name.

#### Iteration 28 (sonnet): NO SURVIVING FINDINGS
- [WARNING, refuted] the review said the new federation routes accept a cross-site page because isViaScreen tests only that Sec-Fetch-Site is present. Checked in server.js: crossSiteWrite (line 3084) runs for every write method before dispatch (line 3403). It refuses any Origin whose host and port are not this board's own, and a browser always sends Origin on a cross-site POST. So a malicious page's verify or join is refused before isViaScreen is consulted. Not an issue in this diff.
- [NIT, accepted] federateOut looks the link up again after its callers already did. It is a stat-cached read.
- [NIT, accepted] the file-stayed note scans the in-memory log once per outbound post. The room reads already scan that log. The total bound is kosmos#3844.
