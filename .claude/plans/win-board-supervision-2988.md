# Plan: win-board-supervision-2988 (the two macOS board-lane NITs from kosmos#2988)

## Scope

kosmos#2988 asks for Windows board supervision (restart-on-failure) plus two macOS
board-lane NITs "worth folding in". This branch delivers ONLY the two NITs. The
Windows supervision core is a separate, larger piece (design locked in the issue's
comments: the win32supervisor respawn-loop pattern, NOT Task Scheduler
restart-on-failure, since a task's restart keys on a non-zero exit and cannot mirror
launchd KeepAlive; and it needs a real-Windows-box smoke that this Mac cannot run).
That core is intentionally left on the issue.

## The two NITs

### NIT 1: install/kosmos cmd_board_run defers on a SILENT port holder

`cmd_board_run` already defers for a HEALTHY board (`healthy()`) and an
HTTP-answering STRANGER (`port_taken_by_stranger()`), but a SILENT holder (a process
that binds the board port and answers no HTTP, the #2955 half-dead/zombie node) is
caught by neither, because both need an HTTP response. Without a guard, board-run
falls through to `exec node`, hits EADDRINUSE, and launchd crash-loops it on its
throttle, spamming board.log until the port frees.

Approach: a new `port_has_listener()` that captures `lsof -nP -iTCP:$PORT
-sTCP:LISTEN` into a `case` and defers only when a listener would actually collide
with the board's 127.0.0.1 IPv4 bind: NAME `127.0.0.1:PORT` or `*:PORT`
(0.0.0.0 / all-interfaces). It runs AFTER the two HTTP guards (so any remaining
listener is the silent case), calls lsof by absolute path (board-run's PATH excludes
/usr/sbin), guards the lsof binary `-f` before `-x` per the installer runnable-guard,
and fails open when lsof is absent.

Decisions and rejected alternatives:
- Rejected `lsof -iTCP:$PORT` unscoped: it matches any interface, so a listener on a
  specific NON-loopback IPv4 address (a LAN IP) that cannot collide with the
  127.0.0.1 bind would make board-run defer forever, silently. The address filter
  fixes exactly that case (measured: 192.168.x.x:PORT proceeds).
- Rejected `lsof -iTCP@127.0.0.1:$PORT`: measured to MISS a 0.0.0.0 (`*:PORT`) bind,
  which DOES collide, re-opening the crash-loop.
- Rejected `lsof | grep -q`: banned under `set -o pipefail` (grep -q closes the pipe,
  lsof takes SIGPIPE, pipefail reports 141 on input that matched, a false negative
  that skips the defer). Capture-into-a-case mirrors healthy()/running_pid.

IPv6 scope, stated precisely so it does not overclaim: macOS `lsof -nP` renders an
IPv6 wildcard (`::`) listener as `*:PORT` too (measured, TYPE IPv6), so the `*:PORT`
arm defers on it. For a DUAL-STACK `::` bind (the default, IPV6_V6ONLY=0) that is
CORRECT: it also holds the IPv4 port and would collide. For an IPv6-ONLY `::` bind
(IPV6_V6ONLY=1) it is a conservative OVER-defer: the IPv4 127.0.0.1 bind would not
actually collide, but deferring is fail-safe (the board declines to start rather than
crash-loop, and the operator sees "not running" and investigates). Distinguishing the
two would need to parse lsof's TYPE column; that is deliberately out of scope for
this NIT because the behavior is already fail-safe and the case is rare. The address
filter's real win is the specific-non-loopback-IPv4 case above.

### NIT 2: tools/restart-local-board.sh stale comment

The shape-(c) comment said the bundle login job runs `kosmos start`; post-#2956 it
runs `board-run`. Fix the comment; the load-bearing empty-working-dir detection is
unchanged.

## Tests

New cases in tools/test-board-foreground-2956.sh: case 6 (127.0.0.1 silent holder
defers) and case 7 (`*` / 0.0.0.0 holder defers), both proven red-capable. Weakest
premise: the false-positive direction (a specific non-loopback IPv4 bind must NOT
defer) has no portable automated test, because there is no stable non-loopback
address across machines/CI and 127.0.0.2 is unbindable on macOS. It is verified
manually (192.168.68.72:PORT proceeds while 127.0.0.1 and 0.0.0.0 defer), and the
`case` is analyzably 127.0.0.1/`*`-only. A testability seam on `port_has_listener`
would let a future change close that gap.
