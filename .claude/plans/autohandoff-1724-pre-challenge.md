---
pre_challenge: true
method: challenge-loop
branch: autohandoff-1724
diff_hash: 39d44c94a27291caaaff8c470fe640122045668adcaae8e5afaa2f1077b8bbd4
validation: passed
subdir_audit: passed
timestamp: 2026-09-01T07:22:41Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4 returned zero new findings after deduplication)
**Total findings:** 12 distinct (1 BLOCKER, 3 WARNINGs, 1 CONVENTION, 7 NITs) plus 1 duplicate WARNING
**Fixed:** 3 | **Deferred:** 3 | **Asked (awaiting user):** 0

Validation: the repo validates with `bash tools/run-tests.sh` (plain JavaScript; `type-check` is a
no-op echo, no linter). The canonical `validation_log_run_or_skip` helper mis-detects the stack as
pnpm/typescript and fails on a missing `typecheck` script; this is a pre-existing helper/repo
mismatch that also fails on `main`, not a defect of this branch. The repo's real suite passed
(3368/3368, "all checks passed") at 6.0, at iteration 1's 6f, and at 6j on the final HEAD. The
subdir CLAUDE.md audit passed (no changed subdir CLAUDE.md).

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 1 BLOCKER, 1 WARNING, 1 NIT
- [BLOCKER] server.js:7444 - the sweep wiring called `store.root()`, which does not exist (`store`
  exposes `ROOT`, a string). It threw a TypeError on every sweep and the interval's best-effort
  `catch` swallowed it, so the whole consume-half was DEAD ON ARRIVAL with a fully green suite.
  --> FIXED (e303e813): extracted a tested `handoffPathFor(store, session)` using `store.ROOT` and
  wired server.js to it.
- [WARNING] engine/autohandoff-sweep.test.js - the `pathFor` was an inline lambda in the server
  wiring that no unit test drove, which is how the typo shipped green. --> FIXED (e303e813): added a
  guard test driving the real `handoffPathFor` against the real `store` (throws on the `store.root()`
  form; proven both arms).
- [NIT] engine/autohandoff.js:58 - `handoffPrompt` is multi-line but `chat.deliver`/`cleanMessage`
  collapses whitespace, so the agent receives one line. --> FIXED (e303e813): added a clarifying
  comment so a future reader is not misled.

#### Iteration 2
**New findings:** 1 CONVENTION, 3 NITs
- [CONVENTION] web/index.html:13152 - `'Saving…'` uses a literal U+2026 ellipsis. --> DEFERRED: this
  is the app's pervasive established convention (113 U+2026 occurrences; all six other `'Saving…'`
  handlers use it; 100+ in-progress messages like "Checking…", "Working…"). ASCII-izing only this one
  would make it the inconsistent outlier. U+2026 is not the banned character (only the em dash is),
  and the added copy is em-dash clean.
- [NIT] server.js - two `safeRoster()`/snapshot calls per minute when enabled; mitigated because the
  sweep early-returns on `!enabled` before `safeRoster()`, so the opt-in-off default pays nothing.
- [NIT] server.js/engine - `setting.enabled` checked three times per pass (server pre-check,
  `sweepOnce` early return, inside `shouldPrompt`); harmless defense-in-depth.
- [NIT] server.js - the per-agent band `Map` is created fresh in `start()`, so a server restart
  re-prompts every currently-over-threshold agent once; acceptable for a fresh monitor.

#### Iteration 3
**New findings:** 2 WARNINGs, 2 NITs
- [WARNING] engine/autohandoff-sweep.js:72 - on a non-PLACED delivery the band is (correctly) not
  advanced, so the next sweep re-injects; for a persistently busy-but-typeable high-context agent the
  ~532-char prompt re-pastes every ~60s and can stack in the composer. --> DEFERRED: known tradeoff.
  Advancing the band on an unconfirmed send is the worse failure (the measured 11%-un-submitted
  false-green); the accumulation is bounded (opt-in/off by default; only a persistently-busy
  high-context agent; the repeated content is the idempotent "write a handoff"). Verified against
  chat.js:87 ("UNCONFIRMED - re-sending may duplicate"). A retry ceiling/backoff is a reviewer-
  recommended FOLLOW-UP, not a merge blocker; flagged to Baron (owns the sweep).
- [WARNING] server.js:7431 - the sweep prompts every roster agent over threshold with no exclusion
  for the PM/orchestrator or an agent a person is mid-conversation with. --> DEFERRED: matches the
  card's explicit scope ("each running agent"); the reviewer classifies it "not a defect, a product
  consideration." Exclusions are a future product idea, and the feature is opt-in/off by default.
- [NIT] server.js:7450 - the sweep `setInterval` is `unref()`'d but never `clearInterval`'d; mirrors
  the sibling nudge sweep, prod-safe (process exits cleanly).
- [NIT] .claude/plans/autohandoff-1724.md - the plan lists "Off" as a dropdown entry; the build
  delivers Off via a separate enable checkbox (arguably better UX); minor wording drift.

#### Iteration 4
**New findings:** 0 (1 duplicate WARNING, 2 NITs)
- [WARNING] engine/autohandoff-sweep.js:142 - unbounded/unthrottled retry on non-PLACED, composer
  stacking. --> DUPLICATE of iteration 3's DEFERRED retry-backoff finding (same concern, same place);
  the deferral reasoning applies.
- [NIT] server.js:7433 - the `setInterval` wiring closure's glue lambdas have no direct test; the
  typo-prone half (`handoffPathFor`) is now covered against the real store, so the untested surface
  is thin glue only.
- [NIT] engine/autohandoff.js - `handoffPrompt` names a path under `handoffs/` whose parent the
  product never creates; low risk, the agent's own Write tooling creates parent dirs.
**Converged** - no new actionable findings after deduplication.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | BLOCKER | server.js:7444 | store.root() throws; sweep dead on arrival, silently swallowed | FIXED | e303e813 (extracted tested handoffPathFor -> store.ROOT) |
| 2 | 1 | WARNING | autohandoff-sweep.test.js | inline pathFor lambda untested; typo shipped green | FIXED | e303e813 (guard test vs real store) |
| 3 | 1 | NIT | autohandoff.js:58 | multi-line prompt collapses to one line | FIXED | e303e813 (clarifying comment) |
| 4 | 2 | CONVENTION | web/index.html:13152 | 'Saving…' uses U+2026 | DEFERRED | matches all sibling Saving… handlers + 113 app-wide; only em dash is banned |
| 5 | 3 | WARNING | autohandoff-sweep.js:72 | unbounded retry on non-PLACED can stack composer pastes | DEFERRED | known tradeoff (never silence); bounded; backoff is a follow-up, flagged to Baron |
| 6 | 3 | WARNING | server.js:7431 | no PM/active-conversation exclusion | DEFERRED | matches card spec "each running agent"; product consideration, not a defect |

### Outstanding questions (ASKED, still unresolved when the run ended)
None. All findings were fixed or deferred with recorded reasoning.

### NITs (non-blocking, across all iterations)
- [NIT] two snapshots/min when enabled (mitigated by off-default early return) (iter 2)
- [NIT] setting.enabled checked three times per pass, defense-in-depth (iter 2)
- [NIT] band Map fresh on restart re-prompts once (iter 2)
- [NIT] sweep setInterval never clearInterval'd, mirrors sibling nudge sweep (iter 3)
- [NIT] plan wording drift: Off via checkbox not dropdown (iter 3)
- [NIT] setInterval glue lambdas untested; risky half handoffPathFor is tested (iter 4)
- [NIT] handoffs/ parent dir not created by product; agent's Write creates it (iter 4)

### Strengths (across all iterations)
- The "advance the band ONLY on a PLACED delivery" rule correctly avoids the false-green monitor:
  an unconfirmed/could-not inject leaves the band untouched so the next sweep retries rather than
  silently marking an agent handled. Tested both arms (iterations 1-4).
- The per-field /api/settings patch validates each present field independently and merges via
  writeSettings, so auto-handoff and timezone never clobber each other; the no-clobber path is
  explicitly tested (iterations 1-4).
- Clean layering: a pure decision core (autohandoff.js), a pure sweep composing injected deps
  (autohandoff-sweep.js), thin server wiring, and UI; each unit-tested in isolation (iterations 3-4).
- Delivery safety inherited from chat.deliver/addressable: non-agent, copy-mode, and name-mismatched
  panes return COULD_NOT (which does not advance the band), so the sweep cannot type into a shell or
  the wrong pane; agents with null context.percent are skipped (iterations 2-4).
- Input hardening end to end: non-finite fill/threshold refused, off-menu thresholds refused on the
  write path, the path is safeKey-sanitized, the prompt is well under MAX_TEXT, and there are no em
  dashes in any user-facing or agent-facing string (iterations 2-4).
- The stale-assertion guards (web.settings-nav nav order, web.file-pickers Save count 4->5, each
  button named) were updated in lockstep with the markup, avoiding the green-check-camouflaging-a-
  stale-assertion release-cut failure (iterations 3-4).
