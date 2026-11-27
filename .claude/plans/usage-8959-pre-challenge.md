---
pre_challenge: true
method: challenge-loop
branch: usage-8959
diff_hash: 15686d3e39bf48d876113446294223aff2fe27c3b08f89c9c43238920e412e8d
validation: passed
subdir_audit: passed
timestamp: 2026-11-27T14:04:00Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (round 6 found nothing material)
**Total findings:** 0 BLOCKERs, 3 WARNINGs (all fixed), MINORs fixed or kept with reasons; in full in .claude/plans/usage-8959.md
**Asked (awaiting user):** 0

### Validation
- Full validation: passed on Mortals 08:03 CST 2026-11-27 (mortals-validate.sh, rc 0, remote hash equal to the local one, 15686d3e39bf, on main with D1c1). Only this proof file changed after it.
- Logic: run-usage.sh 63/63; web.usage-ios-parity-8959 (the phone and the page meet at one file) 2/2; the #9104 guard and the ui-sample shard test pass.
- subdir CLAUDE.md audit: passed.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus

- [WARNING] the UI test looked for names as their own texts; rows now carry identifiers FIXED
- [WARNING] a 120 s limit gave up on reads the page waits for: 600 s FIXED
- [NIT] one read at a time; one formatter per locale; the small figures stack at the largest text FIXED

#### Iteration 2
**Reviewer model:** sonnet

- [NIT] an old read's defer could clear the new read's flag (generation); the formatter cache under a lock; the small figures' widths FIXED

#### Iteration 3
**Reviewer model:** opus

- [NIT] the suite pinned today's figures as literals: the phone and the page now meet at one file FIXED
- [NIT] Int(...) on a malformed huge count; negative zero FIXED

#### Iteration 4
**Reviewer model:** sonnet

- [WARNING] the parity test ran the page's grouping in the machine's locale: pinned to en-US FIXED
- [NIT] three known gaps kept with reasons (the counted-from sentence checked by fragments; 1e21 and up; a missing fixture)

#### Iteration 5
**Reviewer model:** opus

- [NIT] every locale-dependent call in the lifted slice is pinned; the agents' tie-break pinned; the API cost summed in key order FIXED

#### Iteration 6
**Reviewer model:** sonnet

- No issues found.
