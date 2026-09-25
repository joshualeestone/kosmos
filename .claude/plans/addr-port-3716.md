# addr-port-3716: a free port per run for test-kosmos-addr-reclaim-3079

Card: kosmos#3716 (filed by PigeonPete while validating #3713).

## What
`tools/test-kosmos-addr-reclaim-3079.sh` bound a real listener on a fixed port, 17629. When two suites ran at
once (normal on the fleet Mac), the second asserted against the first's listener and failed three arms. The
test now asks the kernel for a free port (node, listen on 0, the same way `tools/browser-checks.sh` `free_port`
does) and falls back to 17629 only when node is missing, in which case the listener arm is skipped anyway.

## Measured
- Fixed file, four copies at once: 4 of 4 passed 12/12.
- Control, the original file from origin/main, four copies at once: 3 of 4 failed (owner pid, is_kosmos, and
  the decision arms, the same arms the card names).

## Decided
- A free port per run, not "skip when 17629 is held": a skip would hide the arm whenever the Mac is busy, which is
  exactly when the suite runs most.

## Weakest premise
The port is freed between asking and binding, so another process could take it in that gap. Ports are handed out
in order, so two runs at once get different ones; a collision needs the counter to wrap in that instant.
