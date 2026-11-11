# uncaught-8379: pin that the board registers no uncaughtException handler

Card: #8379 item 1 (a follow-up from #8373's review). Item 2 (rotation of an open log on Windows) needs a Windows box and stays with #8373's device check.

## The call
A source test (engine/uncaught-handler-8379.test.js) reads server.js and every non-test engine module as raw text and counts every string literal that is exactly `uncaughtException` (any quote), any `setUncaughtExceptionCaptureCallback`, and any require of `domain`. The two monitors' own literals are allowed by file and by count (win32boardlog.js 2, win32boardwatch.js 1). No comment stripping: a stripper that does not parse strings swallowed real code after `'image/*'` and similar strings (review round 1 measured it blind in four real files).

## Why
engine/win32boardlog.js and engine/win32boardwatch.js record a crash only when no such handler exists. A handler added anywhere would silently stop both; a capture callback or a domain would make both record a crash that never happened.

## Rejected
- A behavioural test that loads the whole board and counts `process.listenerCount('uncaughtException')`: loading server.js starts a board. The source scan covers every module the board can load, loaded or not.
- Scanning tools/ and bin/: those are other processes (a release script embeds its own node handler), not the board.

## Not seen
An event name built from pieces, a domain reached without a literal require, and anything in node_modules (the board's dependencies). bin/ bridges are spawned by the board, never required into it (each guards its entry with require.main).

## Weakest premise
That a handler always names the event as a literal somewhere in board code. A comment naming the event in a board module now reds the test, which is the price of not stripping comments; the fix is to reword the comment.

## Would change my mind
A real need for a board-level handler: then it goes in ALLOWED and both monitors change in the same PR.
