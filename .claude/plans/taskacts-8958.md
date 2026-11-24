# taskacts-8958: a task page's message, due date and words, natively (kosmos#8958 slice B1)

## Goal
Slice B1 of kosmos#8958 (plan and inventory on the card, comment 7127094136): the iPhone's task page lacked three of the
board's task-page actions that the info button sent people to the board for. Do them natively, as the board does:
- tk-say: a message on the task (POST .../task/<n>/message {text}), recorded on it and sent to its assignees;
- saveTaskDue: the due date (POST .../due {dueDate: YYYY-MM-DD | null});
- tk-editform: Edit title or detail (POST .../text, only what changed, an emptied detail as null).
Hold, repeat, the receipt and undo are B2 to B5. The info button stays (parts and subtasks are still board-only).

## Change
- TaskPageLogic: the requests (taskMessageRequest, taskDueRequest, taskTextRequest through one taskPost helper), the
  board's words, dueDay/dueString (the person's calendar, YYYY-MM-DD both ways), taskEdit (trimmed; title required;
  only what changed against the words the form opened with; line ends compared as a textarea gives them), and
  taskSaidLine: the board's #5842 "was not told" lines per agent (worst outcome when listed twice), with the held
  "out of usage" line said without the board's reset time, as the phone's other held lines (AgentInfoLogic).
- TaskPageModel: say (true when recorded, so the box empties; the line under it), setDue, saveText (true when the form
  can close), each reading the task and activity again after, as press does.
- TaskPageView: Edit title or detail under the title (a sheet with Save and Cancel), a Due section (a date picker and
  Clear, or Set a due date: a picker opened on a week from today, saved only by Set, so no date is recorded that
  nobody picked); the header's due line is gone (the Due section shows it), and the message box with Send and the board's note
  under the activity. 44 pt targets; refusals announced.
- server.ios-routes-6838.test.js: the three routes declared.

## Rejected
- A confirm before any of them: the board asks none.
- Showing the board's reset time on an out-of-usage line: the phone has no quotaResetWords; it says the sentence
  without the time, as its other held lines.

## Tests
- run-taskpage.sh: 56 new checks (189 in all) (requests, bodies, the null clear, bad dates refused, taskEdit cases, the write
  results, every said-line branch, and the model's three actions through the fake Mac). All 13 LogicTests runners pass.
- Mutant: dropping "Your message stays on the task." reds 3 checks. (Sending a nil due as Any is equivalent: Foundation
  writes it as null, and the test reads the wire.)
- Review 5: one date picker for every state (only the buttons change), so choosing a day does not rebuild it; the
  sample Mac records an edited title and the UI test checks the page shows it; a bad date is refused on the phone; an
  empty title refused while a line shows is announced.
- Review 3: a due draft lives only while it differs from the stored day (Board.keptDraft, Board.dueControls, tested),
  so a stored date moving under it never shows a stale change; the stored title is compared one line too (the board drops a stored line break and so sends such a title back as
  changed; the phone does not); the message
  box stays multi-line (a phone's Return is a line break in the chat's box too), a deliberate difference from the
  board's one-line field, which sends on Enter.
- Review 2: the date picker only chooses; Set saves and Cancel puts it back, in both states (the board's field saves
  once on change, never per day tapped); Set, Cancel and Clear are 44 pt both ways and stack at large text; a stored
  date the phone cannot read shows as kept, with Clear; the edit form stays locked through its re-read; the title is
  one line (a line break is a space); the sample Mac records a message in task 4's activity, and the UI test waits for
  the page to draw and for the message there.
- Review 1: Cancel is off while a save is out (a late answer cannot close a newer form); caps count UTF-16 units, as the
  board's maxlength; a lone \r is read as the board's form reads it; a picked date shows until the Mac's answer is read.
- KosmosUITests/TaskPageActionsUITests (3, in ui-sample.sh's lazy list): the page's actions (shots in light and dark),
  a message sent and the box emptied, the edit form opening with the title and closing on Save. Not run on this Mac
  (busy); CI's "ui tests (sample board)" runs it.
- swiftc -typecheck of every ios/Kosmos source at iOS 16: clean.

## Weakest premise
The UI test's path (Tasks tab, the sample row "Pages 1 to 8", the swipes to the message box) is written from the code,
not run; CI is the first run. "Set a due date" opening on a week from today is my call (a picker needs a date to show);
nothing is saved until Set.
