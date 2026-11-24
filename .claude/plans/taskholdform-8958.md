# taskholdform-8958: what a hold waits for and why, on the iPhone's task page (kosmos#8958 slice B8)

Stacked on taskparts-8958 (B7, 1ddfcd1962). Read and decided on 2026-11-24, and built the same day.

## What the board does (web/index.html tkPaintHoldUntil, tkHoldChoice, tk-hold-save; engine/tasks.js setOnHold, holdUntilOf)
Lines on a held, open task, in this order:
- "Why: <onHoldBecause>" (a full stop added when another line follows and it has none), then tskHoldConfirmedWords ("Last confirmed
  today / yesterday / N days ago.", not when onHoldForPerson), then tskHoldSuggestWords ("Suggested: ...", only onHoldForPerson).
- From holdUntil {words, met}: "task #N is closed": gone from the project -> "Task N is no longer on this project, so this can come
  off hold."; met -> "Task N is closed, so this can come off hold."; else "Waiting for task N to close." An ISO time: met -> "That
  time has passed, so this can come off hold."; else "Waiting until <weekday, day month, time>." The page never works out met.
The form, on a held, open task only:
- Wait for: Nothing in particular / Another task to close / A date and time. Until: a task, or a date and time (from a minute
  ahead to 365 days). Why: 200 characters, Optional. Save.
- The tasks offered: this project's open ones but this one; not one that itself waits for this one; plus the stored one even when
  closed, plus one chosen and since closed; a stored one that is gone as "#N (no longer on this project)". Words cut at 60.
- It shows what is stored unless there is an unsaved change; a field not touched follows the stored value (wait and why
  separately). Times compare to the minute. White space in why is tidied before it is compared.
- Save is on when something differs and the wait is whole; a time is checked as still ahead only if the wait was changed.
- "Saving makes this hold yours, so only you can take it off." when it is not the person's; with ", and the task leaves Needs Your
  Decision." when onHoldForPerson and the project is not paused.
- Save reads the task first: unread -> holdCheckFailed; gone -> holdTaskGone; no longer held -> "This was taken off hold, so nothing
  changed."; else POST .../hold {onHold: true, until when changed (or the stored one restated as it reads NOW, to the second),
  because only when changed}. Then "Saved."; refused: the Mac's words, else "We could not change what that hold waits for."; no
  answer: holdUnreached. Never in flight with Take off hold.
- Put on hold first, then the form (the board shows no form until it is held).

## Call
- A native sheet or section: a section under the hold button, as Repeats is, so nothing new to learn. DatePicker limited to the
  board's range. Same model rules as B3/B7: one save at a time, not beside a press, part, hold, repeat or reviewer write.
- The lines are drawn by the phone from the board's fields; pin the words to web/index.html as B6 and B7 do.

## B9, found 2026-11-24 while comparing the whole board page: also missing on the phone
- Done when (tk-donewhen-row: the checks, what agents say about each, and checks moved here, #8464 and #8668; reading only: find
  the painter and whether the board can edit them).
- The wake line (tk-wake-line, tskWakeSentence, #8669).
Then the info button goes or is relabelled, and the card's simulator screenshots are taken.

## Built, and where it differs from the board on purpose
- The lines (why, how fresh, the suggested answer, what it waits for) are under the hold hint, one line each, where the board runs
  them together; so no full stop is added between them. The form is its own section, On hold, under the hold button and Mark as done.
- What Save says is by its Save; what the hold button says is by the button (the board has one line for both).
- The date picker is limited as the board's is, but a stored time that has passed is still shown, never another drawn over it. A time
  chosen out of range says so (the phone's own words); the board's box does it by itself. The first time offered is tomorrow at nine.
- A condition the phone cannot read goes back whole when only the reason is saved, as the board sends it.
- A refusal, or Saved., goes once the stored hold reads otherwise; Saved. is not said over something else.
- The weakest premise: a menu holds every open task of the project (as the New Task sheet's Part of does), long on a big project.
