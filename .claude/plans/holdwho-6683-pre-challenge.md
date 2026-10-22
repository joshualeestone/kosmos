---
pre_challenge: true
method: challenge-loop
branch: holdwho-6683
diff_hash: 921bfbcf1587f8980c486c69f68a0bbfae11ef35bf51a0966029251167d75788
validation: passed (local, on HEAD 052914e3b8: tools/run-tests.sh exit 0, node 23323 tests 0 fail, then the shell suite; render-onhold-4771.js browser check passed; tree clean before and after)
subdir_audit: passed (no subdirectory CLAUDE.md in the diff)
timestamp: 2026-10-22T19:28:04Z
iterations: 1
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 1
**Converged:** Yes, at iteration 1 (NITs only).
**Total findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Fixed:** 0 | **Deferred:** 0 | **Asked:** 0

Before the loop: the browser check's three new assertions were mutated red against the old page (4 failures: the person's hold and the outside hold at 1400 and 390; the not-held control stayed green), and both browser-check gates passed.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus (default)
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** - no new actionable findings. The reviewer checked every claim in the new nudge clause and hint against the engine and both CLIs (argument order in install/kosmos and tools/windows/kosmos-cli.js; openParts skips a held task; setOnHold's 403 for an off-screen unhold of the person's hold).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| - | - | - | - | - | no BLOCKER, WARNING or CONVENTION was raised | - | - |

### NITs (non-blocking)
- docs/browser-checks/render-onhold-4771.js:57 - the setup comment still calls task 2 "never on hold"; the #6683 arm holds and releases it in each viewport (iteration 1)
- docs/browser-checks/render-onhold-4771.js:340 - the comment's reason for releasing task 2 could say it keeps the next viewport's controls meaningful (iteration 1)
- web/index.html - "only you can take it off, here" is true of the engine; the screen boundary itself is advisory until #4491 (iteration 1)

### Strengths
- The nudge clause appears only under the same project-id guard as the pause clause, adds no quote characters, and names the verb the way both CLIs take it
- The three hint branches match setOnHold exactly, and the not-held sentence is unchanged byte for byte
- The browser check anchors each held arm, so a hint that ignored onHoldByPerson fails one of them
