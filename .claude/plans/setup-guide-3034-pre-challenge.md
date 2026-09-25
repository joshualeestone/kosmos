---
pre_challenge: true
method: challenge-loop
branch: setup-guide-3034
diff_hash: 026086cdfb0f10933deb33408738e963067eb42f4a7125044eef8d875bb31750
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T23:55:42Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (6.0 baseline validation passed, so iteration 1 is the first reviewer)
**Converged:** Yes (iteration 4: 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs; 6j skipped on the validated hash 026086cdfb0f)
**Total findings:** 1 BLOCKER, 5 WARNINGs, 3 CONVENTIONs, 12 NITs
**Fixed:** 1 BLOCKER, 5 WARNINGs, 3 CONVENTIONs, 8 NITs | **Deferred:** 4 NITs | **Asked (awaiting user):** 0

Between iterations, two changes came from outside the loop, not from a reviewer: Josh's picture was added (Splinter, 17:36), and the hands-off rule became a switch and then recorded Josh's 18:02 reaction (Splinter, 17:55 and 18:02). The `setupAssistant` setting on `/api/settings` was added at Splinter's assignment (18:03). Every later iteration reviewed them.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 2 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above (no loop commit existed yet)
- [WARNING] engine/roles.js - the freshness rule ("older than their message") would ask every turn, because the page file is written before the person types --> FIXED (commit 36284333): ask only when missing or more than ten minutes old
- [WARNING] engine/setup-assistant.js - a taken name "Josh" meant no guide ever, silently --> FIXED (36284333): falls back to "Josh AI" once, only on the name-taken refusal
- [WARNING] engine/setup-assistant.js + server.js - a deleted guide's name reused by a new agent would receive page reports --> FIXED (36284333): a marker file in the seeded folder, required by the route
- [CONVENTION] server.js - the new route split the #969 doc comment from its handler --> FIXED (36284333)
- [CONVENTION] server.js - the first-run comment still said the guide is named after the user --> FIXED (36284333)
- [NIT] ring test message; temp-name collision in one millisecond; tab labelled as the person's name; 404 is the normal answer until the seed is on --> FIXED (36284333; the 404 note is in the route doc and on #3034)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 0 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 1 of the above (the MARKER test came from iteration 1's fix, 36284333)
- [BLOCKER] engine.setup-assistant-3034.test.js - the file sandboxed only the data root, so the MARKER test resolved the REAL ~/work/workers/josh and deleted it in a finally --> FIXED (commit f966e851): every root sandboxed before any require, and the test asserts the folder resolves inside the sandbox (RED with the workers line removed). Measured: no josh folder existed on this machine before or after.
- [CONVENTION] engine/roles.js + engine/setup-assistant.js - "Josh's AI" written in two places --> FIXED (f966e851): roles.GUIDE_TAG is the one copy, with a test pinning the re-export equal
- [NIT] header grammar; inverted assertion message --> FIXED (f966e851)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 2 of the above (the tab placement and the marker comment came from iteration 1's fixes)
- [WARNING] engine/pagecontext.js - the Settings tab is free text but was written outside the not-instructions line --> FIXED (commit 3cd56445): written under it
- [WARNING] engine/setup-assistant.js + server.js - a REMOVED guide keeps its folder and marker (removal deletes nothing), so the route kept writing --> FIXED (3cd56445): the route checks remove.removedNames: 404 removed, 409 unreadable, with a restore control
- [NIT] engine/pagecontext.js - names cut by UTF-16 unit could split an emoji --> FIXED (3cd56445): by code point
- [NIT] plan's test counts --> FIXED (3cd56445)
- [NIT] server.js - the page route uses { error } while /api/settings uses { ok, because } --> DEFERRED: both shapes already exist in server.js; the bubble reads each route on its own
- [NIT] engine/pagecontext.js - internal files could show in a Files listing --> DEFERRED: not reachable, they sit beside Files/ (#3614), not in it

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/roles.js | BRANCH | freshness rule asked every turn | FIXED | 36284333 |
| 2 | 1 | WARNING | engine/setup-assistant.js | BRANCH | taken name, no guide ever | FIXED | 36284333 |
| 3 | 1 | WARNING | server.js | BRANCH | reused name receives reports | FIXED | 36284333 |
| 4 | 1 | CONVENTION | server.js | BRANCH | route split the #969 doc | FIXED | 36284333 |
| 5 | 1 | CONVENTION | server.js | BRANCH | stale first-run comment | FIXED | 36284333 |
| 6 | 2 | BLOCKER | engine.setup-assistant-3034.test.js | SELF | test deleted the real ~/work/workers/josh | FIXED | f966e851 |
| 7 | 2 | CONVENTION | engine/roles.js | BRANCH | two copies of the AI tag | FIXED | f966e851 |
| 8 | 3 | WARNING | engine/pagecontext.js | SELF | tab outside the not-instructions line | FIXED | 3cd56445 |
| 9 | 3 | WARNING | server.js | SELF | removed guide still written to | FIXED | 3cd56445 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- [NIT] server.js error shapes differ between the two routes the bubble calls (iteration 3) - DEFERRED
- [NIT] internal files in a Files listing (iteration 3) - DEFERRED, unreachable
- [NIT] engine/pagecontext.js:338-386 agent/project/tab written whatever the screen (iteration 4) - DEFERRED: the guide treats the screen as authoritative and names as data only; scoping them per screen needs the bubble's real screen map
- [NIT] server.js:9169-9171 a try/catch around store.readSettings, which never throws (iteration 4) - DEFERRED, harmless

### Strengths (across all iterations)
- The page context reaches the guide as a file, so the chat record stays exactly what the person typed (iterations 1, 3)
- Only the seeded, marked, not-removed guide is ever written to, pinned against the real server with control arms (iterations 3, 4)
- The tests pin the dangerous answers: closed screen vocabulary incl. __proto__, marker neutralisation, code-point bounds (iteration 4)
- The web/ avatar carries the Browser-check trailer the #1720 gate accepts (iteration 4)
