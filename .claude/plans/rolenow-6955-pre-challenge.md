---
pre_challenge: true
method: challenge-loop
branch: rolenow-6955
diff_hash: 75d104491b233b6b9cf4603812e335b50d97a65d6894ce2baee64ed2e4feff1d
validation: passed
subdir_audit: passed
timestamp: 2026-10-23T02:45:23Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (one blind reviewer at a time)
**Converged:** Yes (iteration 2: no BLOCKER or SHOULD-FIX; 1 NIT, kept with reason)

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 SHOULD-FIX, 1 NIT
- [SHOULD-FIX] web/index.html plusOrgReviewerLine said "now an admin" about a reviewer made an admin who then left: ending a membership does not change the coordinator's role (verified in kosmos-relay db.rs org_end_membership) --> FIXED (940b044648): said only on an explicit leftAt null; the relay gains leftAt (kosmos-relay branch leftat-6955)
- [NIT] the day after promote, demote, promote was the first change --> FIXED (940b044648): roleChangedAt
- Checked: the relay sends roleNow on every grant, removedAt is always set when roleNow is not reviewer, every reader of reviewerGrants goes through cleanReviewerGrants, and the notice ignores ended grants

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 SHOULD-FIX, 1 NIT
- [NIT] "now an admin" is not passed through family wording --> KEPT: the coordinator names the role admin in a family too; recorded on the card
- Checked: leftAt null survives a second sanitiser pass; the relay diff matches (field name, null not absent, unix seconds)
**Converged:** no new actionable findings.

### Final validation
- Full suite (tools/run-tests.sh, queued-heavy) on 940b044648: node 23387 tests, 23061 pass, 0 fail, 0 cancelled, 326 skipped; shell-shard all 284 passed (END rc=0 21:44 CDT 2026-10-22).
- engine/reviewernotice-6752.test.js and web.reviewernotice-6752.test.js 11/11; the new assertions fail on main's code (control run).
- docs/browser-checks/render-reviewerptr-6817.js: 30 PASS, 0 FAIL (chromium + webkit), including "a reviewer made an admin raises no notice" and the Settings lines for admin and member.
