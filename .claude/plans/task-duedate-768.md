# Plan: a due date on a task (#768)

## Goal (what will be true when done)
A task can carry an optional **due date**, set and cleared in place on the task
page and shown in the "This task" details. Setting/clearing it records a lifecycle
event so it appears in the task's Activity list. A nonsense date is refused, never
stored.

## Why + the authorization (this reverses a guarded decision, on purpose)
Josh's #768 body: *"on the right we could have some more detail: when it was
created, if there's a due date assigned, if there's any additional information
about the task."* An earlier deliberate decision (a `web/index.html` comment +
`web.task-page.test.js` guard) said NO due date, because *"nothing in Kosmos acts
on a date... it belongs here the day something reads it."* **#768 is that day** —
the task page now reads and shows it — so this is executing Josh's documented call,
not a unilateral design flip. Splinter green-lit flipping the guard in a commit
citing Josh's #768 authorization.

## Scope (this slice)
Set/clear + show the due date ON THE TASK PAGE. Not in the new-task creation modal
(a later, larger UI change if Josh wants it). Nothing schedules on the date — it is
information a person and a picking-up agent read, never a silent promise.

## Design
- **Engine (`engine/tasks.js`)**: a nullable `dueDate` (calendar date `YYYY-MM-DD`)
  on every task; `dueProblem()` validates format AND that it is a real calendar
  date (round-trips through UTC, so `2026-02-31` is refused); `setDue()` mutates +
  records a `due-set`/`due-cleared` taskchat event, no-op-safe on an unchanged value.
- **Server**: `POST /api/project/:id/task/:n/due { dueDate }` — validated by the
  engine (400 on a bad date, 404 on a missing task).
- **Frontend**: a `Due` details row with a native `<input type="date">` (set +
  clear in one control), painted from the stored value with a `document.activeElement`
  poll-guard, saved on `change`, and `tkActPhrase` renders the due events (so a set
  date shows in the Activity list, composing with the #2400 activity slice).

## Verification
- `engine/tasks.duedate-768.test.js` (7): field present + null default, set/clear,
  the malformed/impossible-date refusal control, the shared validator, the recorded
  event, no-op safety.
- `server.task-duedate-768.test.js` (4): set/clear/400/404.
- `web.task-page.test.js`: the guard FLIPPED to pin the field's presence, plus a
  paint test (input reflects the date, empty when none).
- `docs/browser-checks/render-tasks.js`: drives the real board — fills the date,
  confirms it persists after save+reload, and that "Due date set to 2026-12-25"
  shows in the Activity list (also the #1720 web-change gate).
- Full task suite (62): green.

## What I rejected / weakest premise
- Rejected adding the due date to the create modal (out of this slice; task is
  created then dated on its page).
- Weakest premise: that a display-only due date (nothing schedules on it) is what
  Josh wants. Mitigated: his #768 explicitly asks to SHOW "if there's a due date
  assigned"; a scheduler/reminder can build on this field later without a data change.
