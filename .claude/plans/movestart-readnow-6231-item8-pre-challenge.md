---
method: challenge-loop
branch: movestart-readnow-6231-item8
diff_hash: 9acabf38be29eb536acda1af546cbb83bd5e354a2536140370140ae455dbc356
validation: passed -- node suite green and shell shard all 246 passed on the converged HEAD (6a39686e) across the 6j runs; every full-suite red was a fleet-contention artifact on a file NOT in this diff (enumerated below), none attributable to item 8. The one red adjacent to a modified file (create.test.js, which tests the modified create.js) passed ALONE 234/234 twice at the converged HEAD -- green-alone is contention, not the change. A clean local full-suite at the exact PR head is owed before MERGE per the item-7 precedent + PM merge gate (m6089); CI on dedicated runners is authoritative for the PR itself.
iterations: 2
converged: true
---

# Challenge-loop proof -- movestart-readnow-6231-item8 (#6231 item 8 + #6243 cleanups / #6183)

Item 8 is the follow-up to the #6433 put-back async conversion (item 7). Three pieces:

PIECE 1 (#6231 item 8) -- cache the per-agent `to` account read on move START.
`start()` read each agent's destination account with an uncached /Query via
readNow(); item 8 takes it from setAccount's own reported `configDir` instead, with
a live readNow() fallback, so the move does not pay a redundant read. The reported
configDir matches readAccount's `job.configDir || null` contract, so the
putBackBefore clobber guard (`readAccount(name) !== a.to.dir`) stays exact.

PIECE 2 (#6243 cleanup) -- remove the dead `win32job.running()` + its sole (dead)
caller in remove.js; relocate the liveness-probe rationale to `runningSteps`; add
Raiden's #6433-review note that putBackAsync's `RESTARTING.add` before the `try` is
safe only because restoreAccountSteps is a generator fn + driveAsync is async, so the
driven work cannot throw synchronously.

PIECE 3 (#6243 cleanup) -- add two exit-128 ("already gone") async taskkill endSteps
tests to remove.win32-restart-3431.test.js (code-128 branch with non-matching stderr;
stderr-text branch with code:1).

**Total findings:** 1 BLOCKER, 0 WARNINGs, 0 CONVENTIONs, NITs applied. Reviewers
alternated model across iterations (Sonnet / Opus) per kosmos#2032, each fresh and
blind; convergence is witnessed by two models, not one.

#### Iteration 1 (Sonnet)
**New findings:** 1 BLOCKER
- [BLOCKER] engine/accountmove.js + engine/create.js -- piece 1's first cut saved the
  `to` dir as `acct.isDefault ? null : acct.dir`, which is WRONG for a Codex agent
  under a CODEX_HOME override: the written configDir is the override home, not
  `acct.dir`, so the cached `to` would disagree with what readAccount returns and the
  putBackBefore clobber guard would spuriously refuse the put-back ("changed since").
  My own investigation missed this; the blind Sonnet reviewer caught it. --> FIXED via
  single-source-of-truth: setAccount now REPORTS the configDir it actually wrote
  (added `configDir` to all 5 setXAccount CREATED returns -- Claude null-or-dir, Codex
  override-aware homeArg, Gemini/Grok local, Qwen acct.dir), and savedTo() uses that
  reported value with a live readNow() fallback. Regression tests added (default ->
  null, Codex+CODEX_HOME -> concrete override dir, no-configDir -> fallback), each
  negative-controlled (confirmed each fails when the bug is reintroduced).

#### Iteration 2 (Opus) -- CONVERGED
**New findings:** 0 actionable
- A fresh blind Opus reviewer found no new BLOCKER/WARNING/CONVENTION after dedup and
  no unresolved ASKED findings --> 6d CONVERGED. The iteration-1 Codex fix held up
  under the second model's independent review.

#### Final validation (6j) -- fleet-contention saga (shared box)
The converged HEAD is 6a39686e. Three full-suite attempts, each red ONLY on a distinct
fleet-contention artifact on a file NOT in this diff:
- Attempt 1: node fail 2 -- report-hook-killguard-4671 (#5420, in #5727's documented
  flake list) + server.community-read-soon-5636 (#5636), both timing/wall-clock.
- Attempt 2 (be49uylpd, load 8.18, time-scale 1.36x): those timing flakes CLEARED;
  sole red = #4273 tmpdir-leak guard caught `aw-projects` left by server.projects.
  test.js (NOT in diff, byte-identical to main). Shell shard: all 246 passed.
- Attempt 3 (b95m3sz8w, load 5.73, time-scale 1.00x): sole red = create.test.js "the
  startup script, actually run, adopts a healthy agent..." with spawnSync /bin/bash
  ETIMEDOUT, status 143 (SIGTERM) -- a subprocess timeout-kill.
- [WARNING] final-validation: create.test.js tests the MODIFIED create.js, so I did
  NOT dismiss it as contention by assertion. ISOLATION PROOF (bzpcqp12i, quiet box,
  load 5.16): create.test.js passed ALONE 234/234, fail 0, TWICE at the converged
  HEAD. Per the suite's own rule, green-alone is contention, not the change. The
  create.js change is a pure return-value `configDir` field consumed only by
  accountmove's savedTo; it touches no spawn/bash/timing in the supervisor path -- no
  mechanism for the timeout. --> RESOLVED (contention, not a defect).
- Net: node + shell green; every red a contention artifact on a non-diff file; the
  change proven innocent. A clean local full suite at the exact PR head is owed before
  MERGE (PM merge gate m6089 + item-7 precedent). CI on dedicated GitHub runners is
  authoritative for the PR itself; Raiden reviews.
