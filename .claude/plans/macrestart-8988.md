# macrestart-8988: a Mac agent's card says when and why its process restarted (kosmos#8988, Mac half of #8979)

**Posture:** production

**Finished looks like:** after a Mac Claude agent's process exits on its own and launchd starts it again, its card reads
"Restarted at <time>: <why>" (the same words as Windows, `restartWhy`) until a turn on the restarted agent finishes. A
deliberate stop (kill-session) records nothing. A dead pane can never hold the agent stopped.

## Measured first (tmux 3.6a, on a private server)
- `pane-exited` fires after the pane is gone: no status, no capture.
- With `remain-on-exit on`, a `pane-died` hook reads `#{pane_dead_status}` / `#{pane_dead_signal}` ("term", "kill") /
  `#{pane_dead_time}`, then `kill-session` ends it: `has-session` answers 1, which the wait loop already acts on.
- `kill-session` fires no `pane-died`, so a stop is never recorded.
- A dead pane still reports its last command in `#{pane_current_command}`, so the startup allowlist would read a dead
  Claude as alive and adopt it forever. Hence the startup check.
- `set-option` and `set-hook` accept the session id (`$N`) as an exact target. Without a UTF-8 locale tmux prints a tab
  in `-F` output as `_`, so `session_id_exact` finds nothing. Every plist sets `LANG=en_US.UTF-8`, and so does the test.

## Change
- bin/agent-supervisor.sh
  - `died_file`: `<store root>/runs/<key>.died` (the run file's folder and key rule).
  - `arm_death_record` (after new-session, Claude only): on the AGENT'S OWN PANE (its id, kept on the session as
    `@kosmos_agent_pane`), `remain-on-exit on` and a pane `pane-died` hook that writes "<epoch> status <N>" or
    "<epoch> signal <name>" and kills the session. Never the window or session: a pane a person splits off and closes
    must neither end the agent nor be recorded (review 1 reproduced that). The hook's one command that ends anything is
    `kill-pane` of that pane, so it cannot fail: a failed hook command (a second kill of a session kill-pane already
    ended) is an error tmux shows over the pane of whoever attaches next, in view-mode, which makes that agent deaf to
    Enter (review 9 reproduced it; the MODE arm). The supervisor ends what a person's other panes leave. If the hook cannot be set, remain-on-exit goes
    back off. A path or name with a single quote, a # (run-shell reads # as a format), a ; or a \ gets no hook (a % is literal there, measured).
    The HASH arm pins it.
  - `agent_dead` (that pane's `#{pane_dead}` is 1, or the pane is nowhere on this server: its own hook closed it; a pane
    alive in another session is alive; with no pane id, every pane's must be exactly 1 in a session that is ours) and
    `record_dead_pane` (that pane's exit; a dead pane with no exit yet gets one more look).
  - The wait loop: a dead session is recorded and killed (then the usual sleep), so a missing hook cannot hold it.
    With the supervisor gone and the hook gone, the dead pane is kept until launchd starts the supervisor again,
    which replaces it (the RETURN arm). It is the real safety net: `remain-on-exit` is on before the hook is set, and a hook tmux later drops would leave
    the pane kept with nothing to end it but this (the WAIT arm).
  - When the agent's pane is dead, the whole session ends, including a pane a person split off and left running. That
    is the crash path today too (startup's "every pane is a shell: it crashed"), and before this change such a split
    pane kept a crashed agent's session alive, so the supervisor waited on it and the agent never came back.
  - Startup: an ours-session whose agent pane is dead is recorded and replaced, never adopted. Any of the three ends
    the agent's pane by id as well as the session (a session a person grouped with it shares that pane: GROUP arm).
    These session-ending paths apply to every runner, not Claude only: a session whose every pane is dead is never
    an agent to keep.
- engine/macrestart.js: `restartedFor(name)`: the died file, plus the run right after the one that died, when it is the
  last run and within 5 minutes after the death (measured in whole seconds, so the relaunch can share the death's
  second). A later launch of any kind takes the line with it, so a cleared line cannot come back. A death within a minute after a "kosmos <epoch>" stamp in the run file (a
  restart, switch or change Kosmos made itself, crashloop.noteDeliberate), with no start between, is Kosmos's own and
  shows nothing (a switch whose new process crashed is still said). A death before this boot is a shutdown's. An exit with code 0 shows nothing: Claude closed on purpose
  (a person typing /exit), not a crash to explain. Cleared by a turn end (the report hook's Stop, as
  `selfreport.history` marks it: `turn: 'end'`) at or after that start. A turn that ended in an API error reports
  StopFailure instead, so it does not clear the line, as on Windows. Words from `win32streamstate.restartWhy`.
- engine/crashloop.js `forget`: removes the death file with the run file, so a re-made agent does not inherit it.
- engine/status.js `restartedOf`: Windows as before; a Mac pane that is ours and runs Claude reads macrestart.

## Rejected
- Wrapping the runner to catch `$?`: changes the pane's process tree, which status.js classifies the pane by.
- The dead pane's screen on the card: an interactive Claude's last screen is the conversation (private).
- The hook alone: a hook that does not run would leave a dead pane holding the agent forever.

## Weakest premises
A cleared line is remembered in the board's memory (per agent and restart), so it is not read again at every poll; the
default self-report tail is read first, the whole record only when that is cut short of the restart.

A crash whose first relaunch failed and then succeeded shows nothing (a second launch ends the line).

The 5-minute window: a person's own stop and start within 5 minutes of a crash reads as that crash's restart, and a
crash whose relaunch came later than 5 minutes (the Mac asleep, the supervisor gone for a while) is not said.

A legacy -discord session (its card reads the name without that ending) and an agent in a named Kosmos (KOSMOS_WORLD)
get no death record: in a named Kosmos, its run file is filed under another name and data
folder than the board's card reads (as it is today, #5154), so a record could be read on another agent's card.

When even the whole self-report record (up to 4 MB) is cut short before the restart, the line is hidden rather than
shown stale.

That the finished-answer row is a reliable clearer. A Stop report lost while the board was down leaves the line up
until the next turn's Stop. It fails toward showing a restart a little too long, never toward hiding one.

## Tests
- supervisor.macrestart-8988.test.js: the shipped supervisor, a real tmux on a private socket in the test's folder.
  Arms: CRASH (exit 7 recorded, read after the relaunch) and STOP (nothing recorded), SIGNAL, SPLIT (a split pane
  ending neither ends the agent nor is recorded), WAIT (hook removed: the supervisor records and ends it), STARTUP (a
  planted dead session is replaced), RETURN (a dead agent pane beside a live split pane is recorded and replaced by the
  next launch). Each supervisor piece was removed in turn and its arm failed, and the supervisor's stderr must carry no
  shell error (it caught `session_id_exact` defined after its caller).
- engine/macrestart-8988.test.js: parsing, the window, a later start, exit 0, the clearer over real self-report files read
  by the real `selfreport.history`, and the card's
  Mac branch of status.restartedOf (ours, not ours, another runner).
