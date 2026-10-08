# missedcopy-5444: a missed run on a task never run says the miss once

Card: #5444 (the 0.7.26 design pass; this is the copy nit found when the missed-run screen was finally shot).

Finished means: a repeating task with a missed run and no run ever reported reads "Missed 3 runs, the latest due today at 9am. Repeats every day at 9am. Next tomorrow at 9am.", not "... Repeats every day at 9am. No run reported yet. Next ..."; a task with nothing missed and no run still says "No run reported yet."

Built: tskRepeatSentence adds "No run reported yet." only when tskRepeatMissed said nothing. Copy call (Mona Lisa, copy owner): the miss already says no run came; saying it again reads as a second problem. Rejected: rewording the miss to fold the two together (it would change the line every task with a real last run shows).

Tests: web.task-repeat-4787.test.js asserts both sentences exactly (the miss case was proven red with the fix undone; the no-miss sentence is its control). Browser: render-tasks-view-3559 (which the surface map routes this change to) gets an arm that takes the task's last run out of the store and reads the row: 297 pass locally.
