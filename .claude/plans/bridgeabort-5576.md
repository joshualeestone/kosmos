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
- test-support/agy-bridge-trace.js: a preload for the bridge CHILD only (NODE_OPTIONS=--require, appended to any
  options already set). Markers straight to fd 2 with fs.writeSync (no stream, no handle): the type of fds 0, 1, 2 at
  start; fetch begin and end; exit called; on 'exit' the fds 0, 1, 2 again. Measured on a real run: start 0:chr 1:sock
  2:sock, fetch begin, fetch end ok, exit called 0, exit 0 with the same fds.
- engine/agyseed-4417.test.js: the child carries the preload; a failure message keeps the head and the last 1,200
  characters of stderr (the abort line comes last). Tests: the preload reaches the child's options without replacing
  them; a real run has the markers on stderr and none on stdout; a long stderr keeps its abort line.

## Decided
- Test-only: no diagnostic code in the production bridge.
- Not NODE_DEBUG (my first version, review 1): it makes the child open a stream on fd 2, which the bridge never has,
  the kind of handle the abort is about, so it could change the rate; and it logs nothing on the exit path, so it
  could not tell the two candidates apart.
- Weakest premise: a quiet stretch after this lands is not evidence the abort is gone (the preload adds a little work
  at start); only a marked abort is.

## Review log
### Review 1 (opus): 2 WARNINGs
- Fixed: NODE_DEBUG opened a stream on fd 2 (could change what it measures) and could not split exit from fetch;
  replaced by the fd-2 marker preload above. Fixed: nothing checked the setting reaches the child (fake-spawn test).
- NITs left: the head of a long stderr is mostly start markers; exact 1,600/1,601 boundary untested.
### Review 2 (sonnet): 2 WARNINGs
- Fixed: the --require path was unquoted (a checkout path with a space would split it); now quoted, test pins it.
- Fixed: a marker could be written into fd 2 after its number was reused by a socket (the case hunted). The preload
  records fd 2's identity (dev:ino) at start and writes only while it is unchanged (not the type: a spawned child's
  stdio are sockets already, measured).
- NITs fixed: the fetch markers are asserted; trailing blank line. NIT left: os stays a local require, the file's
  convention.
- 10/10 (08:26 CDT 2026-10-08).
### Review 3 (opus): 3 WARNINGs, 2 CONVENTIONs
- Fixed: the header claimed the last marker separates the two causes; the abort comes at the CLOSE, possibly at
  teardown after the last line either way. Every line now carries fds 0-2 as type@inode, fetch begin and end too, so
  WHERE a stdio fd's record first changes is the finding. Header rewritten to say so.
- Fixed: type alone could not show a reuse (fds 1 and 2 are sockets from the start); the inode is recorded.
- Fixed: dev and ino compared as Numbers lose precision past 2^53 (a socket's ino measured above it); fstat bigint.
- Fixed: the real-run test now goes through runBridge (the same retry as the other real runs).
- Fixed: the fd-2 guard had no test; a child closes fd 2 and opens a file in its place, and no line reaches the
  file (control: the file took fd 2). Removing the guard turns it red (measured).
- 11/11 (08:29 CDT 2026-10-08).
### Review 4 (sonnet): nothing above NIT. CONVERGED.
- Mutation: removing the fd-2 guard reds its test. Child behaviour, NODE_OPTIONS and comments checked clean.
- NITs left: fetch read at preload time (a plain property on Node 26.8.1, so no timing change here); if fd 2 itself is
  reused, later lines are silent, so a missing exit line reads like a death before exit; the real-run test does not
  assert the stand-in board received the report.
