---
pre_challenge: true
method: challenge-loop
branch: rulesdoneunch-5643
diff_hash: 7b1f4287882cae2207880edc7e0d027729a0449ff1c26d5b06d481483f65999b
validation: passed (rebased on origin/main including #5642; full node suite 17504 tests, 17271 pass, 0 fail; both browser-check gates pass; focused defaults, doctrine, doctrine-4890 and verbs-parity suites 86/86)
subdir_audit: passed
timestamp: 2026-10-09T06:24:03Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (opus and sonnet alternating, each blind)
**Converged:** Yes (iteration 4: nothing above NIT)
**Total findings:** 1 BLOCKER, 7 WARNINGs, 5 CONVENTIONs, 4 NITs
**Fixed:** the BLOCKER, every WARNING and CONVENTION; one NIT left with its reason | **Asked (awaiting user):** 0

The change (working rules v26, kosmos#5152 doctrine and #5643 slice 2): the section "Put the work on a task first" teaches agents to set checks with `--done` when they add a task and `done-when` on a given task, unless the person set them. A scheduled run that found nothing new is recorded with `--unchanged` and is not posted on the agent's own initiative. A run that finds something goes to whoever asked, or else to the task's room. A run that could not check is recorded without `--unchanged` and reported with `kosmos report blocked --on`, or needs_you when only the person can fix it, then `kosmos report clear` on the next good run.

Every wording was measured with isolated `claude -p` runs on a fresh copy of the agent folder per run. The table is in .claude/plans/rulesdoneunch-5643.md.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
- [BLOCKER] regenerating doctrine-past.js dropped released v21 rows and a section --> FIXED (table rebuilt by hand from main, pinned by engine/doctrine-4890.test.js).
- [WARNING] x4: answer when asked, tell whoever asked, a run that could not check is not unchanged, the measurement harness shared folders --> FIXED and re-measured.
- [CONVENTION] x2: log label, test comment --> FIXED.
- [NIT] reflow --> FIXED.

#### Iteration 2 (sonnet)
- [WARNING] a change found with nobody asking had nowhere to go --> FIXED (task's room; measured 2/2).
- [CONVENTION] x2: v26 row order, Blocked names the command --> FIXED.
- [NIT] wording --> FIXED.

#### Iteration 3 (opus)
- [WARNING] x2: a bare `report blocked` is refused by both CLIs; Blocked is wrong when only the person can fix it --> FIXED (blocked --on 2/2, needs_you 2/2).
- [CONVENTION] "set by the person" tied to both CLIs by a test --> FIXED.
- [NIT] reflow --> FIXED.

#### Iteration 4 (sonnet)
- [NIT] section hash order in doctrine-past.js --> LEFT (main's list is unsorted; order does not affect matching).
- Nothing above NIT: converged.
