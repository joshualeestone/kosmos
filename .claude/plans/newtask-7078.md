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
- Empty Tasks state: "Add one with +, or ask an agent to." (worded so in review 1) when the sheet is wired (the old line said
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

## Challenge loop iterations 2 (sonnet) and 3 (opus), validation, and Mona Lisa's design review (22:00 CDT)
- Validation red: the iOS routes sweep (server.ios-routes-6838) could not read the request, built away from its URL.
  Now named in place, as BoardRoom's room request.
- A kept draft whose project was archived or removed is re-aimed on every read (NewTask.settled).
  (SUPERSEDED in iteration 7, see below: the sheet now follows the board.) Was: a kept project that is still offered
  stays even when the Tasks tab has another picked (the board's openNewTaskFromTasks aims at the pick). Who and Part of were chosen for the kept
  project, and the sheet's whole point in keeping the draft is not to lose them. Rejected: re-aiming at the pick,
  which drops who and Part of unseen. Weakest premise: that a person reopening from another project's tasks sees the
  Project row and notices; would change if Mona Lisa or a real user says it surprises them.
- No answer is .unknown, not a refusal: status 0, or a 5xx with no sentence of the Mac's (the relay's plain 502/504
  when the Mac stops answering). The sheet says it cannot tell whether it went through and refreshes Tasks. The
  board says "could not add" here; it crosses no relay.
- A failed Tasks read no longer clears a Part of pick (keepingOffered with parents nil keeps it).
- The "Added task" announcement waits until the sheet has gone (posted as it closes, it is lost).
- Design review (Mona Lisa): the board's words, pinned against web/index.html (the hint under the questions, the
  examples, "Anything they should know", "You can give it to somebody later."); each question above its field at
  every size, with the example drawn as wrapping text (a placeholder keeps to one line and cut it); Part of before
  Who is on it.
- LEFT: the added line under "No tasks yet" until the refresh lands (brief); "Review N" comment style is common in
  this repo, removed here anyway.

## Iterations 4 (sonnet) and 5 (opus), and the design approval (22:19 CDT)
- Create is held until the projects are read; the Mac's answer is scrolled into view; a line break in either question
  becomes a space (the board's inputs are one line).
- Nothing sent is not "could not tell": when throughMac sends nothing (not connected, or no request built) the sheet
  says the board's "we could not add that task". Told apart in the view by noting whether a request was built,
  without touching BoardClient (Angel's).
- The board's limits: 200 for each question, 2000 for the details, counted in UTF-16 as the page counts, pinned
  against web/index.html's maxlength and engine/tasks.js. Over 200 the Mac shortens the title and says so only in the
  note the sheet does not show.
- A spinner stands in for Create while a create is in the air.
- Mona Lisa approved the design (#7078 comment 6392881242). The answer line is now plain text under the last
  section, as the hints are; VoiceOver hears it from create()'s announcement.
- DECIDED: the empty-state sentences stay the sheet's own. The board's ("Make a project first...", "Unarchive one,
  or make a new one...") ask for things the phone cannot do; the sheet's say "on your computer".
- LEFT (nits): "Create" and "Project" rather than "Create task" and "Which project" (Mona Lisa: keep Create);
  Return in a question does not move to the next field; required-ness of the second question is in its footer, not
  its label; a sheet left open across a client reset keeps its project list (the Mac then refuses, 404).
- Iteration 6 (sonnet): Create latches synchronously in its tap, before the Task starts, so a double tap cannot send
  two creates.
- DEFERRED (iteration 6): ios.yml runs only on ios/** changes, so a web/index.html or engine/tasks.js change to the
  words, limits or nt-go keys this suite pins goes green on its own PR and turns the next iOS PR red. Not this
  branch's to change: three sibling suites (settings, room, tasks) already read web/index.html under the same filter,
  the workflow is path-filtered on purpose (advisory), and widening it adds a macOS run to every web PR while #5488
  cuts avoidable Mac runs. Filed as its own card. Would change if that card decides to widen the trigger.

## Rebase onto #7074 and iteration 7 (opus, 22:26 CDT)
- #7074 (Angel's native task page) landed on main. Rebased: TasksView keeps #7074's row open (TaskPageView) and its
  taskLink beside this branch's sheet; ios.yml keeps both suites' steps. After the rebase: newtask 94/94, tasks 90/90,
  taskpage 108/108. "+ Add subtask" from the native task page stays out of this card (the page is #7074's; it can open
  this sheet with Part of picked as a follow-up).
- The kept project now follows the board's openNewTask: kept only while words are typed (what, details or done) and
  the project is still offered; with nothing typed, the sheet opens on the Tasks tab's pick. Supersedes the earlier
  decision (whose premise, "who and Part of were chosen for it", does not hold for an empty draft).
- The limits and one-line questions are applied in onChange after the field stores the value, not in a binding that
  refused it (a refused set left the field showing characters the draft did not hold). REASONED, not seen on a device:
  no UI automation here types past 200.
- The Part of picker draws from the last Tasks read that came back, so a failed read keeps the picked row visible.
- Another account or Mac (chatEpoch) closes the sheet and clears its draft and the added line.
- The done-when refusal fixtures use the engine's own sentence ("each done-when check ..."), pinned in engine/tasks.js.
- LEFT (nits): projectTree vs the board's pjSortByChain for a child of an archived parent; the 0.7 s announcement
  delay is a measured-by-nobody guess.
- Iteration 8 (sonnet): BLOCKER, the Release build did not compile: readProjects() used RoomStore.sampleProjects,
  which exists only in Debug. The sample branch is now inside #if DEBUG. Every earlier build was Debug and the logic
  suite never compiles this file, so nothing here could see it; a Release compile is now part of the local build.
- After "could not tell", Create stays held until the Tasks list is read again or the words change.
- LEFT: a parent task that closes between the pick and Create is dropped silently (the board's select does the same).
- Iteration 9 (opus): the kept project now matches BOTH branches of the board's openNewTask. With a project picked
  in Tasks, the sheet is for that project and a draft for another starts clean (ntAimAt clears the words). On All
  projects, a drafted project stays, else the first offered and the words follow. The iteration-7 note covered only
  the All-projects branch. (A picked project that is archived: the board files there anyway; the sheet offers only
  unarchived projects, so it falls back to the All-projects rule. LEFT.)
- After "could not tell" the sheet awaits the Tasks refresh itself. If the read shows an open task in that project with
  the sent words that was not there before the send, it is treated as made. Otherwise Create is released only by a
  read that came back, or by the words changing; a failed read keeps the hold.
- A create still in the air when the account or Mac changes is dropped (chatEpoch captured at the tap).
- Proven: the Release compile of 88405fbf8c (the #if DEBUG fix) succeeded, XCB_RC=0.
- LEFT (nits): members without their role; Who is pruned only against the projects read made when the sheet opens;
  + sits leading (Mona Lisa reviewed the shot with it there).
- Iteration 10 (sonnet): after "could not tell" the sheet makes its own Tasks read (Board.readyTasksRequest through
  throughMac) and judges only what that read returns: the tab's shared list can be left unchanged by a refresh that
  was cancelled or overtaken, and an old list released the hold. BoardClient's tasksAt is private (Angel's file), so
  not used. Cancel and swipe-to-close stay off while that read is in the air, and a late "made" clears the draft only
  if it is still the one that was sent.
- LEFT (nits): the hold is also released by a programmatic rewrite of the words (the cap); `before` comes from the
  last read that came back, so a same-words task an agent made in between could be taken as this one.
- Iteration 11 (opus). The last four rounds found most of their warnings inside the "could not tell" hold, each fix
  adding a rule the next round found a hole in. Simplified instead of patched again: the hold is lifted ONLY by the
  person changing the words (any of the three). A follow-up read that finds the task closes the sheet as made; a read
  that does not find it proves nothing (the Mac may still be filing it) and lifts nothing. Create and the form are
  also off while that read is in the air.
- Opened from a project picked in Tasks, the sheet shows that project as fixed text, not a picker, as the board's
  dialog hides nt-projrow there. So a draft cannot be moved off the picked project and then cleared on reopening.
- LEFT (nits): two Tasks refreshes can start together after a found-after-unknown; Swift and JS trimming differ on a
  few code points (a sentence edged with U+FEFF is never found, so the hold simply stays); firstProject is pinned by
  the tests while settled uses the first offered directly; sampleNewTaskShown outside #if DEBUG.
- Iteration 12 (sonnet): the hold lives with the draft in the Tasks tab, as "the words that got could-not-tell"
  (NewTask.heldBack: same project and the three fields, trimmed). Closing and reopening no longer lifts it; other
  words or another project are another task, so it lifts by itself. Cleared on a made task and on another account.
- 502 and 504 are always unknown, whatever their body says: they are a gateway's. The Mac's task create never sends
  either (server.js uses 502 only on the community routes, for an outside service; its 503s are its own "not done"
  sentences and stay refusals, with a control). Not pinned by a test: a source pin on status codes would be brittle.
- Tests after the rebase: 108/108 now (the 94/94 above is the count at that time).
- LEFT (nits): a rewrite in onChange could reset an IME composition at the limit (reasoned, not tried).
- Iteration 13 (opus): the held words explain themselves and can be released. Whenever the draft is the held words,
  the sheet shows the could-not-tell line (on any opening, not only the one that got the answer) and a "Create it
  anyway" button: the person who has looked in Tasks decides. A Tasks-tab read that shows the held task (found, against
  the numbers there when it was sent) clears the hold and, if unchanged, the words. Weakest premise: a person may press
  Create it anyway without looking; the line says to look first, and the board offers no guard at all here.
- settled uses firstProject for All projects, so the tests of firstProject cover the shipped path.
- LEFT (nits): any 2xx is made even without a task object (the board's res.ok does the same); two Tasks refreshes can
  start together after found-after-unknown.
- Iteration 14 (sonnet): an answer line clears when the draft changes (a refusal is about the draft that was sent);
  held words keep their own line from the hold.
- DEFERRED (iteration 14): Return in a question becomes a space rather than moving on. Single-line fields would let
  Return submit, but typed words would then scroll sideways instead of wrapping, which the largest-text design review
  just fixed. Parity with the board's one-line inputs is kept by oneLine. Would change with a design call from Mona Lisa.
- Iteration 15 (opus): when the Tasks tab's own read finds the held task while the sheet is open, the tab treats it as
  made: it closes the sheet, shows "Added task N to <project>.", and clears the hold and the unchanged words (before,
  it blanked the draft under an open sheet that could not recover).
- LEFT (nits): two Tasks refreshes can overlap (pull-to-refresh has the same pattern); a Held record survives a draft
  cleared by reopening from another project, so the same words for the old project show the hold again (arguably
  right: they may be a duplicate). The fixed Project row at the largest size is in the shots.
- Iteration 16 (sonnet): the sheet's own follow-up read reports a found task only while the hold is still set; when
  the tab's read found it first, the tab has already said so and closed the sheet (no second "Added task" or second
  announcement).
- DEFERRED (iteration 16): create()'s early return after Create's tap latch resets sending by hand (fragile to a future
  early return, no live bug); reopening from a picked project discards a kept draft for another project without saying
  so (the board's ntAimAt does exactly this, silently).
- Iteration 17 (opus): after a found task the draft is cleared by the hold's own comparison (project and the three
  fields, trimmed), not by full equality, so a changed pick or a stray space no longer leaves the same words behind with
  Create on. The tab closes only a sheet showing the held words (one with other words may be creating another task).
  The spinner stands in for Create during the follow-up read too.
- LEFT (nits): the held line on a reopened sheet sits in the last footer and is not announced; members without role;
  the sample projects' ids do not match the sample Tasks list, so Part of is empty in the shots; the view state
  (hold, tab-found close, epoch drop) has no automated test (no UI test target here), only the logic it calls.
- Final shots: "Create it anyway" drew in the app's own tint (black) and read as one more footer line; now the chat's
  link colour, semibold.
- Iteration 19 (opus, after that change): the Tasks tab's found-the-held-task path now announces "Added task N to X."
  as the sheet's own path does; the sheet's projects read drops an answer that lands after an account or Mac change.
- LEFT (nits): + is drawn only with a Tasks read (the board's tsk-new is not gated on it); Result.made(note:) is read
  only by the tests; oneLine makes a pasted break a space where the board's input drops it.
- Iteration 20 (sonnet): "+" no longer needs the Tasks read (the sheet reads its own projects); Cancel and
  swipe-to-close work during the follow-up read after "could not tell" (the hold stays with the draft and the tab
  says "Added task" if it finds it later), so a down Mac is not a 30-second dead end.
- DEFERRED (iteration 20): the Part of picker draws the last read that came back while the prune keeps the pick on a
  failed read (deliberate, iteration 7: never drop a pick unseen); a stale parent is refused by the Mac with its own
  sentence. The hold has no expiry: a false "Added task" needs an agent to make a task with the same words in the
  same project in that window.
