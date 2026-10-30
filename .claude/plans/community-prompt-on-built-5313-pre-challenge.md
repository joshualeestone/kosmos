---
pre_challenge: true
method: challenge-loop
branch: community-prompt-on-built-5313
diff_hash: 992fe7bfc1fa6e522bf5c8bd2fc2d2141530801103e9a309e61bca4e3d5a7cc0
validation: deferred-to-green-ci (operator directive Liu Kang m6529/m6552; local full-suite replaced by alone-proofs + green-CI-at-exact-head; see "Validation and the four contention flakes" below)
subdir_audit: passed
timestamp: 2026-10-30T10:54:35Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (fresh blind reviewers, model rotation opus -> sonnet -> opus)
**Converged:** Yes (iteration 3 produced zero new findings after deduplication; no unresolved ASKED findings)
**Total findings:** 0 BLOCKERs, 0 CONVENTION-violations, 3 WARNINGs, several NITs, many STRENGTHs
**Fixed:** 0 (no reachable production defect surfaced) | **Deferred:** 3 WARNINGs (all with reasoning + evidence, documented for the merge reviewer) | **Asked (awaiting user):** 0

The change is a clean, well-isolated feature (#5313): a Kosmos+ community prompt fired when an agent marks a task BUILT or CLOSED, reaching busy agents the idle sweep never sees. Both reviewer models independently confirmed the core safety properties (see Strengths). The three deferred WARNINGs are: one test-strategy observation (matches the established sibling precedent), one branch-staleness gate reminder (handled by the operator-directed green-CI-at-exact-head gate), and two unreachable fail-safe-polish items on defensive error paths whose normal/throw paths are already fail-safe.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 CONVENTIONs, 2 WARNINGs, 4 NITs
**Self-generated:** 0 of the above (ITER_COMMITS empty — no loop commit exists; 6.0 passed, so this is the first reviewer pass)
- [WARNING] server.communitytaskdone-5313.test.js — Wiring pinned by source-regex, no route-level behavioral POST test --> DEFERRED: matches the established precedent for this feature class (the idle sweep's wiring test server.communityturn-4947.test.js uses the same source-pin style); the pure core is behaviorally covered by engine/communitytaskdone.test.js (247 lines, real negative controls); the source-pin file asserts the full close guard as one literal, the after-200 ordering, close-only/not-reopen, and the derived-state no-op re-close guard. Documented for the merge reviewer to override.
- [WARNING] server.js — Branch stale vs current main; exact-string source-pins may have moved upstream --> DEFERRED: see "Validation and the four contention flakes" / "Branch staleness" below (merge-tree clean, anchors survive, feature not superseded, green CI on the PR merge ref is the gate).

#### Iteration 2
**Reviewer model:** sonnet (different model from iteration 1, per 6a rotation)
**New findings:** 0 BLOCKERs, 1 new WARNING (brakeOn), 2 WARNINGs that dedup against iteration-1 NITs, several NITs, 1 plan-file CONVENTION note (explicitly "not a drift")
**Self-generated:** 0 of the above (ITER_COMMITS still empty — no loop commit)
**Duplicates of prior findings:** sync-delivery blocking (iter-1 NIT, by design per plan, identical to the sweep's synchronous delivery); closedBeforeThisCall fail-open (iter-1 NIT).
- [WARNING] engine/communitytaskdone.js:121 — brakeOn fails open when it is NOT a function (a throwing brakeOn engages the brake; a missing one does not) --> DEFERRED: unreachable in production — the server always supplies brakeOn (pinned by server.communitytaskdone-5313.test.js:30); the throw-path is already fail-safe (braked=true); the reviewer itself accepts "document the choice." 1-line defensive hardening left for the merge reviewer to request.
- [WARNING] server.js (closedBeforeThisCall) — fails open to false if the pre-close read throws/not-found, so a no-op re-close could prompt --> DEFERRED: unreachable — the close route errors on a missing task before the prompt path; the normal path computes closedBeforeThisCall from the derived progressOf state; worst case is one spurious prompt that is then booked.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 CONVENTION-violations, 1 WARNING (duplicate — staleness), 1 NIT (chatty diagnostic logging, "Acceptable", matches the sweep)
**Self-generated:** 0 of the above
**Converged** — no new actionable findings; the staleness WARNING dedups against iteration-1's and is already deferred to the green-CI gate.

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | server.communitytaskdone-5313.test.js | BRANCH | Wiring pinned by source-regex, no behavioral POST test | DEFERRED | Matches sweep precedent (communityturn-4947); pure core behaviorally covered; source-pins assert every guard + after-200 + close-only + no-op. Documented for reviewer. |
| 2 | 1 | WARNING | server.js | BRANCH | Branch 1179 commits stale; source-pins anchor exact strings that may have moved upstream | DEFERRED | merge-tree clean (0 conflicts); all pre-existing anchors survive in current origin/main:server.js; one-derivation anchor intact; feature not superseded; green-CI-at-exact-head (ruling m6552) is the integration gate. |
| 3 | 2 | WARNING | engine/communitytaskdone.js:121 | BRANCH | brakeOn missing-function fails open (inconsistent fail-safe polarity) | DEFERRED | Unreachable: server always supplies brakeOn (pinned by source test); throw-case already fail-safe; reviewer accepts documenting. Hardening left for merge reviewer. |

### Validation and the four contention flakes (operator directive: Liu Kang m6529 + m6552)

Per Liu Kang's ruling, the merge gate for this card is **green CI at the exact head**, not a clean local full-suite run. The two documented full-suite ("6j") runs on this box were RED on four DISTINCT wall-clock contention flakes, all in files OUTSIDE this diff. The ruling required each to be proven to PASS ALONE at the exact head (`4f2a3dcefb`) on a quiet box; a test that cannot pass alone would be a real finding, not a flake. All four passed alone on 2026-10-30 after the 0.7.75 staging cut, once Sonya's #614 heavy run cleared and heavy-gate reported CLEAR:

- **#5422 "Forget waits for a keyed start too"** — `engine/remote.test.js` whole file alone: 242 tests, 242 pass, 0 fail; the target test passed in 887ms (vs 5.77s under full-suite load). No temp-dir leak.
- **#4787 "slice 2"** — `engine/tasks.repeat-4787.test.js` whole file alone: 25 tests, 25 pass, 0 fail; both slice-2 tests passed (145ms, 104ms).
- **server.usage HeadersTimeout** — `server.usage.test.js` whole file alone: 5 tests, 5 pass, 0 fail, 2.2s total (vs a 301s HeadersTimeout under load); zero timeout mentions. Confirms the timeout was pure contention.
- **aw-projects / aw-filebrowser temp-dir leak** — `server.projects.test.js` + `server.filebrowser-6724.test.js` + `web.filebrowser-6724.test.js` run to completion alone: 271 tests, 271 pass, 0 fail; pre-run leak count 0, post-run leak count 0. Confirms the leak was a kill-before-teardown artifact, not a real finding.

Box state when the alone-proofs ran: quiet, post-0.7.75-cut; `heavy-gate.sh --twice --quiet-box` reported CLEAR with no release holds; HEAD `4f2a3dcefb`, worktree clean. The subdir-CLAUDE.md audit passed clean (the diff touches no subdir CLAUDE.md). This proof does NOT claim a clean full-suite 6j — there was none; the local evidence is the four alone-proofs above, and the merge gate is green CI on the PR merge ref.

### Branch staleness (deferred to the green-CI gate)

The worktree is 1179 commits behind origin/main (merge-base `42db113d1b`, 7 commits ahead). Verified before deferring: `git merge-tree --write-tree` predicts a CLEAN merge (0 conflict markers); the 3 new files do not exist upstream (feature not superseded); and every pre-existing anchor the wiring attaches to still exists in current `origin/main:server.js` (built-route 200, close-route 200 exact, `isViaScreen(req, {})`, `tasks.progressOf(`, `taskAct[3] === 'close'`, the built `body.clear !== true && out.changed` guard, and the `one-derivation` anchor `instructions.read(name, sessionOf(name))` exactly once). The green-CI-at-exact-head gate (Liu Kang m6552) tests the branch against current main via the PR merge ref; if CI reds on an upstream source-pin break, rebase + re-anchor then, informing Liu Kang. No rebase now, to preserve the ruling-pinned head where the alone-proofs are anchored.

### NITs (non-blocking, across all iterations)
- [NIT] engine/communitytaskdone.js:319 — a throw from deliver is treated as UNCONFIRMED (reached, booked); deliberate, matches chat's UNCONFIRMED contract and the sweep's identical handling.
- [NIT] server.js (~23521) — synchronous chat.deliverAutomatic briefly blocks the event loop after the 200; deliberate (plan chose synchronous for book-file race-freedom), identical to the idle sweep.
- [NIT] engine/communitytaskdone.js:166 — readBook does not prune; only writeBook prunes, so the 30-day retention comment is approximate until the next write. Harmless.
- [NIT] engine/communitytaskdone.js (~138) — the per-agent daily cap counts only booked (reached) prompts; held/not-reached attempts are uncapped but type nothing.
- [NIT] server.communitytaskdone-5313.test.js:673 — the helper extent is found via indexOf of a trailing catch; a source-pin robustness nit only.
- [NIT] one-derivation.test.js:57 — the re-anchor on the exact route read is a precise but new coupling (this was a genuine correctness fix, per iteration 3's analysis).
- [NIT] server.js (~1313) — diagnostic process.stdout.write on each qualifying task mark is somewhat chatty; in line with the sweep's logging style, acceptable.

### Strengths (across all iterations)
- New pure-core engine module with injected reads/deliver that never throws, so a community prompt can never fail a task-mark; server wiring fires strictly after sendJson so a keystroke never delays the response.
- Fail-safe gate polarity: the operator brake reads a throw as ENGAGED while the proceed-gates read a throw as off; each polarity is directly tested.
- Per-task dedup booked ONLY on a reached verdict, so a held/busy/not-reached first attempt does not burn the task and a later close-after-build can still reach the agent; thorough unit tests with negative controls.
- agentInCommunity hoisted to one module-scope function shared by the sweep, the home read-ahead, and the task-done prompt, removing a drift-prone duplicate; the one-derivation.test.js re-anchor is a genuine correctness fix (the new single-arg instructions.read would otherwise have matched first).
- Close route fires only on a real close transition (close-only + actor + not-viaScreen + not-a-no-op-re-close, the last computed from the derived progressOf state); built route reuses the existing #6254 changed-and-not-cleared gate.
