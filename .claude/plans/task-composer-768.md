# #768: the task-conversation composer (recorded-message first step)

## Problem
The #768 three-column reflow (PR #2899, merged) shipped the middle "Conversation" column
with an honest **inert** composer placeholder, because writing into a task's conversation
was blocked on #992 (tasks and messages did not know each other). **#992 is now closed** --
Ice Cream Kitty built `engine/taskchat.js`, which records a task's events, and my #2400
exposed the read side (`GET .../activity` + the activity list). So a task transcript now
exists to write into, but there was no write path: no POST route, no free-text event kind,
and the composer stayed inert.

## Approach
Make the composer functional as a **recorded-message** stream -- the first step of Josh's
#768 ask for a task conversation "like the project dialog":

1. **Engine** (`engine/tasks.js`): a `say(projectId, n, text)` that validates the message
   (non-empty) and the task (must exist, else a 404-mapped error), then records
   `{kind:'said', text}` via `taskchat.record`. Record-only.
2. **Server**: `POST /api/project/:id/task/:n/message`, body `{text}`, mirroring the
   due-date route -- validates, calls `tasks.say`, returns `{ok}` (400 empty / 404 missing).
3. **Web** (`web/index.html`): the inert `.tkcompose` div becomes a real input + Send
   (reusing the "Add a part" nowrap treatment); `tkActPhrase` gains a `said` case
   (`who ? "Name: text" : "text"`, escaped once at the render site like every phrase); a
   `tkSayPost` handler POSTs, refreshes the activity, clears the input, and reports refusals
   in `tk-say-msg`. Enter sends; empty input is a no-op.

## Key decision: record-only now, two-way delivery later
Josh's ask is a task conversation "like the project dialog", which is two-way (the operator
and agents). This ships the **recorded-message** half: a message is stored on the task and
shown in the activity, but **not delivered to any agent**. That is deliberate and reversible
(two-way = recorded + delivery, so this does not foreclose it):

- Delivering to a live agent is a real side-effect that wants its own design (who receives a
  task message -- the assignees via `whoOf`? all task members? -- and its own rate valve, like
  the 12/hour task-creation valve). Deciding that unilaterally and building it in one night,
  on a Josh-visible surface, is where "decide and build" tips into building the wrong big
  thing.
- The conversation column's screen design is Mona's per #768; this keeps the UI minimal
  (an input + Send, existing patterns) so a later design pass builds on a working engine,
  the same way the reflow left her the room shape and #2863 left her the badge signal.

### Rate valve: consciously deferred, not overlooked
Every other task write (`addPart` / `assignPart` / task-creation) has a rate valve (the
12/hour `PARTS_PER_HOUR` / task-creation cap), and `say` has none. This is a conscious
acceptance for a record-only surface, verified as a real (not overlooked) call:
- The cross-site drive-by vector is already closed by the global `crossSiteWrite` guard,
  so this is not a CSRF hole.
- The residual vector is a same-origin looping agent appending `said` events unboundedly.
  Each line is bounded (taskchat's 4000-char cap), so the harm is one task's transcript
  file growing, never an agent being commanded -- which is exactly why the task-creation
  valve exists (a looping task-creation both litters AND commands agents). Record-only
  removes the command half, leaving only bounded file growth.
- So the valve lands with the two-way delivery step, where the stakes rise (delivery to a
  live agent) and a valve is genuinely load-bearing. Adding it is reversible and easy; not
  adding it now risks only recoverable file growth.
- **Weakest premise of this deferral:** that no operator will run a same-origin script that
  spams the route before the two-way step lands. If that proves wrong, a `say` valve keyed
  on `isViaScreen` (exempt the operator, cap processes), mirroring the task-creation route,
  is the drop-in fix.

**Weakest premise:** that a recorded-only message is useful on its own rather than only as
scaffolding for delivery. Josh's own words include "documents that need to be created or
things that need to happen in here", which reads as note-taking, so a recorded note stream
has standalone value; but if he wants only the two-way form, this becomes the substrate for
it rather than the finished feature. Named on the card.

## What must NOT change
- The read side (#2400 activity route + list) and the reflow (#2899).
- `taskchat.record`'s best-effort contract for LIFECYCLE events; `tasks.say` surfaces a
  record failure because the message IS the operation, not a side-record.
- No agent delivery, no valve change -- explicitly out of scope for this step.

## Verification
- `server.task-message-768.test.js` (new): a message records + reads back as a `said` event;
  empty → 400 records nothing; missing task/project → 404 with no stray transcript.
- `web.task-activity-768.test.js` (extended): the `said` phrase renders its text, the
  authored `Name: text` form, and escaping (user input stored raw).
- `web.task-page.test.js`, full node suite: green.
- `docs/browser-checks/render-tasks.js`: extended to type a message, Send, and assert it
  appears in the activity and the input clears -- the full POST → tasks.say → taskchat →
  /activity → render round trip, headless.
