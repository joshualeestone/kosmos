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
- delete-leftover plan(): running if the session names the agent, OR a pane's claim is this world's launch key
  for it (launchidentity.launchKey; another world's `name+world` does not match), OR a pane works in the
  agent's folder (workerDir: the usable recorded folder, else workers/<name>; resolved once, as written and
  as a real path; pane folders compared as tmux gives them, so nothing per pane touches the disk on the
  board thread; case-blind on Mac/Windows; a folder boundary, not a prefix). A folder outside where Kosmos
  keeps agents is left out of this arm: plan() refuses one that exists a few lines later, and no pane can
  work in one that does not. The folder read uses the tmux that last listed panes (after any re-pick). Each listing line carries its
  pane id; a line without one refuses the plan (a folder name holding a newline); a pane with an EMPTY
  folder (dead, or a root process) holds nothing. The folder refusal names the session, never tmux.
- test-support/fake-tmux.sh answers the folder read from AGENT_WORKFORCE_FAKE_PANE_FOLDERS.
- Cost: a plan whose session and claim do not match makes a second tmux call (one list-panes).
- Rejected: adding `claim` or the folder to roster rows/PANE_COLUMNS (pinned shape, hand-built fixtures).

## Known limits, written in the code
- In a named world, a session renamed without its `+world` suffix is dropped by readPanes, so its claim is
  not seen (the folder arm still covers it while it works in its folder).
- One unreadable folder-listing line refuses every agent's delete until that pane closes (safe side).
- An empty folder is taken to mean "in no agent's folder" (a premise, not measured).

## Weakest premise
That a running agent has a tmux pane whose current folder is inside its folder, or its name/claim. An agent
that `cd`s out of its folder in a session named otherwise is still invisible; so is anything outside tmux.

## Not in this branch (on the card)
- settingsLeftovers and namedRecords still decide "running" by session name, so /api/removed can still LIST
  a running agent (deleting it now refuses). That is the "record" item.
- Windows has no folder check.
- The trust prompt and --resume: on a Mac Kosmos never launches with --resume, so that relaunch was the
  tester's own tooling.
