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
  board's tsk-msg line) and reads again. (The Mac's same-text note is read but NOT shown: review 1.)
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

## After the rebase onto #7076 (20:30 CDT)
#7076 merged; rebased cleanly. Read, not assumed: BoardClient.init wraps env.send with Board.forMac, and throughMac
sends through self.env, so this sheet's POST carries Sec-Fetch-Site: same-origin to the Mac's host. Pinned in the suite
(the request through Board.forMac says it is the person's; CONTROL: a request to Kosmos+ is left unmarked). 51/51.

## Review 1 (blind, opus, 20:56 CDT): 0 BLOCKER, 4 WARNING, 6 NIT; taken except two NITs
It confirmed the body, Create's rule and the answer reading match the board's nt-go and the taskMake route, and that the
path stays the app's own (isProjectId before the path; host is held.url).
- W the Mac's same-text note was shown; the board's Tasks line leaves it out and its words are for the CLI ("kosmos
  task close ...") --> not shown.
- W closing the sheet threw the draft away; the board's Cancel keeps it --> the draft is the Tasks tab's (a binding);
  a create clears it.
- W a picked Part of (or member) that leaves the list under a re-read was still sent --> NewTask.keepingOffered on
  every Tasks re-read: it falls back to nobody/None, as the board's selects do. Tested.
- W Cancel was live while sending --> Cancel and swipe-to-close are off while a create is in the air.
- N VoiceOver never heard the refusal or the added line --> announced.
- N all projects archived said "make a project" --> its own sentence.
- N sample projects reachable in Release --> behind #if DEBUG.
- N the empty-state line reworded: "Add one with +, or ask an agent to."
- N tests: the forMac label says what it proves (the wrapper itself is pinned in LogicTests/main.swift); a padded
  sentence pins "sent as typed".
- LEFT: the role beside a member's name (the phone's project parse has no role; a same-name pair would need it), and
  the added line staying until the next New task (the board's tsk-msg line persists the same way).
