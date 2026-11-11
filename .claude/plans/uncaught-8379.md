# uncaught-8379: pin that the board registers no uncaughtException handler

Card: #8379 item 1 (a follow-up from #8373's review). Item 2 (rotation of an open log on Windows) needs a Windows box and stays with #8373's device check.

## The call
A source test (engine/uncaught-handler-8379.test.js) reads server.js and every non-test engine module for any way of adding an `uncaughtException` handler (`on`, `once`, `addListener`, `prependListener`, `prependOnceListener`, any quote, any spacing), with comments dropped first. It must find none. A handler meant to be there goes in ALLOWED with its reason.

## Why
engine/win32boardlog.js and engine/win32boardwatch.js record a crash only when no such handler exists. A handler added anywhere would silently stop both.

## Rejected
- A behavioural test that loads the whole board and counts `process.listenerCount('uncaughtException')`: loading server.js starts a board. The source scan covers every module the board can load, loaded or not.
- Scanning tools/ and bin/: those are other processes (a release script embeds its own node handler), not the board.

## Weakest premise
That a handler is always added with one of those five calls on an emitter. One added through a variable holding the event name would be missed.

## Would change my mind
A real need for a board-level handler: then it goes in ALLOWED and both monitors change in the same PR.
