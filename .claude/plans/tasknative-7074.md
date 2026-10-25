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
- **The phone's own requests here say they come from the person's screen** (`Sec-Fetch-Site: same-origin`). The
  Mac's isViaScreen (server.js) treats a request without it as a process: seen is refused (403), a close of a task
  whose repeat the person set is refused with an agent's sentence, and a reopen is not recorded as the person's. The
  same person on the same phone in the app's web view passes, because WebKit sends the header. Agents are told apart
  by their token, which the phone never sends. Rejected: changing the Mac to trust its Kosmos+ gate session, a wider
  change to the Mac's security model than this card needs. Weakest premise: that nothing between the phone and the Mac
  drops the header (the board's own requests carry it through the same path).
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
