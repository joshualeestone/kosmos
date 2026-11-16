# localpaths-8585: one helper for a task without this computer's paths

Addresses kosmos#8585 (a NIT from #8318's review iteration 4).

## What
- engine/tasks.js: `withoutLocalPaths(t)`, exported: `withoutFilePaths` (delivered and replaced file paths) and then `landedRepo`. A copy; the stored task keeps them; a non-object passes through.
- The three places that did those two steps by hand now call it: engine/projects.js `withoutPaths` (project rows), server.js the Tasks view's `sendRows`, server.js `pageTask` (now a one-line call, so #8318's source guard that pins `pageTask(out.task)` is unchanged).
- No change in what any view sends.

## Tests: engine/tasks.localpaths-8585.test.js
- A task carrying all three path fields loses all three, keeps its fingerprint, what it replaced, its commit and onRemote, and holds no path string.
- The stored task is unchanged; null and undefined pass through.
- Source guard: outside engine/tasks.js, no source in server.js or engine/ (tests excluded) strips one of these fields by hand: `delete x.f`, `delete x['f']`, a hand strip of `builtReplaces.filePath`, or a rest destructure that drops the field. Each of the five shapes is red when put back in server.js (review iteration 2 widened it from the dotted delete alone).
- The 11 test files that touch these fields pass (151 pass, 0 fail of 158; the rest skipped).

## Weakest premise
That the guard's patterns cover every way to drop a field by hand. They cover delete (dotted and bracketed) and a rest destructure on one line; a destructure spread over several lines, or a copy built field by field, would pass. None exists today (the three sites were the only strips).

## Would change my mind
A view that needs one of these paths after all: then it reads the stored task, not this copy.
