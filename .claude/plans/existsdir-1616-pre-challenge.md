---
pre_challenge: true
method: challenge-loop
branch: existsdir-1616
diff_hash: fe33830d647f06b57245ce74ba4fdeec628182d1fc15f7b8633ab4f85c98d66e
validation: passed
subdir_audit: passed
timestamp: 2026-09-02T00:48:49Z
iterations: 5
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 5
**Converged:** Yes
**Total findings:** 21 (0 BLOCKERs, 3 WARNINGs, 6 CONVENTIONs, 12 NITs)
**Fixed:** 20 | **Deferred:** 1 | **Asked (awaiting user):** 0

**Process disclosures, so the record matches what happened:**
- Step 6.0 (initial validation) was NOT run before iteration 1: the repo's validation command
  is the full suite, and a fleet-wide suite hold was in force (a colleague's browser-gate
  bisect on main) from 18:07 to 19:13 CDT. Per-file suites were green throughout, and the
  full suite ran as soon as the hold lifted (EXIT_CODE=0 at 1a385a53 and again at 46d61489).
- The canonical validation helper fails closed on this repo tonight (no lockfile, so it
  routes to pnpm and looks for a `typecheck` script that does not exist). Per Splinter's
  broadcast, the JS runner was pinned to yarn after sourcing for the 6j run; it runs the
  identical canonical sequence. Disclosed here as required.
- Iteration 5 returned only NITs; three were applied after convergence with per-file runs
  green (44fda20f). The 6j gate ran on that commit.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 1 WARNING, 2 CONVENTIONs, 4 NITs
- [WARNING] docs/browser-checks/live-connect.js:83 -- tmux spawn gate asks existsSync under a name the matcher does not key on, inside the swept tree --> FIXED (bd9348f0: isRunnable, matcher widened to bare tmux|claude|codex, line planted in the control)
- [CONVENTION] engine.runnable-not-directory.test.js:200 -- header asserts the sites are live in one sentence and closed in the next --> FIXED (bd9348f0)
- [CONVENTION] engine/create.js:1720 -- helper block inserted between binPaths and its doc comment --> FIXED (bd9348f0: moved above, renamed runnerRunnable)
- [NIT] engine.runnable-not-directory.test.js:262 -- per-line sweep gap undisclosed --> FIXED (bd9348f0)
- [NIT] engine/create.runner-dir-1616.test.js:97 -- tmux arm drives one wrong shape --> FIXED (bd9348f0)
- [NIT] engine.runnable-not-directory.test.js:1924 -- counts in prose disagree with arrays --> FIXED (bd9348f0)
- [NIT] engine/create.js:1733 -- helper named for presence, defined as runnability --> FIXED (bd9348f0: runnerRunnable)

#### Iteration 2
**New findings:** 0 BLOCKERs, 2 WARNINGs, 2 CONVENTIONs, 3 NITs
- [WARNING] engine/create.js:1706 -- lazy-require rationale the code does not support --> FIXED (1a385a53: top-level require)
- [WARNING] engine.runnable-not-directory.test.js:262 -- gap disclosure phrased as hypothetical while live unswept presence checks exist --> FIXED (1a385a53: remote.js and live-connect.js named, with why they stay)
- [CONVENTION] .claude/plans/existsdir-1616.md:120 -- plan says engine-only after the driver edit --> FIXED (1a385a53)
- [CONVENTION] engine/create.js:2451 -- alternative.because wording not in the decided scope --> FIXED (1a385a53: recorded on the plan and at the site)
- [NIT] docs/browser-checks/live-connect.js:85 -- driver line exercised only by the cut --> recorded in the plan
- [NIT] engine/create.js:2434 -- bin loop has no DRY_RUN guard, comment implies uniformity --> FIXED (1a385a53, d947b5e8: comment counts the gates)
- [NIT] engine/create.runner-dir-1616.test.js:90 -- claude-loop control weaker than CREATED --> FIXED (1a385a53)

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 2 CONVENTIONs, 3 NITs
- [CONVENTION] engine/create.js:1701 -- comment counts four DRY_RUN gates, there are three --> FIXED (d947b5e8)
- [CONVENTION] .claude/plans/existsdir-1616.md:31 -- mechanism paragraph still describes the removed lazy require --> FIXED (d947b5e8)
- [NIT] three comment lines appended to rather than rewrapped --> FIXED (d947b5e8)
- [NIT] docs/browser-checks/live-connect.js:85 -- inline require beside a hoisted sibling --> FIXED (d947b5e8)
- [NIT] engine/create.runner-dir-1616.test.js:107,136 -- two weaker controls, asymmetry unstated --> FIXED (d947b5e8)

#### Iteration 4
**New findings:** 0 BLOCKERs, 0 WARNINGs, 1 CONVENTION, 3 NITs
- [CONVENTION] engine/create.js:1748 -- binPaths still lazy-requires runners twice beside a module const --> FIXED (46d61489)
- [NIT] engine.runnable-not-directory.test.js:281 -- qualifier accepts one dotted level, undisclosed --> FIXED (46d61489)
- [NIT] engine.runnable-not-directory.test.js:273 -- census omits reporthook.js --> FIXED (46d61489)
- [NIT] docs/browser-checks/live-connect.js:84 -- comment states an unmeasured failure as fact --> FIXED (46d61489: "would fail")

#### Iteration 5
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Converged** -- no new actionable findings.
- [NIT] engine.runnable-not-directory.test.js:204 -- header says "cannot come back unseen" beside a list of ways it can --> FIXED after convergence (44fda20f: "the KNOWN spellings")
- [NIT] engine/create.js:1716 -- wrapper is a second spelling of runners.isRunnable --> DEFERRED: the wrapper carries the comment at the one place a reader of the gates looks, and the sweep is on the old spelling, which it does not affect
- [NIT] engine/create.runner-dir-1616.test.js:139 -- installJob control weaker than it could be --> FIXED after convergence (44fda20f: measured ok:true, asserted)
- [NIT] engine.runnable-not-directory.test.js:284 -- 144-column matcher line --> FIXED after convergence (44fda20f: named constant)

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | docs/browser-checks/live-connect.js:83 | tmux gate asks existsSync, unswept name | FIXED | bd9348f0 |
| 2 | 1 | CONVENTION | engine.runnable-not-directory.test.js:200 | self-contradicting header | FIXED | bd9348f0 |
| 3 | 1 | CONVENTION | engine/create.js:1720 | helper split binPaths from its doc | FIXED | bd9348f0 |
| 4 | 1 | NIT | engine.runnable-not-directory.test.js:262 | per-line gap undisclosed | FIXED | bd9348f0 |
| 5 | 1 | NIT | engine/create.runner-dir-1616.test.js:97 | tmux arm one shape | FIXED | bd9348f0 |
| 6 | 1 | NIT | engine.runnable-not-directory.test.js:1924 | counts disagree | FIXED | bd9348f0 |
| 7 | 1 | NIT | engine/create.js:1733 | helper misnamed | FIXED | bd9348f0 |
| 8 | 2 | WARNING | engine/create.js:1706 | unsupported lazy rationale | FIXED | 1a385a53 |
| 9 | 2 | WARNING | engine.runnable-not-directory.test.js:262 | live unswept sites unnamed | FIXED | 1a385a53 |
| 10 | 2 | CONVENTION | .claude/plans/existsdir-1616.md:120 | plan says engine-only | FIXED | 1a385a53 |
| 11 | 2 | CONVENTION | engine/create.js:2451 | alternative wording outside decision | FIXED | 1a385a53 |
| 12 | 2 | NIT | engine/create.js:2434 | DRY_RUN asymmetry implied uniform | FIXED | d947b5e8 |
| 13 | 2 | NIT | engine/create.runner-dir-1616.test.js:90 | weak claude control | FIXED | 1a385a53 |
| 14 | 3 | CONVENTION | engine/create.js:1701 | four gates counted, three exist | FIXED | d947b5e8 |
| 15 | 3 | CONVENTION | .claude/plans/existsdir-1616.md:31 | stale lazy-require paragraph | FIXED | d947b5e8 |
| 16 | 3 | NIT | (three files) | lines appended not rewrapped; inline require; unstated control asymmetry | FIXED | d947b5e8 |
| 17 | 4 | CONVENTION | engine/create.js:1748 | binPaths lazy-requires beside a const | FIXED | 46d61489 |
| 18 | 4 | NIT | engine.runnable-not-directory.test.js:281,273 | one-level qualifier; reporthook in census | FIXED | 46d61489 |
| 19 | 4 | NIT | docs/browser-checks/live-connect.js:84 | unmeasured claim as fact | FIXED | 46d61489 |
| 20 | 5 | NIT | engine.runnable-not-directory.test.js:204,284; create.runner-dir-1616.test.js:139 | header claim; long line; weak installJob control | FIXED | 44fda20f (after convergence) |
| 21 | 5 | NIT | engine/create.js:1716 | wrapper as second spelling | DEFERRED | carries the comment at the gates; sweep unaffected |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### NITs (non-blocking, across all iterations)
Listed per iteration above; one deferred (#21), the rest fixed.

### Strengths (across all iterations)
- The revert table reproduced independently by every reviewer: each site reverted to existsSync reds exactly one named arm plus the sweep; the early OpenAI gate reds by ORDER, the one observable that separates it from the loop gate (iterations 1 to 5)
- The fixture asserts its own premise before any arm runs, so no arm can pass vacuously (iterations 3, 4, 5)
- Load-order claim checked against the require graph: runners.js reads env only inside functions and requires only platform.js (iterations 2, 3, 4, 5)
- The sweep's controls run both arms, with a file-count floor so a broken walker cannot report clean (iteration 5)
- No regression across the bin-fixture suites; every fixture passed as a runner is executable (iterations 2, 4, 5)
