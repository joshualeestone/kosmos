---
pre_challenge: true
method: challenge-loop
branch: plusasks-4610
diff_hash: a6ec0e594ebe60c42c25ae08b38ff69e0fa3033f6e7aae7d145d6130d2af6e64
validation: passed (full tools/run-tests.sh on Mortals at c784f95ad, 12,232 tests, 0 fail; recorded clean for this hash)
subdir_audit: passed
timestamp: 2026-09-30T09:14:01Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 separate blind reviewers (round 1, round 2 sonnet, round 3 opus). **Converged:** round 3 found nothing above NIT.
**Post-convergence changes (covered by the validation above):** a4fe66126 re-pinned the stale gated check render-waiting-phone-718 to this card's placement rule (found while building #4637); 983d0a609 made render-plus-asks-signin-4610 require lib-sandbox-home first (the full validation's tools.browser-checks-home-3675 named it); origin/main merged in.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** separate reviewer agent (13:22)
- [BLOCKER] the stranger test could not fail (it never went through the one granting path, ensure()) --> FIXED: the tick is driven with this Mac and a stranger in one snapshot; granting everything turns it red
- [WARNING] a succeeded grant re-spawned while a stale snapshot listed it; failures retried silently --> FIXED: granted once per id, a failure logged once per id, both reset on a new identity
- [WARNING] "never display": this Mac showed in the Allowed list with a Remove --> FIXED: left out, and its device id is no longer sent to the page
- [WARNING] a device id a same-account client presents would be granted --> DEFERRED: carried to #4616 (the id is off every read route)

#### Iteration 2
**Reviewer model:** sonnet (13:37)
- [BLOCKER] a grant out across an identity change could mark the NEXT identity granted --> FIXED: an epoch per identity; an answer counts only for its own epoch (tested; removing the check fails it)
- [WARNING] the granted mark was not reset at every identity change; a reported success never re-checked --> FIXED: reset at all four sites; re-tried after ten minutes if still pending
- [WARNING] a test raced two grant sources; an arm could not fail --> FIXED

#### Iteration 3
**Reviewer model:** opus (13:46)
- [NIT] two tests waited a fixed 300 ms --> FIXED: they wait for the grant
- [NIT] no fallback to the in-memory id if remote.json's write failed; reset paths not all driven by tests; a dying tunnel can rewrite the old snapshot for ~5 s; the browser check sets the sign-in state by hand --> DEFERRED (named in the plan)
**Converged.**

### Final Ledger
| # | Iter | Category | Origin | Description | Status | Resolution |
|---|------|----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | BRANCH | stranger test could not fail | FIXED | drives the real tick |
| 2 | 2 | BLOCKER | BRANCH | grant across identity change | FIXED | epoch per identity |
| 3 | 1 | WARNING | PRE-EXISTING | a same-account client can present this Mac's id | DEFERRED | #4616 |
