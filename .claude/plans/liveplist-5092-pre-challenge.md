---
pre_challenge: true
method: challenge-loop
branch: liveplist-5092
diff_hash: f2523fa5f38d97d20851fc5db19bb1d4631573a631f2c4abce4cf92fd6444622
validation: PR CI (full suite on GitHub; merge waits on it). Local: the guard test all PASS under /bin/bash 3.2, 774 node tests reading run-tests.sh 773/0
subdir_audit: passed
timestamp: 2026-10-03T03:50:42Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (blind reviewers, opus and sonnet alternating)
**Converged:** Yes (iteration 4: 0 BLOCKERs, 0 WARNINGs, 3 NITs, one fixed and two left as cosmetic, safe-direction)
**Total findings:** 0 BLOCKERs, 4 WARNINGs, 14 NITs
**Fixed:** every WARNING but one, which is an accepted, documented false red (named-world and connected-folder agents) | **Asked (awaiting user):** 0

**Validation, stated plainly:** no full local suite was run for this head. The change is to the test RUNNER (tools/run-tests.sh and the #3011 guard lib); a full local run would take hours in either queue tonight (Agent1s about 13 deep, Mortals about 12), and Baron wants it on main before the 0.7.20 cut. The PR's own CI runs the full suite (node, both shell shards, which include this guard test, and windows) on GitHub, and merge waits on all of it green. Locally: `tools/test-launchagent-leak-guard-3011.sh` all PASS under /bin/bash 3.2 (17 new legs); every node test that reads run-tests.sh or the guard, 774 tests, 773 pass, 0 fail; the other shell tests that read run-tests.sh pass (test-install.sh needs built dist/ trees and fails identically on main). Seven sabotages (S1 to S7), re-run on the final code, each turned its own legs red. Replayed on the REAL Mortals Liu Kang plist (copied read-only): live-owned under its workers root, not under another.

### Per-iteration breakdown

#### Iteration 1 (opus) - 0 B, 1 W, 5 N
- [WARNING] named-world and connected-folder agents still red --> ACCEPTED, documented (a false red, never a hidden leak)
- [NIT] x5 --> FIXED (honest comments on the AGENT_WORKFORCE_WORKERS convention and #3605's reach; no notes file turns the skip off; note wording; trailing-slash and XML-escaped-root legs)

#### Iteration 2 (sonnet) - 0 B, 2 W, 3 N
- [WARNING] the runner's no-notes fallback was untested --> FIXED (pinned; sabotage S5)
- [WARNING] the note did not name the other possible writer --> FIXED
- [NIT] x3 --> FIXED (quoting, comments, plan numbers)

#### Iteration 3 (opus) - 0 B, 1 W, 2 N
- [WARNING] the runner's print loop was untested --> FIXED (launchagent_live_notes_report in the lib, behavioural legs, a call pin; sabotages S6, S7)
- [NIT] cut | grep -q under pipefail --> FIXED (awk)
- [NIT] plan count --> FIXED

#### Iteration 4 (sonnet) - 0 B, 0 W, 3 N => CONVERGED
- [NIT] leg count --> FIXED
- [NIT] awk -v unescapes a backslash path (reds, safe) --> left
- [NIT] runner pins are text greps --> left (behavioural legs and sabotages carry it)
