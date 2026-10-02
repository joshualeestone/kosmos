# tmuxsocket-2955: Kosmos's tmux and a newer tmux on the same Mac

Card: joshualeestone/kosmos#2955. Angel measured it on Agent1s after the 2026-10-01 power-outage reboot: the board
(pid 792) started at 13:42:45 on Kosmos's bundled tmux 3.5a; at 13:42:48 the fleet's Homebrew tmux 3.6a started the
server on the default socket; two tmux versions cannot share a socket, so the board read no agent ("server exited
unexpectedly") until Angel pointed the bundled path at Homebrew's. Splinter put it ahead of #4409 slice 3 (19:47).
Mortals, checked the same evening: the same wall (bundled 3.5a against Homebrew 3.7c), hidden because its board was
started with AGENT_WORKFORCE_TMUX_BIN=/opt/homebrew/bin/tmux.

## Decided: NOT a private socket (the card's option 1)
Kosmos shares the person's tmux server ON PURPOSE: install/kosmos and install.tmux-pick.test.js record why (the adopt
audience: "you already have agents here" exists to show agents a person already runs in their own tmux). A private
socket would hide every one of them, and on the fleet every Discord bot. It would also need every existing agent's
launchd job rewritten (plists are written once) or its supervisor would restart the agent on the other socket and run
it twice. Rejected for those reasons; reopen if the adopt screen is ever dropped.

## Change
1. engine/status.js `tmuxRepick`: when the board's look meets the version wall ("server exited unexpectedly" with a
   socket on disk, or "protocol version mismatch"), it asks the known tmux binaries (/opt/homebrew/bin/tmux,
   /usr/local/bin/tmux) and switches the whole process to the first that can LIST the server: AGENT_WORKFORCE_TMUX_BIN
   (every engine module reads it at call time) and PATH (for bare `tmux` calls). Then the look is retried, in the same
   call: no restart. Only over this board's launcher pick, read once when the module loads: the marker
   (KOSMOS_TMUX_BIN_PICKED=1) AND the value the launcher recorded beside it (KOSMOS_TMUX_BIN_PICKED_AS, new in
   install/kosmos) must agree with AGENT_WORKFORCE_TMUX_BIN, so an explicit choice (a harness stub, a sandbox's inert
   tmux, a person's, or a harness in an agent's pane over an inherited marker) is never replaced. Kosmos's own tmux
   and the launcher's pick are always candidates, so the board follows a server back. Kosmos's own is found from where
   status.js is installed (<KOSMOS_HOME>/app/engine, two directories below <KOSMOS_HOME>/tmux/bin/tmux): the launcher
   does not export KOSMOS_HOME and the board's launchd job does not carry it.
   A search that found nothing waits a minute before it runs again. PATH gets the directory first once, never twice.
1b. engine/create.js binPaths: a NEW agent bakes the launcher's pick, not a tmux the board switched to; its supervisor
   switches at start if the wall is still there, and a removed Homebrew tmux cannot strand it. An existing
   agent's plist rewrite passes its own baked path to plistFor and is not touched.
2. bin/agent-supervisor.sh `_kosmos_supervisor_tmux`: the same rule, at each start of an agent's job, before its first
   look: if the baked tmux meets the wall, the first tmux on PATH, in the known places, or Kosmos's own that can LIST the server
   wins (Kosmos's own found through the engine-path pointer the board writes beside the installed supervisor, which
   lives in Application Support with nothing else, measured on Agent1s), and goes first on the supervisor's PATH (its own later calls, and the -e PATH
   it builds for some runners' panes). Plists are never rewritten, so this is where an old
   agent's choice can be made.
3. engine/status.js `lookProblemFor`: at the wall the detail line says a different version may be running the sessions,
   and says what the search did: found nothing, waiting a minute to look again, or not allowed (an explicit choice).
4. bin/agent-supervisor.sh twin_session_may_live: `printf | awk; $?` became `awk <<<"$_tl"; $?`, the same status (awk's
   exit is the answer: found or not), because the #632 pre-commit hook refuses any staged shell file with `$?` after a
   pipe and this line is on main. Equivalence measured both ways (found 0, missing 1).

## Rejected in review round 1 (my first design)
Preferring a system tmux at launch whenever it answered "no server", and recording the pick in a file for supervisors.
It made the pick a race between whoever ran `kosmos` last and the running board, the record was deleted by every
update (setup.sh replaces the tmux directory), an empty record aborted the launcher under set -e, and it tied Kosmos's
own agents to Homebrew's tmux, which a `brew upgrade` can pull out from under them. Now: with no server, nothing
changes (Kosmos keeps its own tmux); only a live server that our tmux cannot read moves anyone, and everyone moves the
same way, by asking that server.

## Weakest premise
That the board and the supervisors converge: both ask the live server the same question, so they land on the same tmux,
but only the board re-asks while it runs; a supervisor asks once per start. A supervisor that started a bundled server
before any newer one existed keeps it, and then the newer tmux (a person's, the fleet's) is the one that cannot read
(Kosmos sees its agents; the person's own tmux client does not). Not measured on a real reboot of a Mac with
Kosmos-created agents and a newer Homebrew tmux. And it can switch more than once: each time the server's owner changes
(a Kosmos-started server after a Homebrew one, then back), the board follows, one log line and one PATH entry each
time; only a search that found nothing is damped. Following the owner is the point, so this is accepted; a fleet that
mixes owners on one socket would show it as repeated switch lines in the board log.

## Tests
engine/status.test.js: the switch (env and PATH), an explicit choice never replaced, nothing that cannot list taken,
the look succeeding in the same call, the wall's detail and its controls. supervisor.tmux-reader-2955.test.js: the
switch at the wall (both wordings) with PATH; a working tmux, no server, a permission refusal and an unlisting
candidate all keep the baked path; the reader is called before the first look. Every guard mutated, each reds its
test. Round 3's run of the 208 test files that read the launcher, the supervisor, the status engine or create.js
found one red (engine.reachable.test.js: the two new test seams, now excused by name); it is rerun before the PR.
## Review rounds
- Round 1 (opus): my first design (a launch-time preference for the system tmux, recorded in a file for supervisors)
  REPLACED by the runtime rule above; see "Rejected in review round 1".
- Round 2 (sonnet): FIXED W: the switch was one-way (the bundled tmux was never a candidate), so a board that had moved
  to Homebrew's could not follow a later Kosmos-started server back; the launcher's pick is kept and stays a
  candidate (test: switch and switch back). FIXED W: a failed search ran on every look (a process per candidate, up
  to 5 s each, on the event loop); it now waits a minute (test). FIXED W: after a switch, new agents baked Homebrew's
  tmux into their jobs, the brew-upgrade exposure this design avoids elsewhere; plistFor maps the switched value back
  to the launcher's pick, an explicit path untouched (test). NOTED W (premise, already named): a supervisor asks once
  per start; its candidate set (PATH plus the two known places) is a superset of the board's. NITs taken: the "every
  module reads it at call time" comment names the two that cache (on private sockets); PATH no longer grows on
  repeated switches. LEFT NIT: one console line per switch, unthrottled (a switch is rare by construction).
- Round 3 (opus): FIXED W: Kosmos's own tmux was a candidate only after a switch in this process, so a board (or a
  supervisor) that started on Homebrew's could not follow a later Kosmos-started server; it is now always a candidate on
  both sides (tests on both). FIXED W: the plist mapping keyed on equality and silently re-baked an existing agent's
  Homebrew path on a rewrite; removed: new agents take the launcher's pick in binPaths, rewrites pass through (test).
  FIXED W: KOSMOS_TMUX_BIN_ORIGINAL rode the update chain; gone: the launcher's pick is read once at module load from
  the marker and its recorded value. FIXED W: a harness in an agent's pane inherits the marker from the server's
  environment; the recorded value must equal the current one, so its stub is never replaced (test in a fresh process).
  NITs taken: a no-socket arm (a clean Mac's serverless words start no search; removing that arm reds it); the detail
  says what the search did; the supervisor's PATH comment says what PATH reaches; the supervisor test is hermetic.
  LEFT NIT: the supervisor's probes have no timeout (its existing has-session loop has none either).
- Round 4 (sonnet): FIXED W: the launcher pick was judged once at module load, so a harness that loaded status.js
  first and then set its own stub could have it replaced (and create.binPaths would bake the real tmux); launcherTmux
  now answers only while the live value is that pick or one tmuxRepick wrote itself (test: a stub set after load is a
  choice; removing either half reds it). FIXED W: the supervisor took 3.5a's serverless "server exited unexpectedly"
  as the wall and searched at every agent start on a clean Mac; it now needs the socket on disk, as status.js does
  (test with a no-socket control; the explicit mismatch wording needs none). NOTED W (premise, now written): the board
  follows each change of owner, so it can switch more than once. NITs taken: create.js's helper sits above binPaths's
  doc comment, not between it and binPaths, and says a load failure instead of swallowing it; the plan's test count
  says what was actually run. LEFT NIT: $0 without a slash in a manual run (the derived path is skipped, harmless).
- Round 5 (opus): FIXED B: "Kosmos's own tmux is always a candidate" was false in every install: the board built it
  from KOSMOS_HOME (never exported, not in the board's launchd job) and the supervisor from beside its own script (in
  Application Support, with nothing else); my tests passed only through seams production never sets. Now the board
  derives it from where status.js is installed and the supervisor from the engine-path pointer the board writes beside
  it, both measured on Agent1s (engine-path names ~/.local/share/kosmos/app/engine; two up is tmux/bin/tmux). New tests
  use those derivations with no seam (the installed supervisor layout in a sandbox, with a no-pointer control; the
  board's formula and the setup.sh layout it rests on; create.js writing the engine directory into engine-path); each
  derivation reddened alone. FIXED W: the PATH comments say the whole directory moves ahead (Homebrew's node with it),
  as the launcher already does. FIXED W: the supervisor's socket check comment said it shares status.js's rule; it says
  where they differ (EACCES) and that the difference is the conservative side. FIXED W: the test seams reset the last
  search state too. LEFT NITs: a symlinked and a resolved path to one tmux are two candidates (one wasted probe); a
  stale socket file with a 3.5a client reads as "may be a different version" (hedged).
- Round 6 (sonnet): FIXED W: candidates were probed once per path, not once per binary (the bundle is a symlink to
  Homebrew's on Agent1s, so one tmux could be probed three times, each blocking up to 5 s); real paths now (test counts
  probes). FIXED W: the supervisor's own-tmux path was unnormalized (../..), so it never equalled the baked path and could
  reach PATH that way; normalized (the installed-layout test now compares exactly). FIXED W: an engine run under an
  older launcher (no recorded value) said "chosen explicitly"; it now says only that the launcher that started this
  board did not pick it. FIXED NIT: an old agent whose baked tmux is gone (a removed Homebrew) searched nothing and
  stayed stranded; it now looks for one that can read the server, else uses Kosmos's own (test with a control).
  DECIDED (W, kept): moving the winning tmux's whole directory ahead on PATH mid-run (Homebrew's node and claude with
  it). The alternative, a bare-tmux-only shim, would let a bare `tmux` and AGENT_WORKFORCE_TMUX_BIN disagree, which is
  the defect this card is about; the launcher already does the same at launch, and both comments say so. LEFT NIT:
  TMUX_LAST_SEARCH is meaningful only right after a failed look (every reader of it is).
- Round 7 (opus): FIXED W: the supervisor's PATH comment said the prepend reaches panes' -e PATH; that is built from the
  server's own PATH and the prepend reaches it only when that read fails; the comment says so. FIXED W: the installed-
  layout test matched the formula against itself and the two paths anywhere in setup.sh; it now anchors on the lines
  that lay the files down (the bundle's cp into app/engine, install_kosmos "$KOSMOS_HOME", the bin/app/runtime move,
  fetch_tmux "$KOSMOS_HOME/tmux"); moving the engine in the bundle builder reds it. NITs taken: the explicit-choice
  arm passes a stale recorded value, so removing the launcher's unset reds it; the supervisor's candidates are tried
  once per path; its pointer uses dirname "$0" as resolve_token_engine does; two detail wordings corrected.
- Round 8 (sonnet): FIXED W: a candidate probe could block a board request for 5 s each; probes now give up after 2 s
  (test: a 4 s candidate is abandoned in under 3.5 s; restoring 5 s reds it). FIXED W: the supervisor's socket check
  comment now says only the default socket is looked at (another socket starts no search, the conservative side).
  FIXED W: the pointer is read through the same normalized spelling as resolve_token_engine. DUPLICATE W: a board not
  started through the launcher has no pick and never switches (named in round 6's wording fix; the reviewer found the
  message true). NIT taken: the export line is split, the #2955 seams on their own lines. LEFT NIT: the supervisor
  de-duplicates by path, the board by real path (one extra probe on a symlinked bundle, harmless).
- Round 9 (opus): FIXED W: Open in Terminal attached with the agent's baked tmux, which after a switch is the one that
  cannot read the server; it uses the tmux the board switched to (status.switchedTmux), else the baked one (test in
  server.launch-terminal-2129; reverting reds it). FIXED W: a launcher pick that was removed after launch (a brew
  uninstall) left the board saying "could not run tmux" with Kosmos's own a candidate, and new agents baking the gone
  path; a gone tmux now also starts the search, and only a pick that exists is baked (launcherTmux), while the switch
  goes by the pick itself (launcherPick); test, each half reddened alone. FIXED CONVENTION: "removed or upgraded" was
  wider than the code (an upgraded Homebrew meets the same wall until its server restarts); now "removed". NITs taken:
  the detail line shows the home folder as ~ (no user name on screen; test); every status test pins Kosmos's own tmux
  to a missing path unless it sets one; the 2 s test's bound is under the 4 s it proves, not a tight 3.5 s; a
  tautological plistFor assertion removed (it could not fail); the redundant lazy require gone (status is required at
  the top of create.js; no cycle).

