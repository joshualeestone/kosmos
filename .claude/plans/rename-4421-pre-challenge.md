---
pre_challenge: true
method: challenge-loop
branch: rename-4421
diff_hash: 726bf0949e5dcb4953774b2b5861709a7a6c8beb3f71bd67e284b195be8bfcec
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T22:28:32Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes, at iteration 6
**Total findings:** 3 BLOCKERs, 11 WARNINGs, 1 CONVENTION, 20 NITs
**Resolved:** every BLOCKER, WARNING and CONVENTION fixed; NITs fixed, accepted or moved to follow-up #4423 (ledger in
.claude/plans/rename-4421-20260928T2038Z.md). **Asked (awaiting user):** 0

Validation: `yarn test` via validation-log, gated on tools/heavy-gate.sh --twice with no test-install running
(#4410 interim rule), PASSED at 138b997c8: 11469 tests, 11304 pass, 0 fail, 165 skipped; leak guards green. The
first gated run failed one lint (fixture-discipline: hand-built cards in the new page test), fixed at 138b997c8.
After that run only the plan file changed (0566b9b7c). Subdir CLAUDE.md audit: passed. Browser check
render-rename-4421.js: all good (22 lines); every RENAMED line fails on main's page. Both browser-check gates pass;
per-check trailers for render-signin-visible-3892, render-dm-phone-718 and render-agentdm-3414 (each run: passes).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
- [WARNING] the server test's "six runners" was false --> FIXED (real runner panes, birth names, each runner's file rewritten)
- [WARNING] Save could still rename the agent back --> FIXED (a name only when the box was edited)
- [WARNING] memory box repainted with a newer reading than the ring --> FIXED
- [WARNING] the meta note and other senders' DM labels on the same screen --> FIXED (moved in from #4423)
- [WARNING] a title assertion that could not fail --> FIXED (removed; the browser check asserts the title)
- [CONVENTION] followRename split refreshAvatar from its JSDoc --> FIXED
- [NIT] x4 --> FIXED 3, ACCEPTED 1 (reused session id relabels old posts)

#### Iteration 2
**Reviewer model:** sonnet
- [WARNING] the picture's tint did not follow --> FIXED
- [WARNING] the rename box synced on one poll only --> FIXED (every poll)
- [WARNING] #4423 listed two items this PR fixed --> FIXED
- [NIT] x2 --> FIXED

#### Iteration 3
**Reviewer model:** opus
- [BLOCKER] web.links-everywhere red (dmWho's new dependency); web.instructions-copy red too --> FIXED
- [WARNING] a padded name froze the box --> FIXED
- [WARNING] message pictures drawn from the id --> FIXED
- [NIT] x5 --> FIXED

#### Iteration 4
**Reviewer model:** sonnet
- [BLOCKER] web.project-page red (pjNameOf's new dependency) --> FIXED (typeof-guarded, the page's convention)
- [WARNING] latent missing dependencies in six lifting tests --> FIXED at the source by the same guard
- [NIT] x2 --> FIXED

#### Iteration 5
**Reviewer model:** opus
- [BLOCKER] web.mention-rename-refresh-2139 pinned the Save handler's changed line --> FIXED (pin follows the edited-name gate)
- [WARNING] the message-picture change had no test --> FIXED (browser check + source pin; the id back fails both)
- [NIT] x4 --> FIXED or DECIDED

#### Iteration 6
**Reviewer model:** sonnet
- [NIT] x3 --> 1 FIXED, 1 to #4423, 1 already accepted
**Converged:** no BLOCKER, WARNING or CONVENTION findings (79 affected test files run one by one, 0 fail).

### Final Ledger

| # | Iter | Category | Description | Status |
|---|------|----------|-------------|--------|
| 1 | 3 | BLOCKER | dmWho's new dependency broke lifting tests | FIXED |
| 2 | 4 | BLOCKER | pjNameOf's new dependency broke web.project-page | FIXED |
| 3 | 5 | BLOCKER | Save handler source pin (#2139) | FIXED |
| 4 | 1 | WARNING | Save could rename the agent back | FIXED |
| 5 | 1 | WARNING | server test did not cover six runners | FIXED |

### Strengths
- One derivation: every name surface on the page follows the fresh card through followRename
- Save sends a name only when the person edited it, so a rename made elsewhere cannot be undone by a role save
