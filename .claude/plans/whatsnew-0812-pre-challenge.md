---
pre_challenge: true
method: challenge-loop
branch: whatsnew-0812
diff_hash: 29e1241d74351b42a5f153cf1137c2339c937726f0299f7634695d0e75c9c393
validation: passed (targeted: the six What's New test files, 72 tests, after every round; data-only change, the full suite runs in PR CI and in the cut's step 3 on the frozen pin)
subdir_audit: passed
timestamp: 2026-11-20T13:19:31Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes, twice: round 8 raised only NITs; then 0.8.12 was cut without this window, the window was rebuilt for 0.8.13 (rounds 9 and 10), and round 10 raised only NITs.
**Total findings:** 1 BLOCKER, 16 WARNINGs, 0 CONVENTIONs, NITs per round
**Fixed:** 16 | **Deferred:** 1 | **Asked (awaiting user):** 0

**6.0 deviation, stated:** the local validation helper was not run (one heavy run at a time on Agent1s). The branch changes two data files and a plan only (release/whats-new-pool.json, web/whats-new.json built by tools/whats-new-pool.js). After every round: the pool tool's own build (it checks the window with engine/whatsnew.js's rules) and the six What's New test files (web.whatsnew-3955, tools.whats-new-pool-5711, tools.whats-new-pool-sync-5713, tools.whats-new-check-3955, web.whatsnew-phone-7839, engine/whatsnew; 72 tests, 0 fail), plus tools/test-whats-new-early-7349.sh once. The full suite runs in PR CI and again in the cut's step 3.

**One mistake of mine during the loop, stated:** a test-file filter matched the worktree's own path and started about 2258 test files for about five minutes before I stopped it; no orphaned workers were left (checked). It produced no result that was used.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 5 WARNINGs, 3 NITs
**Self-generated:** 0
- [WARNING] the sign-in line limited #8785 to Cloud and promised "the day" --> FIXED (f62abac6ec)
- [WARNING] the Linux line announced an unmerged PR, and its removal would pull the crashed-session item into the window --> FIXED (f62abac6ec): re-ranked below Starring; #8805 then merged
- [WARNING] "service keeps the installer running" is jargon --> FIXED (f62abac6ec)
- [WARNING] "Pictures and downloads come later" promised unscheduled work --> FIXED (f62abac6ec)
- [WARNING] user-visible CLI and Windows changes had no entries --> FIXED (f62abac6ec): notes-only entries
- NITs: Settings wording, provider block wording --> FIXED (f62abac6ec)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 3 WARNINGs, 2 NITs
**Self-generated:** 2 (lines written in iteration 1)
- [WARNING] the Linux line claimed no command for every install --> FIXED (9e576841e4)
- [WARNING] "stay up to date" too strong for the nightly prod-only update --> FIXED (9e576841e4)
- [WARNING] the iPhone app's empty Agents tab had no entry --> DEFERRED: it ships with the iPhone app, not this release (recorded in the plan)
- NITs: plainer iPhone and Safari words --> FIXED (9e576841e4)

#### Iteration 3
**Reviewer model:** opus (default)
**New findings:** 2 WARNINGs, 5 NITs
**Self-generated:** 2 (the plan this loop wrote)
- [WARNING] the plan's counts and ranks no longer described the branch --> FIXED (8dbe519657)
- [WARNING] the plan's #8805 condition was out of date --> FIXED (8dbe519657)
- NITs: until you sign out, shown as blocked, on a phone, kosmos task --how --> FIXED (5fab3d577e)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, 3 NITs
**Self-generated:** 1
- [WARNING] "until you sign out" is not literally true --> FIXED (9229a59528): "counts for as long as it lasts"
- [WARNING] the Safari line rests on a premise not tried on a real old Safari --> FIXED (9229a59528): named in the plan's Weakest premise
- NITs: the plan's stale commit count --> FIXED (9229a59528)

#### Iteration 5
**Reviewer model:** opus (default)
**New findings:** 1 WARNING, 3 NITs
**Self-generated:** 1
- [WARNING] the Linux line did not name the Cloud owners it serves --> FIXED (adc5be2854)
- NITs: plainer Safari version --> FIXED; "until you sign out" asked again --> recorded as decided in the plan (two reviews asked for opposite wordings)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 1 WARNING, 2 NITs
**Self-generated:** 0
- [WARNING] confirm the relay half is on relay main and in the rebuilt connector --> FIXED (441b874bc5): checked by content (kosmos-relay 5fd421b1c0) and recorded
- NIT: "Agent pictures, downloads and previews" --> FIXED (441b874bc5)

#### Iteration 7
**Reviewer model:** opus (default)
**New findings:** 1 WARNING, 2 NITs
**Self-generated:** 1 (a line written in iteration 3)
- [WARNING] kosmos task --how prints every situation, not one at a time --> FIXED (55be19a63a)
- NIT: the Cloud items' ranking --> recorded as decided in the plan (55be19a63a)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0
**Converged.**
- NITs not changed: "authenticator code" where SMS is also a second step; the Linux line on an unusual setup; the Cloud nightly starts after a machine installs 0.8.12; the first-run line names the Cloud case. Each is narrower than the code, not wrong.

#### Iteration 9 (after the 0.8.13 rebuild)
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING
**Self-generated:** 1 (the Safari line this loop wrote)
- [BLOCKER] the Safari line said pictures and previews do not load, but #8790's pictures step merged after the 0.8.12 cut and ships in 0.8.13 --> FIXED (cf93b5ac84): pictures and previews included, nothing said about downloads (#8816 may or may not land first)
- [WARNING] the plan did not mention #8790 --> FIXED (cf93b5ac84)

#### Iteration 10
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 3 NITs (plan wording)
**Converged.** NITs FIXED in the plan: its title, and the iPhone app items (#8809, #8815) and #8806 named as left out.

### Final Ledger (deferrals)

| # | Iter | Category | Origin | Description | Status | Resolution |
|---|------|----------|--------|-------------|--------|------------|
| D1 | 2 | WARNING | BRANCH | no entry for the iPhone app's empty Agents tab (#8793) | DEFERRED | ships with the iPhone app, not this release |

### Outstanding questions
None.

### Strengths
- The window is built by the pool tool, not by hand, and every round confirmed it is exactly the pool's rule.
- The pool records prod 0.8.11 correctly (its five highlights shown, lastProd 0.8.11).
- Every window line was checked against the merged code each round.
