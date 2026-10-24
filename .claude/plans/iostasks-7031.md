# iostasks-7031: the native Tasks tab on iPhone (kosmos#7031, slice 7 of #6838)

Spec: Mona Lisa, `~/work/workers/monalisa/ios-design-2026-10-19/slice7/SPEC.md` (#6838 comment 6381620158).
Coordinated with Angel (#7030, slice 4 Today, lands first): Today keeps its own `Board.ReadyTask`; this slice adds a
general `Board.Task` model and parser, which Today can filter in a follow-up. Shared files (`ShellLogic.swift`
AppTabs.isNative, `ContentView.swift`, `ios/LogicTests/main.swift`) are touched only after #7030 part 2 is on main.

## Scope
1. `ios/Kosmos/TasksLogic.swift` (UIKit-free, so LogicTests compile it on macOS):
   - `Board.Task`, decoded from `GET /api/tasks?view=tasks`, every state, tolerant of missing fields.
   - `Board.tasksRequest(mac:)` and `Board.tasks(_ data:)` -> `TasksRead` (rows, rosterUnknown). A
     `rosterUnreadable: true` answer is "cannot tell" for Needs Your Decision, never zero.
   - The board's own rules, mirrored from web/index.html and named after them:
     TSK_GROUPS (keys, labels, order), tskDot (decision neutral at 0 or unknown), tskSort('new': newest created
     first, the board's default), tskTitle (the title is the count: "N Tasks on M Projects", Josh #3949),
     tskRowsShareOneProject / tskLeaveOutProjectLine, tskChainOf and the picker's project order (sub-projects after
     their parent), the row line per group (decision wait line, assigned/working agent names, built line, repeat line),
     the "all subtasks built, ready for you to check" line.
2. `ios/Kosmos/TasksView.swift`: the SwiftUI list per the spec (grouped inset list, 8pt dot, count, Completed folded and
   closed on each appearance, Answer on decision rows, row opens the board's task page, picker menu, empty state,
   cannot-tell group, pull to refresh, accessibility labels and custom action).
3. `BoardClient`: a tasks viewer (show/hide, as Angel's todayViewer), reading all states.
4. Shell: Tasks native in AppTabs.isNative; ContentView's Tasks tab page; a row pushes the board's task page.
5. `ios/LogicTests/run-tasks.sh` + `ios/LogicTests/tasks/main.swift`, its own suite, wired in .github/workflows/ios.yml.
   The tests read the board's words from web/index.html where they can (TSK_GROUPS labels, TSK_DECISION_UNKNOWN), so
   the phone cannot drift from the board silently.

## Decided
- The title follows the board, not the spec's subhead. The spec asks for "N open tasks across M projects" under the
  title; the board replaced that line with a title that IS the count ("30 Tasks on 2 Projects", Josh 09-26 #3949).
  The spec's own rule is that the phone says what the board says, so the phone shows the board's title words.
  Rejected: the spec's subhead (it would say something the board no longer says).
- Group order is the board's TSK_GROUPS, Built but waiting fifth (Josh #3949), as the spec says.
- The model is `Board.TaskRow`, not `Board.Task` (as first agreed with Angel): inside `enum Board` a nested `Task`
  hides Swift's own `Task` from every Board extension. Told Angel.
- The board's "all subtasks built, ready for you to check" stands in for the row line, as the spec says. On the
  board it is a phrase beside a chip; on the phone it is the whole line, so it starts with a capital and ends with a
  period. The test checks the board still says the phrase.
- A row opens the board's task page by ?project=&task= (the board's WANT_TASK at boot), the same URL Today's Check it
  builds (#7030). Once #7030 is on main the two share one helper.
- The phone has no search or Created window (the spec leaves out the board's filters), so the scope is the project
  picker alone, and the sort is the board's default ('new').

- A row's task page opens UNDER TODAY in the board view (pushManager.boardToOpen), as Today's Check it does, not pushed
  on the Tasks tab as the spec draws it. The app has one shared board view, and every page it sends there opens under
  Today; a second web view for Tasks is more than this slice. A press on Tasks brings the native list back.
  Rejected: a second WebView pushed on the Tasks tab. For Mona Lisa's design review.
- The board's own Tasks section (a project's View all, a board link) stays under Projects now that Tasks is native
  (AppTabs.barTab), as the board's Settings section shows under Today. Lighting Tasks would cover that section with
  the native list. The hidden page moving never moves the bar off native Tasks (AppTabs.follow).
- One read for both tabs: BoardClient reads GET /api/tasks?view=tasks while Today OR Tasks is on screen (tasksViewer),
  keeping Today's readyTasks/tasksFailed as they were, and adding tasksList/tasksListFailed. An answer whose agents
  could not be read is a good read for Tasks (Needs Your Decision says it cannot tell), though Today reads it as unknown.
- "No tasks yet" shows when the board answers with no tasks. The tab itself is only in the bar once the board earns it
  (counts.tasksTab), so the spec's "before the board shows Tasks" state is never on screen; an earned board with no
  tasks is the same empty state the board shows.
- The press tests in LogicTests/main.swift that used Tasks as their board-page tab now use Projects (Tasks is native).

## Done so far
- TasksLogic.swift and LogicTests/tasks (79 checks, VERDICT PASS). run.sh 858/858, run-settings 41/41, run-actions 97/97. The suite reads TSK_GROUPS, TSK_DECISION_UNKNOWN,
  PJ_NEEDS_WHY and the ready-to-check phrase from web/index.html. A copy with Built and On a schedule swapped fails 3.

## Weakest premise
That the board's row rules can be mirrored as data without the page: the row line depends on agoWords and on agent
display names (tskAgentName). The logic takes both in, and the tests pin the words against the board's own strings.
