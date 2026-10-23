# seen-tabreturn-6953: the round-8 leftovers of #6951

Card: kosmos#6953.

## Finished looks like
"Viewed at" stops ageing while the person comes back to a task's page, and the five-second read's gate is run by a test rather than matched as text.

## Built
1. Coming back to the tab records the view again even when the conversation is unchanged (the tab-return listener clears tkMarked before it redraws). A return to the tab is a look the person chose, and it costs one request. Other redraws of an unchanged conversation (an action, the five-second read) still record nothing new.
2. The gate moved into tkPollIfThere() (task page shown, tab visible, tkPresent), called from loadProjects behind `TK_OPEN !== null` (the lifted loadProjects tests run with no task open, where the new function is absent). A test runs it with each condition false and a control with all true.
3. Not built: a test that evaluates the whole page script for the new top-level statements. CI's browser-checks job loads the whole page in Chromium on every PR (render-url-state, render-tasks and more), which already runs those statements; a second check would duplicate it.

## Decided
- Re-record on a tab return only. Rejected: on every redraw (the poll would record every five seconds while the page is up, the volume #6951 settled), and a timer-based refresh (records views nobody made).

## Weakest premise
That a tab return means a look. A person switching tabs to reach something else passes through; that counts as a view, as opening the task does.
