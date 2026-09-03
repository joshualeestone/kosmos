# Plan: deliver the kosmos CLI's auth tokens OFF argv (kosmos#1970)

## The problem
#1946 made the board token the cross-account boundary and kept the durable secret in a
mode-600 `board.token` file, precisely because macOS `$HOME` is group-traversable so the
file is the only real per-account boundary. But the token is DELIVERED to the server on
process **argv** (`curl -H "x-kosmos-board-token: $_bt"`), and macOS (unlike Linux
`hidepid`) lets any local account read every user's full command line via `ps -ww -o args`.
So a co-tenant second account has a pollable side channel to the very secret the mode-600
file protects, for the brief window each command runs.

## The fix
Add a token-agnostic helper `kosmos_curl` (install/kosmos) that writes whichever auth
headers are present to a mode-600 temp file and hands curl `-H @file`, so only the file
PATH reaches argv, never the token. Convert every token-bearing CLI curl site to it:
msg, reply, post, whoami, report, room. The helper:
- creates the file with `mktemp` (0600 on macOS) plus a defensive `chmod 600`;
- runs curl inside an `if` so its failure does not skip cleanup under `set -euo pipefail`;
- always `rm -f`s the file before returning; returns curl's exact status;
- fails closed (return 99) if the file cannot be made, so an enforcing request is never
  sent without its token;
- when both token args are empty, takes a plain `curl "$@"` fast path (nothing to protect),
  matching the old `${_bt:+-H ...}` omit-when-empty behavior exactly.

## Integration with #1968 (arrived on main during the work)
A rebase onto origin/main pulled in #1968 (harden report/reply against a cross-account
loopback spoof). #1968 changed `board_token` callers to `_bt="$(board_token || true)"`
(avoids a set -e abort on a non-enforcing board) and made cmd_report ALSO present the board
token and cmd_reply present it too. The merge integration:
- keeps `board_token || true` at every caller;
- delivers #1968's newly-added tokens OFF argv (report now sends BOTH agent + board tokens
  in one mode-600 @file; reply sends the board token off argv);
- leaves no token inline.
#1968's own tests (report/reply present the board token; send none on a non-enforcing board;
remote agent reaches /api/report,/api/reply only with a valid token) pass with off-argv
delivery, so the anti-spoof behavior is preserved.

## Decision: the browser-open handoff is a bounded residual, tracked as #1979
`cmd_open` and setup.sh's open-once plist still hand the token to the browser as
`$URL/?token=$_bt`, and `open` takes the URL as an argument, so the long-lived board token
(not a swappable nonce) is on argv for that launch. The `?token=` is swapped for an httpOnly
cookie and 302-stripped from the address bar, but that does NOT close the argv channel.
The card explicitly permits "evaluate a one-shot handoff OR accept as bounded." I accept it
as bounded because: the high-volume exposure (agent curls every few seconds) is now closed;
`kosmos open`/first-boot open are infrequent interactive launches; the plist file itself is
mode-600; and the proper fix (a server one-shot nonce the browser redeems for the cookie) is
a server + install change of its own, filed as #1979. Documented honestly at three code sites.

## Test
`cli.token-off-argv-1970.test.js` drives `kosmos report` through a `curl` stub that logs its
own argv (the in-process form of the card's `ps -ww -o args` poll) and execs the real curl so
delivery still lands. It asserts the token is ABSENT from argv, PRESENT in a mode-600 `@file`,
delivered end-to-end (positive control), and the temp file is cleaned up. Verified it reds when
the token is put back on argv. `kosmos_curl` is token-agnostic (board and agent tokens traverse
identical code; only the header name differs), so the agent-token `report` path validates the
mechanism that protects the board token; the two-header path is independently covered by the
#1968 CLI test, which now routes through the same helper.

## Weakest premise
The bounded-residual acceptance rests on `kosmos open`/first-boot being infrequent and
interactive; that is a property of the intended flow, not an enforced bound (`kosmos open`
can be scripted). Named explicitly in the code comment and in #1979, which is the real fix.
