# Project page, the two engine items (#761): files that refresh on their own, and an assignee who is told

Branch `project-engine-761`. Josh's project-page pass, 2026-08-24 21:56; the engine half is Angel's, the page is Mona Lisa's (she is in `web/index.html` tonight on the same card).

## What happened

- "I have to hard refresh the page to get files in this project to refresh." The project page lists the folder once, when the project opens (`/api/project/<id>/documents`), and nothing asks again.
- "I created three new tasks and assigned them but I don't know that the agent was notified." Creating a task with an assignee rewrites the agent's instruction block (`told`), which a running agent reads at its next start; nothing reaches it now, and the page cannot say either way.

## What changed (engine)

- `engine/projects.js` `listFiles`: the answer carries `stamp`, a hash of every file's name, size and time (not only the capped page), so a page can ask every few seconds and repaint only when the stamp moves. The route passes it through unchanged.
- `server.js`: on the three assignment routes (create a task with a `who`, add a part with a `who`, give a part a `who`) a line is typed into the assignee's pane through `chat.deliver`, the way the room's unanswered-post nudge is: `[Kosmos: you were given task N in "<project>": <sentence>. When you take it up, include "task N" in what you report; the room is: kosmos post <id>]`. The response carries `heard: { who, state, because }` beside `told`, with the delivery's own states (placed, unconfirmed, could_not). Closing or reopening types nothing.

## Page contract (Mona Lisa)

- On the 5-second tick, with a project open, `GET /api/project/<id>/documents?limit=500` and repaint the files card only when `stamp` differs from the last one painted.
- After creating or assigning a task, say what `heard` says: "Told <name>" when placed; "Could not tell <name>: <because>" otherwise (told = written into its instructions for its next start; heard = typed into its screen now).

## Finished when

- `listFiles` stamps change on add, change and remove, including past the cap, and hold on an unchanged folder (test).
- Creating a task with an assignee types the line into that agent's pane and answers `heard.state === 'placed'` (route test with the chat runner captured); a task without an assignee types nothing; closing a task types nothing (control).

## Not in this change

The page half (above); a person-facing notification when an agent was NOT reachable (the response says so; the page shows it).
