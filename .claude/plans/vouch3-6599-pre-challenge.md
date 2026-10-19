---
method: challenge-loop
branch: vouch3-6599
diff_hash: d255d3478b5f9584afd2b8d88c2aeaa00b3ff038d5273dcf4e87c208f4440546
timestamp: 2026-10-19T18:14:15Z
subdir_audit: passed
iterations: 14
converged: true
---

# Challenge-loop proof: vouch3-6599 (kosmos#6599)

The automatic-allow window after the app signs in goes from 10 minutes to 3; the notice with its Undo stays 10;
the window's end is logged in one case. Fourteen blind iterations alternating Opus and Sonnet (iteration 1 Opus). Rebased onto origin/main after iteration
11 (clean merge-tree). The first full suite then went red on one repo guard (engine.reachable.test.js: the two test
seams were not excused); excused and reviewed again in iterations 12 to 14.

#### Iteration 1 (Opus) and 2 (Sonnet)
- [WARNING] the window test was timing-sensitive: FIXED, bounded between before and after the sign-in, no slack.
- [WARNING] no way to see how often 3 minutes is too short: FIXED, a stderr line at the window's end with no match.
- [WARNING] stale "ten minutes" comments: FIXED. [NIT] notice untested: FIXED, 9 and 11 minute arms.
- [WARNING] linking the residual publicly: DEFERRED with reason (public on #5786 since 10-11; the card says it).
- [NIT] drop the test export: DEFERRED (the alternative needs a signed-in, enrolled state).

#### Iteration 3 (Sonnet)
- [WARNING] the log line untested: FIXED, three-case test.
- [WARNING] a Sign out in the same tick could be reported as the window ending: FIXED, own branch.
- [WARNING] "said once" unenforced: FIXED, wording. [CONVENTION] console.error vs process.stderr.write 'kosmos+:': FIXED.

#### Iteration 4 (Opus)
- [WARNING] "never reported" overclaimed: FIXED. NITs (newline, matched shape, ruling date 10-10 19:04): FIXED.

#### Iteration 5 (Sonnet)
- [WARNING] garbled comment; [WARNING] overclaimed what the line measures; [WARNING] a switch-off at expiry said the
  Allow card was coming: all FIXED (silent end checks first, comment rewritten).

#### Iteration 6 (Opus)
- [WARNING] "upper bound" wrong both ways (a sign-in after the window never opens the browser): FIXED, the comment
  says it is not a measure. Logging unopened window ends: DEFERRED with reason (noise; recorded in the plan).

#### Iteration 7 (Sonnet)
- [WARNING] the line said "browser sign-in" but a phone sign-in also opens the browser: FIXED, "sign-in".

#### Iteration 8 (Opus)
- [WARNING] the new check order untested: FIXED, identity-change-after-expiry arm (red under the old combined
  check, green restored). NITs ("at most" to "about"; redundant teardown): FIXED.

#### Iteration 9 (Sonnet)
- [WARNING] "none of them leads to the Allow card" unbacked: FIXED, removed.
- [WARNING] a matched allow still retrying at the end is silent and unmentioned: FIXED, the comment says so.

#### Iteration 10 (Opus)
- [CONVENTION] new tests left remote switched on, unlike every sibling: FIXED, setOn(false) on every path.
- NITs (wrap, name VOUCH_NOTICE_MS): FIXED.

#### Iteration 11 (Sonnet)
- NITs only. No BLOCKER, WARNING or CONVENTION.

#### Full suite after iteration 11: RED, 1 of 22186
- engine.reachable.test.js: recentlyVouchedForTests and vouchPatchForTests exported with no excuse. FIXED: both
  excused with checkable reasons (guard 8/8 alone). Reopened the loop for the change.

#### Iteration 12 (Opus)
- [CONVENTION] an over-long comment line: FIXED. NITs (a second tick that could never fail: removed; the stderr
  stub swallowed other warnings: now passes them through): FIXED.

#### Iteration 13 (Sonnet)
- [WARNING] the plan claimed a second-tick check that no longer exists: FIXED.
- [WARNING] the plan said the order test is red "under the old combined check"; it is red only if the window check
  runs before the identity checks: FIXED. [NIT] the first test switched off outside a finally: FIXED.

#### Iteration 14 (Opus)
- NITs only (a window that ends while a register or Forget is in flight reports "nothing matched"; the notice test
  guards the future, not this diff). No BLOCKER, WARNING or CONVENTION. Converged.

### Final Ledger
- Iterations: 14. New actionable findings per iteration: 5, 3, 4, 1, 3, 1, 1, 1, 2, 1, 0, 1, 2, 0 (plus the one
  full-suite guard red between 11 and 12).
- Deferred with reasons: public residual link, the test export, logging unopened window ends.
- Residual risk: how often 3 minutes is too short is unmeasured; owner Renet, revisit on any report of the Allow
  card after a slow sign-in.
