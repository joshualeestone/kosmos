# holdscreen-7184: the task page shows and sets what a held task waits for (kosmos#7184, screen half of #7180)

Owner: Mona Lisa. Routed by Splinter 2026-10-26 05:44; reference from Ice Cream Kitty (#7182, 975c5e1d94).
Design call posted on #7184 (comment 6414143491) before the build.

## Done when (from the card)
1. A held task on the screen says what it waits for, in the task list's words, and says when that has happened.
2. The person can put a task on hold until another task in the project closes, or until a date and time, and can
   change or clear that.
3. Holding or re-holding from the screen keeps the stored condition unless the person changed it.
4. Design shots (light and dark, desktop and phone) are on the card before the build is reviewed.

## What it does
- engine/projects.js (joinTaskClaims, withParts): every served task carries `holdUntil`, tasks.holdUntilState's
  { words, met } or null, so the page never works out "met" (a task that is gone counts as met, the engine's rule).
- web/index.html, the task page's hold row:
  - a line, only while held with a condition: "Waiting for task 2 to close." (plain words since the first shots; the Until choice names the task), "Waiting until Wed, Oct 28,
    9:30 AM." (the person's own clock), "Task 2 is closed, so this can come off hold.", "That time has passed, so this
    can come off hold.", "Task 2 is no longer on this project, so this can come off hold.";
  - "Wait for" (Nothing in particular / Another task to close / A date and time), the project's other open tasks or the
    browser's date-and-time picker, and Save, shown only while held. The form follows the stored condition unless the
    person has an unsaved change (the Repeats controls' rule), compared to the minute; Save sends exactly what it shows;
  - "Saving makes this hold yours, so only you can take it off." when the hold is not the person's (what the engine does);
  - "Put on hold" reads the task again first: if it is already on hold (an agent's, unseen by this page), it changes
    nothing and says "This is already on hold, so nothing changed." (done-when 3; round 1 also made it a fresh read, and Save reads first too);
  - the page's activity words gain #7182's: "Put on hold until task #N is closed", ", no longer waiting for anything",
    "What its hold waited for happened (...)". The parity test held only because no fixture carried a condition.

## Decided (reversible; reasons on #7184)
- Hold first, then say what for (no condition in the same click as Put on hold).
- Not on the task list cards in this slice; the held group already says On hold.
- The activity keeps the engine's words, so a time there reads as the stored ISO instant (the parity test holds the
  page to the engine); the waiting line above it says the time in the person's clock.

## Weakest premise
That the picker's local time is what the person means. It is sent as that instant (toISOString), so what they see is
what fires, wherever the board runs.

## Checks
- engine/holdscreen-7184.test.js: served holdUntil (unmet, met on close, a time, a time passed, a task gone, off hold);
  dropping the field turns both tests red.
- engine/taskactphrase.test.js: five new fixtures; main's page fails it (1 red), this page passes.
- docs/browser-checks/render-holduntil-7184.js (gated.txt, README row), light 1400 and dark 390: all pass; with the
  stale-page guard disabled it goes red (4), showing the agent's condition replaced and the hold made the person's.
- render-onhold-4771.js still passes. Related node tests 329/329, fixture-discipline and no-name-refs 24/24.

## Changes after the first shots (06:20)
- The waiting line names the task in plain words, not as a link: the inline link was a sub-44px tap target on a phone,
  and the Until choice right below names the task.
- The activity says a hold's time in the person's clock ("Put on hold until Wed, Oct 28, 9:30 AM"), on the page and in
  taskactphrase's page wording (its when()); agents (forAgent) keep the exact instant. holdcond-7180.test.js now pins
  both. Each shot screen has its own throwaway project: a reused name inherits task activity (#7185, filed).

## Review
- Round 1: 1 blocker, 4 warnings, 6 nits.
  - [BLOCKER] the page tests that lift paintTaskPage with a fixed helper list (web.task-page 11 red,
    web.notonproject-6895 1 red) had no tkPaintHoldUntil: stand-ins added; all fourteen web/server tests that lift these
    functions pass (129 + the six).
  - [WARNING] the new selects lacked the field fill render-fields asserts: added to the rule beside the Repeats selects.
  - [WARNING] the stale-page guard trusted the poll's list, which a failed read keeps and an overtaken read skips:
    both buttons now read the task fresh (tkHoldFresh) and change nothing when it cannot be read (tested with a 500).
  - [WARNING] Save could put back on hold, as the person's, a task an agent had just taken off: it reads first and
    changes nothing then (tested; with the guard disabled the check goes red).
  - [WARNING] a stored task that is gone left the select blank, which read as an unsaved change forever: it stays a
    choice, "#3 (no longer on this project)" (tested).
  - Nits taken: "This is already on hold, so nothing changed." (a page can be stale for hours, so not "a moment ago");
    the picker's min/max (now to a year ahead, the engine's bounds); the select's accessible name starts with its
    visible label; a bad task row cannot fail the projects read (holdUntil in a try).
  - Nits left: the repeated hour when the clocks go back (a stored time in that hour comes back an hour early through
    the picker; Save is off unless the person changes something, so nothing moves on its own); no year in the activity's
    time (holds are at most a year ahead); both recorded here, neither changes what is stored.
- Round 2: 1 blocker, 0 warnings, 5 nits.
  - [BLOCKER] the #2518 surface gate names four checks whose tokens the diff touches (render-onhold-4771: tk-hold-msg;
    render-unread-edge-3743 and render-agentdm-3414: msg; render-runrollup-5643: paintTaskActivity). All four were run
    through the harness on this branch and pass unchanged, so each gets a Browser-check-surface trailer saying so
    (the tokens are shared names; none of those checks' surfaces changed).
  - Nits taken: Save stays off while a save is in flight (a busy mark tkHoldDirty reads); a hold line is written only
    while its task is still on screen (tkHoldSay, the Repeats Save's still()); a task that is gone says so ("That task
    is no longer on this project, so nothing changed."), not "could not check"; the Until fields' accessible names
    start with "Until"; projects.js filters the task list once per read, not once per task.
- Round 3: 1 blocker, 1 warning, 4 nits.
  - [BLOCKER] web.file-pickers.test.js counts the buttons visibly reading Save (5); the hold Save made 6. Raised to 6,
    the new button named and its accessible name pinned beside the Repeats one. All 416 root web.*.test.js files now
    run on this branch: 3296/3296 (round 1 had run only the ones that lift page functions).
  - [WARNING] both hold POSTs built their URL from the live TK_OPEN after awaiting the fresh read, so a person who opened
    another task meanwhile put THAT task on hold: both use the clicked task's number now. Tested (a slowed read, a move
    to task 4 mid-Save); with TK_OPEN put back the check goes red and task 4 is held.
  - Nits taken: focus returns to Wait for after a Save (Save goes off under focus); taking the hold off forgets an unsaved
    choice, so a new hold starts from what is stored; an unsaved choice whose task has closed stays a choice; the
    render-onhold-4771 surface trailer's reason is corrected (Put on hold now reads the task first; the check passes).
- Round 4: 0 blockers, 2 warnings, 2 nits. The reviewer ran every root web test (3296/3296), 96 server and engine files
  (1348 pass, 0 fail), both gates (rc 0), render-onhold-4771 at HEAD (all pass) and the merge with main (clean, still
  six visible Saves).
  - [WARNING] Save's focus return could pull focus out of the message box a person had moved to: it moves only if focus
    is still on Save or lost.
  - [WARNING] one task's unsaved task or time choice stayed in the hidden fields and showed on the next task's form: a
    new task starts both fields empty (tested with a fifth task; without the reset the check goes red, showing "5").
  - Nits taken: "We could not check that task just now, so nothing changed." matches its sibling lines; Put on hold's
    refusal lines go through tkHoldSay too.
- Round 5: 1 blocker, 0 warnings, 3 nits.
  - [BLOCKER] browser-checks-teardown-guard-6022.test.js: the slowed-read route handler called route.fallback()
    outside a try (a poll held in its timer at teardown would crash the check after every PASS, as aborted 0.7.42 and
    0.7.44). Both route handlers in the check now run inside a try with an abort fallback; the root browser-check
    guards pass (78/78), and root web plus wiring tests 3308/3308.
  - Nits taken: this plan's top section describes what ships (plain words, the fresh reads); the README row lists every
    arm and says it boots its own board and is gated; the two hold buttons are never in flight together (Save disables
    Put on hold / Take off hold and the reverse).
- Round 6: 2 blockers, 0 warnings, 3 nits.
  - [BLOCKER] round 5's `getElementById('tk-hold')` put the bare token `tk-hold` into the diff, so the #2518 gate also
    named render-task-taps-5200.js (and tools.shell-shard-4317.test.js, which runs run-tests.sh, went red with it). The
    check passes on this branch through the harness (4ecdcd06c6): Browser-check-surface trailer added.
  - [BLOCKER] on a phone a long task sentence widened the task choice past the card (the page 516px wide at 390): the
    select and its row get max-width 100% and min-width 0. The check's fifth task now has a long sentence; without the
    rule its no-sideways-scroll arm goes red at both sizes.
  - Nits taken: the hold button's off-while-Save-is-in-flight is asserted; the picker starts at the next minute (the
    current one is refused as passed); Save's two fallback lines are sentences like their siblings.
- Every root *.test.js at 8ec5a56011: 10386 tests, 1 fail, which was the round-6 surface-gate blocker reached through
  run-tests.sh (tools.shell-shard-4317.test.js), fixed by the trailer.
- Round 7: 0 blockers, 0 warnings, 4 nits. CONVERGED. Gates rc 0 (five overrides), 3421 root and engine tests, the three
  browser checks all pass; the width rules hold at 1400 and 390 with a 90-character sentence.
  - Nits taken: a time the picker calls invalid (already passed) keeps Save off; a task whose own hold waits for this
    one is not offered (the engine would refuse it; a longer loop is still refused by the engine in its own words); the
    Put on hold fallbacks are sentences too; the render-fields comment is back on the fill rule it explains.
