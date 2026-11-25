---
pre_challenge: true
method: challenge-loop
branch: dotname-9070
diff_hash: fb980db0d0dd40aa1217da6f56a51b6566f1cc53a22e1553e6a02796224507cd
validation: engine/projects.js, one refusal sentence. engine/projects.test.js 167/167; every root test loading the module 2653/2658 with the same 4 failing on main without the change (this machine's)
subdir_audit: passed
timestamp: 2026-11-25T16:04:46Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1 (sonnet, blind)
**Converged:** Yes. Nothing above NIT.
**Total findings:** 0 BLOCKERs, 0 WARNINGs, 2 NITs (both out of scope, recorded in the plan)
**Fixed:** n/a | **Deferred:** none | **Asked (awaiting user):** 0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
- Nothing above NIT.

### Iteration 1 findings in full
- Where it reaches a person: server.js /api/project-folder preview, rendered by the page's pjSentence (capital,
  full stop): "A name starting with a dot can make a hidden folder, so pick another." Reads right.
- Also thrown as create's and folderNameFor's Error message; the iOS and Android apps do not reference it.
- Pins on the old sentence: none in any test, doc, iOS or Android file; only an old plan file quotes it (history).
- Other Mac or Finder words in the function: only a code comment ("in Finder"), not shown to a person. [NIT]
- Out of scope, checked by the author: "Finder did not open" in engine/projects.js is Mac-only, because the Windows
  path returns through win32explorer first.
- [NIT] the new comment says a dot-folder is not hidden on Windows while the refusal still fires there; "can make"
  covers it honestly. Kept.
- Tests: engine/projects.test.js 167/167.
