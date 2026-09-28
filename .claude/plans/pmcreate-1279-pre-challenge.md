---
pre_challenge: true
method: challenge-loop
branch: pmcreate-1279
diff_hash: 825d480258eaff3865d73d77ac15bca57634d518200beab66c1377d50feb9cdd
validation: passed
subdir_audit: passed
timestamp: 2026-09-28T14:37:03Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** Yes (iteration 2 raised NITs only)
**Total findings:** round 1 raised the items fixed below; its per-finding severity table was held in the session that ran it and did not survive a machine reboot at 09:02, so severities for round 1 are NOT recorded here rather than reconstructed. Round 2: NITs only.
**Fixed:** all round 1 findings (listed below) | **Deferred:** round 2 NITs | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** unknown (not preserved across the reboot)
**New findings:** severities not preserved (see Summary). Fixed in a37e9e74d (listed without severity tags, because none were preserved):
- the PM caution understated its reach; it and the opening now say it can make agents (house rule: a caution never understates reach).
- the new lines fold into the existing briefing bullet, keeping three bullets.
- brief the new agent by the name Kosmos prints, not the name asked for.
- on a create timeout, look at the board before retrying (no double create).
- `install/kosmos` comment and the CLAUDE.md row updated to name the PM as well as the guide.
**Self-generated:** 0 (no loop commit existed before this pass)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, NITs only (deferred, wording)
**Self-generated:** 0

### Final validation (6j)
Full validation helper on HEAD a37e9e74d after the reboot: PASSED, hash 825d480258ea, exit 0 (1525 s test phase). An earlier run at 08:15 was killed by the reboot and is not counted.

### Tests specific to the change
`engine/roles.test.js` 4/4, including a CONTROL that no role other than `pm` and `setup` names the create verb; removing the PM wiring fails it.

### Not done, by choice
PMs created before this change keep their old brief: there is no role refresh for PMs like the guide's `refreshGuideRole`. Recorded in the plan.
