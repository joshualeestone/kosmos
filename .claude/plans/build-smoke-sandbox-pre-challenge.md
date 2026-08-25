---
pre_challenge: true
method: challenge-loop
branch: build-smoke-sandbox
diff_hash: 813d4693346c025804e430e51831e33d9f68b39440ac8d936ce7de7dc95ac786
subdir_audit: passed
timestamp: 2026-08-25T01:52:54Z
iterations: 2
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** No (stopped at the bound after iteration 2; see below)
**Total findings:** 16 (0 BLOCKERs, 8 WARNINGs, 1 CONVENTION, 7 NITs)
**Fixed:** 8 WARNINGs + 1 CONVENTION + 4 NITs | **Deferred:** 3 NITs (recorded)

**Why stopped rather than converged:** this change unblocks the next cut (release.sh step 4 was failing on main since #715), so its bound was two rounds. Both rounds' warnings were in the NEW test's extraction (ways it could be fooled) and each is fixed with a control proven by mutation; the product change itself (two environment variables in two tools) drew no finding in either round. Validation after each round: yarn test 1955/1955, exit 0, audit clean; the real build passes (exit 0, tarball packed); the install harness runs 205/212 with the seven known fixture failures that predate this change. Bounded on purpose (Angel).

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 5 WARNINGs, 1 CONVENTION, 2 NITs
- [WARNING] test:23 — an empty value read as a set root --> FIXED (2afc06b): values passed unchanged, control
- [WARNING] test:18 — comment lines read as assignments --> FIXED (2afc06b): stripped, control
- [WARNING] test:42 — a missing DIRS export looped zero times and passed --> FIXED (2afc06b): the list is read first and an empty one fails
- [WARNING] test:18 — sort -u lost source order; a duplicated key read as the wrong value --> FIXED (2afc06b): order kept, last wins, control
- [WARNING] build-kosmos-bundle.sh:262 — comment said the server only reads on GET / ; a boot writes into the data root (measured) --> FIXED (2afc06b)
- [CONVENTION] test:11 — two adjacent comments disagreed on whether values matter --> FIXED (2afc06b)
- [NIT] the sed range closes on the first runtime/bin/node line --> FIXED in iteration 2 (anchored on app/server.js); printf | grep -q under pipefail --> FIXED (a case substring test)
- Also in this iteration: tools/test-install.sh was found failing at its first install for the same reason, and fixed (PROJECTS, WORKERS, DRY_RUN=1), with the audit extended to cover it

#### Iteration 2
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] test:63 — the harness audit stopped at the first install; a later unset of a root was invisible (measured) --> FIXED (this iteration): the rest of the file is swept for an unset or emptied root and later re-assignments are audited merged; control by mutation
- [WARNING] plan:17 — the plan said the harness was out of scope while the diff changed it --> FIXED: plan rewritten
- [WARNING] test-install.sh:131 — "every root the app has" overclaimed: the claude config (trust.js writes through it) and the config root stayed the operator's real files --> FIXED: both sandboxed, as the build already did
- [NIT] install/kosmos:130 says the harness sets TMUX_BIN (it never did) --> DEFERRED: pre-existing, named in the plan; the harness comment now says DRY_RUN is what makes sends no-ops
- [NIT] anchor on app/server.js --> FIXED; digits in a root name would not extract --> DEFERRED: fails closed via the DIRS check
**Stopped at the bound** (see the summary).

### Final Ledger
| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | test:23 | empty value read as set | FIXED | 2afc06b |
| 2 | 1 | WARNING | test:18 | comment lines read as assignments | FIXED | 2afc06b |
| 3 | 1 | WARNING | test:42 | missing DIRS passed silently | FIXED | 2afc06b |
| 4 | 1 | WARNING | test:18 | duplicated key read wrong | FIXED | 2afc06b |
| 5 | 1 | WARNING | build:262 | comment described a server that no longer exists | FIXED | 2afc06b |
| 6 | 2 | WARNING | test:63 | later unset of a root invisible | FIXED | iteration 2 |
| 7 | 2 | WARNING | plan:17 | plan and code disagreed | FIXED | iteration 2 |
| 8 | 2 | WARNING | test-install.sh:131 | two roots still the operator's real files | FIXED | iteration 2 |

### NITs (non-blocking, across all iterations)
- Deferred: install/kosmos's stale TMUX_BIN comment (2); digits in a root name (2); the harness's seven icon-block fixture failures are Baron's (#664/#665 uid keying) and are named in the plan, not this change.

### Strengths (across all iterations)
- Every control proven by mutation: a dropped root, a dropped DRY_RUN, an empty value, a commented line, a gate that always passes, a gate with tmux always inert, a gate that grows a root, a later unset (rounds 1 and 2).
- DRY_RUN=1 changes nothing the build's smoke test or the harness proves (both rounds checked the assertions).
- The root list is read from the gate itself, never copied (both rounds).
