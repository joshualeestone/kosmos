---
pre_challenge: true
method: challenge-loop
branch: staleblock-6209
diff_hash: 7a522a289a44c1bfb37db915eb359744fad1f3d42508c5ff487027199d7e713d
validation: CI on the PR is the merge gate (the full suite); Mortals full run queued since 01:55 for the same code (0797d199e), its hash recorded against a stale local main. Locally: the 57 suites that load selfreport plus the file guards, 1587/1587 on main 2026-10-15 03:27 after rebase
subdir_audit: passed
timestamp: 2026-10-15T06:57:02Z
iterations: 12
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 12
**Converged:** Yes (iteration 12: no new actionable finding; its warnings repeat recorded decisions)
**Total actionable findings:** 1 BLOCKER, 30 WARNINGs, 4 CONVENTIONs (plus NITs)
**Fixed:** 27 | **Deferred (decided, in plan):** 8 | **Asked (awaiting user):** 0

Reviewer models alternated: odd iterations opus, even iterations sonnet. A "re-show the covered wait" design built in
iterations 3 to 6 drew a defect every round and was removed in iteration 7. Per-iteration detail is in
.claude/plans/staleblock-6209.md under "Review N".

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [BLOCKER] clearing an auto block that had overwritten a deliberate question erased the question too --> FIXED (refused when it covered a wait)
- [WARNING] stale #2456 comment and hook docs --> FIXED
- [WARNING] cross-turn reorder of background reports --> DEFERRED (stated in the plan)
- [CONVENTION] test title promised a legacy case it did not test --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] the covered-line check failed open on an unreadable record or a cut tail --> FIXED (fails closed)
- [WARNING] the run-of-blocks loop untested --> FIXED
- [WARNING] auth_failed kind under the clear --> FIXED in iteration 7 (excluded)

#### Iteration 3
**Reviewer model:** opus
- [WARNING] a question under a block stayed hidden --> FIXED by re-showing it (REMOVED in iteration 7)
- [NIT] comment and placement --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
- [WARNING] the re-shown wait was re-dated --> FIXED (then removed)
- [WARNING] old run fields copied --> FIXED (then removed)

#### Iteration 5
**Reviewer model:** opus
- [WARNING] the restore re-implemented read() rules and disagreed (project carry, cut tail, until) --> FIXED (read() split into readTail + latestOf; kept)

#### Iteration 6
**Reviewer model:** sonnet
- [WARNING] a block line could re-label the wait; askedAt ungated --> FIXED (then removed)
- [WARNING] restored line's at re-freshens decay --> DEFERRED (decided; then moot)

#### Iteration 7
**Reviewer model:** opus
- [WARNING] a question about a left project could come back --> FIXED (re-showing REMOVED: the block stays, as before #6209)
- [WARNING] a no-project wait could be re-labelled --> FIXED (moot after removal)
- [WARNING] the clear rode on the unmeasured premise for limit and sign-in kinds --> FIXED (excluded)

#### Iteration 8
**Reviewer model:** sonnet
- [WARNING] stale comments and plan lines --> FIXED; excluded kinds case-insensitive

#### Iteration 9
**Reviewer model:** opus
- [WARNING] auto working over a clearable kind untested --> FIXED
- [CONVENTION] plan line not marked superseded --> FIXED

#### Iteration 10
**Reviewer model:** sonnet
- [WARNING] a denylist of two kinds let billing and bad-request blocks clear --> FIXED (allowlist of passing kinds)
- [WARNING] non-atomic read-check-append --> DEFERRED (stated)

#### Iteration 11
**Reviewer model:** opus
- [WARNING] deliberate and legacy tests refused for the wrong reason --> FIXED (aimed at the writer check; mutation measured)
- [WARNING] allowlist names kinds Claude Code does not send; unknown kind residual --> FIXED (documented; residual stated)

#### Iteration 12
**Reviewer model:** sonnet
- No new actionable finding: CONVERGED.

### Deferred, with reasons (all in the plan)
- A question covered by a block stays hidden until the agent's next report (as before #6209; re-showing was removed).
- An unknown kind or the hook's fallback text keeps its block.
- The premise that StopFailure fires instead of Stop is from Claude Code's docs, unmeasured.
- Read, check and append are not one locked step; a late background report can reorder.
