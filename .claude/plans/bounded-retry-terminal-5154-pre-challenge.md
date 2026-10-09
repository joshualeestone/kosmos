---
pre_challenge: true
method: challenge-loop
branch: bounded-retry-terminal-5154
diff_hash: e483baf29dfd2b18bd9c693b4a4e38064b6be5cf290d17f2e498ab0d60489083
validation: passed
subdir_audit: passed
timestamp: 2026-10-08T15:56:56Z
iterations: 7
converged: true
---

## [CHALLENGE-LOOP] Summary

**Issue:** #5154 slice C — a disk-backed "stuck terminal error" detector. When an agent sits in
the same terminal state (`auth_failed` = expired login, 15 min; `rate_limited` = a rate limit that
has not lifted, 30 min) continuously past a conservative per-state threshold, Kosmos raises ONE
needs-you per episode (card escalation sentence + the Issue filter + one phone push), and clears
itself on recovery. Extends slice A (engine/crashloop.js). Excludes transient `connection_lost` and
the agent's own `needs_you` (precedence).

**Iterations:** 7 blind passes, model rotated (opus/sonnet), plus a final proof-generating pass.
**Converged:** Yes — iteration 7 (opus) returned zero NEW findings after dedup, and the
proof-generating re-run (sonnet) on the final head 7e09a66fd independently re-confirmed convergence
(4 WARN + 4 NIT, every one a verified dedup/merit-defer against the ledger, no code change).
**Total findings:** 0 BLOCKERs across all 7 iterations; multiple WARNINGs/CONVENTIONs/NITs.
**Fixed:** all CONVENTIONs + every WARNING judged a real defect | **Deferred:** the merit-based
WARNINGs/NITs below, each with reasoning | **Asked (awaiting user):** 0.

**Two post-convergence validation repairs (6g), neither a new iteration — an undo + a one-line
guard + test hygiene, no new product logic:**
- **6g-1 (→ c2888395d):** the heavy suite on 35592b533 came back RED (16709 tests, 12 fail), all
  from the iter-6 decision to emit `stuckError` from `status.snapshot()`'s normaliser. That broke
  the snapshot-shape contract (the #2519 golden-card key-set drifted by one key, and the strict
  card/lrow/offline field contracts in web.not-running threw). FIX: REVERTED the normaliser
  addition (every consumer tests `Boolean(a.stuckError)`, so an absent field reads as not-stuck
  exactly as null would; a hazardous live-box golden re-capture was not worth it). Also added
  `stuckError: null` beside `crashLoop` at the /api/status OFFLINE row (server.js:5563), which
  renders through agentNeedsAttention. Dropped a hand-built-roster test that tripped
  fixture-discipline, moving the throwing-tell test onto tellStuck directly.
- **6g-2 (→ 7e09a66fd, the final head):** the fresh suite on c2888395d still had 3 reds — 2 real,
  1 flake. The 2 real (both in engine/tasks.state-3559.test.js) were `needsPerson` (status.js)
  reading `a.stuckError` unguarded, because it also runs over BARE `snapshot().agents` rows via
  `waitingOnPerson` (tasks.js) and projects.js, which omit stuckError — tripping test-support/
  fleet.js's strict `get` proxy (a defect only the heavy suite catches; unit tests over plain
  objects coerce `undefined` to falsy). FIX (status.js only): presence-guard the read —
  `Object.prototype.hasOwnProperty.call(a,'stuckError') && Boolean(a.stuckError) &&
  a.stuckError.stuck === true`, matching projects.js's `'stuckError' in card` guard and the
  crashLoop normaliser idiom. Behaviour unchanged (absent → not-stuck); the parity harness still
  pins needsPerson == agentNeedsAttention. The guard was chosen over re-normalising stuckError
  because normalising forces the hazardous golden re-capture for a field that is always null in
  snapshot() anyway; the documented weak point is the asymmetry with crashLoop, accepted on merit.
  The 1 flake was #3827 (engine/remote.test.js:2450, tunnel-timeout) on the contended box —
  confirmed a flake by running remote.test.js alone (177/177/0).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 3 WARNINGs, 0 CONVENTIONs, NITs
- [WARNING] a recovered agent showed the stuck card for up to 60s before the next sweep rewrote the
  anchor --> FIXED (9afa7795c): gate the /api/status read on `isTerminal(a.state)` via `peek`.
- [WARNING] a removed-and-recreated agent of the same name inherited the old episode's clock -->
  FIXED (9afa7795c): disk-back the anchor + wire `forget` into create.js/remove.js/delete-leftover.js.
- [WARNING] a FAILED roster read wiped every anchor --> FIXED (9afa7795c): skip the sweep on
  `roster === null`.

#### Iteration 2
**Reviewer model:** sonnet (rotated from iteration 1)
**New findings:** 0 BLOCKERs, 2 WARNINGs, NITs
- [WARNING] the project pill drifted (stuckError missing from the projects.js member projection) -->
  FIXED (6712764a4): carry stuckError into the projection (two-derivations alignment).
- [WARNING] an off-roster agent kept a stale clock --> FIXED (6712764a4): prune departed anchors on
  a GOOD roster only. + atomic tmp-then-rename write, plan SUPERSEDED note.

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 CONVENTION, NITs
- [CONVENTION] a new docs/browser-checks/render-*.js is not auto-discovered, and the parity harness
  in crashloop-5154.test.js must also exercise stuckError rows --> FIXED (75f6ce194): registered the
  check in b8-board.txt + README.md, and added stuckError rows to the needsPerson/agentNeedsAttention
  parity harness (the two-derivations pin).
- [NIT x3] DEFERRED: terminal→terminal switch leaves peek on the old anchor ≤60s (self-corrects,
  push uses read not peek); safeRoster emits `{stuck:false}` vs /api/status null for non-terminal
  (both falsy, harmless); the good-roster prune re-anchors a momentarily-absent stuck agent (delays,
  never false-raises — documented).

#### Iteration 4
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, NITs
- [WARNING W1] `tellStuck`'s prune deleted the anchor file but left `told.has(key)` true — a
  departed-then-returned stuck agent never re-pushed, and the Set grew --> FIXED (3e69a5d8d): prune
  the told-mark too.
- [WARNING W2] `peek` ignored the current state — a terminal→terminal switch between sweeps showed
  the wrong sentence --> FIXED (3e69a5d8d): `peek(key, state, now)` returns not-stuck unless
  `anchor.state === state`; both server attach sites pass `a.state`; the web stateReason branch
  also requires `a.state === a.stuckError.state` (defense in depth).
- [WARNING W3] a stale anchor survived a restart/sweep-gap, so a recovered-during-downtime agent
  relapsing same-state inherited the old sinceAt --> FIXED (3e69a5d8d): `clearAll()` wipes the stuck
  dir, called once at boot before the crashLoopTick. (lastSeenAt re-anchoring was REJECTED: it
  cannot distinguish a sweep outage from an off-roster gap, so it would reset a genuinely-stuck
  clock after a transient failure.)
- [CONVENTION] stale comments on `tellStuck` + the server sweep claimed "not a roster prune" after
  iter-2 added one --> FIXED (3e69a5d8d): corrected both comments.
- [NIT] tmp files left by a crash mid-write are never read as anchors (keys() filters `.json`;
  fail-safe) — DEFERRED.

#### Iteration 5
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 CONVENTION, 1 WARNING, 3 NITs
- [CONVENTION] the null-skip safety invariant (`if Array.isArray(roster)`) lived only in server.js's
  caller, untested --> FIXED (14228feb2): extracted `stuckterminal.sweepRoster()` (owns the null-skip
  + our-named filter), + 3 unit tests (null→no-wipe, []→prune, good→tell-once), and consolidated the
  server.js comment to match.
- [WARNING] the good-roster prune re-anchors a stuck agent that transiently vanishes from a non-null
  snapshot → DELAYED alarm (never a false alarm) --> DEFERRED: duplicate of the iter-2/iter-3
  deferral; "fixing" it re-introduces the iter-2 stale-clock FALSE-alarm, worse for a deliberately
  false-alarm-averse module. Reviewer rated it WARNING-not-BLOCKER; mitigated + documented.
- [NIT x3] DEFERRED: tmp-file leak (fail-safe); board-restart re-push (consequence of the W3
  clearAll-at-boot); sub-60s recovery+relapse invisible (inherent to 60s sampling; matches slice A).

#### Iteration 6
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 2 NITs
- [WARNING] a throwing `tell()` for one agent aborted the tick's remaining rows + both prune loops
  --> FIXED (35592b533): wrap `tell()` in try/catch exactly as crashloop.tellLoops does (told-before-
  tell kept to match the sibling) + a new unit test.
- [WARNING] (slice-A parity) the snapshot normaliser omitted `stuckError: null` beside
  `crashLoop: null` --> applied in 35592b533, then REVERTED in the 6g-1 repair above (it broke the
  snapshot-shape contract 11 ways; absent reads as not-stuck exactly as null, so no live bug).
- [WARNING W1 flapping] a non-terminal sample resets the clock, so a flapping agent never escalates
  --> DEFERRED: the same 60s-sampling tradeoff as iter-5 and slice A; auth_failed does not flap; the
  false-negative is the safe direction; a debounce is out of scope.
- [NIT x2] DEFERRED: the stateReason `a.state === a.stuckError.state` guard vs the Issue predicates
  (they coincide because peek enforces state-match upstream; documented defense-in-depth); peek adds
  a per-agent disk read in safeRoster (mirrors crashloop.read; no correctness impact).

#### Iteration 7
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 1 WARNING, 2 NITs — **all deferred on the merits, no code change.**
**6d CONVERGED.**
- [WARNING clearAll-at-boot] on a FREQUENTLY-restarting board a continuously-stuck agent's clock is
  repeatedly wiped, so it may never reach the 15/30-min threshold --> DEFERRED (merit-based, would
  defer at iteration 2 too). Premise VERIFIED (boardrestart.js #2238/#2346: a world switch restarts
  the board process). Deferred because clearAll is the deliberate iter-4 W3 fix for the INVERSE
  false-alarm (a recover-then-relapse during downtime inheriting a stale clock), the alternatives
  were rejected or re-introduce that false-alarm, and this module's documented philosophy prefers a
  false-NEGATIVE over a false-alarm. The common case (a stable active world) is a long-lived board,
  unaffected. Carried into the PR body as a KNOWN LIMITATION + a possible future follow-up (slice A
  avoids it only because the supervisor writes its run files independently of the board lifetime).
- [NIT x2] DEFERRED: sub-60s recover→relapse-same-state keeps the old sinceAt (sampling limitation,
  mirrors slice A) — dup of iter-5/6; the stateReason extra state guard — dup of iter-6.

#### Proof-generating pass (final head 7e09a66fd)
**Reviewer model:** sonnet (fresh, blind; it reviewed the 6g-2 guard itself)
**New findings:** 0 BLOCKERs, 4 WARNINGs, 4 NITs — **every one a verified dedup or merit-defer
against the 7-iteration ledger, confirmed by reading the code. No code change. 6d CONVERGED, 6f skip.**
- [WARNING] prune wipes clock on an incomplete roster --> DEFER: verified listPanes/paneRoster THROW
  on total enumerate failure → safeRoster null → the sweep skips (invariant holds); only an
  individual dropped pane reaches the prune = the iter-3 deferred re-anchor delay (never a false
  raise; explicit forget handles real departures).
- [WARNING] flapping / clearAll --> DEFER: dup of iter-6 W1 + the iter-7 clearAll KNOWN LIMITATION.
- [WARNING] the stuck sentence asserts the state as fact --> DEFER: the 15-30 min sustained anchor is
  a STRONGER confidence filter than a single-scrape stateConfidence (a non-terminal sweep resets it,
  so a scraped false positive cannot persist to threshold); copy is Mona's to refine (noted in-code).
- [WARNING] stuck vs disruption precedence --> DEFER: mutually-exclusive states (stuck fires on
  auth_failed/rate_limited; disruption/#4006 on needs_you/restarting) — no overlap.
- [NIT1] silent writeAnchor --> DEFER by design (mirrors crashloop). [NIT2] peek disk read --> dup
  of iter-6. [NIT3] normaliser asymmetry --> the documented 6g decision; strict-proxy tests (not just
  the comment) protect future consumers. [NIT4] headless `HEADED === '0'` --> VERIFIED matches 285
  sibling occurrences; not a bug.

### Outstanding questions (ASKED, still unresolved when the run ended)
None. Zero ASKED findings in any iteration.

### Deferred (with reasoning, so the operator can override)
- [WARNING] clearAll-at-boot starves escalation on a frequently-restarting board — see iteration 7.
  Board-lifetime-scoped by deliberate design to avoid a stale-clock false alarm after downtime.
  Carried as a KNOWN LIMITATION in the PR body; a future follow-up could give slice C
  supervisor-scoped (restart-surviving) tracking, as slice A has.
- [WARNING] the good-roster prune re-anchors a transiently-absent stuck agent (delayed alarm, never
  a false raise) — the iter-2/3/5 deferral; the alternative re-introduces the stale-clock false alarm.
- [WARNING] the stuck sentence's factual wording — justified by the sustained 15-30 min anchor; copy
  refinement is Mona's.
- [NIT] sub-60s recover→relapse-same-state keeps the old sinceAt (60s-sampling limitation, mirrors
  slice A's event-vs-sample tradeoff).
- [NIT] stateReason's extra `a.state === a.stuckError.state` guard — defense-in-depth; the predicates
  coincide because peek enforces state-match upstream.
- [NIT] peek's per-agent disk read in safeRoster — mirrors crashloop.read; no correctness impact.
- [NIT] tmp files from a crash mid-write — never read as anchors (keys() filters `.json`); fail-safe.
- [NIT] writeAnchor swallows errors silently — by design; a board that cannot write its data dir
  simply does not escalate, never fatal (mirrors crashloop).

### Strengths (across all iterations)
- The three Issue derivations (needsPerson, agentNeedsAttention, the projects projection) are kept
  aligned and pinned by the parity harness in crashloop-5154.test.js, which runs needsPerson and
  agentNeedsAttention over the SAME rows (including stuckError rows) and asserts equal.
- `store.ROOT` is read at call time, never frozen at require (convention #2).
- Writes are atomic (tmp + rename), so a concurrent 5s peek never reads a half-written file and a
  crash mid-write never leaves a truncated one.
- Single-writer: only the 60s sweep advances the clock (via `read`); `peek` is read-only.
- The `isTerminal(a.state)` gate keeps the 5s /api/status path cheap (no disk read for the common
  non-terminal agent).
- The null-skip SAFETY invariant (a failed snapshot never advances or prunes an anchor) is pinned by
  dedicated `sweepRoster` unit tests, not asserted only by reading the single server.js caller.
- The detector reads the state status.js already classified (a.state), never re-deriving it from a
  pane or transcript (repo convention #5 — signal, not a second derivation).

### Validation
- 6j heavy suite GREEN BY CONTENT on 7e09a66fd twice, by content not exit code: `buc0i3veh`
  (tests 16708, fail 0) and the closing `be99c6s92` (ran, reached the final build stage,
  `validation-log: validation PASSED hash=e483baf29dfd`, exited 0, zero failure glyphs; #3827 passed
  this run). All 18 `#5154-C` tests green; the crashLoop/needsPerson parity test green.
- Browser-check render-stuck-terminal-5154: 8/8 PASS (still valid — 7e09a66fd touches only status.js,
  not web/index.html or the fixture).
- subdir CLAUDE.md audit: passed.
