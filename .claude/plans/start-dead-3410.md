# Plan: start a fully-dead agent (FOUND.NONE) instead of refusing (#3410 engine seam)

## What "finished" looks like
`remove.restartInner`, for a fully-dead agent (a launch job on disk but NO live
session, FOUND.NONE), STARTS it (bootstraps the launchd job) and returns RESTARTED
with a "starting" message, instead of refusing with "nothing to restart, it starts
itself." So Mona's merged "Start this agent" button (#3433, POST /restart ->
restartInner) actually brings back Josh's never-connected agents and Nora, not just
shows the honest refusal. A bystander's untied session (FOUND.UNTIED) still refuses;
a failed bootstrap returns PARTIAL honestly. Verified by tests + full suite green.

## Why this is a NEW piece (not covered by merged #3418)
Merged #3418 fixed the FOUND.OURS relaunch-VERIFY (don't report RESTARTED when a live
agent's bootstrap silently failed). It did NOT touch the FOUND.NONE branch, which still
refused. Mona's #3433 flagged the gap: there is no route that starts a no-session agent.
This card closes exactly that. (Mona's card comments call it "#3418"; it is the same
cluster but a distinct branch, shipped here.)

## Root cause / mechanism (Alexandra + Mona's #3433 review)
A genuinely-offline agent is built server.js state:'stopped', session:null = FOUND.NONE.
restartInner refused it. The app copy promises "it starts itself when this computer is
on" but that has NO mechanism for an agent whose launchd job is not loaded (Nora:
launchctl list showed nothing). Alexandra's manual recovery was
`launchctl bootstrap gui/<uid> .../com.kosmos.agent.<name>.plist` -- loading the job IS
the missing mechanism.

## The change (engine/remove.js restartInner)
FOUND.NONE no longer refuses; it sets `fromDead` and flows through the SAME
disruption + relaunch + loaded-verify path as a live restart, skipping only the kill:
1. `const fromDead = found.kind === FOUND.NONE`. FOUND.UNTIED / UNKNOWN still refuse
   (a session we cannot tie to this agent is a bystander's).
2. The kill (`sessionOps.end`) runs only for a live agent; `ended` is vacuously true
   for fromDead (nothing to close).
3. The relaunch (stopNow bootout + startNow bootstrap) and the #3418 loaded-verify run
   for both. jobFor already proved the plist exists, so there is a job to bootstrap;
   bootout on an unloaded job returns code 3 (success), then bootstrap loads it fresh.
4. Messages are fromDead-aware: success says "X is starting" (no "again", it may never
   have run); PARTIAL drops the "we closed X's window" clause (there was no window).
5. disruption.begin runs for fromDead too (the board shows "starting", not "doesn't
   exist"); disruption.clear on the PARTIAL path, as the live path does.

No route change: POST /api/agent/<name>/restart already maps RESTARTED to success, so
Mona's button gets a real start (then verifies the agent comes up, per her PR).

## Tests (engine/remove.test.js)
- Updated "refuses on an untied window, but STARTS one that is not running": FOUND.UNTIED
  still REFUSED (no kill); FOUND.NONE now RESTARTED with a "starting" message (not
  "nothing to restart", not "starting again"), bootstrap called, no kill-session.
- NEW: FOUND.NONE + bootstrap fails -> PARTIAL, honest message (no "closed window", no
  "starting"), disruption cleared.
- Existing FOUND.OURS restart + #2019 disruption tests unchanged and green (75/75).

## Weakest premise (name it)
That a fully-dead agent's launchd job, once bootstrapped, actually brings up a session
(via the supervisor + KeepAlive) -- i.e. bootstrap is the missing mechanism. Confirmed
by Alexandra's manual bootstrap recovering Nora. The loaded-verify (#3418's op) confirms
the job loaded synchronously; the session itself comes up shortly after via the
supervisor (the same "its window comes up on its own" the live restart already promises,
and which Mona's button then polls for). If a job is loaded-but-sessionless (rare,
KeepAlive-transient), bootout+bootstrap reloads it; loaded-verify still confirms the job.

## Out of scope
- #3432 (codex CODEX_HOME) and #3419(a) (send-truncation): separate cards.
- A time-bounded session-existence poll inside restartInner: the loaded-verify catches
  the "job never loaded" symptom synchronously; the button owns the come-up poll.
