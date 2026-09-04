# kosmos#2019 — engine half: a deliberate-disruption "restarting" state

Branch: `disruption-state-2019`. Card: kosmos#2019. Author: Renet Tilley (night shift).
Design half (copy + presentation): Mona Lisa's spec, `Josh-Brain/Projects/kosmos-disruption-state-2019-design-spec.md`.

## The bug

The board reads an agent's liveness from a tmux pane. A deliberate restart / model
change / provider change / account change / instructions change takes the agent out of
tmux for a moment. `classify()` then sees a pane with no Claude process and returns
`STOPPED` ("this agent doesn't exist") to the very person who just clicked the button.
"Gone" is the one thing we KNOW is false, because we caused it.

## The fix (engine half only — this PR)

A third reading of a dead pane: **RESTARTING**, shown only while a fresh record of a
disruption WE initiated is on file, and self-healing both ways.

1. **`engine/disruption.js` (new)** — a transient per-agent store modeled on
   `engine/liveness.js`: `disruptions/<safeKey>.json = {cause, startedAt}`, with the same
   "three answers" discipline (`read` → found:false for no-record; `active` folds a 180s
   window in and returns null once stale). `begin` / `read` / `active` / `clear`. Cause is
   a machine token (`restart|model|provider|account|instructions`); an unknown cause is
   coerced to `restart` so nothing unreadable reaches the board.
2. **`engine/remove.js`** — `restartInner(name, cause)` writes `disruption.begin(clean,
   cause)` once committed to a real fleet agent (after the FOUND.OURS guard), BEFORE the
   kill, and `disruption.clear` on a PARTIAL (kill failed → agent still live → not
   restarting). `restart(name, cause)` threads it.
3. **`engine/status.js`** — new `STATE.RESTARTING`; `reconcileReport(...,  disruptionRec)`
   returns RESTARTING (carrying `{cause, startedAt}`) when scraped is structured-STOPPED
   and a fresh disruption record is passed. Placed at the TOP of reconcile, above the
   no-report early return, because a just-restarted agent usually has no fresh self-report.
   `snapshot()` resolves `disruption.active(pane.name)` behind the `isNamedOurs` gate and
   passes it; the card carries `disruption` (null except when restarting).
4. **`server.js`** — the model / provider / account routes pass their cause; the restart
   route accepts an optional `{cause}` body (default `restart`), so the stale-instructions
   notice can send `instructions`. Backward-compatible: a bodyless POST → `restart`.

## What I decided, and what I rejected

- **Engine-only this PR; presentation handed to Mona Lisa.** The design spec itself calls
  the liveness-backed check the load-bearing half ("the animation plus a check that can
  turn it off is the feature"). The animated K + copy are her design lane and need browser
  verification I cannot do headless. An unknown `restarting` state degrades to
  `CARD_ST.unknown` (pres:'unsure') — honest, not "gone" — so the core bug is fixed the
  moment the engine ships, before her half lands. Contract sent to her.
- **Separate module, not a field on `profiles/` or `liveness/`.** Preserves profiles'
  identity-protection boundary and liveness's hard "records only liveness, never state"
  rule. Rejected folding it into either.
- **Top-of-reconcile override, not a branch inside rule 2.** Found by test: a just-restarted
  agent has no self-report, so reconcile's no-report early return fired before rule 2 and
  the state never flipped. The integration test caught this (stopped instead of restarting).
- **No liveness.alive() gate on the pane path.** Rejected the Explore suggestion to also
  require `alive !== false`: during a restart the process is down, so a stale beat would
  wrongly suppress RESTARTING. The disruption record's freshness is the signal; the pane
  coming back (classify != STOPPED) is the exit.
- **Cause as a machine token, copy in the frontend.** Rejected storing display copy in the
  record — keeps the two-copies-of-one-fact defect away and leaves copy where the design owns it.

## Weakest premise (named)

The 180s window bounds only the FAILURE case (a restart that never visibly comes back). A
successful restart ends the state instantly when the pane is alive again, regardless of
window. The residual: if an agent is deliberately restarted, comes back, then GENUINELY
crashes within 180s, it reads as `restarting` briefly before self-healing to `stopped`.
Rare, self-healing, and far better than the current every-restart-reads-gone. The window
is a tunable constant, documented in `disruption.js`.

## Scope boundary (delineated follow-ups, not this slice)

- **Paneless (Windows / non-tmux) restarting.** A paneless agent mid-restart drops off the
  board (its heartbeat stops) rather than showing RESTARTING. Needs the disruption signal
  to keep a paneless card on the board through its window. Card field carried (always null
  there) so the shape is ready.
- **Turn-1 `auth_failed` surfacing** (Ice Cream Kitty's #1906 fail-open follow-up) — a
  running agent whose cred 401s is the same "is it actually answering" question; it folds
  into this liveness module when filed. Coordinated; she files it against this layer.
- **Frontend presentation** — Mona Lisa (animated K, copy, reduced-motion, CARD_ST entry).

## Tests

- `engine/disruption.test.js` — the module (begin/read/active/clear, the window self-heal,
  cause coercion, three-answers).
- `engine/status.disruption-2019.test.js` — reconcileReport unit (with the discriminating
  control: same STOPPED input, WITH vs WITHOUT the record → RESTARTING vs STOPPED; outranks
  reported-stopped; gated on structured-STOPPED) + a snapshot() integration test proving the
  wiring (a stopped owned pane flips to restarting once begun).
- Regression: status/remove/liveness/observed (239) and server (255) green.
