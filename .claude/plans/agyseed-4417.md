# agyseed-4417: a restarted Antigravity agent says Idle, not "Can't tell", before its first turn

## Why
#4414 (Josh 2026-09-28 15:15): one of two Gemini agents "didn't update its status indicator", even after a restart.
agy's hooks are PreInvocation (working) and Stop (idle) only; there is no session-start event. So an agy agent that
was just (re)started and not spoken to sent the board nothing, and engine/status.js's agy arm reads a running pane
with no report as UNKNOWN ("Can't tell"). The API-key Gemini CLI has SessionStart, so it never had this gap.

## Call
- bin/agy-report-bridge.js: a Kosmos-only event, KosmosLaunch -> idle, auto. Not in STATE_FOR_EVENT (that map is
  what agy's hooks fire).
- bin/agent-supervisor.sh, agy arm: right after new-session, run the bridge once with KosmosLaunch as the new pane
  (TMUX_PANE from display-message #{pane_id}), ONLY when both hold, because an idle report never decays and nothing
  else would correct it (review 1's blocker):
  - the hook is in place and on: engine/agyhooks.js now prints `hooked` on stdout only then (a folder inside a git
    project, a hooks.json left alone, or the person's `enabled:false` print nothing);
  - the board's last Antigravity check found it signed in (agystatus.lastKnown): a signed-out agy waits on the
    person at Google's sign-in, which is not idle.
  Only KOSMOS_*, AGENT_WORKFORCE_* and HOME from the pane's env reach the bridge (the pane also carries API keys).

## Rejected
- status.js guessing Idle for "running, no report": a state the agent never sent, and wrong for an agy with no hooks.
- Posting from the supervisor with curl: a second copy of the bridge's headers (token, board token, world).

## Weakest premise
- The REAL /api/report route accepting the seed is not measured: the sandbox used a stand-in board that answers {}.
  The route resolves the sender by pane (a live snapshot) and launch token; a pane seconds old should resolve like any
  hook's, but a {recorded:false} would be discarded silently. To be checked live after release (needs-release).
- Timing: the seed is sent synchronously as the pane starts and agy takes seconds to boot, but it is not guaranteed
  to land before a turn a launch prompt starts; then the next Stop replaces it.
- "Signed in" is the board's LAST check, not a live one; a sign-out since then would seed an idle for an agy on its
  sign-in screen until the person signs in and a turn runs.

## Evidence
- Sandbox (real supervisor, fake agy, tmux socket zz-livecheck-4417, stand-in board): origin/main sends no report;
  this branch, signed-in record + hook: one idle, auto, from_pane %0, launch token present; git-project workdir: none;
  signed-out record: none; no record: none.
- engine/agyseed-4417.test.js 5/5 (bridge run against a stand-in board with an empty store root, so no real board
  token leaves; source pin on both gates and the env allowlist; agyhooks CLI `hooked` on a plain folder, silent for
  the off switch and a git project). engine/agyhooks.test.js 29/29.
