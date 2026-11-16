# nopath-8318: page task answers leave out the delivered file's path

Addresses kosmos#8318 (follow-up from the review of #8307). Unparked 11-16: `tasks.withoutFilePaths` is on main.

## What
- server.js: `pageTask(t)` and `taskForCaller(req, body, t)` beside `isViaScreen`. For the page (isViaScreen true) the task leaves out this computer's paths: the delivered file's (`tasks.withoutFilePaths`) and a landed commit's repository (`landedRepo`), as the Tasks list view already does. For an agent token, or the person's terminal CLI, the task is answered as stored, so the CLI still reads them.
- The 11 page-facing answers that send a whole task go through it: close/reopen, hold, due, done-when, check, parent, repeat/ran/told, parts, part who, part close/reopen (two answers).
- The built route keeps its own `if (viaScreen)` line (#8307, kept as server.communitytaskdone-5313.test.js reads it), now calling `pageTask`, so its page answer drops `landedRepo` too (review iteration 2). Task add's 201 is left: its `task` is a number.

## Tests: server.nopath-8318.test.js
- Page calls on due, done-when, hold, unhold and parent: each on a task freshly delivered for it, asserting 200, the same task, the stored task STILL carrying the path (the control that makes an absent path mean a strip), and no path in the answer.
- Agent-token calls on due, hold and done-when keep the path.
- A landed commit: the page's due answer leaves out `landedRepo` while the stored task keeps it; the agent's answer keeps it.
- Wider than the named fields (review iteration 3): every page answer checked above must hold no string under the test's sandbox at all, so a field that later starts carrying one of these local paths, under any name, fails too. Proven alone: with the landedRepo strip and its named check both removed, this check still fails.
- Source guard: every `sendJson(res, N, { ... task ... })` in server.js, read from `sendJson(` to its matching bracket (so a key on the next line counts), uses `task: taskForCaller(`, except the two named above; it also pins the built route's `pageTask` line.
- Red-capable: against main's server.js the page test and the guard fail; with one site reverted to `{ task: t }` both fail; the agent control passes throughout.

## Not covered by a behaviour test, on purpose
Adding a part, closing a task and setting a repeat each clear the built mark, so those answers have no path to send; the check route refuses the page. The guard keeps them on the helper.

## Weakest premise
That `isViaScreen` is the right line: a terminal CLI sends no token and no browser headers, so it keeps the path, which matches the card ("agent-token answers keep the path; the CLI reads it").

## Would change my mind
A page view that needs the delivered file's path from one of these answers. None reads them today: nothing under web/ reads builtFilePath or landedRepo, and the list views already strip both.
