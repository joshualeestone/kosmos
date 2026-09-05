# portrace-1073: name a port pick-to-bind collision instead of a 30s flaky red

Card: kosmos#1073 (claimed:renettilley). Night-shift direct build; plan backfilled
before the challenge-loop, per the pre-challenge-gate contract.

## The problem (from the card, verified in code)

`tools/browser-checks.sh` picks all 16 ports up front in `pick_ports` (all via
`free_port`, which binds `:0`, reads the port, then CLOSES the socket, releasing
the port back to the OS), then the servers bind them across the whole ~11-minute
run. The `#633` comment claims the pick-to-bind window is "a few milliseconds",
which holds only for the FIRST port bound: P7/P9 bind minutes later, so their
window is genuinely minutes. In that window another run can take the port.

It is a NARROW race, not an inevitability (the kernel hands out ephemeral ports
monotonically, so two runs minutes apart land in separated blocks), and it was
refuted for the 2026-08-26 incident. But when it fires, the loser's node server
exits with EADDRINUSE and `wait_up` polls the full 30s then reports a generic
"server never answered" - an unattributable flaky red.

## Decision (mine, per Josh's "make the call and implement it")

Ship the honest-instrument half; leave the full prevention for a box-verified
follow-up on the same card.

- **Do now (low risk, high integrity, my observability lane):** make `wait_up`
  read EADDRINUSE from the server's own log and report the collision BY NAME on
  the first iteration - converting a 30s mystery flaky red into a fast,
  attributable one. Correct the dishonest `#633` comment.
- **Rejected for now:** the prevention fix (re-pick a fresh port when a bind
  loses, plumbing the actual port back to every caller). It touches every
  `PORT="$Pn" node ...` launch site (several inline, not just boot_board) in a
  harness that gates every release cut - high blast radius - and its value can
  only be VERIFIED under genuine concurrent runs on the box. That is a
  needs-release change, not a 4am solo one. Recorded as the residual on #1073.

## Weakest premise

That a bind collision reliably surfaces in the server log as a string wait_up
matches, within the first poll iteration. Two shapes exist and the pattern
covers both: the board server (server.js, what almost every boot runs) does NOT
emit a raw EADDRINUSE - it catches the code and writes a friendly "port <N> is
already in use" (server.js ~9345), while thread-server.js / a bare node default
emit "listen EADDRINUSE: address already in use". The grep is
`EADDRINUSE|already in use`, whose "already in use" substring is common to both.
(An earlier draft matched only `EADDRINUSE|address already in use` and so MISSED
the board server - the primary case - reported as a blocker by the first blind
reviewer and fixed; the test now carries a board-shaped arm that reds against
the narrow pattern.) The residual weakest premise: a still-different future
graceful message using neither "EADDRINUSE" nor "already in use" would fall
through to the existing 30s timeout - i.e. degrade to today's behaviour, never
worse.

## Change

- `tools/browser-checks.sh`:
  - `free_port`/`pick_ports` comment made honest about the minutes-long late-port
    window and pointing at the wait_up mitigation.
  - `wait_up`: per-iteration EADDRINUSE detection -> named, fast return;
    `KOSMOS_BC_WAIT_TRIES` test-only seam (default 60) so the timeout arm is
    testable in ~1s.
- `tools/test-wait-up-collision-1073.sh` (new): extracts and exercises the REAL
  `wait_up`. Three arms - collision (named + fast), no-boot control (generic
  message, no false collision), live server (returns 0). Proven RED on the
  pre-fix wait_up and on a present-but-neutered detection.
- `package.json`: wired the new test into `test:shell` (every-test-runs guard).

## Verification done

- `bash -n tools/browser-checks.sh` clean.
- New test passes clean; both perturbations red.
- node text/wiring tests over browser-checks.sh (every-test-runs,
  browser-checks-wired, -selectors, -reason-grep, -indexed): 21/21 pass.
- Not a web/ change, so the browser-check CI gate does not apply.
