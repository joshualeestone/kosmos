# tasknative-7074: a native task page with Mark as done

Card: kosmos#7074, a gap in the native iPhone plan (#6838). Today's Check it and every Tasks row open the board's web
page for a task; Mark as done, the one task verb a person owns, lives only there.

## Finished looks like
On main, Today's Check it and a Tasks row open a native task page (pushed in that tab's navigation): the project, Task
N and its title, the detail (formatted as chat messages are), who added it and when, the state word with the built
mark, the due date and hold as read-only lines, who is on each part with the claim line, the close note, the subtasks
(each opens its own page) and the task it is part of, and the task's activity in the board's own words. Mark as done /
Reopen acts on the state last read, says the Mac's refusal, and re-reads. The page marks the task seen while it is on
screen. An info button opens the board's page for what this does not do. Checked by a new LogicTests suite
(run-taskpage.sh, in CI) with broken-copy controls, the iOS typecheck, and simulator shots light and dark.

## The board it follows (web/index.html on main)
- Data: GET /api/projects (the project list; each project carries `tasks` with parts, progress, claim, subtasks), as
  paintTaskPage; activity GET /api/project/<id>/task/<n>/activity; tkStateWord, tkAdded, tkMemberName, tkSayPart,
  taskClaimHtml, claimNotReported, the tk-note close note, tkPaintSubtasks, tkActPhrase, tkActRowsHtml (runs folded).
- Mark as done / Reopen: POST /api/project/<id>/task/<n>/close|reopen, refusal `error` else "we could not change
  that task"; then a re-read. Seen: POST .../seen while the page is on screen, a 5xx retried once after 3 s.
- Re-read every 5 s while on screen, as the board's tick.

## Decided
- **The Mac must read these as the person's screen**, and its isViaScreen does that only for a request saying
  `Sec-Fetch-Site: same-origin`: without it seen is refused (403), closing a task whose repeat the person set is
  refused with an agent's sentence, and a reopen is not recorded as the person's. Measuring this found #7075 (every
  native request lacked the header, so through Kosmos+ the tunnel also withheld the board token): fixed app-wide in
  PR #7076 (BoardClient marks every Mac-bound request, Board.forMac), so this page sets nothing itself.
- The stale guard compares with the task's real closed state (progress.closed, else closedAt). The board's guard reads
  only closedAt, so on a task whose parts are all done but has no closedAt its Reopen only repaints; the phone does
  what the button says.
- Not here, on the board's page by the info button: the task composer, due date and hold edits, parts (add, assign,
  done), Add subtask, Close them and this task, the receipt and undo, repeat controls.
- BoardRoom.swift (Mona Lisa's) is only called (projectsRequest, isProjectId), never edited.

## Steps
1. TaskPageLogic.swift (UIKit-free): parse, words, requests, answers, activity phrases. DONE when its suite passes.
2. TaskPageModel.swift: reads, the press, seen, the 5-second read, epoch guards; tests with an injected send.
3. TaskPageView.swift; Today's Check it and TasksView's row push it.
4. run-taskpage.sh + CI step; mutants; simulator shots; review loop; PR.
