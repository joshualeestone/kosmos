---
pre_challenge: true
method: challenge-loop
branch: keepawake-7416
diff_hash: 3cbdeefbd4fa3c258ff6c863db4c03a57594468925bc6fca381928d26738c4ae
validation: passed
subdir_audit: passed
timestamp: 2026-10-28T17:51:59Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7
**Converged:** Yes (iteration 7 raised no BLOCKER, WARNING or CONVENTION)
**Total findings:** 15 actionable (1 BLOCKER, 14 WARNINGs, 0 CONVENTIONs) and 21 NITs
**Fixed:** 11 | **Deferred:** 4 | **Asked (awaiting user):** 0

**Validation:** step 6.0 ran the touched test files locally (the full suite runs only through the queue on this
fleet); the full validation ran on Mortals for this exact diff (hash 5079ff8b0d89, passed 12:16 CDT) and 6j skipped on
that recorded clean entry. **Design:** Mona Lisa approved the shots (~/work/design-shots/kosmos-7416/) at 11:48 CDT.

**After convergence, unreviewed by a blind round:** 2153e6e9f8 adds two design-shot screens to
docs/browser-checks/mobile-shots.js (a helper plus two literal entries). Covered by the nine tests that read that file
(110/110) and by the full validation above.

**Rebased after convergence:** main gained #7500 (a hint on the start-at-sign-in row, the lines this branch's switch
follows). The branch was squashed onto its merge base (index identical to the reviewed tree) and rebased; the one
conflict kept both changes. The 104 touched tests pass on the result, and the full validation re-ran on Mortals for
this rebased diff.

**Self-generated:** counted by reading each cited line against this loop's own fix commits, not by the blame lookup.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 BLOCKER, 4 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [BLOCKER] web/index.html: machineSwitchClick's `fetch(how.url)` raised the #3957 non-literal fetch count to 22 and hid both routes from the route guard --> FIXED (6f3ef04d3a: each caller passes its own literal fetch)
- [WARNING] server.js: the sweep sat between the hold-stale comment and its code --> FIXED (6f3ef04d3a)
- [WARNING] server.js: nothing kept a test board from starting a real caffeinate --> FIXED (6f3ef04d3a: dryRunSpawn under AGENT_WORKFORCE_DRY_RUN)
- [WARNING] server.js: an env seam nothing set --> FIXED (6f3ef04d3a: removed)
- [WARNING] server.keepawake-7416.test.js: no test of the server wiring with a working card --> FIXED (6f3ef04d3a; a mutation of the tick reds it)
- [NIT] switches.fsync-5434 writer list --> fixed; [NIT] error handler wording after start --> fixed; [NIT] emoji in a comment --> fixed
- [NIT] web/index.html: the contraction in the hint --> DEFERRED: it is Mona Lisa's approved wording

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 4 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] server.js: the tick read `on` and ignored `ok` --> FIXED (c07c0912c6)
- [WARNING] engine/keepawake.js: a start failure's reason never reached the person --> FIXED (c07c0912c6: `because` on the route and the sleep row, a line on the page)
- [WARNING] engine/keepawake.js: up to 30 s of false "holding" after an outside kill --> DEFERRED: the child's `exit` event fires at once, not at the next tick
- [WARNING] server.js: no stop on shutdown --> DEFERRED: `-w <board pid>` ends caffeinate with the board, and the holder is one module-level instance
- [NIT] English copy beside windowsCopy; [NIT] `since` unexposed

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 3 NITs
**Self-generated:** 1 of the above (the `because` lifetime was written by iteration 2's fix)
- [WARNING] engine/keepawake.js: a failure reason stayed on screen after agents went idle --> FIXED (bfb0914bcb; mutation reds it)
- [NIT] the error code reached the Settings screen --> fixed (plain sentence)
- [NIT] dry-run gating --> DEFERRED: already gated; [NIT] 400 on a failed save --> DEFERRED: matches the sibling route

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 0 of the above
- [WARNING] server.js: a roster that could not be read (safeRoster's null) let go of the hold mid-turn --> FIXED (0294bd937b: engine pass() leaves the hold; mutation reds it)
- [WARNING] server.js: the PUT runs a pass inline --> DEFERRED: one roster read on switching on is what lets the answer say `holding` truthfully, and other routes read safeRoster on the request path
- [NIT] no test for an error after stop; [NIT] English copy

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
- [WARNING] engine/keepawake.js: a caffeinate that ends by itself left no reason --> FIXED (c2bbfff5f0)
- [NIT] first pass 30 s after start --> fixed (c2bbfff5f0: one pass at start)
- [NIT] holding before an async spawn error; [NIT] stop on close; [NIT] typographic quote --> not changed (the next repaint corrects the first; `-w` covers the second; the third is the approved wording)

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
**Self-generated:** 1 of the above (the unread-roster branch was written by iteration 4's fix)
- [WARNING] engine/keepawake.js: an unread roster kept the hold with no bound --> FIXED (7d61bc8893: ten passes, five minutes, as long as a stale self-report counts; mutation reds it)
- [WARNING] server.js: `holding` briefly stale in the PUT answer --> DEFERRED: same concern as iteration 5's async NIT
- [NIT] a failure line during an unread roster; [NIT] label repeated three times

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
**Converged** -- no new actionable findings.
- [NIT] `unread` not reset when the switch goes off; [NIT] `stop` exported and unused; [NIT] no backoff on a failing spawn; [NIT] a second regular snapshot() caller while the switch is on

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | web/index.html machineSwitchClick | BRANCH | non-literal fetch, #3957 ceiling | FIXED | 6f3ef04d3a |
| 2 | 1 | WARNING | server.js sweep | BRANCH | sweep under the hold-stale comment | FIXED | 6f3ef04d3a |
| 3 | 1 | WARNING | server.js KEEP_AWAKE | BRANCH | real caffeinate reachable from a test board | FIXED | 6f3ef04d3a |
| 4 | 1 | WARNING | server.js sweep | BRANCH | unused env seam | FIXED | 6f3ef04d3a |
| 5 | 1 | WARNING | server.keepawake-7416.test.js | BRANCH | no wiring test with a working card | FIXED | 6f3ef04d3a |
| 6 | 2 | WARNING | server.js keepAwakeTick | BRANCH | ok ignored | FIXED | c07c0912c6 |
| 7 | 2 | WARNING | engine/keepawake.js | BRANCH | start failure never shown | FIXED | c07c0912c6 |
| 8 | 2 | WARNING | engine/keepawake.js exit | BRANCH | 30 s false holding | DEFERRED | exit fires at once |
| 9 | 2 | WARNING | server.js | BRANCH | no stop on shutdown | DEFERRED | -w ends it |
| 10 | 3 | WARNING | engine/keepawake.js set | SELF | failure reason outlived the need | FIXED | bfb0914bcb |
| 11 | 4 | WARNING | server.js keepAwakeTick | BRANCH | unread roster let go mid-turn | FIXED | 0294bd937b |
| 12 | 4 | WARNING | server.js PUT | BRANCH | pass inline on the request | DEFERRED | truthful holding |
| 13 | 5 | WARNING | engine/keepawake.js exit | BRANCH | self-ended caffeinate silent | FIXED | c2bbfff5f0 |
| 14 | 6 | WARNING | engine/keepawake.js pass | SELF | unread hold unbounded | FIXED | 7d61bc8893 |
| 15 | 6 | WARNING | server.js PUT | BRANCH | holding briefly stale | DEFERRED | as #8/iter 5 |

### Outstanding questions (ASKED, still unresolved when the run ended)
- None.

### NITs (non-blocking, across all iterations)
- Contraction in the hint, approved wording (iteration 1)
- Hard-coded English beside windowsCopy; the setting is Mac only (iterations 2, 4)
- `since` tracked and unexposed (iteration 2)
- 400 on a failed save, as the sibling route (iteration 3)
- holding before an async spawn error; stop on close (iteration 5)
- label text repeated three times (iteration 6)
- `unread` not reset on switch-off; `stop` exported unused; no spawn backoff; a second snapshot() caller (iteration 7)

### Strengths (across all iterations)
- `caffeinate -i -w <board pid>`: idle sleep only, and a board that dies cannot leave the computer held awake (every iteration)
- Fails off: a missing, corrupt or unreadable setting reads off, and the switch is drawn only from a setting that was read (iterations 1, 3, 7)
- Working is the board's own card state, not a second derivation; tests use real fleet cards and a fake spawn (iterations 3, 5)
- Each new guard was shown to go red by a mutation before it was called tested (iterations 1 to 6)
