---
pre_challenge: true
method: challenge-loop
branch: wincurrency-6628
diff_hash: 7a6c3654db21413c5e28d466a050ed0534654368c44c892d1cda3ded3b069a9a
validation: passed
subdir_audit: passed
timestamp: 2026-10-20T00:25:24Z
iterations: 10
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 10
**Converged:** Yes
**Total findings:** 17 actionable (0 BLOCKERs, 17 WARNINGs, 0 CONVENTIONs), plus NITs (one kept in the ledger as a recorded decision)
**Fixed:** 16 | **Deferred:** 2 (one WARNING, one NIT) | **Asked (awaiting user):** 0

Validation: the helper passed on 41b43c5 (iteration 1) and on the final head 576215c (22234 node tests, 0 failed;
both connector-currency shell tests passed inside test:shell; subdir audit rc 0). The runs on fc0aa4d, a12ec31, 047c20e,
d1fb545, ae54774, 9725b70 and 922faec were stopped by me before they finished because a later commit superseded them;
each iteration's own shell tests (the three currency/floor scripts) and, from iteration 5, the release-related node
tests were run by hand before its commit.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/lib/connector-currency.sh — Windows rebuild hint lacks -Sign, so following it yields an unsigned connector the build refuses --> FIXED (41b43c5)
- [WARNING] tools/windows/RELEASING.md — runbook does not name the new refusal, relay checkout or override --> FIXED (41b43c5)
- [NIT] connector-currency.sh — Mac hint no longer names the file --> FIXED (41b43c5)
- [NIT] build-kosmos-windows.sh — override leaves no record in the zip manifest (pre-existing on Mac too)

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
- [WARNING] tools/test-connector-currency-windows-6628.sh — wiring check is source-text only; harden by also requiring it before connector_pe_signed --> FIXED (fc0aa4d; text-only approach kept, matching the 3884 test)
- [NIT] .ps1 suffix selects the Windows wording; [NIT] copy can be a no-op; [NIT] not-a-checkout message

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the dist-name hint, written in 41b43c5)
- [WARNING] connector-currency.sh — a build script missing from relay main matches nothing as a pathspec and reads as unchanged (fail-open) --> FIXED (a12ec31)
- [WARNING] connector-currency.sh — hint names dist/<basename of destination>, which may not exist --> FIXED (a12ec31)
- [WARNING] build-kosmos-windows.sh — override does not get past an unreachable relay; say so --> FIXED (a12ec31, RELEASING.md and lib header)
- [NIT] Windows build header did not list the refusal --> FIXED; [NIT] assert Mac wording absent --> FIXED; [NIT] copy onto itself --> FIXED later (point KOSMOS_TUNNEL_BIN at it)

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] connector-currency.sh — the missing-script refusal is new on the Mac cut; name it --> FIXED (047c20e, recorded in the plan's Decisions)
- [NIT] internal round number in a comment --> FIXED; [NIT] RELEASING.md missing that case --> FIXED; [NIT] fetch before local signature check --> DEFERRED (both orders valid; recorded in plan); [NIT] Windows lacks coordinator floor check (raised again in iteration 5 as a WARNING)

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] build-kosmos-windows.sh — the Windows build adds step 1d's half without 1d2's coordinator floor check --> FIXED (d1fb545)
- [WARNING] connector-currency.sh — Git Credential Manager ignores GIT_TERMINAL_PROMPT and can hang on a dialog --> FIXED (d1fb545, GCM_INTERACTIVE=never)
- [NIT] anchor the wiring pattern --> FIXED; [NIT] FAILS CLOSED list missing the new case --> FIXED; [NIT] Mac default path missing-script not tested --> FIXED; [NIT] copy onto itself
- Found by me while fixing: tools.release-gate.test.js fixture relay lacked the Mac build script (9 failures, caused by a12ec31) --> FIXED (d1fb545)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs (plus 1 WARNING duplicate of iteration 4)
**Self-generated:** 1 of the above (the plan's unverified curl claim, written in d1fb545)
- [WARNING] build-kosmos-windows.sh — floor check needs node and curl 7.71+, undocumented; plan's curl claim unverified --> FIXED (ae54774)
- [NIT] shallow-clone wording --> FIXED; [NIT] .ps1 coupling; [NIT] awk heuristic

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the "already needs both" plan sentence, ae54774)
- [WARNING] node is now required even with KOSMOS_CUT_NO_WHATS_NEW=1, and the node message names release.sh --> FIXED (9725b70)
- [WARNING] new Mac refusal not noted where step 1d is documented --> FIXED (9725b70, release.sh step 1d comment)
- [WARNING] floor check on Windows covered by wiring only --> DEFERRED: stated in the plan and PR body; the check itself is tested by test-coordinator-floor-5037.sh with the same arguments
- [NIT] coordinator-floor.sh header/curl comments stale --> FIXED; [NIT] .ps1 suffix; [NIT] sourcing not asserted

#### Iteration 8
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs (plus 1 WARNING duplicate of iteration 4)
**Self-generated:** 1 of the above (the "every Windows build" claim, 9725b70)
- [WARNING] RELEASING.md and plan overstate when node/curl are needed (only when a floor line applies) --> FIXED (922faec, claims narrowed)
- [WARNING] wiring arm does not pin the relay checkout argument --> FIXED (922faec, with a negative control)
- [NIT] credentials not mentioned --> FIXED; [NIT] GCM on Mac too; [NIT] local -a fine

#### Iteration 9
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (arm 5d, added in d1fb545)
- [WARNING] tools/test-connector-currency-3884.sh — arm 5d reset origin to BUILT, so arm 6's rebuilt-connector control compared BUILT with BUILT --> FIXED (576215c, arm moved after the control)
- [NIT] "node, which release.sh already needs" comment --> FIXED; [NIT] "fail, not hang" holds over HTTPS only --> FIXED; [NIT] sourcing not asserted

#### Iteration 10
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | tools/lib/connector-currency.sh:90 | BRANCH | Windows rebuild hint lacks -Sign | FIXED | 41b43c5 |
| 2 | 1 | WARNING | tools/windows/RELEASING.md:68 | BRANCH | Runbook silent on the new refusal | FIXED | 41b43c5 |
| 3 | 2 | WARNING | tools/test-connector-currency-windows-6628.sh:66 | BRANCH | Wiring check text-only; also require before the signature check | FIXED | fc0aa4d |
| 4 | 3 | WARNING | tools/lib/connector-currency.sh:49 | BRANCH | Missing build script reads as unchanged (fail-open) | FIXED | a12ec31 |
| 5 | 3 | WARNING | tools/lib/connector-currency.sh:94 | SELF | Hint names a dist file that may not exist | FIXED | a12ec31 |
| 6 | 3 | WARNING | tools/build-kosmos-windows.sh:142 | BRANCH | Override does not cover an unreachable relay; undocumented | FIXED | a12ec31 |
| 7 | 4 | WARNING | tools/lib/connector-currency.sh:73 | BRANCH | New Mac refusal unstated | FIXED | 047c20e |
| 8 | 5 | WARNING | tools/build-kosmos-windows.sh:139 | BRANCH | No coordinator floor check on Windows | FIXED | d1fb545 |
| 9 | 5 | WARNING | tools/lib/connector-currency.sh:58 | BRANCH | GCM can hang on a sign-in dialog | FIXED | d1fb545 |
| 10 | 5 | WARNING | tools.release-gate.test.js:73 | BRANCH | Fixture relay lacks the Mac build script (found running tests) | FIXED | d1fb545 |
| 11 | 6 | WARNING | tools/build-kosmos-windows.sh:148 | SELF | node/curl needs undocumented, curl claim unverified | FIXED | ae54774 |
| 12 | 7 | WARNING | tools/build-kosmos-windows.sh:148 | SELF | node required even on the hotfix path | FIXED | 9725b70 |
| 13 | 7 | WARNING | tools/lib/connector-currency.sh:75 | BRANCH | Mac refusal not in step 1d's docs | FIXED | 9725b70 |
| 14 | 7 | WARNING | tools/test-connector-currency-windows-6628.sh:73 | BRANCH | Floor check on Windows covered by wiring only | DEFERRED | Stated in plan and PR; check tested by 5037 |
| 15 | 8 | WARNING | tools/windows/RELEASING.md:87 | SELF | node/curl claim overstated | FIXED | 922faec |
| 16 | 8 | WARNING | tools/test-connector-currency-windows-6628.sh:80 | BRANCH | Relay argument not pinned | FIXED | 922faec |
| 17 | 9 | WARNING | tools/test-connector-currency-3884.sh:86 | SELF | Arm 5d emptied arm 6's control | FIXED | 576215c |
| 18 | 4 | NIT→kept | tools/build-kosmos-windows.sh:139 | BRANCH | Fetch before the local signature check | DEFERRED | Both orders valid; recorded in plan |

### Outstanding questions (ASKED, still unresolved when the run ended)
- none

### NITs (non-blocking, across all iterations)
- The override leaves no record in the zip's manifest (pre-existing on the Mac path; follow-up card candidate) (iteration 1)
- The `.ps1` suffix selects the Windows wording (iterations 2, 6, 7)
- The wiring arm does not assert the two libs are sourced (a missing source fails loudly anyway) (iterations 7, 9)
- An old curl on the Windows PC refuses with a network-looking message (iteration 10)
- Each check re-runs the provenance read (harmless, as on the Mac) (iteration 10)

### Strengths (across all iterations)
- The third argument defaults to the Mac script, so release.sh step 1d compares the same inputs; arm 5 proves both directions (iterations 1-10)
- The missing-build-script refusal closes a real fail-open, tested with and without the override on both paths (iterations 4-10)
- The tests are hermetic, can fail, have controls, and are run by test:shell (all iterations)
