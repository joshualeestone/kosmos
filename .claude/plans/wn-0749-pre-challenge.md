---
pre_challenge: true
method: challenge-loop
branch: wn-0749
diff_hash: e9a92fbdf63c8fc033c3200249d8c9521fb5d0da3827eb68d95f4c85acaccd84
validation: passed
subdir_audit: passed
timestamp: 2026-10-14T12:58:30Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes (iteration 5, opus: no issues found)
**Total findings:** 8 actionable WARNINGs plus NITs
**Fixed:** 8 | **Deferred:** 0 | **Asked (awaiting user):** 0

Validation: Mortals full suite on a3cb08e277 (this head's diff), clean: 20548 tests, 0 failed; the browser-check gate
passed on the branch's Browser-check trailer. Mortals hashed with ids at 9 (8c027c15c75c); mortals-validate's ladder
matched it to this diff (local f20842dda56c, git's own length), and run_or_skip matched it (kosmos#6002). The FIRST
Mortals run (96ddd592fb, same diff) was red ONLY on the #1720 browser-check gate (20548 tests, 0 failed): web/whats-new.json
is a web/ path and the branch had no trailer. The trailer is an empty commit, so the diff and its hash are unchanged.
The gate run alone: rc 0 with the trailer, rc 1 on the commit before it (control).
An earlier Mortals run (843413e93f, before iteration 1) was stopped by me on purpose: the copy was about to change.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 2 WARNINGs, NITs
**Self-generated:** 0
- [WARNING] release/whats-new-pool.json - the weekly-usage line said "each" Claude account; API-key accounts get no meter, an unread account says so --> FIXED e38fbfa8ef (a, can show, this computer's agents)
- [WARNING] web/whats-new.json - the mac tag covers the meter only; the agents list and Move work on Windows --> FIXED e38fbfa8ef (stated as a deliberate under-announce in the plan)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 1 WARNING, NITs
**Self-generated:** 0
- [WARNING] release/whats-new-pool.json - "giving it a task starts sooner": it read as the agent; the page says give the project a task --> FIXED 9db9c61504
- [NIT] "today" is calendar wording; the page says in the last day --> FIXED 9db9c61504
- [NIT] "its agent" implies one; the Assigner asks one of several --> FIXED 9db9c61504
- [NIT] the plan did not say which entries left the window --> FIXED 9db9c61504

#### Iteration 3
**Reviewer model:** haiku
**New findings:** 3 WARNINGs, NITs
**Self-generated:** 0
- [WARNING] web/whats-new.json - "gave up" read as final; the page says it tries again later --> FIXED 51ca2702be (stuck, and the retry is said)
- [WARNING] web/whats-new.json - Move is conditional (another eligible account) --> FIXED 51ca2702be (a way to move them)
- [WARNING] web/whats-new.json - the imports question may show on the card, not the page --> NOT A DEFECT, recorded in the plan: the engine returns it as because on a needs_you state, and the card's stateReason renders because only for a reported state or a failed restart; the agent page's screen line carries it (iteration 5 traced the same and agreed)
- [NIT] the plan's reason for leaving the plugin line unchanged was weaker than the real one (SEPARATE_ACCOUNT) --> FIXED 51ca2702be

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 1 WARNING, NITs
**Self-generated:** 0
- [WARNING] web/whats-new.json - "a project task starts it sooner": it had no clear referent, and a task replaces the planning ask rather than starting it --> FIXED 96ddd592fb (a project task gets work going sooner)
- [NIT] "could not reach" misses the page's "could not ask" case --> FIXED 96ddd592fb (could not get)
- [NIT] plan lines over-long --> FIXED 96ddd592fb

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 (NITs only)
**Self-generated:** 0
- [NIT] "It tries again": It could be read as the project --> DECLINED: "Kosmos tries again" makes the line 142 characters, over the 140 limit; the previous sentence's subject is Kosmos

### Decided, not missed
- #6146 (#4455: the installed app is read-only by default; an update refuses cleanly before removing anything it
  cannot replace) rides 0.7.49 with its OWN pool entry (rank 16, added by its author), below the window. It merged
  after this branch began, so the branch was REBASED onto it (shas above are the rebased ones); the pool conflict
  was resolved by keeping both, and the rebuilt web/whats-new.json was byte-identical. It changes the rollback rule instead: once 0.7.49 is served,
  never serve a /setup older than 0.7.45 (#6149).
- #6139 (a one-line scroll fix), #6138 (widens an existing entry's first case, which stays true as written), and the
  test or tooling PRs (#5907, #5727, #5923) are left out.
- The build reads prod (0.7.47) and keeps lastProd 0.7.47; nothing is newly marked shown.

### Reviewer rotation
sonnet, opus, haiku, sonnet, opus: the convergence (iteration 5) is witnessed by a different model from iteration 4.
