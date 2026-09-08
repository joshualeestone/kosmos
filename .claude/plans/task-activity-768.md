# Plan: show a task's recorded activity in-app (#768/#992, first slice)

## Goal (what will be true when done)
On the task-view page, a read-only **Activity** list shows the task's recorded
lifecycle (created / assigned / part added / part done / put back / marked done /
reopened), oldest first, with relative times and resolved member names — so a
person can "get to it as a user" IN the app, not only by opening the folder.

## Why
- Josh, #768: "In the middle, very much just like viewing a project, we need a
  big activity. This is the activity about this particular task."
- Josh, #992: "record those conversations... I just want all the dialog stored
  and then I want to be able to get to it as a user."
- `engine/taskchat.js` already **records** every task lifecycle event as JSONL and
  has a `read()`, but **no HTTP route exposed it and nothing rendered it** — so
  #992's "get to it as a user" half was only a folder-reveal button.

## Scope of THIS slice (the first of #768)
#768 is a large redesign (three-column layout, task members list, a task
conversation, due date). Per the card's own owner split — "screen: Mona Lisa;
engine: Angel" — and Mona's routing note ("the build belongs to the Kosmos
implementation owner, Angel"), this slice takes the read-side foundation of the
middle "activity" column, WITHOUT the three-column reflow (the screen owner's
design slice) and WITHOUT the net-new pieces (a task conversation composer, due
dates). The activity list sits full-width below the existing two columns so it
does not pre-empt Mona's layout; it moves into her middle column later.

## Design
- **Server**: `GET /api/project/:id/task/:n/activity` -> `taskchat.read(id, n)`,
  returning `{ events, count }`. Read-only, keyed by the SAME (id, number) the
  record side used. Fail-soft: no file / unreadable both return 200 + [] (the
  page renders "Nothing yet", never an error).
- **Frontend**: `paintTaskActivity(n)` fetches on `openTaskPage` and re-fetches
  after an in-app mutation (`tkPartPost`, the done button) — NOT on the 5s poll,
  since a lifecycle event is rare. `tkActPhrase(ev, p)` maps each kind to a
  human phrase; an unknown kind renders as its bare name (never dropped). All
  text is escaped at the render site — `engine/taskchat.js` stores RAW text and
  its header says the render surface owns escaping. A post-await `n !== TK_OPEN`
  guard stops a slow fetch painting a page the person has left.

## Verification
- `server.task-activity-768.test.js`: oldest-first order, count == events.length
  (non-empty arm), fail-soft [] control. 3/3.
- `web.task-activity-768.test.js`: phrasing, empty state, unknown-kind fallback,
  stale-fetch guard, failed-read state, and an injection-payload escaping control
  (the dangerous-answer control). 7/7.
- `docs/browser-checks/render-tasks.js` extended: asserts the list renders the
  'created' event in the real board (waits for the async fetch). Passes; also
  satisfies the #1720 web-change gate.
- Full task suite (web.task-page, server.tasks-all-1382): green, incl. the
  pre-existing "no due date field" test (untouched by this slice).

## What I rejected / deferred
- The three-column reflow, a task members list, a task conversation composer, and
  due dates — later slices; the reflow + membership presentation are the screen
  owner's design calls (Mona), best done against the published mock.
- Re-fetching activity on the 5s poll: rejected — a per-open + per-action read
  stays fresh without a request every tick.

## Weakest premise
That the activity's placement (full-width, below the columns) is acceptable until
Mona's three-column reflow lands. Mitigated: it is additive and forward-compatible
(the content and the route survive the reflow; only the presentation moves), and
it does not touch the existing columns.
