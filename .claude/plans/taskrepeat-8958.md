# taskrepeat-8958: how often a task repeats, on the iPhone's task page (kosmos#8958 slice B3)

## Goal
Slice B3 of kosmos#8958 (plan on the card, comment 7127094136): the board's Repeats controls (tk-repeat-*) and the
repeat line, natively. Stacked on B2 (taskhold-8958); rebased onto main once B1 and B2 merge.

## Call
- In: the line (the board's own sentence, red while a run is missed), the frequency (Never, Every so many minutes,
  Every hour, Every day, Every week), its time, day or minutes, and Save.
- Out, to a slice B3b: "If missed, tell" (tk-review-who, the reviewer). It is its own control, saved on change, and
  needs the project's member list as a picker. Rejected folding it in: it doubles the review surface of this PR.
- Weakest premise: the times are the computer's clock and are shown in a fixed calendar, never moved by the phone's
  time zone. That matches the board's words in the line, but a person whose phone and computer are in different time
  zones sees the computer's time with no label saying so (the board has the same gap).

## Change
- TasksLogic: the repeat fields of one task are read by one helper, Board.fillRepeat, shared by the Tasks tab's rows
  and the task page (GET /api/projects carries the same fields, engine/taskrepeat.fieldsOf).
- TaskPageLogic:
  - TaskPage.repeatRow (the fields, when it repeats) and repeatStored (the rule as the controls show it; nil for a
    rule the controls cannot show, which then says to change it on the board).
  - RepeatChoice (each box keeps its value whichever frequency shows, as the board's inputs), repeatWire (the board's
    tkRepeatChoice: 030 is 30, 60 minutes is hourly, a daily rule's other times kept and sorted, nothing for an empty
    box), repeatBody, repeatNeeds (Say how many minutes, Choose a time), repeatStored (tkRepeatStoredChoice and
    tkRepeatShowChoice), keptRepeatDraft (a draft equal to the stored rule is dropped; a daily edit under a rule
    changed elsewhere keeps its box and takes the new rule's other times, tkRepeatFollowUnderEdit).
  - taskRepeatRequest: POST .../repeat through taskPost.
- TaskPageModel.saveRepeat: nothing for an empty box, a save in flight, Mark as done in flight, a closed task, or the
  rule already stored. Refusal: the Mac's sentence, marked as a refusal. Then page and activity are read, and
  "Saved." is said until the stored rule reads as something else.
- TaskPageView: the Repeats section on an open task, Save and Cancel, 44 pt targets, the answer announced.
- server.ios-routes-6838.test.js: the repeat route under taskPost's entry.

## Tests
- ios/LogicTests/taskpage: B3 section (stored rules, wire, bodies, drafts, time round trip, request, the line on a
  page read) and b3ModelTests (unchanged sends nothing, a save and its reads, Saved. retired by a change elsewhere,
  refusal, unreached, Saved. gone on a finished task, a box moved past the other daily time and saved). 277/277.
- server.ios-routes-6838: 5/5.
- UI: TaskPageActionsUITests.testRepeatIsChangedAndSaved (light and dark) against the sample board, which now
  stores a repeat rule (task 4 starts twice a day): the line says the stored rule, Save is off until a change,
  Every hour is chosen and saved, then the line follows, Save turns off and Saved. shows. 4/4 locally on an
  iPhone 16e simulator. ios/tools/ui-sample.sh tally 3 to 4 (its tests 6/6).
- The app's sources typecheck for iOS 16 (the view is compiled by no logic runner).
- Every iOS LogicTests runner, since TasksLogic.swift (fillRepeat) is compiled by most of them: run.sh 2255,
  run-tasks 167, run-room 907, run-actions 99, run-newtask 108, run-settings 48, run-agentinfo 295, run-composer 61,
  run-files 138, run-pullrefresh 48, run-sweep 45, run-orb, run-taskpage 270, all passing.

## Review decisions
- An edit keeps the person's choice as set, even when it equals the stored rule (Save turns off); only a change to
  the stored rule from elsewhere runs keptRepeatDraft. After a save the draft goes only once a read shows the saved
  rule, so a failed read leaves the controls on what was saved.
- A change to the stored rule from elsewhere: a draft that equals the OLD rule follows the new one
  (Board.followStored, the board's tkPaintRepeat review 3), so Never is never left showing over a rule an agent set.
  Any other draft stands, its daily other times following the new rule.
- keptRepeatDraft compares the draft with the stored rule as it stands BEFORE re-deriving a daily rule's other times:
  re-deriving first rebuilt them from the sorted stored list and dropped a time the box had moved past, after a save.
- Mark as done sends nothing, and is drawn off, while a Repeats save is out, as it already waits for a hold.
- The page's scroll view closes the keyboard on a drag (the minutes box is a number pad, with no return key).
- A finished task drops an unsaved choice and any Repeats line.
