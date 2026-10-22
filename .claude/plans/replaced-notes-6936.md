# replaced-notes-6936: the round-8 review notes on the replaced-by close (#6923 follow-up)

## Finished looks like
The five notes on #6936 are each built or decided on the card, with tests for the built ones, on main.

## Items
1. Older Kosmos ignores --replaced-by: both CLIs add "To undo that: kosmos task reopen <project> <n>". Windows prints the project slug it sent, so the line pastes. Tested on both (the Mac path gets its first older-board test: a pass-through fake that answers only the close as an old board does).
2. The replace-loop walk follows replacedBy on any task. Chose a test over a code change: every reopen goes through setClosed(null), which deletes the link; the test pins "an open task never carries replacedBy" across plain, reasoned and person reopens, with a control.
3. Decided, no change: a replaced subtask counts as done in the parent's counts (reasoning on the card). Weakest premise: the replacing task may sit outside the parent.
4. web/index.html: replacedLine moved above the #4787 comment, which documents repeatLine.
5. server.js: a well-formed body with another key is told "a close takes only replacedBy"; unreadable bodies keep "we could not read that request". Tested per body.

## Rejected
- Walking only closed tasks in the loop check (item 2): safe either way today; a test changes no behaviour.
