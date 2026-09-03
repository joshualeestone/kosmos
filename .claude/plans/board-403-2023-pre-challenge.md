---
pre_challenge: true
method: challenge-loop
branch: board-403-2023
diff_hash: a1e7f7835eddc2a72c16a8288b0ad0010d19ba47a4d746310651e8c1128d8075
validation: passed
subdir_audit: passed
timestamp: 2026-09-03T16:27:17Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6 found zero BLOCKER/WARNING/CONVENTION; one optional NIT on pre-existing code, no change)
**Total findings:** 3 BLOCKER + a 9th broken test + 6 WARNING/coverage + several NIT
**Fixed:** all actionable | **Deferred/documented:** the retry two-writer race (co-gated routes; in-code comment), watchForAgent's unreachable 403 (in-code comment) | **Asked:** 0

kosmos#2023, the frontend FALLBACK render half: a protected-read 403 (a board with
no #1946 token) renders as a distinct NOT-SIGNED-IN state whose remedy LEADS with
"it fixes itself the next time Kosmos updates", with a full-path CLI footnote,
never bare and never an in-app button. A genuine non-403 failure still shows the
old "cannot read" copy. The engine self-heal is Angel's #2023(a), separate.

### Per-Iteration Breakdown

#### Iteration 1 (blind agent)
**New findings:** 3 BLOCKER (+ a 9th broken test surfaced in the fix).
- [BLOCKER] the branch broke 8 existing tests: the new-Function lift harnesses
  (web.board-empty, web.offline-note, server.test.js) did not inject the new
  BOARD_NEEDS_SIGNIN free variable --> FIXED (harnesses bind it), commit bacee385.
- [BLOCKER] BOARD_NEEDS_SIGNIN latched true across a later non-403 failure -->
  FIXED (tick's catch clears when nothing answered; loadProjects sets from got403
  on every path), bacee385.
- [BLOCKER] two missed render sites (paintAddAgents, the free-agent picker) still
  showed the generic cannot-read copy on a 403 --> FIXED, bacee385.
- Also fixed the copy to lead with self-heal (every user-action remedy was measured
  to fail on a real machine), and a 9th harness (server.test.js:7066) found by
  grepping every harness that lifts a flag-reader, commit 0edb954e.

#### Iteration 2 (blind agent)
**New findings:** 0 BLOCKER; 2 WARNING.
- [WARNING] paintFreeAgentPicker's signin branch had no assertion --> FIXED (a
  direct test with a flag-off control), commit 0edb954e.
- [WARNING] watchForAgent's 30s creation-poll shows a create-specific message on a
  403 --> DOCUMENTED as unreachable-by-construction (the poll runs only after a
  gated create write succeeded, so the session holds the token this same-origin
  poll carries), in-code comment, 0edb954e.

#### Iteration 3 (blind agent)
**New findings:** 0 BLOCKER; 1 WARNING + 1 NIT.
- [WARNING] the shared [data-board-retry] Reload handler re-polled only tick()
  (/api/status), so a Reload on the projects signin card cleared the shared flag
  without repainting #pj-list (stale up to 5s) --> FIXED (Promise.all([tick,
  loadProjects]); lifter injects loadProjects; a guard test asserts it), b6db6f2e.
- [NIT] plan verification line said "web units 38/38" (conflated the guard suites)
  --> FIXED, b6db6f2e.

#### Iteration 4 (blind agent) -- the best find of the run
**New findings:** 0 BLOCKER; 2 WARNING, both mutation-proven.
- [WARNING] the ANTI-LATCH FIX ITSELF was unguarded: mutating either unstick line
  (tick's catch, loadProjects's catch) left all 279 tests green --> FIXED three
  ways: a tick unit test driving 403->500->403->throw and reading the flag off
  globalThis; a loadProjects BROWSER scenario driving 403->network-abort (an abort,
  not a 500, so the catch's clear is isolated from the !res.ok branch's), proven to
  red under the catch mutation; commit 379fd40c.
- [WARNING] paintAddAgents' signin branch had no assertion --> FIXED (a direct test
  with a flag-off control), 379fd40c.

#### Iteration 5 (blind agent)
**New findings:** 0 BLOCKER/CONVENTION; 1 WARNING + 1 NIT.
- [WARNING] the retry handler calls tick() and loadProjects() concurrently, both
  writing the shared BOARD_NEEDS_SIGNIN --> DEFERRED, documented in-code: the two
  routes share the #1946 gate, so within one page load they cannot disagree on the
  403 answer; the only divergence window is a cookie arriving between the two
  fetches, which self-corrects on the next poll and never latches. Serialising
  would order a non-existent divergence. Commit 98f2856e. No behaviour change.
- [NIT] stale plan verification counts --> FIXED (281/281; browser-check 14/14),
  98f2856e.

#### Iteration 6 (blind agent) -- CONVERGED
**New findings:** 0 BLOCKER/WARNING/CONVENTION; 1 NIT (no change).
- [NIT] three archive/restore "could not re-read your projects just then" sentences
  are unreachable-by-403 (they run only after a PUT that shares the same gate
  succeeded), like watchForAgent, but lack its self-documenting comment. NO CHANGE:
  they are PRE-EXISTING lines this branch does not modify, and the reviewer framed
  the comment as optional ("if this branch gets touched again"). Adding it would
  expand the diff into unrelated code and reset the loop for a documentation nicety.
- The reviewer independently mutated the anti-latch guard (tick's catch) and
  confirmed the unit test reds; restored clean. Verified 281/281 + 14/14 + 18/18.

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | BLOCKER | test harnesses | new-Function lifts did not bind BOARD_NEEDS_SIGNIN (broke 8 tests) | FIXED | bacee385 |
| 2 | 1 | BLOCKER | web/index.html | BOARD_NEEDS_SIGNIN latched across a later non-403 failure | FIXED | bacee385 |
| 3 | 1 | BLOCKER | web/index.html | paintAddAgents + picker showed cannot-read on a 403 | FIXED | bacee385 |
| 4 | 1 | BLOCKER | server.test.js | a 9th harness (7066) lifting paintFreeAgentPicker unbound the flag | FIXED | 0edb954e |
| 5 | 2 | WARNING | server.test.js | picker signin branch had no assertion | FIXED | 0edb954e |
| 6 | 2 | WARNING | web/index.html | watchForAgent 403 site | DOCUMENTED (unreachable) | 0edb954e |
| 7 | 3 | WARNING | web/index.html | retry handler re-polled only agents, not projects | FIXED | b6db6f2e |
| 8 | 3 | NIT | plan | web-units count conflated the guard suites | FIXED | b6db6f2e |
| 9 | 4 | WARNING | web/index.html | the anti-latch fix itself was unguarded (mutation-proven) | FIXED | 379fd40c |
| 10 | 4 | WARNING | server.test.js | paintAddAgents signin branch had no assertion | FIXED | 379fd40c |
| 11 | 5 | WARNING | web/index.html | retry two-writer race on the shared flag | DEFERRED (documented; co-gated, self-correcting) | 98f2856e |
| 12 | 5 | NIT | plan | stale verification counts | FIXED | 98f2856e |
| 13 | 6 | NIT | web/index.html | archive/restore sentences lack the unreachable-by-403 comment | NO CHANGE (pre-existing, optional) | - |

### Verification
- node --test web.board-empty.test.js web.offline-note.test.js web.retry-feedback.test.js server.test.js -> 281/281 pass.
- render-board-signin-403-2023.js (real Playwright, sandboxed board) -> 14/14 pass, CHECK_RC=0, including the 403->abort anti-latch scenario, a 200 control (neither message), and a 500 control (cannot-read survives).
- browser-check guards (indexed / wired / reason-grep / selectors) -> 18/18 pass; EXPECTED_SITES 31->32 for the new check's single emit site.
- Anti-latch proven load-bearing by mutation in iters 4 and 6 (unit) and iter 4 (browser abort scenario); every mutation restored clean.

### Strengths
- The anti-latch FIX itself is guarded (iter 4): the question "would anything notice
  if this fix were removed" was asked of my own work, and the answer had been no.
- Controls return the dangerous answer: a 200 arm shows neither message, a 500 arm
  keeps cannot-read, a flag-off arm keeps the ordinary empty copy.
- The negative knowledge (why each user-action remedy was dropped; why the retry
  two-writer pattern is safe; why watchForAgent needs no branch) is written into the
  code, where it survives a restart and reaches the next editor.
