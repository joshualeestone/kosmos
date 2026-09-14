# #768: deliver task-conversation messages to the assigned agents (two-way)

## Problem
The task composer (PR #2901, merged) records a message on a task and shows it in the
activity, but delivers it to nobody. Josh's #768 ask is a task conversation "like the
project dialog", which is two-way. Josh confirmed the routing directly (2026-09-12,
Angel's channel): "Yes, only to the agents assigned to the task."

## Approach
1. **Outbound** (`server.js` POST `/api/project/:id/task/:n/message`): after `tasks.say`
   records, deliver to the task's assignees (`tasks.whoOf`) via `chat.deliver` -- the
   sanctioned low-level primitive every notify path uses, which carries the rails
   (addressable check, the trust-dialog guard, body validation). Return a `delivered`
   list (per-assignee agent + delivery state) -- a distinct name from the sibling
   routes' single-object `told` (instruction-sync), so the field is not two shapes.
2. **Notification, not the whole message.** What an assignee receives is a short line:
   `[Kosmos task N - <project>] <who> said: "<preview up to 140 chars>" - reply in the
   task: kosmos task message <id> N "..."` (plain ASCII, no em dash or multibyte, since
   it is typed into an agent's pane). The full message lives in the task record
   (single source of truth), and a short line never bumps chat's 2000-char cap, so a
   max-length message always delivers.
3. **Reply path** (`install/kosmos`): a new `kosmos task message <project> <n> "<text>"`
   verb POSTs to the same route, so an assigned agent replies INTO the task; its reply is
   recorded in taskchat and shows in the activity the operator is watching. That closes
   the loop: operator -> assignees -> back into the task.
4. **Rate valve**: a PROCESS (agent CLI) is capped per hour (in-memory rolling window,
   default 30, env-overridable) so a looping agent cannot spam a task's people; the
   OPERATOR (the board, which sends `sec-fetch-site`) is never valved -- the same posture
   as the task-creation and room valves (the person driving is the remedy, not the hazard).

## Key decisions
- **Deliver via `chat.deliver`, not `messages.sendPost`/`send`.** sendPost is room-bound
  (records into the room, validates project membership, runs the room valve) and send is
  agent-to-agent (no operator path). A task is neither a room nor a DM. chat.deliver is the
  shared primitive both wrap, so calling it directly with a task-labelled line inherits the
  core rails without inheriting room/DM record semantics.
- **A notification, not the full text, is delivered.** Avoids duplicating the message into
  the chat log and sidesteps chat's length cap / newline stripping; the task transcript
  stays the one place the conversation lives. Agents pull the full thread (`kosmos task
  list` / the activity), exactly as room participants pull room context.
- **Routing = assignees only** (whoOf), per Josh. Weakest premise: that assignees, not all
  project members, are the right audience -- Josh chose this explicitly; widening to the
  roster is a one-line change if he ever reverses it.
- **`tasks.say` stays record-only; delivery lives at the route.** Mirrors the room, whose
  delivery also lives at its route with the roster, and keeps the engine function pure.

## What must NOT change
- The record side (`tasks.say`, taskchat), the read side (`/activity`), the composer UI
  and its guards (#2901), and MESSAGE_MAX.
- The rails: delivery goes THROUGH chat.deliver, never around it.

## Verification
- `server.task-message-768.test.js`: records + reads back, delivers to the assignee
  (`delivered` names mona), a no-assignee task notifies nobody but still records, empty/
  over-length 400, missing project/task 404.
- `server.task-msg-valve-768.test.js` (new, isolated low cap): a process is valved after
  the cap; the operator (screen) is never valved.
- `web.task-activity-768.test.js`, `web.task-composer-768.test.js`, `web.task-page.test.js`: green.
- `install/kosmos` bash syntax; the `kosmos task message` verb POSTs `{text}` and reports
  the board's `{ok}` / `{error}` shape.
- `docs/browser-checks/render-tasks.js` (headless): the composer round trip still passes,
  fixture tmux only (delivery hits fake-tmux, no live pane).
- Full node suite + browser-check surface gate: green.
