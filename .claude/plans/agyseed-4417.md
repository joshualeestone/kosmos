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
  - the folder is in agy's trusted list: engine/agytrust.js now prints `trusted` only then (review 3), since an agy
    on its "trust this folder?" prompt is waiting on the person, not idle;
  - agystatus.lastKnown() has signedIn true. PRECISELY: Kosmos has confirmed a sign-in on this Mac at some point and
    not since seen agy uninstalled (remember() keeps that answer over a later "could not confirm", which is what a
    signed-out check returns). So this keeps out an agy never signed in; it does NOT catch a sign-out since.
  The pane id comes from `new-session -P -F '#{pane_id}'` (review 3: a lookup by bare session name can resolve another
  agent's session if agy has already exited). Of the pane's env list only KOSMOS_*, AGENT_WORKFORCE_* and HOME are
  added to the bridge's command; the bridge still inherits the supervisor's own environment (it is Kosmos's code).
- Not Windows: a Windows agy agent does not start through this supervisor (engine/win32supervisor.js), so a
  restarted Windows Antigravity agent still reads "Can't tell" until its first turn.

## Rejected
- status.js guessing Idle for "running, no report": a state the agent never sent, and wrong for an agy with no hooks.
- Posting from the supervisor with curl: a second copy of the bridge's headers (token, board token, world).

## Weakest premise
- The REAL /api/report route accepting the seed is not measured: the sandbox used a stand-in board that answers {}.
  The route resolves the sender by pane (a live snapshot) and launch token; a pane seconds old should resolve like any
  hook's, but a {recorded:false} would be discarded silently. To be checked live after release (needs-release).
- Timing: the seed is sent synchronously as the pane starts and agy takes seconds to boot, but it is not guaranteed
  to land before a turn a launch prompt starts. If it lands mid-turn the card reads idle until agy's next hook:
  PreInvocation fires before each model call, so normally within one model call, at worst until that turn's Stop.
- Named worlds: the signed-in read (agystatus.lastKnown, via store.ROOT) relies on the supervisor exporting the
  world's AGENT_WORKFORCE_* roots, which it does when KOSMOS_WORLD is set; if that export fails it reads the default
  store, the same fallback the launch-token mint already accepts (review 2, deferred as a known limit).
- "Signed in" means confirmed at some point on this Mac (see Call); a sign-out since then would seed an idle for an agy
  on its sign-in screen until the person signs in and a turn runs, and a re-check does not correct it.

## Evidence
- Sandbox (real supervisor, fake agy, tmux socket zz-livecheck-4417, stand-in board): origin/main sends no report;
  this branch, signed-in record + hook + trusted folder: one idle, auto, from_pane %0, launch token present;
  git-project workdir: none; signed-out record: none; no record: none; agy settings a dangling link (trust fails):
  none. (The harness now points agytrust at a sandbox agy home: an earlier run had added its scratch folder to this
  Mac's real agy trusted list, which was then removed by hand.)
- engine/agyseed-4417.test.js 5/5 (bridge run against a stand-in board with an empty store root, so no real board
  token leaves; source pin on both gates and the env allowlist; agyhooks CLI `hooked` on a plain folder, silent for
  the off switch and a git project). engine/agyhooks.test.js 29/29.
