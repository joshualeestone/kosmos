# taskwake-8669: a task wakes its holder on an event

Card: kosmos#8669. Scope posted on the card (issuecomment-6964342997).

## Finished looks like
- A task set to wake on a PR merge tells one holder once after the merge, never before.
- The pending condition shows in `kosmos task show`, `kosmos task list` (both CLIs) and on the Tasks row and task page.
- Branch, file and time wakes work the same way.
- The card's own done-when (woken within a minute of the merge, on a real board) is measured at QA on a real board, not by these tests: the tests use a fake gh. By design the board ticks every 30 s and looks at a wake at most every 25 s, so the merge is found within about 30 s plus gh's answer; a board watching more than 10 pull requests and branches looks at each less often (20 GitHub reads a minute at most), and a holder is told only once idle and settled (50 s after going idle).

## What was built
- `engine/taskwake.js`: parse what a person writes (`owner/name#123`, `owner/name:branch`, a full path, `30m|2h|1d|HH:MM|YYYY-MM-DD HH:MM`), `prepare` (reads GitHub or the file once when set), `probe`, `checkTick` (once a minute per task, at most 20 GitHub reads a tick, oldest first), `fieldsOf` (the words every route shows), `owed` + `sweep` (one holder told once, repeatdue's delivery gates, copied).
- `engine/tasks.js`: `setWake` (person's wake is theirs; closed task refused; a new wake drops what the last found) and `saveWakeMet` (once, for the wake it checked). `withoutLocalPaths` drops a file wake's path.
- `server.js`: `POST /api/project/<id>/task/<n>/wake`, `wakeGh()` (the GitHub door's gh, bounded, no prompt), the minute tick, wake fields on Tasks rows.
- `engine/projects.js`: wake fields on project page rows.
- CLIs: `kosmos task wake` on Mac (`install/kosmos`) and Windows (`tools/windows/kosmos-cli.js`); the wake on `task list` lines; `task show` via `engine/tasklist.js`.
- Page: `tskWakeSentence`, a line on the Tasks row and `#tk-wake-line` on the task page.

## Decisions
- Board polls GitHub through gh (the GitHub connection's road), not the agent. Rejected: agent-side loop (the card's premise is that agents are not woken). Weakest: the Kosmos-held token road (githubdevice) is not read in slice 1.
- One holder told, the setter first. Rejected: every holder (one event, one pick-up).
- A busy holder is told when next idle (repeatdue's gates). Rejected: typing into a busy agent.
- A file over 8 MB is watched by size and modified time only (the hash runs on the board's thread).
- A file wake watches only an ordinary file under the home folder, outside hidden folders and Library (links followed), with one refusal sentence for every other path; page rows carry neither its path nor its fingerprint. Rejected: any absolute path (the board reads it for any agent on any project).
- An agent on the project may set a wake on any repository this computer's gh sign-in can see, and on any ordinary file under the home folder: no more than it can already read on this computer, as the same user. Rejected: only the project's folder (agents work in worktrees outside it). A PR closed unmerged and a deleted branch also wake, and say so.
- A holder not reached after three tries is recorded as not reached and not tried again, as a due repeat is.
- A branch 404 counts as gone only when the repository itself still answers (a lost sign-in also answers 404).

## Not in slice 1
Kosmos-held GitHub token road; several conditions per task; a page control to set a wake (CLI only); agent instructions text naming the command.
