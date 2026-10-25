# kosmos#7078: a native New task sheet on the iPhone Tasks tab (gap 2 of #7074)

Branch `newtask-7078`. Ice Cream Kitty, 2026-10-24 20:20 CDT.

## Scope
- NEW ios/Kosmos/NewTaskLogic.swift (UIKit-free): projects offered, project words, first project, members, Part of,
  the draft and its project switch, Create's rule, the request, the Mac's answers, the added line.
- NEW ios/Kosmos/NewTaskView.swift: the sheet.
- ios/Kosmos/TasksView.swift: a "+" toolbar button and the sheet (TasksTab), the added line under the title; nothing
  in the row's open callback (Angel's, #7074).
- NEW ios/LogicTests/run-newtask.sh + newtask/main.swift, and a step in .github/workflows/ios.yml.
- No pbxproj entries (ios/Kosmos is a file-system-synchronized group, Angel 20:15); no BoardClient/BoardLogic edits.

## Decided
- The sheet is the board's New task dialog (web/index.html nt- functions): project (ntChoices: not archived, chain
  order = projectTree A to Z), What needs doing + How will you know it is done? (both required, #5956), details,
  who (the members' session names, nt-who's value), Part of (open tasks of that project, newest first). A different
  project keeps the words and drops who and Part of (nt-proj change).
- The request is the board's nt-go body; Create is held down as ntGoState holds it.
- The Mac's answers read as nt-go reads them: its own sentence, the done-when refusal in the field's words, else
  "we could not add that task". After a create the Tasks tab shows "Added task N to <project>." under its title (the
  board's tsk-msg line), plus the Mac's same-text note when it sends one, and reads again.
- The "from the screen" header (isViaScreen): NOT set here. Angel's #7075 (PR #7076) makes every request through
  BoardClient carry it (Board.forMac); this branch rebases onto main after it lands. Rejected: Board.asPerson (being
  removed, Angel 20:15) or a second copy of the header.
- Projects are read by the sheet itself through client.throughMac (GET /api/projects, Board.parseProjects), so
  projects with no tasks yet can be picked; Part of uses the Tasks tab's own read.
- Empty Tasks state: "Add one with the + button, or your agents will." when the sheet is wired (the old line said
  tasks are made on the computer, no longer true). The board itself says only "No tasks yet."
- Left out (named on the card): "+ Add subtask" from the native task page (#7074's page), New task from a room, the
  board's "who was told" sentence after a create (heardSentence: a roster join the phone does not have here).

## Weakest premise
That #7076 lands as Angel describes (every throughMac request carries Sec-Fetch-Site). Without it the Mac records a
phone-added task as a process's and the runaway breaker counts it. This branch must not merge before #7076 is on main,
and the rebase must be checked by reading the request the client actually sends, not by trusting the rebase.
