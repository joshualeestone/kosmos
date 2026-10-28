---
pre_challenge: true
method: challenge-loop
branch: stagefixture-7465
diff_hash: 43535e80c3200574070e4b010963d15fb905c2f2583eb13119ccb3bccadd8a1b
subdir_audit: passed
timestamp: 2026-10-28T08:47:29Z
converged: true
---

## [CHALLENGE] kosmos#7465, one blind round (sonnet), no blocker

### Iteration 1 (on 93c6224d5d)
- [WARNING] the derivation sees only fully quoted "$REPO/<path>" literals: KEPT and named in the test; every other spelling fails closed (cp returns 1, or a sourced function is undefined), so the control goes red, never a quiet pass.
- [WARNING] the control proves stageable only without a service key set (the sourced library returns early): FIXED in wording (comment and PASS text say so); that is the only case this fixture stages.
- [NIT] a future "$REPO/../x" literal would write outside the temp dir: FIXED, any '..' path is skipped.
- [NIT] a hand stub of a sourced library would win over the real copy: KEPT, it turns the control red, which is the safe side.
- Checked clean: the real copy only reads the live repo; the control's destination is always inside the temp dir; --refresh-only exits before plist and launchctl; nothing is left in /tmp.

### Final ledger
- [BLOCKER] none

### Validation
bash tools/test-install-board-paths-2870.sh (as package.json test:shell runs it): all checks hold, exit 0. Mutants on a scratch copy: derivation removed -> the new control red with the #6587 cause; validate_dest neutered -> the --refresh-only guard-absent case red (the swap replaced "precious"). The diff is this one test file plus .claude/plans.
