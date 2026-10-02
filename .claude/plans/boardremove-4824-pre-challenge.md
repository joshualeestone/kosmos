---
pre_challenge: true
method: challenge-loop
branch: boardremove-4824
diff_hash: bac7ef8001e80add115c47bd10e054e555aec45f54948ac94128e858316c00f6
validation: passed
subdir_audit: passed
timestamp: 2026-10-01T08:21:10Z
iterations: 17
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 17
**Converged:** Yes (iteration 17: its one WARNING deduplicated against a DEFERRED ledger entry)
**Total findings:** 38 ledger entries (1 BLOCKER, 37 WARNINGs), plus NITs
**Fixed:** 33 | **Deferred:** 5 | **Asked (awaiting user):** 0

Final validation: full suite on Agent1s at 0556c4fb1, 13410 tests, 0 failed, validation_rc=0, recorded clean for
diff hash bac7ef80. An earlier full run (3ea531cf1's predecessor, 5fb564274) had one red, the browser-checks README
index, fixed as a synthetic final-validation finding; a Mortals run of 2a158df8e passed every test and stopped on the
browser-check surface gate (the token `msg`), answered with per-check trailers in 0556c4fb1 (gate passes alone).
Browser check render-device-remove-4824: 23/23 PASS at 2a158df8e (queued-heavy, 03:01).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 3 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [BLOCKER] web/index.html:42855 — the after-Remove line was cleared by paintDevices' next repaint --> FIXED (6614917f2)
- [WARNING] web.allow-card.test.js:79 — copy only grepped, no render check --> FIXED (6614917f2, browser check added)
- [WARNING] engine/remote.js:1429 — old_connector field unused by the page --> FIXED (6614917f2)
- [WARNING] web/index.html:42804 — confirm copy over-promised other computers --> FIXED (6614917f2)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
- [WARNING] web/index.html:43193 — the 5 s paintPlus poll still cleared the line --> FIXED (6d8f6e5a2, ASK.said)
- [WARNING] web/index.html:42869 — "within a few seconds" unmeasured --> FIXED (6d8f6e5a2)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] docs/browser-checks/render-device-remove-4824.js:1 — no CI route selected the check --> FIXED (e6e49666a, cd...; gated.txt + functions)
- [WARNING] web/index.html:42793 — assertive alert rewritten every 5 s --> FIXED (e6e49666a)
- [WARNING] web/index.html:42850 — old connector's missing local_cutoff unsaid --> FIXED (e6e49666a)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above
- [WARNING] web/index.html:42842 — two alarming lines for an old connector --> FIXED (797978f2c)
- [WARNING] web/index.html:42791 — line never expires --> FIXED (797978f2c, REMOVE_SAID_MS)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] docs/browser-checks/render-device-remove-4824.js:97 — persistence arm could not see a clearing repaint --> FIXED (35a5ea49f, control added)
- [WARNING] web/index.html:42870 — a second Remove during the slow call --> FIXED (35a5ea49f, ASK.removing)
- [WARNING] web/index.html:42851 — old-connector sentence unconditional --> FIXED (35a5ea49f)
- [WARNING] engine/remote.js:1420 — stale comment --> FIXED (35a5ea49f)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/remote.js:1427 — retry without re-checking busy() --> FIXED (b4b1497d1)
- [WARNING] web/index.html:42788 — unreadable list overwrote the line --> FIXED (b4b1497d1)

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] docs/browser-checks/render-device-remove-4824.js:160 — busy arm could not fail --> FIXED (50cb6c7ee)

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (plus 1 duplicate), 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/remote.js:1423 — a timed-out Remove read as failed --> FIXED (1ec3f7dc7, timed_out)

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above (prose)
- [WARNING] web/index.html timeout copy — named a cause it could not know --> FIXED (cd303ca47, claim deleted, neutral copy)

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] engine/remote.js:1443 — timeout copy missed "gone but not told" --> FIXED (163cf2b99)
- [WARNING] web/index.html:42885 — no client-side timeout --> DEFERRED: the board answers within the retire timeout and finally clears Removing

#### Iteration 11
**Reviewer model:** opus
**New findings:** 0 (5 NITs)
**Self-generated:** 0
**Converged (first time)**, then final validation failed: [BLOCKER] final-validation: browser-checks-indexed.test.js (the README does not name the check) --> FIXED (3ea531cf1)

#### Iteration 12
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (plus 1 duplicate), 1 CONVENTION-note, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/remote.js — fallback depends on clap's wording --> DEFERRED: the plan's named weakest premise; only pre-#4803 connectors take that path, and 0.7.15 bundles the new one

#### Iteration 13
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] web/index.html:43004 — "the list below" (it is above) --> FIXED (87dd0e727)
- [WARNING] web/index.html:43011 — "could not confirm it" with no antecedent --> FIXED (87dd0e727)
- [WARNING] server.js:8549 — no engine-to-page route test --> FIXED (87dd0e727, server.test.js)

#### Iteration 14
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (plus 1 duplicate), 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above
- [WARNING] web/index.html:42949 — a failed list read hidden for two minutes --> FIXED (37dee4a93)

#### Iteration 15
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 1 of the above
- [WARNING] web/index.html:42950 — the failed-read line rewrote the alert every poll --> FIXED (2a158df8e)
- [WARNING] web/index.html:42943 — the line survived sign-out/Forget/Plus off --> FIXED (2a158df8e)

#### Iteration 16
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING (plus 3 duplicates), 1 CONVENTION-note, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] web/index.html:43036 — a poll started before the Remove answer can repaint the removed row --> DEFERRED: the same stale-list race exists on main; not introduced here

#### Iteration 17
**Reviewer model:** opus
**New findings:** 0 (1 WARNING, a duplicate of the DEFERRED clap-wording entry; 3 NITs)
**Self-generated:** 0
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html:42855 | BRANCH | Line cleared by next repaint | FIXED | 6614917f2 |
| 2-4 | 1 | WARNING | various | BRANCH | grep-only test; old_connector unused; confirm over-promise | FIXED | 6614917f2 |
| 5-6 | 2 | WARNING | web/index.html | SELF/BRANCH | poll cleared line; unmeasured timing | FIXED | 6d8f6e5a2 |
| 7-9 | 3 | WARNING | check, index.html | BRANCH/SELF | not selected; alert rewrite; old local_cutoff | FIXED | e6e49666a + gated.txt |
| 10-11 | 4 | WARNING | web/index.html | SELF/BRANCH | old-connector alarm; no expiry | FIXED | 797978f2c |
| 12-15 | 5 | WARNING | check, index.html, remote.js | SELF/BRANCH | weak measurement; double Remove; unconditional copy; stale comment | FIXED | 35a5ea49f |
| 16-17 | 6 | WARNING | remote.js, index.html | BRANCH | busy() recheck; read error overwrite | FIXED | b4b1497d1 |
| 18 | 7 | WARNING | check:160 | SELF | vacuous busy arm | FIXED | 50cb6c7ee |
| 19 | 8 | WARNING | remote.js:1423 | BRANCH | timeout read as failure | FIXED | 1ec3f7dc7 |
| 20 | 9 | WARNING | web/index.html | SELF | timeout copy named wrong cause | FIXED | cd303ca47 |
| 21 | 10 | WARNING | remote.js:1443 | SELF | gone-but-not-told case | FIXED | 163cf2b99 |
| 22 | 10 | WARNING | web/index.html:42885 | BRANCH | no client timeout | DEFERRED | server-bounded |
| 23 | 11 | BLOCKER | final-validation | BRANCH | README index missing the check | FIXED | 3ea531cf1 |
| 24 | 12 | WARNING | engine/remote.js | BRANCH | clap wording premise | DEFERRED | named weakest premise |
| 25-27 | 13 | WARNING | index.html, server.js | SELF/BRANCH | below/above; antecedent; route test | FIXED | 87dd0e727 |
| 28 | 14 | WARNING | web/index.html:42949 | SELF | read error hidden | FIXED | 37dee4a93 |
| 29-30 | 15 | WARNING | web/index.html | SELF/BRANCH | failed-read rewrite; account change | FIXED | 2a158df8e |
| 31 | 16 | WARNING | web/index.html:43036 | BRANCH | stale-list race | DEFERRED | pre-existing on main |
| 32 | final | GATE | browser-check surface | BRANCH | token msg mapped to chat checks | FIXED | 0556c4fb1 trailers |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- Source-regex wiring tests in web.allow-card.test.js are formatting-sensitive (the browser check covers behaviour).
- No aria-busy on the Removing button.
- A Remove result written while the box is hidden stays in the element until the next visible paint.
- "Keep" clears a warning the person may not have read.

### Strengths (across all iterations)
- The old-connector fallback is measured against the real pre-#4803 binary (exit 2 + clap wording, ANSI stripped), with controls that are not retried.
- removedWords claims the other computers only from the connector's own answer, and is run on every answer shape.
- The browser check counts list reads after the Remove answer, with controls that prove it can see a clearing repaint and a busy arm that cannot pass vacuously.
- A server test pins that the route hands the page every field unchanged.
