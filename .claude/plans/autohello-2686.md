# autohello-2686: auto-send the wake "hello" after a user-initiated restart

Card: joshualeestone/kosmos#2686 (josh-review). Branch: autohello-2686.

## Problem

When the user restarts an agent from the board, the app tells them "you will
need to say 'hello' to wake them" and makes them type it by hand. Josh asked for
this to happen automatically. It is genuinely new behavior, not a reuse: today's
"Say hello" button only navigates to the chat; nothing auto-sends.

## Why it is not "just a first message"

A restart is asynchronous. `POST /api/agent/<name>/restart` KILLS the tmux
session and returns `outcome:"restarted"` after the kill; a supervisor then
respawns a fresh session later. An auto-hello fired the instant the restart POST
returns would type into a dead/booting pane and be lost. So the send has to wait
for the agent to actually come back up.

## The call

Auto-send `hello` to `POST /api/agent/<name>/thread` `{text:"hello"}` (the same
route the composer uses), but only AFTER a readiness-wait, on the two
user-initiated restart transitions that today tell the user to say hello:

1. The shared restart-modal confirm (`rst-go`, web/index.html) - covers every
   restart button that opens the modal (stale notice, detail page, role change).
2. The "Add Instructions & Restart" doctrine flow (the plan restart).

On each: on a successful restart, poll `/api/status` until the agent is back and
ready, then POST hello and change the notice to "...and said hello to wake
them." If the wait times out, fall back to the current manual-hello notice (no
regression).

### Readiness predicate (the load-bearing refinement)

`boardCanSeeIt(a)` (present + ours + `state !== 'stopped'`) is TOO LOOSE for this
purpose: during the async restart the engine emits `state:'restarting'` (#2019),
which boardCanSeeIt counts as visible. Firing hello then is the exact "type into
a booting pane" bug. So readiness here is `boardCanSeeIt(a) && a.state !==
'restarting'`, AND we require having observed the agent NOT-ready at least once
(the restart gap) before accepting ready - so a stale first status snapshot
still showing the pre-restart session cannot trigger an early send. Bias toward
safety because the card states a mistimed send is worse than the manual
status quo; the cost is that an agent that restarts faster than one poll falls to
the manual line, which is the current behavior anyway.

### Scope guard

This PR wires the two restart-MODAL-based user-initiated restart sites (rst-go +
doctrine). A crash / self / supervisor restart does not route through them, so it
will not trigger an unwanted auto-hello.

Two OTHER user-initiated flows also restart the agent and still tell the person to
say hello by hand: the provider switch (`moveAccountNow`) and the model switch
(`changeModelNow`). They are deliberately NOT in this PR: both run through
`changeDialog`'s Josh-tuned interstitial (a success-only `minBusyMs` hold,
RESTART_HOLD_MS ~10s, with the #768/#2463 wording rulings), whose timing differs
from the auto-hello readiness wait (up to 30s), so reconciling the two is a focused
follow-up with its own test arms and Josh's eyes in the running app. Tracked as
kosmos#2716. The `autoHelloAfterRestart` helper is site-agnostic and already
carries everything that piece needs.

### Concurrency guard

A monotonic `RESTART_HELLO_SEQ` token: a later restart supersedes an earlier
pending wait, so two restarts cannot cross wires onto one notice.

## Rejected

- Auto-send immediately on restart-return (types into a booting/dead pane).
- A one-click "Wake them" button (still a manual step; Josh asked for no manual
  step).
- Reusing `watchForAgent` directly (it repaints the CREATE screen - avatar
  upload, project tell, made-hello panel; wrong side effects for a restart).
  Reuse only its readiness concept (`boardCanSeeIt`) plus a dedicated poll.

## Verification (headless, no operator, no MCP)

A committed browser-check `docs/browser-checks/render-autohello-2686.js`, run
under pw-runtime over `file://web/index.html` with a `window.fetch` stub
(the render-pj-clear-2575.js model). Arms:

1. Success: status returns `restarting` then `idle` -> hello POSTs exactly once,
   AFTER the transition, notice becomes "said hello".
2. Ordering/safety: an agent that is `restarting` on every poll -> NO hello,
   notice falls to the manual line (red-capable contrast with arm 1).
3. Early-guard: an agent already ready on the FIRST poll with no observed gap ->
   NO early hello (the stale-old-session guard).
4. Both restart sites (rst-go modal + doctrine flow) exercised.
5. Timing constants overridden to short values so the timeout arm runs fast.

Run:
`NODE_PATH=$HOME/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-autohello-2686.js`

Plus a `Browser-check:` commit trailer / docs/browser-checks assertion so the CI
shell gate passes for a web/ change.

## Weakest premise

That the restart gap is observable within the poll window in practice (true given
the async supervisor respawn takes seconds and the #2019 restarting state renders
during it). If an agent restarted faster than one poll interval, auto-hello would
fall to the manual line - the current behavior, so no regression, only a missed
optimization. This residual timing question is what the card's needs-operator /
live verify would confirm on real hardware; the frontend sequence itself is fully
asserted headless.
