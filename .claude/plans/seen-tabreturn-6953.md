# seen-tabreturn-6953: the round-8 leftovers of #6951

Card: kosmos#6953.

## Finished looks like
"Viewed at" stops ageing while the person comes back to a task's page, and the five-second read's gate is run by a test rather than matched as text.

## Built
1. Coming back to the tab records the view again even when the conversation is unchanged (the tab-return listener clears tkMarked before it redraws), but only for a state the board recorded (tkRecorded): a state it refused, or that failed twice, stays settled, so a refusing or broken board is not asked on every return. It also needs the window focused (document.hasFocus): a tab turns visible when a covering window closes, with nobody choosing to look. The handler, tkTabReturn, runs on visibilitychange and on the window gaining focus (coming back from another app to an already visible tab fires no visibilitychange). It draws the way the five-second read does (onlyIfChanged): an unchanged conversation is not redrawn, so a selection or keyboard focus in it survives an app switch, and a changed one is drawn quietly. One return re-records once (two seconds), though each of its two events costs an activity read. A return to the tab is a look the person chose, and it costs one request. Other redraws of an unchanged conversation (an action, the five-second read) still record nothing new.
2. The gate moved into tkPollIfThere() (task page shown, tab visible, tkPresent), called from loadProjects behind `TK_OPEN !== null` (the lifted loadProjects tests run with no task open, where the new function is absent). A test runs it with each condition false and a control with all true.
3. Not built: a test that evaluates the whole page script for the new top-level statements. CI's browser-checks job loads the whole page in Chromium on every PR (render-url-state, render-tasks and more), which already runs those statements; a second check would duplicate it.

## Decided
- Re-record on a tab return only. Rejected: on every redraw (the poll would record every five seconds while the page is up, the volume #6951 settled), and a timer-based refresh (records views nobody made).
- A return while a record for the same state is still on its way sends nothing; that record's time stands (seconds off).

## Weakest premise
That a focused return to the tab, or the window gaining focus (every app switch back, an undocked devtools window closing), means a look. The screen waking or unlocking with the browser in front also gives a focused visible page with nobody necessarily there, and a person passing through a tab on the way elsewhere counts too; all count as a view, as opening the task does. A person switching tabs to reach something else passes through; that counts as a view, as opening the task does.
