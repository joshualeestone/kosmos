---
pre_challenge: true
method: challenge-loop
branch: worldsw-lockout-3055
diff_hash: b85ddecfde665bb2f069bd7b2b5285ba66a188c1007c9ba8100329b8e32964bc
validation: passed
subdir_audit: passed
timestamp: 2026-09-14T16:48:17Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (plus the 6.0 initial validation pass)
**Converged:** Yes (iteration 3 found no BLOCKER/WARNING/CONVENTION)
**Total findings:** 1 BLOCKER, 4 WARNINGs, 2 CONVENTIONs, 3 NITs (+ 3 synthetic 6.0 integration findings)
**Fixed:** all blocking findings | **Deferred:** 1 NIT (acceptable-by-design) | **Asked:** 0

Change: kosmos#3055 (SEVERE lockout, render side) - the Kosmos switcher `#worldsw` is hidden
by default and `worldsFetch` used to fail closed on any non-ok `/api/worlds` (a not-signed-in
board 500s/403s after a broken multi-Kosmos switch), so a hard refresh permanently hid the
switcher and locked the user out with no way back. The fix persists the last-known world list
(localStorage) and renders the switcher from it on a failed read (honest stale note via the
switcher's own status banner, guarded by `WORLDSW_RECONNECTING`; render-once via `WORLDSW_STALE`;
an unconditional 8s self-heal retry that clears on live recovery; `worldswClose` preserves a
stale note). With no cache it stays hidden (today's clean single-world degrade). Plus an explicit
`worldswSwitch` 403 branch (the per-world board-token mismatch) with an honest, non-false-promising
message.

### Validation note (the full suite self-contends; isolation evidence stands)

`tools/run-tests.sh` runs `node --test-concurrency=0` (UNLIMITED concurrency) over 7534 tests
that boot boards, saturating the box internally, so a clean full run is NOT reachable on this
machine regardless of other agents (measured independently by PigeonPete: two solo full runs each
failed with ~59 identical board-boot/spawn TIMEOUT fails in board-lifecycle tests that pass in
isolation). Per the fleet ruling (contention only ever false-REDS, never false-greens, so an
isolation-green result stands), this change is validated by ISOLATION, and it is a client-side
change (web/index.html worldsw + a browser-check + the reason-grep counts) that touches NO
board-lifecycle code:

- ALL tests that exercise the change pass in isolation (controlled concurrency): 44/44 across
  web.world-import-agents-1704, web.world-switch-agents-1704, web.world-import-2563,
  browser-checks-reason-grep, tools.browser-checks-wired, browser-checks-indexed.
- The browser-check `render-worldsw-lockout-3055.js` passes headless (its control arm reds on
  origin/main's pre-fix page, so it is load-bearing).
- Zero fails in any file this change touches, across every run.
- The full-suite reds are the board-lifecycle self-contention timeouts, untouched by this change.
- `subdir_audit: passed`. No em dashes in any changed file.

### Per-iteration breakdown

#### 6.0 Initial validation
**New findings:** 3 synthetic (browser-check integration)
- [BLOCKER] browser-check not wired into the runner (#1387) --> FIXED: added to tools/browser-checks.sh
- [BLOCKER] emit lines not gate-quotable (#1864) --> FIXED: per-problem lines carry the `FAIL` prefix
- [CONVENTION] reason-grep emit-site counts (#1864) --> FIXED: EXPECTED_SITES 107->109, EXPECTED_CATCH_SITES 76->78 (deliberate, quotable)

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 WARNING, 2 NITs, 2 CONVENTIONs
- [WARNING] the 8s retry re-rendered the list every cycle while the board stayed down, dropping keyboard focus/scroll --> FIXED: render-once via WORLDSW_STALE
- [NIT] retry timer not cleared on a live-success read --> FIXED
- [NIT] worldswSetStale set text before unhide (role=status may not announce) --> FIXED: unhide-then-set
- [CONVENTION] WORLDS_RETRY_MS lacked a rationale comment --> FIXED
- [CONVENTION] em dashes in the browser-check + plan file --> FIXED

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING (both empirically verified against the built page)
- [BLOCKER] the self-heal retry could be permanently killed - the reschedule was gated on `!WORLDSW_RECONNECTING`, so a retry firing during a concurrent worldswReconnect dropped the chain and it never self-healed --> FIXED: reschedule unconditionally; only the render is guarded
- [WARNING] worldswClose unconditionally cleared the status banner, so a close/reopen while still offline wiped the honest stale note and the reopened stale list looked live --> FIXED: worldswClose preserves the banner when WORLDSW_STALE; browser-check arm D added

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 blocking (1 very-low NIT)
- [NIT] a rare edge where a transient `/api/worlds` failure mid-switch, then recovery, clears a now-moot manual-restart banner --> DEFERRED: acceptable-by-design (if the board recovered, showing the live list supersedes the stale guidance); the reviewer graded it "arguably acceptable"
**Converged** - traced the WORLDSW_STALE lifecycle both directions (no stuck-true/stuck-false), the retry-timer lifecycle, localStorage try/catch completeness, the 403 branch honesty; confirmed the browser-check control is load-bearing and the two prior fixes are pinned.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 6.0 | BLOCKER | tools/browser-checks.sh | BRANCH | new browser-check not wired (#1387) | FIXED | runner list |
| 2 | 6.0 | BLOCKER | render-worldsw-lockout-3055.js | BRANCH | emit lines not gate-quotable (#1864) | FIXED | FAIL prefix |
| 3 | 6.0 | CONVENTION | browser-checks-reason-grep.test.js | BRANCH | emit-site counts | FIXED | 109/78 |
| 4 | 1 | WARNING | web/index.html | BRANCH | retry re-render drops focus | FIXED | WORLDSW_STALE render-once |
| 5 | 1 | NIT | web/index.html | BRANCH | timer not cleared on success | FIXED | clearTimeout |
| 6 | 1 | NIT | web/index.html | BRANCH | a11y text-before-unhide | FIXED | unhide-then-set |
| 7 | 1 | CONVENTION | web/index.html | BRANCH | constant lacked rationale | FIXED | comment |
| 8 | 2 | BLOCKER | web/index.html | BRANCH | self-heal retry could die | FIXED | unconditional reschedule |
| 9 | 2 | WARNING | web/index.html | BRANCH | close/reopen wiped stale note | FIXED | preserve when WORLDSW_STALE |
| 10 | 3 | NIT | web/index.html | BRANCH | recovery clears moot manual banner | DEFERRED | acceptable-by-design |

### Strengths (across iterations)
- The browser-check control is load-bearing: it reds on origin/main's pre-fix page (the lockout) and on a naive always-show fix (the no-cache control arm), and passes on the branch.
- The WORLDSW_STALE lifecycle is sound both directions (no stuck-true/stuck-false); localStorage is fully try/catch-wrapped (private window degrades to prior hidden behaviour).
- The 403 branch is honest and does not false-promise a fix; it follows the existing 404/409 branch shape.

### Coordination (kept out of the shipped code)
PigeonPete owns the engine side: B = a new ungated `GET /api/worlds/names` (names-only + markers)
that this switcher's primary read points at as a fast-follow (localStorage as the deeper net);
A = accept the browser's held per-world token as same-account, ending the post-switch 403. This
PR is the standalone render-side net + the honest 403 message; both compose with B/A.
