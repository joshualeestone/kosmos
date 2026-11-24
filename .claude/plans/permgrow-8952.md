# permgrow-8952: kosmos#8952 slice (d), approve a long permission request from the phone

Finished means: when a Claude agent's permission box is too tall for its window (top cut, so slice (c) offers only No),
the agent's conversation (board, and the phone app's conversation page) shows the WHOLE request with Allow within a few
seconds, through the unchanged whole-box path. The lock-screen notice is unchanged (buttons only for a one-line command);
the window goes back to its size once the prompt is gone; a window a person is watching in a terminal is never grown.

## Measured (card comment 7131048790, 2026-11-24, Claude Code 2.1.331, tmux 3.6a)
- Agents start at tmux's default 80x24 (supervisor new-session passes no size). A 60-line mkdir shows 15 lines there.
- resize-window -y 200 redraws the whole box; the existing permissionCard reads all 61 lines unchanged.
- resize-window (and -A) sets window-size manual; restore = resize to the recorded WxH, then unset window-size.
- An attached client is panned to the top of a taller window and loses the question: never grow with a client attached.
- End to end on a real agent: tick grows, card whole, answer, tick restores and clears; attach while grown, tick restores.

## Built
- engine/permgrow.js: plan (pure), run (ordered tmux steps), anyPermissionWait (cheap gate), sweepOnce.
- server.js: a 3 s sweep beside class1's, gated by liveExecutionAllowed and AGENT_WORKFORCE_PERMGROW_OFF; the roster is
  built only when a window is grown or a hook reports a permission wait.
- chat.js exports its tmux() as tmuxCall (same runner seam and dry-run guard).
- Tests: engine/permgrow-8952.test.js (real captures as fixtures, real fleet cards), engine/permgrow-asking-8952.test.js.

## Rejected
- Transcript match (a PreToolUse hook can rewrite the command; card comment 7130937528).
- Growing with a client attached.

## Weakest premise
A taller screen changes nothing else the board reads from that pane while the prompt is up (status classify reads the
last 25 lines; the prompt sits at the bottom). Checked in review.

## Round 1 (opus) fixes
- Roster: the cached 20 s sweepRoster, read only when a window of ours is grown or a report not yet judged stands;
  a report judged (whole, no hint, too tall) is not read again; screens are read only for waiting agents.
- Worlds: the mark is "WxH@<world>"; a board acts only on its own marks.
- Fitted height: grow by Claude Code's own "↑ N more lines" + 4 (measured 24+50+2 draws whole), never a flat 200:
  blank rows under the box turned status.classify to unknown (measured). No hint: no grow.
- Brake restores; an unreadable mark restores to 80x24; a failed grow puts the size back; failures back off 60 s and log once.
- Skips a pane with a key answer or delivery under way (chat.paneKeysBusy); grouped-session clients count as watching.
- Tests: default viewport path through chat's runner; brake; back-off; worlds; mutations checked (world, flat 200, busy).

## Round 2 (sonnet) fixes
- Judged only on a final verdict (whole, or over MAX_ROWS); no prompt yet / no hint yet is unsure, read again up to 3
  times per report (the hook can report before the box is drawn).
- A grown window whose box is still or again cut grows again by its hint (mark kept).
- After a restore under a standing report, no regrow for that report (no grow/shrink loop).
- Report reads cached by file size and mtime.
- Deferred, with reason: restoring a window-size the window had set on purpose before the grow. Agents set none
  (supervisor new-session passes no size, nothing sets window-size); recording it would add a third tmux read per grow
  for a state that does not exist.

## Round 3 (opus) fixes
- MEASURED the reviewer's stitched-card concern: shrinking 78 -> 24 and 78 -> 40 under a standing prompt leaves the box
  cut (not answerable, no card; no old title or rule in scrollback). Kept as fixture + test (SHRUNK). The three fixtures
  are now one command, read the way viewport reads (-J -S -60).
- A grown window remembers the report it was grown for; a new report (a new prompt) puts it back, so a short box is not
  drawn at the top of a tall window; the grow loop regrows if needed. Unknown (board restart) counts as new.
- Waiting agents the sweep can never grow (not Claude, not ours, several panes, another board's window, removed) are
  settled per report; watched or windowless are unsure (3 reads). So a standing report stops costing a roster read per tick.
- Linked windows count as watched; failure and grown memory pruned to existing windows; the brake restores at once.
- Known, not handled: a board that stops (shutdown, or its world never returns) leaves its grown windows tall until it
  runs again. tmux older than 3.0 (user option in a format) is not supported by this sweep: the mark would read empty.

## Round 4 (sonnet) fixes
- Windows planned by #{window_id} (a grouped window is listed once per session), acted on by id.
- A grown window is kept for the box it was grown for, known by its request id the first time it reads whole; a
  different box puts it back; a report change under the same box changes nothing (replaces round 3's report-time key).
- Someone watching is looked at every tick without a screen read, never spending the unsure budget (a brief look no
  longer leaves the prompt ungrowable); an unreadable screen and a failed grow spend it.
- World id sanitised in the mark.
- Watching = max(session_attached, session_group_attached, window_active_clients). Round 3's window_linked was WRONG:
  every grouped window reads linked=1, so the real grouped run never grew. Measured window_active_clients on tmux 3.6a
  (0 unviewed grouped or linked; 1 viewed through either), then the real run passed.
- Stateful multi-tick tests (fake tmux that keeps height, mark, clients): grow once and keep, report ends under the same
  box, attach then detach, grouped duplicate row. Mutations checked: dedupe, watched budget, fingerprint.
