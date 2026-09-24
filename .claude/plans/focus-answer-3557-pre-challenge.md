---
pre_challenge: true
method: challenge-loop
branch: focus-answer-3557
diff_hash: ac5cc8ac2a0de53be6a754548c9410564e73c5f68509319726e560cd3df8db35
validation: passed (change-relevant); full `yarn test` gate unavailable on this Mac (unagreed Xcode license blocks tools/test-served-verify.sh server boot) and the full node suite shows contention-only reds under the fleet 5.5-migration load
subdir_audit: passed
timestamp: 2026-09-24T13:25:28Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 7 blind review passes (model-alternated opus/sonnet), plus a 6.0 initial-validation pass and a 6j final-validation pass.
**Converged:** Yes -- iteration 7 produced zero new BLOCKER/WARNING/CONVENTION findings; 6j then caught one real regression, fixed and re-validated.
**Total findings:** BLOCKER 1 (env, 6.0), WARNING 8, CONVENTION 1, NIT 6, plus 1 synthetic 6j regression.
**Fixed:** 10 | **Deferred:** 3 | **Asked:** 0

### The change

Card #3557: in the needs-you answer flow, `detail(A) -> back -> answer(B)` left keyboard focus on
`<body>` instead of the composer `#d-say`. Root cause (diagnosed with the render-thread fixture +
a focus tracer): the answer button sits in a card torn down on panel-open, so focus falls to
`<body>` AFTER paint 1 focused the composer; the focus intent was consumed on paint 1, and the
recovery paint read a STALE `say.disabled`. Fix: a TIME-BOUNDED answer-focus intent
(`ANSWER_WANTS_FOCUS` + `ANSWER_WANTS_FOCUS_AT` stamped on first observation with `performance.now()`
+ `ANSWER_FOCUS_WINDOW_MS` = 750ms), enabling the composer from live `presence` and re-focusing only
a `<body>` steal within the window; disarmed on any `openDetail`, on a different-agent open, on a
failed open, and when the agent is off. Full design in `focus-answer-3557.md`.

### Verification path (important)

`render-thread` is NOT in the CI browser-checks allowlist (`KOSMOS_BC_CI_ALLOWLIST`) -- it SENDS, so
it runs only at the headed release cut (3b), not in CI. The verification here is the LOCAL headless
run of `docs/browser-checks/render-thread.js` against the `thread-server.js` fixture: the
focus-to-composer assertion (a DOM-state `activeElement.id` check, headless-robust) flips FAIL
(`activeElement is (body)`) -> PASS, re-confirmed after every iteration. The assertion is active on
`main` (this makes it green); the `render-thread-3552` cut branch's temporary focus SKIP citing
#3557 can be dropped once this lands.

### Environment note (why `validation` is not a bare "passed")

- The full `yarn test` gate cannot complete on this Mac: `tools/test-served-verify.sh` cannot boot a
  server (unagreed Xcode license, `sudo xcodebuild -license`). Machine-wide, macOS-specific,
  unrelated to this pure-JS diff.
- The full node suite, run during 6j under the fleet-wide 5.5-migration load, showed 66-110 reds
  that VARY run-to-run and are all server/engine/machine-state/account/provider tests -- none touch
  focus/renderStale/openDetail. Sampled failing files (`supervisor.provider-key-inject-3296`,
  `server.depends-on-claude-2096`) PASS in isolation (16/16). This is the documented "a red that is
  green alone is contention" case.
- The one real regression 6j found (the openDetail 4200-char-slice test, below) was fixed and
  re-verified passing in isolation.

### Per-Iteration Breakdown

#### Iteration 0 (6.0 initial validation)
**Reviewer model:** n/a (helper) · **New:** 1 BLOCKER (env) · **Self-generated:** 0
- [BLOCKER] initial-validation -- `yarn test` served-verify step cannot boot a server (Xcode license) --> DEFERRED (environment, unrelated; change is covered by render-thread + node lift tests)

#### Iteration 1
**Reviewer model:** opus · **New:** 1 WARNING, 2 NIT · **Self-generated:** 0
- [WARNING] indefinite intent liveness re-introduced a later-visit yank hazard + falsified the intent-set comment --> FIXED (06b2f261: bound to settle/mismatch/off)
- [NIT] EXPECTED-table doc-only --> DEFERRED (pre-existing); [NIT] stale line ref --> FIXED

#### Iteration 2
**Reviewer model:** sonnet · **New:** 2 WARNING, 1 NIT · **Self-generated:** 1 (the intent block, this loop's own)
- [WARNING] level-triggered body check could not tell steal from deliberate blur -> 5s poll could yank; [WARNING] same-agent leave/return re-fires --> both FIXED (95035eed: time window)
- [NIT] plan filename timestamp --> DEFERRED (dominant repo pattern)

#### Iteration 3
**Reviewer model:** opus · **New:** 1 WARNING, 2 NIT · **Self-generated:** 1
- [WARNING] window anchored to the PRESS folded in async fetch latency (slow read -> silent no-op) --> FIXED (73333dee: anchor to first observing paint)
- [NIT] Date.now -> performance.now (monotonic); [NIT] symbolic say.disabled ref --> both FIXED
- [WARNING] clean-flow has no dedicated assertion --> DEFERRED (shared code path with the covered detail-flow assertion; documented)

#### Iteration 4
**Reviewer model:** sonnet · **New:** 1 WARNING, 2 NIT · **Self-generated:** 1
- [WARNING] failed openDetail left the intent dangling --> FIXED (0092a5ac: disarm in the failure branch)
- [NIT] `!activeElement` defensive keep; [NIT] plan timestamp --> both acknowledged/deferred

#### Iteration 5
**Reviewer model:** opus · **New:** 1 WARNING, 1 NIT · **Self-generated:** 1
- [WARNING] clock never starts if every paint fails its fetch, then a later revisit re-fires --> FIXED (0cc5919e: reset the intent at the top of openDetail; generalizes over all leave/return paths)
- [NIT] inaccurate clean-flow comment --> FIXED (softened to measured facts)

#### Iteration 6
**Reviewer model:** sonnet · **New:** 1 WARNING · **Self-generated:** 1
- [WARNING] 2000ms window overlapped the 5s poll ~40% -> a deliberate blur in-window could be reversed --> FIXED (60409b9c: window 2000ms -> 750ms; documented residual)

#### Iteration 7
**Reviewer model:** opus · **New:** 0 · **Self-generated:** 0
- **Converged** -- design confirmed correct and complete across clean flow, poll interleave, same-agent reopen, different-agent open, off-presence, deliberate blur, failed/aborted open. Only STRENGTHs.

#### 6j Final validation
- Full node suite caught a real regression the per-iteration lift tests missed: the iteration-5 openDetail reset (above the `d-account-msg` clear) pushed that clear past the first-4200-char window `server.test.js` slices to pin it --> "openDetail no longer clears the account message on a switch" failed.
- [BLOCKER] final-validation regression --> FIXED (e7ab7e92: moved the reset BELOW the d-account-msg clear; offset unchanged; functionally identical). Re-verified: the test passes in isolation; render-thread PASS; web lift tests green.

### NITs / deferrals
- Clean-flow focus assertion: deferred (shared code path with the covered assertion; a second harness flow is scope/flakiness risk).
- `!document.activeElement` guard: kept as deliberate defensive code.
- Plan filename timestamp: matches the dominant repo pattern (965/1261 plans omit it).

### Strengths (final state)
- Intent life bounded by three cooperating disarm paths (750ms window, reset-on-any-open, failed-open disarm) that cover each other's gaps.
- Focusability from live `presence`, composer enabled before focus; only a `<body>` steal recovered, so deliberately-placed focus is never yanked.
- Payload isolation correct (`body.presence` read only for the intent's agent); monotonic clock; safe `=== 0` sentinel.
- Verification honestly scoped (render-thread not in CI; env + contention reds documented and shown green in isolation).
