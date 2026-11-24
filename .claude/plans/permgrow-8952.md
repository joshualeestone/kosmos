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
