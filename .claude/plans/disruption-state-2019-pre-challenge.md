---
pre_challenge: true
method: challenge-loop
branch: disruption-state-2019
diff_hash: edfdd14c4545f843a550d6c72aed6327a3f0b13e73346b1e352951c663b92340
validation: passed
subdir_audit: passed
timestamp: 2026-09-04T02:20:47Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3
**Converged:** Yes (iteration 3 returned zero new BLOCKER/WARNING/CONVENTION findings)
**Total findings:** 10 (0 BLOCKERs, 4 WARNINGs, 1 CONVENTION, 5 NITs) + strengths
**Fixed:** 8 | **Deferred:** 2 (1 WARNING with disclosure, 1 NIT with reasoning) | **Asked:** 0

Each iteration spawned a fresh, blind general-purpose agent with a self-contained prompt
(no access to prior findings). Baseline (6.0) and every 6g/6j validation ran the canonical
helpers: full JS suite + shell suite green, subdir-CLAUDE.md audit clean.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs
- [WARNING] engine/remove.js:1337,1369 — the begin-before-kill / clear-on-failed-kill
  production wiring had no test (the safety-critical PARTIAL clear unverified) --> FIXED
  (f4f7f3e3): 4 remove.test.js tests (success records cause, default cause, PARTIAL clears,
  REFUSED never reaches begin).
- [WARNING] server.js:3016-3033 — the restart-route body/cause parsing had no server-level
  test --> FIXED (f4f7f3e3): server.test.js asserts {cause:'instructions'} rides through AND
  a bodyless POST stays backward-compatible, at the route layer.
- [NIT] engine/status.js:4124 — #1930 auth-stale recursion did not forward disruptionRec
  --> FIXED (f4f7f3e3): threaded (harmless today, prevents a latent drop).
- [NIT] engine/remove.js:1337 — disruption.begin not DRY_RUN-gated like sibling writers
  --> FIXED (f4f7f3e3): gated `!(DRY_RUN && !runner)`, matching recordRemoval/trust convention.
- [WARNING] engine/status.js + remove.js — RESTARTING renders only when a pane EXISTS but
  Claude is not running; the Mac kill->bootstrap interval is briefly fully paneless -->
  DEFERRED (f4f7f3e3): disclosure strengthened in the paneless-card comment and the plan's
  follow-up section (covers Windows AND the Mac gap); the more visible Claude-booting interval
  IS covered, the short fully-paneless gap is a delineated follow-up (reasoning: covering it
  needs a second RESTARTING producer or a reconcile-contract change, more invasive than a
  short, mitigated, self-healing gap warrants for this additive slice).

#### Iteration 2
**New findings:** 0 BLOCKERs, 1 WARNING, 1 CONVENTION, 3 NITs
**Duplicates of prior findings (confirmed resolved):** 0 (fresh agent, independent surface)
- [WARNING] engine/status.js:4144 — the named weakest premise (restarted-then-crashed-within-
  window reads restarting); the agent offered a forward self-heal (distinct from the liveness
  gate the plan rejected) --> FIXED (68856b32): snapshot clears the record on the first
  confident live reading after a restart, tightening the window to the actual boot interval.
  Guarded to not-RESTARTING/not-UNKNOWN; safe against a first-tick race (begin+kill synchronous
  in restartInner). Two integration tests (clears on completed restart; does NOT clear on
  UNKNOWN mid-boot).
- [CONVENTION] engine/disruption.js:55 — WINDOW_MS duplicated liveness.STALE_AFTER_MS as a
  bare literal while the comment asserted alignment (claim-outlives-guard) --> FIXED (68856b32):
  dropped the false alignment claim, justified 180s independently; the two are different facts
  that coincide, so coupling them would be wrong.
- [NIT] engine/status.js:4251 — the RATE_LIMITED re-entry did not thread disruptionRec -->
  FIXED (68856b32): threaded, parallel to the auth re-entry.
- [NIT] engine/disruption.test.js:103 — a vacuous assertion (typeof ok === boolean) --> FIXED
  (68856b32): now asserts ok === false + nothing written.
- [NIT] engine/status.js:4522 — disruption.active resolved per owned pane per tick (not gated
  on STOPPED the way liveAuth is gated on AUTH_FAILED) --> DEFERRED (reasoning): the forward
  self-heal needs the read on non-STOPPED panes to detect a completed restart, so gating would
  reinstate the residual it removes; the read is one ENOENT stat per owned pane per tick,
  negligible, and only agents mid-restart have a file.

#### Iteration 3
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT
**Converged** — no new actionable findings. All prior fixes independently confirmed as
strengths (discriminating control armed, begin/kill race reasoning holds, self-heal guard
correct in both branches, backward-compat real, WINDOW_MS decoupling sound, security clean).
- [NIT] engine/disruption.js:125-131 / status.js:4548 — an aged-out record for a restart that
  never came back is self-healed at the READING layer (active() returns null past the window)
  but the file lingers on disk until a later begin() overwrites it or a kill-fail clear() runs
  --> DEFERRED (NIT, does not block convergence): bounded (one tiny mode-0600 file per
  agent-name ever restarted-and-not-recovered), harmless, and identical to the liveness.js
  model this is patterned on. The plan's "no cleanup required" is accurate about the reading;
  the file residual is idiomatic. A future cleanup could clear on agent removal, but it is not
  worth a re-iteration.

### Final Ledger

| # | Iter | Category | File:Line | Description | Status | Resolution |
|---|------|----------|-----------|-------------|--------|------------|
| 1 | 1 | WARNING | remove.js:1337,1369 | begin/clear wiring untested | FIXED | f4f7f3e3 |
| 2 | 1 | WARNING | server.js:3016-33 | restart-route body/cause untested | FIXED | f4f7f3e3 |
| 3 | 1 | WARNING | status.js/remove.js | Mac kill->bootstrap paneless gap | DEFERRED | disclosure + follow-up |
| 4 | 1 | NIT | status.js:4124 | auth recursion drops disruptionRec | FIXED | f4f7f3e3 |
| 5 | 1 | NIT | remove.js:1337 | begin not DRY_RUN-gated | FIXED | f4f7f3e3 |
| 6 | 2 | WARNING | status.js:4144 | weakest premise (crash-in-window) | FIXED | 68856b32 (forward self-heal) |
| 7 | 2 | CONVENTION | disruption.js:55 | WINDOW_MS duplicated liveness const | FIXED | 68856b32 |
| 8 | 2 | NIT | status.js:4522 | active() read per owned pane/tick | DEFERRED | required by self-heal |
| 9 | 2 | NIT | status.js:4251 | rate-limited re-entry drops disruptionRec | FIXED | 68856b32 |
| 10 | 2 | NIT | disruption.test.js:103 | vacuous assertion | FIXED | 68856b32 |
| 11 | 3 | NIT | disruption.js:125-131 | aged-out record file lingers | DEFERRED | idiomatic (liveness.js model) |

### NITs (non-blocking, across all iterations)
- [NIT] status.js:4522 — active() read per owned pane/tick (iteration 2, deferred: self-heal needs it)
- [NIT] disruption.js:125-131 — aged-out record file lingers on disk (iteration 3, deferred: idiomatic)

### Strengths (across all iterations)
- Discriminating control present and armed: identical STOPPED input WITH vs WITHOUT the record
  -> RESTARTING vs STOPPED; snapshot integration has a no-record baseline before begin (iter 1,2,3).
- The production begin/clear wiring is covered where the isolated tests cannot see it -- a
  regression in placement now fails the suite (iter 1,3).
- begin/kill synchronous in restartInner, so no snapshot GET interleaves the pre-kill live pane
  -- the race reasoning holds (iter 3).
- Forward self-heal guard correct in both branches (clears on confident live, keeps on UNKNOWN)
  (iter 2,3).
- Graceful frontend degradation: an unmapped 'restarting' -> CARD_ST.unknown ("unsure", not
  "gone"), so the core bug is fixed engine-first, before the presentation half (iter 2,3).
- WINDOW_MS deliberately decoupled from liveness.STALE_AFTER_MS with a documented rationale;
  cause stored as a machine token, copy left to the frontend -- no private vocabulary (iter 2,3).
- Security clean: execFileSync arrays, name sanitized, begin catches the unkeyable throw, files
  mode 0600, no secrets (iter 3).
