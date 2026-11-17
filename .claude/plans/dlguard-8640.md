# dlguard-8640: delete-leftovers never offers a running agent (#8640, part 3)

## Measured (PROVEN, engine/delete-leftover.running-8640.test.js on unchanged main)
- The delete-time running check (plan(), re-run by del) matched a live pane by SESSION NAME only.
- A pane in `<name>-discord` was already seen (the roster maps it back): safe.
- A pane in another session whose `@kosmos_agent` claim names the agent was NOT seen: the plan offered the
  running agent's folder and job, case-blind or not. 2 of 5 arms red on main.

## Change
- status.paneLook(): ONE tmux read, returned as the roster (unchanged shape, pinned by fixture-discipline)
  and the claimed panes { claim, session }. Throws as paneRoster does, so the check fails closed.
- delete-leftover plan(): a pane whose claim names the agent (case-blind where the disk is) counts as
  running; the refusal names its tmux session.
- Rejected: adding `claim` to roster rows (pinned shape; every hand-built roster fixture would need
  re-reading); a second tmux read (doubles calls and broke #7819's single-read failure test).

## Weakest premise
That a pane under a running agent carries either the agent's session name or its claim. A relaunch that does
neither (a bare `claude` in some other session) is still invisible. Not covered: a process-level check
(cwd inside the agent's folder), which would need a new pane column or lsof.

## Not in this branch
The trust prompt on relaunch, --resume of a missing session, and the removed record that lists live agents.
