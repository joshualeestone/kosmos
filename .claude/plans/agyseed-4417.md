# agyseed-4417: a restarted Antigravity agent says Idle, not "Can't tell", before its first turn

## Why
#4414 (Josh 2026-09-28 15:15): one of two Gemini agents "didn't update its status indicator", even after a restart.
agy's hooks are PreInvocation (working) and Stop (idle) only; there is no session-start event. So an agy agent that
was just (re)started and not spoken to sent the board nothing, and engine/status.js's agy arm reads a running pane
with no report as UNKNOWN ("Can't tell"). The API-key Gemini CLI has SessionStart, so it never had this gap.

## Call
- bin/agy-report-bridge.js: a Kosmos-only event, KosmosLaunch -> idle, auto. Not in STATE_FOR_EVENT (that map is
  what agy's hooks fire). It reads no stdin (the supervisor sends none).
- bin/agent-supervisor.sh, agy arm: right after new-session, run the bridge once with KosmosLaunch as the new pane
  (TMUX_PANE from display-message #{pane_id}) with the pane's own env (PANE_ENV minus the -e flags: token, port,
  world). Before agy can start a turn, so it never overwrites a real working; `|| true`, so it never fails a launch.

## Rejected
- status.js guessing Idle for "running, no report": a state the agent never sent, and wrong for an agy with no hooks.
- Posting from the supervisor with curl: a second copy of the bridge's headers (token, board token, world).

## Weakest premise
That the seed always lands before agy's first PreInvocation. It is sent synchronously right after the pane starts,
and agy takes seconds to boot, but a launch that already carries a prompt could in principle race; the cost is one
idle that the next hook replaces.

## Evidence
- Sandbox (real supervisor, fake agy, tmux on socket zz-livecheck-4417, stand-in board): origin/main sent no report;
  this branch sent one idle, auto, from_pane %0, launch token present.
- engine/agyseed-4417.test.js: 4/4; 3 of 4 red on origin/main's bridge and supervisor.
