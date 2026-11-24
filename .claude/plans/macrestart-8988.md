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
    must neither end the agent nor be recorded (review 1 reproduced that). If the hook cannot be set, remain-on-exit goes
    back off. A path or name with a single quote or a # (run-shell reads # as a format) gets no hook.
  - `agent_dead` (that pane's `#{pane_dead}` is 1; with no pane id, every pane's must be exactly 1) and
    `record_dead_pane` (that pane's exit).
  - The wait loop: a dead session is recorded and killed (then the usual sleep), so a missing hook cannot hold it.
    It is the real safety net: `remain-on-exit` is on before the hook is set, and a hook tmux later drops would leave
    the pane kept with nothing to end it but this (the WAIT arm).
  - When the agent's pane is dead, the whole session ends, including a pane a person split off and left running. That
    is the crash path today too (startup's "every pane is a shell: it crashed"), and before this change such a split
    pane kept a crashed agent's session alive, so the supervisor waited on it and the agent never came back.
  - Startup: an ours-session whose panes are all dead is recorded and replaced, never adopted.
- engine/macrestart.js: `restartedFor(name)`: the died file, plus the LAST start in the run file, within 5 minutes after
  the death (a later start is a launch of its own). An exit with code 0 shows nothing: Claude closed on purpose
  (a person typing /exit), not a crash to explain. Cleared by a self-report row idle "finished responding" (the
  report hook's Stop) at or after that start, not by an operator's row. Words from `win32streamstate.restartWhy`.
- engine/status.js `restartedOf`: Windows as before; a Mac pane that is ours and runs Claude reads macrestart.

## Rejected
- Wrapping the runner to catch `$?`: changes the pane's process tree, which status.js classifies the pane by.
- The dead pane's screen on the card: an interactive Claude's last screen is the conversation (private).
- The hook alone: a hook that does not run would leave a dead pane holding the agent forever.

## Weakest premises
The 5-minute window: a person's own stop and start within 5 minutes of a crash reads as that crash's restart. It fails
toward showing the line, never hiding a real one.

That the finished-answer row is a reliable clearer. A Stop report lost while the board was down leaves the line up
until the next turn's Stop. It fails toward showing a restart a little too long, never toward hiding one.

## Tests
- supervisor.macrestart-8988.test.js: the shipped supervisor, a real tmux on a private socket in the test's folder.
  Arms: CRASH (exit 7 recorded, read after the relaunch) and STOP (nothing recorded), SIGNAL, SPLIT (a split pane
  ending neither ends the agent nor is recorded), WAIT (hook removed: the supervisor records and ends it), STARTUP (a
  planted dead session is replaced). Each supervisor piece was removed in
  turn and its arm failed.
- engine/macrestart-8988.test.js: parsing, the window, a later start, exit 0, the clearer and its controls, and the card's
  Mac branch of status.restartedOf (ours, not ours, another runner).
