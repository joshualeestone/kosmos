# dlguard-8640: delete-leftovers never offers a running agent (#8640, part 3)

## Measured (PROVEN, engine/delete-leftover.running-8640.test.js)
- The delete-time running check (plan(), re-run by del) matched a live pane by SESSION NAME only
  (`<name>`, and `<name>-discord`, which the roster already maps back: that arm was always safe).
- On main, a pane in a renamed session whose `@kosmos_agent` claim names the agent was NOT seen (red).
- On main, a pane whose session and claim match nothing but which works in the agent's folder was NOT
  seen (red with the folder check removed). That is the tester's 9-day agents: on their Mac, their own
  tooling started those panes, and the board lists them as removed.

## Change
- status.paneLook(): one listing read as the roster (shape unchanged, pinned by fixture-discipline) and the
  claims { claim, session }. Throws as paneRoster does.
- status.paneFolders(): a second listing, `#{session_name}\t#{pane_current_path}`, because the folder is
  not one of PANE_COLUMNS. Throws when it cannot be read or every line is unreadable (fails closed);
  [] with no tmux server. With a pane source set it never asks tmux: tests inject setPaneFolderSource,
  and on WINDOWS (roster not tmux) it answers [] so the folder check does nothing there (follow-up).
- delete-leftover plan(): running if the session names the agent, OR a claim does (the part before `+`,
  for a named world), OR a pane works in the agent's folder or in a folder its profile records elsewhere
  (resolved once, as written and as a real path; pane folders compared as tmux gives them, so nothing
  per pane touches the disk on the board thread; case-blind on Mac/Windows; a folder boundary, not a
  prefix). Each listing line carries its pane id, and any line without one refuses the plan (a folder
  name holding a newline). The folder refusal says "something is working in X's folder"; neither
  refusal names tmux.
- Cost: a plan whose session and claim do not match makes a second tmux call (one list-panes).
- Rejected: adding `claim` or the folder to roster rows/PANE_COLUMNS (pinned shape, hand-built fixtures).

## Weakest premise
That a running agent has a tmux pane whose current folder is inside its folder, or its name/claim. An agent
that `cd`s out of its folder in a session named otherwise is still invisible; so is anything outside tmux.

## Not in this branch (on the card)
- settingsLeftovers and namedRecords still decide "running" by session name, so /api/removed can still LIST
  a running agent (deleting it now refuses). That is the "record" item.
- Windows has no folder check.
- The trust prompt and --resume: on a Mac Kosmos never launches with --resume, so that relaunch was the
  tester's own tooling.
