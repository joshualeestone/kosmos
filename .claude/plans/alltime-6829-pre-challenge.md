---
pre_challenge: true
method: challenge-loop
branch: alltime-6829
diff_hash: 3618670f52e9ad62159fa446e33b855d7b1d839cfde299b60bef70234bbef152
validation: passed (see Validation below: full node suite 22601 pass / 0 fail; its one red, the #2518 surface gate, cleared by per-check trailers and passed alone with the coarse gate)
subdir_audit: passed
timestamp: 2026-10-21T14:22:32Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 28 (0 BLOCKERs, 12 WARNINGs, 1 CONVENTION, 15 NITs)
**Fixed:** 9 actionable + 9 NITs | **Deferred:** 3 actionable (plus 1 duplicate) | **Asked (awaiting user):** 0

### Validation

- Focused files run after every round (usage, usage-installday-6829, usage-mtime-5363, usage-cursor-5759,
  orgrollup-scope-5532, web.token-usage-2617, web.token-usage-alltime-6829, server.usage, installid-senders-5995,
  ping, status.cardnoinstallid-5995): 138 pass, 0 fail on the final rebased head.
- Full suite (validation helper) at 490f788ee1: node 22911 tests, 22601 pass, 0 fail. Its one red was the
  browser-check surface gate (#2518): the token `msg` changed, matched to render-unread-edge-3743.js and
  render-agentdm-3414.js. The changed `msg` is paintUsage's own #usage-msg, so commit 4a5a483238 carries a
  per-check `Browser-check-surface:` trailer for each; the surface gate and the coarse gate (#1720) then both
  passed alone (rc 0), and again after the rebase onto origin/main 4f319bf57d.
- Two earlier full runs were stopped mid-way (08:32, 08:38) because the next review round changed the code under
  them; their orphaned test servers were stopped by pid (Splinter flagged two at 08:51).
- Browser check render-token-usage-2617 ran in the heavy queue on this branch: PASS, including the new
  Active Days = 40 assertion. The later sentence assertion (iteration 3) is checked in CI's browser-checks job.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/usage.js startSaving: a timed save could freeze unreadable days at zero for good --> FIXED (26cf5dbe, reworked in iteration 3)
- [WARNING] engine/ping.js installedAt: mtime fallback can drift later after a copy --> FIXED (recorded once, 26cf5dbe)
- [CONVENTION] web/index.html: new helpers sat under the hero's doc comment, which had a false sentence --> FIXED (26cf5dbe)
- [NIT] engine/ping.js: "minted on the first board start" overstated --> FIXED (26cf5dbe)
- [NIT] engine/installid-senders-5995.test.js: listing usage.js exempts the whole file --> FIXED (usage.js must never name installId, 26cf5dbe)
- [NIT] server.usage.test.js: UTC midnight crossing could flake --> DEFERRED: rare, self-healing
- [NIT] engine/usage.js usageSinceInstall: today computed twice --> DEFERRED: off by one only at UTC midnight, self-healing

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above (the save guard, code, fixed normally)
- [WARNING] engine/usage.js: one permanently unreadable transcript would block every save --> FIXED (days older than 20 saved anyway, ae67bc54)
- [WARNING] web/index.html: chart header total all-time over a 14-day line --> FIXED (aria-label says last N days, ae67bc54; header totals all-time by plan decision)
- [WARNING] engine/ping.js: installedAt writes on a read --> DEFERRED: atomic, idempotent, a failure falls back to the mtime
- [NIT] usage-installday-6829.test.js: chmod 000 does not lock a folder for root --> FIXED (skip as root, ae67bc54)
- [NIT] engine/usage.js: unreadable log line on every scan --> FIXED (ae67bc54, then removed in iteration 3)
- [NIT] server.usage.test.js hermeticity of ping.FILE --> no change: the sandbox env is set before any require
- [NIT] engine/usage.js: MAX_DAYS clamp vs installDay --> DEFERRED: unreachable (10 years)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above (the save guard again, code: redesigned)
- [WARNING] engine/usage.js: holding partial scans for every caller made each page open a full rescan and changed ?days=N --> FIXED (only the timed save holds, `holdPartial`; page saves as before, 490f788e)
- [WARNING] page read and timed save could scan the same weeks at once --> FIXED (`inTurn` chain, 490f788e)
- [WARNING] web/index.html: totals called all-time while old days may be gone --> FIXED (status line past 30 days, 490f788e)
- [WARNING] web/index.html: loading copy understated the first all-time read --> FIXED (490f788e)
- [NIT] FREEZE_ANYWAY_DAYS assumes the 30-day default --> FIXED (comment says so)
- [NIT] lastUnreadableSaid never reset --> FIXED (removed)
- [NIT] server.js docblock lacked days=all --> FIXED
- [NIT] browser-check fixture installDay/daysOnKosmos disagreed --> FIXED (07-23)
- [NIT] one-at-a-time test leaned on microtask order --> FIXED (awaits a started signal)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 new actionable (3 WARNINGs all duplicates or not issues), 2 NITs
**Self-generated:** 0 of the above
- [WARNING] mtime fallback can only move later --> duplicate of iteration 1 (recorded once; the plan's weakest premise)
- [WARNING] providers' days frozen from a partial read in the timed save --> DEFERRED: not an issue, mergeProviders freezes only when its read reports complete (`freeze = !!(res && res.complete)`)
- [WARNING] only days=all reads are serialised --> DEFERRED: the comment says all-time reads, which the reviewer confirmed accurate
- [NIT] chart header totals vs line (plan decision); [NIT] MAX_DAYS clamp (unreachable)
**Converged**: no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/usage.js startSaving | BRANCH | timed save could freeze partial reads | FIXED | 26cf5dbe, 490f788e |
| 2 | 1 | WARNING | engine/ping.js installedAt | BRANCH | mtime fallback drift | FIXED | 26cf5dbe |
| 3 | 1 | CONVENTION | web/index.html hero comment | BRANCH | misplaced comment, false sentence | FIXED | 26cf5dbe |
| 4 | 2 | WARNING | engine/usage.js save guard | SELF | permanent bad file blocks every save | FIXED | ae67bc54 |
| 5 | 2 | WARNING | web/index.html charts4 | BRANCH | label scope | FIXED | ae67bc54 |
| 6 | 2 | WARNING | engine/ping.js installedAt | SELF | write on read | DEFERRED | atomic, idempotent |
| 7 | 3 | WARNING | engine/usage.js save guard | SELF | slows every open, changes ?days=N | FIXED | 490f788e |
| 8 | 3 | WARNING | engine/usage.js all-time reads | BRANCH | concurrent heavy scans | FIXED | 490f788e |
| 9 | 3 | WARNING | web/index.html status | BRANCH | lost days unstated | FIXED | 490f788e |
| 10 | 3 | WARNING | web/index.html loading copy | BRANCH | understated wait | FIXED | 490f788e |
| 11 | 4 | WARNING | engine/usage.js mergeProviders | BRANCH | providers frozen from partial read | DEFERRED | already freezes only when complete |
| 12 | 4 | WARNING | engine/usage.js inTurn | SELF | only all-time reads serialised | DEFERRED | comment accurate |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- UTC midnight crossing in server.usage.test.js and in usageSinceInstall (iteration 1), deferred as self-healing.
- MAX_DAYS clamp vs installDay (iterations 2, 4), unreachable.
- Chart header totals all-time over a 14-day line (iteration 4), the plan's decision.

### Strengths (across all iterations)
- The install id never reaches the new path: usage.js reads installedAt only, and the #5995 guard now asserts it never names installId (iterations 1 to 4).
- Controls that fail on the 14-day version: days=14 cannot see day 18, the window-length figure is 14 where the new one is 1, and the browser check reads 40 against a 2-day fixture (iterations 1, 3).
- Every new rule has a mutant measured red: hero window length, ignored daysOnKosmos, server ignoring all, installDay without first-run, read() dropping installedAt, the partial-scan hold, the save-anyway threshold, and the in-turn chain.
