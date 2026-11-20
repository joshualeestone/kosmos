---
pre_challenge: true
method: challenge-loop
branch: enrolcaller-7116
diff_hash: 1aa6c7486351d9a42b3c3d062d4c11657c04f0b6cfd0f3fb23f912a29262978b
validation: passed
subdir_audit: passed
timestamp: 2026-11-20T05:49:46Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (the cap), plus Ice Cream Kitty's read of round 8's fix (ed6a2d2626), whose one point (refuse a malformed kept-code record) is applied.
**Converged:** Rounds 1 to 5 converged before the rebase onto main; rounds 6 to 8 followed Renet Tilley's route correction. After round 8: the final route interface (#7116 comment 7024805833: the stays list, a no-nonce start, pending's ready), and two guards the full validation found outside the change (runners.isRunnable for the helper; enrolsign.js registered as a mac-request caller in tools/test-connector-verbs.sh).

Validation: the full suite passed on Mortals (mortals-validate.sh) at 7dc795477d: 30099 node tests, 0 failed, 0 cancelled, all four shell shards status 0, status clean, hash 1aa6c7486351. Six local runs on this Mac each failed on a different timing or environment test under load 20 to 70 (never the change), so the clean run was made on Mortals.

Checked against Renet Tilley's pushed routes (kosmos-relay devkeyroutes-7116 7d94d023c): paths, answer fields, ended on 200 answers and ok/code all match.

### Per-Iteration Breakdown
- Rounds 1 to 5: the kept code (owner-only store, tie before signing, one invite one computer, drop on accept only if still the checked code), the route client, adminQueue (see the plan's last sections and the commit messages).
- Round 6: a refused sign carries the entry id; ended only on sign calls; every stays and ending code tested.
- Round 7: a kept code applies only to the entry whose codeHash it hashes to; a tie's hour before its other-computer refusal; approve re-checks an unchecked entry; the accept guard tested.
- Round 8: the hash is compared with the code on disk before its age and tie filters, so a stale code's own entry is refused as expired.
