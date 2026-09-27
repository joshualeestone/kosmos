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
- server.js, first thing, only when it runs as the board (`require.main === module`): install on stdout (1) and stderr
  (2). At the very top, so even the load-time half-sandbox refusal is stamped.

## Why "only a regular file"
Every test that spawns the board reads its output through a pipe, and a person running it by hand sees a terminal; both
are left exactly as they were. board.log under launchd and nohup is a regular file. This targets the file without an env
switch and without changing any piped reader.

## Rejected
- Stamping only class1-autohandle / restart lines (the card's minimum): the time is useful on every line (the "server
  exited unexpectedly" bursts, the half-sandbox refusal), and one wrapper is simpler than editing each writer.
- Changing formatLogLine or other writers: the stamp at the stream keeps every writer and its exact-text tests as they are.
- Stamping in install/kosmos (a shell timestamper in the pipe): it would not cover launchd's StandardOutPath, which is how
  the board normally runs.

## Weakest part
stdout and stderr share the file but track their own line start. If one writes half a line and the other writes before
it ends, a time can land mid-line. Lines are written whole almost everywhere, so this is rare and only cosmetic. Node's
own fatal crash trace is written below process.stderr.write, so it is not stamped.

## What would change my mind
A reader of board.log that matches a line from its start (`^...`). None was found (grep for board.log readers: tests read
setup.sh's own output or grep the text without an anchor).
