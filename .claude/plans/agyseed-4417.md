# agyseed-4417: a restarted Antigravity agent says Idle, not "Can't tell", before its first turn

## Why
#4414 (Josh 2026-09-28 15:15): one of two Gemini agents "didn't update its status indicator", even after a restart.
agy's hooks are PreInvocation (working) and Stop (idle) only; there is no session-start event. So an agy agent that
was just (re)started and not spoken to sent the board nothing, and engine/status.js's agy arm reads a running pane
with no report as UNKNOWN ("Can't tell"). The API-key Gemini CLI has SessionStart, so it never had this gap.

## Call
- bin/agy-report-bridge.js: a Kosmos-only event, KosmosLaunch -> idle, auto. Not in STATE_FOR_EVENT (that map is
  what agy's hooks fire).
- bin/agent-supervisor.sh: the agy launch arm computes the gates and the pane id; the bridge runs once with
  KosmosLaunch AFTER the supervisor claims the session (@kosmos_agent, @kosmos_runner), because the board ties a report
  to an agent only through that claim (launchidentity.paneSessionIsOurs; review 5's blocker: the seed used to run
  inside the launch arm, before the claim, and a real board would have dropped it). ONLY when all three hold, because an idle report never decays and nothing else
  would correct it (review 1's blocker):
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
- The REAL /api/report route recording the seed is REASONED, not measured: the sandbox board answers {} to anything.
  What IS measured: at the moment the seed arrives the session already carries its @kosmos_agent claim (the stand-in
  board read it from tmux on receipt), which is what paneSessionIsOurs requires; before review 5's fix it did not.
  Checked live after release (needs-release).
- Timing: the seed is sent synchronously as the pane starts and agy takes seconds to boot, but it is not guaranteed
  to land before a turn a launch prompt starts. If it lands mid-turn the card reads idle until agy's next hook:
  PreInvocation fires before each model call, so normally within one model call, at worst until that turn's Stop.
- The seed runs synchronously before the supervisor's keep-alive loop: a board that does not answer delays the start
  of supervision by the bridge's own bounds (a second or two), not the agent, which is already running.
- The supervisor half is RUN in supervisor.agyseed-4417.test.js (review 7: the fake-tmux harness of
  supervisor.muse-launch-3939.test.js makes that possible; my earlier "needs a real tmux" was wrong): one idle sent as
  the pane new-session printed, after @kosmos_agent and @kosmos_runner; nothing without a confirmed sign-in, nothing
  for an untrusted folder, nothing on the adopt path even with every gate value inherited. Mutation: iteration 3's
  supervisor (seed before the claim) and origin/main's both turn the first case red.
- Named worlds: the signed-in read (agystatus.lastKnown, via store.ROOT) relies on the supervisor exporting the
  world's AGENT_WORKFORCE_* roots, which it does when KOSMOS_WORLD is set; if that export fails it reads the default
  store, the same fallback the launch-token mint already accepts (review 2, deferred as a known limit).
- "Signed in" means confirmed at some point on this Mac (see Call); a sign-out since then would seed an idle for an agy
  on its sign-in screen until the person signs in and a turn runs, and a re-check does not correct it.

## Evidence
- Sandbox (real supervisor, fake agy, tmux socket zz-livecheck-4417, stand-in board): origin/main sends no report;
  this branch, signed-in record + hook + trusted folder: one idle SENT (auto, from_pane %0, launch token present), with
  the session's @kosmos_agent claim already set when it arrived (iteration 3's order: claim absent on arrival);
  git-project workdir: none; signed-out record: none; no record: none; agy settings a dangling link (trust fails):
  none. (The harness now points agytrust at a sandbox agy home: an earlier run had added its scratch folder to this
  Mac's real agy trusted list, which was then removed by hand.)
- engine/agyseed-4417.test.js (bridge run against a stand-in board with an empty store root, so no real board
  token leaves; source pin on both gates and the env allowlist; agyhooks CLI `hooked` on a plain folder, silent for
  the off switch and a git project; agytrust CLI `trusted` for a trustable folder, silent otherwise), all passing,
  with engine/agyhooks.test.js, engine/agytrust.test.js and engine/create.test.js.
