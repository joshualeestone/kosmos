# Plan - #3492: restart pop-up "Write a handoff, then restart"

Branch: `handoff-then-restart-3492` · Card: joshualeestone/kosmos#3492 · Owner: Angel · Target: 0.6.90

## Ask (Josh, 2026-09-23)
On agent view -> restart, the confirm pop-up offers "leave running / restart". Add a THIRD option:
"Write a handoff, then restart" - the app tells the agent to write its handoff, WAITS for completion,
then restarts, so the fresh session picks up cleanly. Splinter: build it, best-call-and-proceed;
Windows parity is Homer's later (Mac first). I own it end to end (mechanism + the button).

## Validated design (from reading the engine)
- **Reuse the existing auto-handoff core.** `engine/autohandoff.js` `handoffPrompt(fillPct, path)`
  returns the operator handoff prompt; `engine/autohandoff-sweep.js` injects it via `chat.deliver`
  and writes to `handoffPathFor(store, session)` (wired in server.js:13899). #3492 reuses
  `chat.deliver` + `handoffPathFor`, with a #3492 VARIANT prompt ("write your handoff - you are being
  restarted and the fresh session will read it", NOT "keep working").
- 🛑 **NO auto-pickup exists.** A fresh/restarted session does NOT read its handoff on startup
  (grep `handoff` in remove.js/create.js/agent-supervisor.sh = nothing). So the NOVEL piece is the
  PICKUP: after restart brings the fresh session up, deliver a message pointing it at the handoff.
  Ride the existing wake-'hello'-on-restart hook (server.js:4667 "Say hello…" task) so timing is solved.
- **Restart path:** `POST /api/agent/<name>/restart` -> `removal.restart(name, cause, {startIfDead:true})`
  (server.js:5203) -> remove.js `restartInner`.

## Build steps
1. **UI:** add a 3rd button "Write a handoff, then restart" to the restart CONFIRM dialog (the
   "leave running / restart" popup; grep web/index.html ~27589 for the confirm; distinct from the
   `#d-fresh` Restart/Compact/Clear panel at 8947). Working label, swappable per Mona/Josh.
2. **Engine pure core (mirror engine/class1-autohandle.js: pure decision + DI executor + tests):**
   a #3492 handoff-for-restart prompt (variant of handoffPrompt) + a pure state/decision fn for the
   flow (running? -> proceed; not running -> plain restart or disable; handoff-written? -> restart;
   timeout -> bounded fallback).
3. **Server flow** (stateful async; a new route `/api/agent/<name>/handoff-restart` or a mode on
   /restart): (a) deliver the #3492 prompt via chat.deliver -> (b) POLL handoffPathFor(store,session)
   for the handoff to be written/updated, bounded (~60-120s), surfacing progress in the dialog like
   the plain restart's status -> (c) removal.restart -> (d) after the fresh session is up, deliver the
   PICKUP message ("read your handoff at <path> and continue"), via the wake hook.
4. **Edge cases:** agent not running (nothing to hand off -> fall back to plain restart or disable the
   option); handoff-write TIMEOUT (bound it; restart-anyway-with-a-note OR abort with a clear message,
   never hang); reuse the in-flight guard the plain restart uses (START_EPOCH/START_FLIGHT).
5. **Tests:** pure-fn tests for the prompt + flow decisions; a DOM/render test for the 3rd button
   (mirror web.connection-lost-3410.test.js); full node suite; challenge-loop; PR ("Addresses #3492",
   let QA close per Kosmos convention).

## Weakest premise
That a pickup message delivered to a freshly-restarted session lands (timing: the fresh session must
be up + listening before the pickup). Mitigation: ride the wake-'hello' path, which already solves
this timing. Verify against a real restart before relying on it.

## Verify
- `node --test` the new engine tests + web render test, real exit read.
- Full node suite via the runner; merge on CI GREEN (the `test` job flaky-times-out at the 15m cap -
  a cancel is contention, rerun it; do NOT pkill the suite mid-run).
