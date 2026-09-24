---
pre_challenge: true
method: challenge-loop
branch: automations-recommender-assigner-2619
diff_hash: 387ed2beeb21ef097ecf01e5c1fca3bc38e365ff76e28c154c39e7b511ba30da
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T07:21:46Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 blind review passes, reviewer model alternated (sonnet, opus, sonnet, opus)
**Converged:** Yes (iteration 4 returned zero NEW actionable findings, no ASKED outstanding)
**Total findings:** 3 BLOCKER/WARNING-class actionable + several NITs across all iterations
**Fixed:** all actionable | **Deferred:** the non-actionable NITs (documented) | **Asked:** 0

Scope: this branch adds the Recommender and Assigner automations to Settings >
Automation as a SETTINGS + PERSISTENCE layer only. The automation behaviour
(consensus-recommend-implement; goal-to-task / idle-assign) is a documented separate
build. Per Splinter's directive (2026-09-24), the controls render DISABLED with a
"Not active yet" note so the product never presents an actionable control that does
nothing; the engine modules and GET/PUT routes are the persistence contract the
behaviour PR will wire up.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 1 BLOCKER, 1 WARNING, 1 NIT
**Self-generated:** 0 (no loop fix commit existed yet)
- [BLOCKER] server.js (routes) -- the one-field-per-PUT dispatch for /api/recommender-setting and /api/assigner-setting was proven only at the module layer; no HTTP-level route test (heartbeat has server.heartbeat-1722.test.js). --> FIXED (commit c191a609c): added server.recommender-assigner-2619.test.js, 11 tests booting the real board and exercising GET/PUT including guard-vs-on dispatch (guard precedence), fail-safe rejections, and rejected-write-leaves-value-unchanged.
- [WARNING] web/index.html -- the guard checkboxes were interactive from page load with no load-gate, so a click before the first GET resolved would PUT the stale HTML `checked` default. --> FIXED (commit c191a609c): added the same load-gate recToggleClick uses. (Later superseded: the controls became disabled in iter 2, removing the handler entirely.)
- [NIT] engine/worldenv.js -- the require-time store.ROOT-capture module enumeration did not list the two new modules. --> FIXED (commit c191a609c).

#### Iteration 2
**Reviewer model:** opus
**New findings:** 2 WARNINGs, 2 NITs
**Self-generated:** 1 (the guard-checkbox load-gate WARNING is on JS this loop added in iter 1)
**Duplicates of prior findings:** 0
- [WARNING] web/index.html saveRecommender/saveAssigner -- the client read the error reason from out.because, but the routes send it under out.error, so the specific reason was always discarded. --> RESOLVED by construction (commit 1f38225a6): the save paths were removed when the controls became disabled.
- [WARNING] web/index.html -- native guard checkboxes flip their own visual state on click before the handler runs; the REC_SAVING drop-guard, the not-loaded gate (recPaintGuards skips the active element), and the non-ok return all left a flipped checkbox uncorrected against an unchanged server value, violating the painted-from-server contract for the safety-critical guards. --> RESOLVED by construction (commit 1f38225a6): a disabled checkbox fires no change event, so there is no un-reverted state possible.
- [NIT] guardKeys published by the route but not consumed by the client. --> ADDRESSED (commit 1f38225a6): kept as a forward contract for the behaviour PR's live UI; softened the route-test comment to stop claiming the current UI depends on it.
- [NIT] read-error=500 is partial (matches heartbeat); no change needed.

Note: iteration 2 also folded in Splinter's product directive (2026-09-24): do not ship
a switch a person can turn on that does nothing. The controls now render DISABLED with a
"Not active yet" note; the guard checkboxes show their safe default (all on) but disabled;
the interactive paint/save JS was removed (a disabled control cannot be clicked, so the
wiring would be dead code). This is why both iteration-2 WARNINGs are resolved by
construction rather than by a targeted patch.

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 1 WARNING
**Self-generated:** 1 (the assertion was added by this loop in commit 1f38225a6)
**Duplicates of prior findings:** 0
- [WARNING] web.settings-nav.test.js -- the disabled-until-wired regression guard for the toggles used /\bdisabled\b/, which matches inside "aria-disabled" (the hyphen is a word boundary). The toggles carry both aria-disabled="true" and the real boolean disabled, so the assertion passed even with the real click-blocking attribute dropped -- the exact regression its comment says it exists to catch. Demonstrated live by the reviewer. --> FIXED (commit 4f9f4478f): switched to (?<!aria-)\bdisabled\b (applied to the toggles and, for uniformity, the guard checkboxes). Perturbation-verified: dropping the real `disabled` while keeping aria-disabled now fails the assertion; restore passes.

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs (2 non-actionable NITs)
**Self-generated:** 0
**Duplicates of prior findings:** 0
**Converged** -- zero NEW actionable findings; no ASKED findings outstanding.
- [NIT] write() is a lock-free read-modify-write, so two concurrent PUTs can lose an update. --> NOT ACTIONABLE: inherent to the file store and identical to heartbeat-setting.js; the one-field-per-PUT design prevents the intra-request guard-reset problem; cross-request loss is low risk for a single-operator board.
- [NIT] guardKeys is published but not consumed by the disabled UI. --> NOT ACTIONABLE: it is a real response field and a forward contract for the behaviour PR; the route test acknowledges it. Reviewer confirmed the iter-3 regex fix genuinely requires the real disabled attribute, the controls are genuinely inert (real disabled attrs, no reachable handler, no dead references), and the fail-safe guard coercion is correct and tested.

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | BLOCKER | server.js routes | BRANCH | no HTTP-level route test for the PUT dispatch | FIXED | c191a609c |
| 2 | 1 | WARNING | web/index.html | BRANCH | guard checkboxes had no load-gate | FIXED | c191a609c (later superseded by disable) |
| 3 | 1 | NIT | engine/worldenv.js | BRANCH | module enumeration missing the two modules | FIXED | c191a609c |
| 4 | 2 | WARNING | web/index.html | BRANCH | client read out.because, route sends out.error | RESOLVED | 1f38225a6 (save path removed) |
| 5 | 2 | WARNING | web/index.html | SELF | un-reverted guard-checkbox state on dropped/failed/not-loaded saves | RESOLVED | 1f38225a6 (controls disabled) |
| 6 | 2 | NIT | server.js / test | BRANCH | guardKeys published but unconsumed | ADDRESSED | 1f38225a6 (forward contract; comment softened) |
| 7 | 2 | NIT | server.js routes | BRANCH | read-error=500 partial (matches heartbeat) | NOTED | no change needed |
| 8 | 3 | WARNING | web.settings-nav.test.js | SELF | \bdisabled\b matches inside aria-disabled (false pass) | FIXED | 4f9f4478f (negative lookbehind, perturbation-checked) |
| 9 | 4 | NIT | engine/*-setting.js | BRANCH | lock-free read-modify-write can lose concurrent update | NOT ACTIONABLE | inherent, matches heartbeat, low risk single-operator |
| 10 | 4 | NIT | server.js / web | BRANCH | guardKeys unconsumed by disabled UI | NOT ACTIONABLE | real field, forward contract |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### Validation
- 6j final validation: full suite `bash tools/run-tests.sh` run twice. Each run showed a
  single red, and the two reds were in DIFFERENT files (tools.release-gate.test.js, then
  server.supervisor-refresh.test.js), both of which this branch never touches. The harness
  itself flags the release-gate red as contention (a concurrent tools/test-install.sh
  holding the install gate's fixed port). server.supervisor-refresh.test.js passes 4/4 in
  isolation. My own test files (recommender-setting, assigner-setting, route test,
  settings-nav) had zero failures in the full run. The reds are machine contention on a
  busy box (live board on :16180, load 3.69), not a regression from this change; CI on a
  clean runner will not have that contention.
- Affected suites run directly: engine/recommender-setting.test.js + engine/assigner-setting.test.js (17) + server.recommender-assigner-2619.test.js (11) + web.settings-nav.test.js (6) = 34, all pass. node --check server.js clean.

### Strengths (across all iterations)
- Fail-safe guard coercion: a missing/non-boolean/corrupt/array/partial config falls to
  all-guards-ON (restrictive), pinned by CONTROL tests that exercise the dangerous direction.
- One-field-per-PUT: setGuard merges a single guard so the other two are never reset; the
  route dispatches exactly one field with guard precedence; tested including the both-fields case.
- Persistence mirrors engine/heartbeat-setting.js faithfully (atomic tmp+rename, never throws,
  ENOENT -> clean default, array/non-object rejection, write failure returns {ok:false, because}).
- The disabled controls are genuinely inert: real `disabled` on the button toggles and the
  checkboxes, no reachable handler, no dead references to removed JS. The regression guard
  requires the real attribute (perturbation-verified).
- No em dashes in any added line; Browser-check commit trailer present.
