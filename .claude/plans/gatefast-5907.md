# gatefast-5907: tools/test-tunnel-handshake-gate.sh, 98 s to 57 s (#5907)

Card: joshualeestone/kosmos#5907 (full suites run about 30 min against the documented 14 to 26). This test was 85 s
in a loaded suite this morning, the third slowest shell script; measured alone 98 s, per line (card comment).

## The call
- tools/tunnel-handshake-gate.sh `stop_connector`: after TERM, check for the connector every 0.1 s (50 checks)
  instead of every 0.5 s (10 checks). Same 5 s bound before KILL. A connector just sent TERM is nearly always still
  alive at the first check, so every stop paid 0.5 s, three stops a case.
- tools/test-tunnel-handshake-gate.sh: the three deadline-path cases (no tunnel up, a ticket failure that keeps
  retrying, a different page) pass `--timeout 3` after run()'s `--timeout 6` (the gate keeps the last), and their
  expected texts say 3s. They wait out the whole timeout on each attempt by design; their control stub comes up at
  once, so 3 s keeps room under load. Every other case keeps 6 s.

## Proven
- Alone on Agent1s: 98 s before, 75 s with the timeouts, 57 s with both; 57 of 57 pass each time.

## Not covered (before or after)
- A connector that ignores TERM (the KILL after 5 s): no case exercises it. The bound is unchanged (50 x 0.1 s).

## Weakest premise
That 3 s is enough for the control stub under a loaded suite. It answers at once; if a loaded run ever reds one of the
three cases on its control, the fix is a larger number, not a retry.
