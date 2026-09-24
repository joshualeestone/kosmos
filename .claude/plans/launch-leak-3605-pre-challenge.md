---
pre_challenge: true
method: challenge-loop
branch: launch-leak-3605
diff_hash: 0a2fcb66fc0bf2e1ab6087530f798a6dadc4e277f531f7da0da1d782b70f864e
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T18:04:40Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes
**Total findings:** 16 reviewer findings (0 BLOCKERs, 15 WARNINGs, 1 CONVENTION) plus 4 synthetic validation reds, and 26 NITs
**Fixed:** 16 | **Deferred:** 0 | **Asked (awaiting user):** 0
**Synthetic validation reds:** 4, all contention (green alone, not branch-caused); final 6j run passed 8705/0

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/create.js:4443 — createAgent rollback rmSync could delete a real agent's job file under test; deletes were unguarded --> FIXED (commit 6e0fc945)
- [WARNING] engine/create.js:249-261 + plan — comment/plan claimed an unsandboxed test "fails at the line"; the create.js half surfaces as a failed step result plus stderr --> FIXED, claim deleted (commit 6e0fc945)
- [WARNING] tools.all-node-tests-considered-1934.test.js:79 — widened regex admitted narrowing flags before the counted set --> FIXED, only --require/--import allowed (commit 6e0fc945)
- [NIT] launch-guard.js — case-sensitive compare on darwin; URL pathname not decoded (both fixed); createWriteStream/openSync/cp unwrapped (fixed in iter 3); untested wrapped forms (fixed); source-text check scope; XML-escaped origin; HOME vs account home

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above
**Duplicates of prior findings (confirmed resolved):** 0
- [WARNING] test-support/launch-guard.js:52-63 — symlink/link callback and promise forms unwrapped --> FIXED (commit 14675ea1)
- [WARNING] engine/create.js:262 vs launch-guard.js:27 — two realLaunchAgentsDir derivations, not pinned equal --> FIXED, derivations matched and a pin test added (commit 14675ea1)
- [NIT] fail-open when os.userInfo throws; rm of the folder itself (fixed in iter 3)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, 5 NITs
**Self-generated:** 1 of the above
- [WARNING] test-support/launch-guard.js:37-44 — recursive delete of the folder itself allowed; rmdir forms missing --> FIXED (commit c4dadcfe)
- [WARNING] test-support/launch-guard.js:3-7 + plan — open/createWriteStream/cp/truncate unwrapped while header and plan claimed every writer --> FIXED, wrapped and claims narrowed to the WRITERS list (commit c4dadcfe)
- [WARNING] engine/create.js:4448 — hand-run (no preload) product deletes in remove.js/delete-leftover.js unguarded --> FIXED by naming the gap in the plan's Weakest premise; under run-tests.sh the preload covers them (commit c4dadcfe)
- [NIT] leak label "sandbox" -> "working dir" (fixed); URL pathname in message (fixed); os.userInfo stubs; source-text brittleness; a preload can narrow a run

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 1 CONVENTION, 1 NIT
**Self-generated:** 1 of the above
- [WARNING] engine/create.js:3341,4791 — mkdirSync of the real folder ran before the refusal; mkdir unwrapped --> FIXED, mkdir moved inside writePlistFile after the refusal, preload wraps mkdir (commit f3219ac5)
- [WARNING] test-support/launch-guard.js:39-46 — fs.open(path, cb) misread as a write open --> FIXED (commit f3219ac5)
- [CONVENTION] CLAUDE.md — no pointer in Repo-Specific Conventions --> FIXED, convention 6 added (commit f3219ac5)
- [NIT] rename out of the folder not covered from the source side (noted in the WRITERS comment)
- Validation after iter 4: red on tools/test-board-foreground-2956.sh EADDRINUSE (fixed port 18731, concurrent suites); green alone. Filed as kosmos#3616.

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 3 NITs
**Self-generated:** 2 of the above
- [WARNING] engine/create.js:4450 — rollback skip only pinned by a source regex --> FIXED, removeJobFileForRollback extracted and tested with a recorder (commit 334873b1)
- [WARNING] test-support/launch-guard.js:40 — ancestor recursive rm/cp and nested recursive mkdir not caught --> FIXED (commit 334873b1)
- [NIT] NODE_TEST_CONTEXT inherit wording (fixed); HOME vs account home at the leak snapshot (comment added); trailing "$@" on the run line (pre-existing, noted)
- Validation after iter 5: red on server.supervisor-refresh ENOTEMPTY under load 10; green alone 3/3 with the preload and 1/1 without.

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 1 NIT
**Self-generated:** 0 of the above
- [WARNING] engine/create.js:255-260 — NODE_TEST_CONTEXT choice diverges from live-execution.js with no cross-reference --> FIXED, points at win32job.js's stated reason (commit a80262a2)
- [NIT] launchagent_leak_origin sed quit never fired (fixed)
- Validation after iter 6: red on test-board-foreground-2956 again, two other agents' suites measured running concurrently (kosmos#3616).

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0 of the above
**Converged** — no new actionable findings.
- 6j final validation attempt 1: red on server.supervisor-refresh ENOTEMPTY and tools.release-gate under concurrent suites; both files green alone with the preload. Attempt 2: PASSED, 8705 tests, 0 fail, audit clean.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | engine/create.js:4443 | BRANCH | rollback delete of real plist under test | FIXED | 6e0fc945 |
| 2 | 1 | WARNING | engine/create.js:249-261 | BRANCH | comment overclaims "fails at the line" | FIXED | 6e0fc945 |
| 3 | 1 | WARNING | tools.all-node-tests-considered-1934.test.js:79 | BRANCH | regex admits narrowing flags | FIXED | 6e0fc945 |
| 4 | 2 | WARNING | test-support/launch-guard.js:52 | SELF | symlink/link callback+promise unwrapped | FIXED | 14675ea1 |
| 5 | 2 | WARNING | engine/create.js:262 | BRANCH | two unpinned realLaunchAgentsDir derivations | FIXED | 14675ea1 |
| 6 | 3 | WARNING | test-support/launch-guard.js:37 | SELF | folder-itself delete; rmdir missing | FIXED | c4dadcfe |
| 7 | 3 | WARNING | test-support/launch-guard.js:3 | BRANCH | open/stream/cp/truncate unwrapped; overclaim | FIXED | c4dadcfe |
| 8 | 3 | WARNING | engine/create.js:4448 | BRANCH | hand-run product deletes outside create.js | FIXED (gap named in plan) | c4dadcfe |
| 9 | 4 | WARNING | engine/create.js:3341 | BRANCH | mkdir before refusal; mkdir unwrapped | FIXED | f3219ac5 |
| 10 | 4 | WARNING | test-support/launch-guard.js:39 | SELF | fs.open(path, cb) misread | FIXED | f3219ac5 |
| 11 | 4 | CONVENTION | CLAUDE.md | BRANCH | no convention pointer | FIXED | f3219ac5 |
| 12 | 5 | WARNING | engine/create.js:4450 | SELF | rollback skip only regex-tested | FIXED | 334873b1 |
| 13 | 5 | WARNING | test-support/launch-guard.js:40 | SELF | ancestor rm/cp, nested mkdir | FIXED | 334873b1 |
| 14 | 6 | WARNING | engine/create.js:255 | BRANCH | NODE_TEST_CONTEXT divergence uncited | FIXED | a80262a2 |
| 15 | 4-6 | BLOCKER (synthetic) | validation | BRANCH | contention reds (2956 port, supervisor-refresh ENOTEMPTY) | resolved: not branch-caused, green alone; #3616 filed | - |
| 16 | 6j | BLOCKER (synthetic) | final-validation | BRANCH | contention red, attempt 1 | resolved: attempt 2 PASSED | - |

### NITs (non-blocking, across all iterations)
- [NIT] tools/run-tests.sh:247 — comment says "any fs write"; only the WRITERS calls are wrapped (iteration 7)
- [NIT] test-support/launch-guard.js — mkdtemp and metadata writers (chmod/utimes/chown) unwrapped; none used against LaunchAgents today (iteration 7)
- [NIT] plan Weakest premise — engine/discover.js:1981 is a third hand-run product delete (gated on stopped && ours and live execution) (iteration 7)
- [NIT] CLAUDE.md convention 6 — say in a clause why it keys on NODE_TEST_CONTEXT, unlike convention 3 (iteration 7)
- [NIT] engine/create.js:258 — mid-sentence line break in the #3605 comment (iteration 7)
- [NIT] create.launch-refuse-3605.test.js — source-text scans can be evaded by an alias; the preload is the runtime backstop (iterations 1, 3, 7)
- [NIT] leak origin prints the XML-escaped value (iteration 1)
- [NIT] leak snapshot uses $HOME, the guards the account home (iterations 1, 5; comment added)
- [NIT] trailing "$@" on the run line can narrow a run (pre-existing, iterations 5, 7)

### Strengths (across all iterations)
- Diagnosis by measurement: the card's freeze-at-require theory was disproven with a two-arm run (current main writes 0, a pre-#3011 checkout writes 5) (iterations 3, 7)
- Two-layer guard: the preload covers the ~60 test-side writes, create.js covers hand runs and spawned children (all iterations)
- Tests cannot harm the machine: recorders installed before the guard wraps fs, refusal asserted before the call, allow-arm controls (iterations 1, 2, 3, 5, 6, 7)
- "Real" keyed on the account home, so HOME / AGENT_WORKFORCE_HOME sandboxes are left alone (iterations 3, 5, 7)
- Plan names its own coverage edges instead of implying full coverage (iterations 5, 6)
