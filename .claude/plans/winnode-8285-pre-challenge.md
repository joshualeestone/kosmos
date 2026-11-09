---
pre_challenge: true
method: challenge-loop
branch: winnode-8285
diff_hash: 14ecdab82bcb015edef05ceb909b0780e91835f318bfb65b859c14891dc3681e
validation: substituted (the helper needs yarn/npm, absent on this Windows box; the repo's type-check is a no-op. Instead, with the no-schtasks preload, at e2c5c2f9ec: every test file that names publish-r2 (4 files) run one file at a time on the branch and on a control at the merge base 75b1034650, identical counts and failing names (all pass on both); the new tools.win-publish-node-runtime-8285.test.js 12 pass + 1 CI-only skip under powershell.exe (pwsh is not installed here; the Windows CI job runs both); a mutation control deleting the publisher clause turns exactly the other-publisher test red; policy tests fixture-discipline, no-name-refs-3071, engine.reachable, engine/windows-tests-1777, engine/win32-separator-guard, engine/windows-coupling-audit-1732 pass; worktree clean. Live: with no node on PATH, publish-r2.ps1 -Promote ... -DryRun for the live 0.8.00 says "no node on PATH; using the installed Kosmos app's own (signed by OpenJS Foundation)" once, both checks PASS, nothing written, exit 0)
subdir_audit: passed
timestamp: 2026-11-09T18:44:37Z
iterations: 8
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8
**Converged:** No: stopped at the fleet's 8-round cap (stop at 8 unless a BLOCKER is open; WARNINGs go to a card). Iteration 8 raised one WARNING and no BLOCKER; that WARNING and one NIT are left for a follow-up card (named below and in the plan). No code changed after iteration 8's review; one plan sentence was corrected (documentation only, disclosed here).
**Total findings:** 31 (0 BLOCKERs, 10 WARNINGs, 1 CONVENTION, 20 NITs)
**Fixed:** 22 (9 of 10 WARNINGs, the CONVENTION, 12 NITs) | **Deferred:** 8 NITs | **Left for a card:** 1 WARNING, 1 NIT | **Asked:** 0

Validation note: the canonical helper cannot run on this box (no yarn/npm); substituted by the per-file branch-vs-control comparison above, as in the 8227, 8232 and 8309 proofs.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] publish-r2.ps1 help header does not say where node comes from --> FIXED (36b3e0ef88)
- [NIT] the runtime line printed on every call --> FIXED (once per run)
- [NIT] refusal claimed a %LOCALAPPDATA% search where there is none --> FIXED
- [NIT] tests missed no-LOCALAPPDATA and the board path's stderr --> FIXED

#### Iteration 2
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 3 NITs
- [WARNING] the node that checks a release could come from the board runtime's writable copy --> FIXED (788a8169f8: dropped; app's node only)
- [WARNING] refusal-words test only grepped source --> FIXED (evaluates the real assignment both ways)
- [CONVENTION] once-flag not declared up front like the script's other flags --> FIXED
- [NIT] "node is not on PATH" wrong when only a shim is there --> FIXED
- [NIT] a broken file at the path counts as found --> DEFERRED: fails safe at the check (refuses as undecided), now said in the comment
- [NIT] empty -File argument quirk in the test --> FIXED (sentinel)

#### Iteration 3
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
- [WARNING] the app's folder is just as user-writable, so "installer-placed" is no trust boundary --> FIXED (6ea1d5ae29: used only while Authenticode Valid and signed by OpenJS Foundation)
- [WARNING] help over-claimed what is guaranteed --> FIXED (help, comment, plan say what is checked)
- [NIT] first-call regex in the order test is line-order, not run-order --> DEFERRED: the script runs top to bottom; the test title now says line order
- [NIT] no LOCALAPPDATA-points-nowhere fixture --> DEFERRED: covered by the empty-folder and no-LOCALAPPDATA cases

#### Iteration 4
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] the signature gate is no boundary against code that can write the folder (DLL planting beside a signed node, check-to-run gap) --> FIXED (4b8e13cd58: stated in help, comment, plan; not claimed)
- [WARNING] the signature read is outside -NodeTimeoutSec --> FIXED (stated; measured 0.5 s online; offline not measured)
- [NIT] the once-line keeps only the first verdict --> DEFERRED then resolved by iteration 6's single path
- [NIT] "node.exe on PATH" off Windows is "node" --> FIXED (help says executable)
- [NIT] up to 0.5 GB of copies on CI --> FIXED in iteration 6 (one copy per run, hard links)

#### Iteration 5
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] the shim assertion matched a hard-coded phrase and could not fail --> FIXED (4ad8c90f01: the line names the shim only when there is one; tested both ways)
- [NIT] issuer not pinned --> FIXED (stated)
- [NIT] no Authenticode cmdlet off Windows would throw raw --> FIXED (guarded: nothing used)
- [NIT] comment carried review-round history --> FIXED (trimmed)

#### Iteration 6
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
- [WARNING] no test proved the publisher clause (an empty file fails on status alone) --> FIXED (872ee59d91: a copy of cmd.exe, Valid from "Microsoft Windows", is refused; a mutation removing the clause turns exactly that test red)
- [WARNING] list-plus-once-flag could log a different binary from the one returned --> FIXED (one path, $KosmosAppNode)
- [NIT] the no-cmdlet arm is untested --> DEFERRED: both Windows PowerShells have the cmdlet; the arm is a plain string
- [NIT] refusal words on a host that cannot check --> DEFERRED: accurate enough; the stderr line says the real reason
- [NIT] repeated 80 MB copies --> FIXED (one per run)

#### Iteration 7
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
- [WARNING] the signed-node probe did not drop PSModulePath for 5.1 (as the harness and #7951 do) --> FIXED (bb60504cbe). Not reproduced on this box (a fake PS7 module did not stop 5.1's own cmdlet); the fix follows the documented convention.
- [NIT] help promised a line even when the file is absent --> FIXED
- [NIT] the no-cmdlet arm untested --> DEFERRED (as iteration 6)
- [NIT] test header said "list" --> FIXED
- [NIT] a throwing signature read surfaced raw under Stop --> FIXED (try/catch: no signature)

#### Iteration 8
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
- [WARNING] a throwing read (5.1 with PS7's module path) reports "unreadable", not the exception's cause --> LEFT FOR A CARD (fleet 8-round cap; fails closed)
- [NIT] the verdict is re-read on each of 2 to 4 calls rather than cached --> LEFT FOR A CARD (with the WARNING)
- [NIT] plan said the board runs this node; it runs a copy of the same download --> FIXED (plan only, after the review)
- [NIT] once-per-run not tested on the signed path --> DEFERRED: the code path printing the line is the same for both verdicts

### Final Ledger

| # | Iter | Category | Description | Status | Resolution |
|---|------|----------|-------------|--------|------------|
| 1 | 1 | WARNING | help silent on node source | FIXED | 36b3e0ef88 |
| 2 | 2 | WARNING | board runtime copy trusted | FIXED | 788a8169f8 |
| 3 | 2 | WARNING | refusal words only grepped | FIXED | 788a8169f8 |
| 4 | 2 | CONVENTION | flag not declared up front | FIXED | 788a8169f8 |
| 5 | 3 | WARNING | folder is no trust boundary | FIXED | 6ea1d5ae29 (signature gate) |
| 6 | 3 | WARNING | help over-claimed | FIXED | 6ea1d5ae29 |
| 7 | 4 | WARNING | gate is not a boundary vs folder writers | FIXED | 4b8e13cd58 (said, not claimed) |
| 8 | 4 | WARNING | signature read outside timeout | FIXED | 4b8e13cd58 (said, measured) |
| 9 | 5 | WARNING | shim assertion could not fail | FIXED | 4ad8c90f01 |
| 10 | 6 | WARNING | publisher clause untested | FIXED | 872ee59d91 (+ mutation control) |
| 11 | 6 | WARNING | list could log the wrong binary | FIXED | 872ee59d91 (one path) |
| 12 | 7 | WARNING | probe kept PSModulePath | FIXED | bb60504cbe |
| 13 | 8 | WARNING | throwing read says "unreadable" | CARD | 8-round cap; fails closed |
| 14 | 8 | NIT | verdict re-read per call | CARD | with #13 |

### NITs (non-blocking, across all iterations)
- Listed per iteration above: 12 fixed, 8 deferred with reasons, 1 left for the card.

### Strengths (across all iterations)
- PATH's real node still wins and the shim is still skipped; both callers unchanged (every iteration).
- Fails closed in every branch: no file, unreadable or throwing signature, not Valid, another publisher, no cmdlet (iterations 5 to 8).
- The trust claim matches the code: it says what the gate proves and what it does not (iterations 4 to 8).
- Tests run the real function and assignments under the script's own Stop and StrictMode, with real signed, other-publisher and unsigned binaries and a CI-only guard against silent skips (iterations 6 to 8).
