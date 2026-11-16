# nopath-8318: page task answers leave out the delivered file's path

Addresses kosmos#8318 (follow-up from the review of #8307). Unparked 11-16: `tasks.withoutFilePaths` is on main.

## What
- server.js: `taskForCaller(req, body, t)` beside `isViaScreen`. For the page (isViaScreen true) it answers `tasks.withoutFilePaths(t)`; for an agent token, or the person's terminal CLI, it answers the task as stored, so the CLI still reads `builtFilePath`.
- The 11 page-facing answers that send a whole task go through it: close/reopen, hold, due, done-when, check, parent, repeat/ran/told, parts, part who, part close/reopen (two answers).
- Left as is: the built route, which already strips through its own `if (viaScreen)` line (#8307, kept as server.communitytaskdone-5313.test.js reads it); task add's 201, whose `task` is a number.

## Tests: server.nopath-8318.test.js
- Page calls on due, done-when, hold, unhold and parent: each on a task freshly delivered for it, asserting 200, the same task, the stored task STILL carrying the path (the control that makes an absent path mean a strip), and no path in the answer.
- Agent-token calls on due, hold and done-when keep the path.
- Source guard: every `sendJson(res, N, { ... task ... })` in server.js uses `task: taskForCaller(`, except the two named above; it also pins the built route's strip line.
- Red-capable: against main's server.js the page test and the guard fail; with one site reverted to `{ task: t }` both fail; the agent control passes throughout.

## Not covered by a behaviour test, on purpose
Adding a part, closing a task and setting a repeat each clear the built mark, so those answers have no path to send; the check route refuses the page. The guard keeps them on the helper.

## Weakest premise
That `isViaScreen` is the right line: a terminal CLI sends no token and no browser headers, so it keeps the path, which matches the card ("agent-token answers keep the path; the CLI reads it").

## Would change my mind
A page view that needs the delivered file's path from one of these answers. None reads it today: the list views already strip it.
