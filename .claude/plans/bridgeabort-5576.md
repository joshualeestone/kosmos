# bridgeabort-5576: make the next CI abort of the agy bridge name what the child was doing (kosmos#5576)

## Finished looks like (this slice)
The next time the bridge child aborts in libuv's uv__close on CI, the test's failure message shows the child's last
socket, stream and fetch operations before the abort line. The cause itself is the card's later step.

## Measured
- 6,000 runs of the real bridge (origin/main dc66fa3d5), 64 in parallel, against a board stub answering after 0 to
  120 ms and dropping 10% of sockets: 0 aborts (Node 26.8.1, this Mac, 2026-10-08 08:09). With the card's 1,200, the
  abort does not reproduce off a loaded CI runner.
- Reasoned: the test gives the child all three stdio fds, and libuv's stream close skips fds 0 to 2, so the abort
  needs another close path. A socket handed a low fd after a stdio fd was closed would be one.

## Built
- engine/agyseed-4417.test.js: the bridge child runs with NODE_DEBUG=net,stream,fetch (stderr only; the answer is
  stdout, and nothing asserts the child's stderr). The failure message keeps the head and the last 1,200 characters
  of stderr (the abort line comes last). A test pins that.

## Decided
- Test-only: no diagnostic code in the production bridge.
- Weakest premise: the debug lines may not include the close that aborts (libuv closes below Node's debug points).
  They still order the abort against the fetch and the exit, which splits the card's two candidates.

## Review log
