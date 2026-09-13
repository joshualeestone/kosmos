---
pre_challenge: true
method: challenge-loop
branch: win32-cli-verbs
diff_hash: 45a98fbb7464a50d9a70d7d973b5464bf4bcb4ecfd0375414822aa03fec4ae52
validation: passed
subdir_audit: passed
timestamp: 2026-09-13T07:10:00Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (opus, opus, sonnet).
**Converged:** Yes. Round 3 found NO NEW FINDINGS.
**Fixed:** every finding from rounds 1 and 2: 2 BUGs, 1 SAFETY, 1 TEST-GAP, 3 CONVENTIONs and 5 NITs. The plan's review log (`.claude/plans/win32-cli-verbs-20260912T2150.md`) records each one.
**Asked (awaiting user):** 0. The coordinator made the design calls:
- `kosmos` must never hang on any real invocation path;
- a presented agent token always means an agent, never the screen posture;
- a command never exits 0 on stdin that may have been truncated.

`diff_hash` is the sha256 of the raw bytes of `git diff origin/main HEAD -- . ':!.claude/plans/win32-cli-verbs-pre-challenge.md'`, computed with node over git's own output. It was first taken at `1ff79aa0` (143,681 bytes, `9cf88cb9...`). It was retaken at `807625db` after the macOS CI harness fix below (150,386 bytes, `45a98fbb...`), on origin/main `04e23b70`, 6 commits ahead and 0 behind. The pre-challenge-gate hook is not installed on this Windows box, so the recipe is written out here.

## Validation of record

All runs were on this box, with the Kosmos runtime node v24.19 via PowerShell, the schtasks guard (`NODE_OPTIONS=--require=C:\Users\joshu\kosmos-scripts\no-schtasks-preload.cjs`), and APPDATA/LOCALAPPDATA pointed at scratch.

- **Round 3 (reviewer):**
  - 11 files: the new and touched suites, team, whoami/server.test.js, engine.reachable, one-derivation and fixture-discipline. 471 tests, 44 unique failures, identical by name to a `git archive` of `04e23b70`.
  - Main showed one extra, fixture-discipline's `git ls-files` check, because the archive isn't a git repo.
- **Round 2 (builder):**
  - 30 files: 649 tests, 67 failures, identical by name to main (28 files, 604 tests, 67 failures).
  - The failures are bash-spawning `cli.*` tests, `sendertoken` #1761, `taskchat.992` and `feedbacksend`'s own-home scrub. They fail on this box on main too.
- **Block log:** every line comes from pre-existing suites the branch doesn't touch (`fixture-discipline`, `server.test.js`, `engine/tasks`, `server.task-message-768`, `server.world-outbox-1704`). The branch's new and touched test files add zero lines.
- **`tools/test-feedback-triage.sh`** (the Mac triage, under Git Bash): PASS.
- **No-hang measurements** with an open, never-written stdin:

| Invocation | Result |
|---|---|
| `powershell -File kosmos.ps1 reply --help` | exit 0, 1.6 s |
| `powershell -File kosmos.ps1 feedback write` | exit 2, 3.4 s |
| Claude Code PowerShell-tool shape | exit 0 / exit 2, under 3.5 s |
| Git Bash `reply --help` | exit 0, 0.2 s |
| Git Bash `feedback write`, no text | exit 2, 3.2 s |

- **Truncation probe (round 3):** `(printf 'PART1 '; sleep 5; printf 'PART2') | kosmos feedback write` exits 2 and saves nothing. A slow card list in triage still matches.

## Control runs

Every control went red. Each was a hand edit restored from a backup, with the diff checked unchanged afterwards.

| Control | Reverts | Tests red |
|---|---|---|
| R2-ENDED | quiet counts as ended | 3 |
| R2-TRIAGE | uses an unended card list | 1 |
| R2-BODYTOKEN | task-message route drops the body | 1 |
| BUG | `$piped = @($input)` restored | 2 |
| SAFETY | token check out of `isViaScreen` | 3 |
| TEST-GAP | a role teaches `kosmos handoff` | 1 |
| QUIET | stdin quiet limit removed | 1 |
| Roster-null | the 503 answer removed | 1 |
| (a) | `task message` dropped | 4 |
| (b) | `--help` guard removed | 3 |
| (c1) | `restart` taught | 1 |
| (c2) | `task reassign` taught | 1 |
| (c3) | Mac `snooze` verb | 1 |
| (c4) | `${cliShown} feedback publish` | 1 |
| (d) | server token lookup removed | 5 |
| (f) | triage `--since` broken | the Mac bash test fails |

## Iteration 1 (opus): 1 BUG, 1 SAFETY, 1 TEST-GAP, 1 CONVENTION, 3 NITs

- **BUG:** `kosmos.ps1`'s `$piped = @($input)` hung `powershell -File` with an open stdin on every verb. Now the ps1 never reads `$input`, and node reads stdin only for `feedback write` with no text and `triage --cards -`. Every real invocation path was measured.
- **SAFETY:** an agent token plus `Sec-Fetch-Site` got "The person said" and skipped the valve. Now one helper, `presentedAgentToken`, and `isViaScreen` returns false whenever a token is presented.
- **TEST-GAP:** the agent-texts drift check no longer filters by known verbs.
- **CONVENTION:** stale plan control (e).
- **NITs:** a null roster with a token gives 503; the Windows task reader is stubbed in the e2e and valve-768 tests; the %TEMP% snapshot is moot.

## Iteration 2 (opus): 1 BUG, 2 CONVENTIONs, 1 NIT

- **BUG:** the 3 s quiet limit silently truncated a slow pipe, with exit 0. Now `readStandardInput` returns `{text, ended}`. `feedback write` refuses text that arrived without EOF, and `--cards -` waits for EOF up to 120 s, then exits 2.
- **CONVENTION 1:** two inline copies of the token expression, one of which shadowed the helper. Both now use `presentedAgentToken`.
- **CONVENTION 2:** a comment falsely said a process could not mint the screen posture. Reworded at all sites. The tokenless residual is recorded in the plan.
- **NIT:** task create and both parts routes now pass `body` to `isViaScreen`, and a body-token test was added.

## After convergence: macOS CI

- **Symptom:** PR #2975 at `180ee896` went red on both macOS test jobs (runs 34734953892 and 34734952688) in `server.paneless-sender.test.js`, with `ReferenceError: presentedAgentToken is not defined at resolveAgentSender`. The CI log lists all 7 of that file's tests as failed.
- **Cause:** the file is a source-extraction harness. It evaluated `resolveAgentSender` alone, read out of server.js, and round 1 made that function call the new module-scope helper `presentedAgentToken`. A harness break, not a server defect.
- **Why it was hidden locally:** the file was never in this branch's hand-picked run sets. It was not a by-name mask: on clean origin/main it passes 7/7 here, and on the branch it failed 7/7 once run.
- **Fix (`807625db`):** the harness extracts the root function plus every top-level server.js function it calls, transitively, read from the source. No copy of the helper lives in the test.
- **Other tests that read server.js source:** `server.test.js` (its evals are over web/index.html), `reachability-1502`, `server.agent-token-sender-570` and `server.remote-bind-1112`. All four run on branch and main; their only failure, remote-bind's declared-Host test, is identical on both.
- **Verification** (schtasks preload; APPDATA and LOCALAPPDATA in scratch):
  - 34 branch files: 680 tests, 68 failures.
  - 32 pre-existing files on clean origin/main: 635 tests, 68 failures.
  - Identical by name AND by normalised first error line.
  - Block log: the new and touched files add no lines.
- **Control:** the harness narrowed back to `resolveAgentSender` alone turns all 7 tests red. The diff was verified unchanged afterwards.

## Iteration 3 (sonnet): NO NEW FINDINGS

Round 3 re-verified each fix in the code and re-ran the truncation and no-hang probes:
- `ended` is set only on `'end'`;
- the timers are cleared in `finish()`;
- a TTY is never read;
- the helper call sites are algebraically identical to main;
- the comments match the code.
