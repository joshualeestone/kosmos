# logtime-4199: a UTC time on every board.log line

kosmos#4199, assigned by Liu Kang (m1613). On #4169 two agents matched board restarts against agents' self-reports and
reached different conclusions about one event, because board.log lines carry no time.

## Done looks like
Lines the board writes to board.log after this start with an ISO-8601 UTC time and one space, then exactly the old text
(greps for the text still match); a test pins the format; nothing that reads the board's output through a pipe changes;
it takes effect on a box at its next Kosmos release or board restart, like #4176.

## How board.log is written (read, not assumed)
board.log is the board process's own stdout AND stderr: install/setup.sh's launchd job points StandardOutPath and
StandardErrorPath at it, and install/kosmos runs `nohup node server.js >> board.log 2>&1`. So the time has to be added
inside the board process.

## Change
- engine/logstamp.js: `stampText` (pure: stamps each line start, carrying whether the last write ended a line, so a line
  written in pieces is stamped once) and `install(stream, fd)`, which wraps stream.write ONLY when fd is a regular file.
- server.js, only when it runs as the board (`require.main === module`): install on stdout (1) and stderr (2), right
  after the world bootstrap, which must stay the FIRST engine require (server.worldenv-order.test.js: ~27 engine modules
  freeze store.ROOT at require time). The final validation caught my first version installing it above that line. Still
  early enough that the load-time half-sandbox refusal is stamped; only the bootstrap's own named-world lines (none on
  the default world) come before it.

## Why "only a regular file", and what else that stamps
board.log under launchd and nohup is a regular file; a person running the board by hand sees a terminal, and the node
tests that spawn a board read it through a pipe; both are left as they were. Any OTHER file the board's output is sent
to is stamped too (review 1): tools/browser-checks.sh's fixture `server.log` files. Checked: their readers match text
without an anchor (wait_up's grep for EADDRINUSE, and its tail); render-thread reads thread-server.js's log, which loads
server.js as a module, so it is never stamped.
- stdout and stderr share one line-start state when they are the same file (same device and inode), so a line one
  starts and the other ends is stamped once.
- A string written in another encoding (hex, base64) goes through untouched. A Buffer write is stamped BYTE BY BYTE
  after each newline byte (0x0a never occurs inside a multi-byte UTF-8 character), so it goes out exactly as written:
  no decoding, nothing held back, no byte changed (review 3: a StringDecoder rewrote invalid or waiting bytes as U+FFFD).
- A board that died mid-line leaves board.log ending mid-line (review 2). At start the board reads the file's last byte
  and, if it is not a newline, ends that line first, so its own first line is not glued to the old one. stdout is
  write-only, so the byte is read through board.log's PATH (../logs/board.log from the app, which is where install/kosmos
  puts both, pinned by a test against install/kosmos; KOSMOS_HOME is not exported to the board, so it is not read), and
  only when that path is the same file (device and inode) as stdout; any other file is left as it is (for
  example a dev board's ~/Library/Logs/kosmos-board.log is stamped, but a line a dead board left there is not ended).

## Rejected
- Stamping only class1-autohandle / restart lines (the card's minimum): the time is useful on every line (the "server
  exited unexpectedly" bursts, the half-sandbox refusal), and one wrapper is simpler than editing each writer.
- Changing formatLogLine or other writers: the stamp at the stream keeps every writer and its exact-text tests as they are.
- Stamping in install/kosmos (a shell timestamper in the pipe): it would not cover launchd's StandardOutPath, which is how
  the board normally runs.

## Weakest part
Output that does not go through process.stdout/stderr.write carries no time: Node's own fatal crash trace, and child
processes that inherit the board's stderr (engine/remote.js spawns with stdio 'inherit'), and install/kosmos's own
board-run narration before it execs node, and the world bootstrap's named-world lines (#1704/#2528). A child's line can
also split a stamped line. A person reading board.log should expect the odd unstamped line.

## What would change my mind
A reader of board.log that matches a line from its start (`^...`). None was found (grep for board.log readers: tests read
setup.sh's own output or grep the text without an anchor).
