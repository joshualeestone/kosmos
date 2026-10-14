# gatefast-5907: tools/test-tunnel-handshake-gate.sh, 98 s to 57 s (#5907)

Card: joshualeestone/kosmos#5907 (full suites run about 30 min against the documented 14 to 26). This test was 85 s
in a loaded suite this morning, the third slowest shell script; measured alone 98 s, per line (card comment).

## The call
- tools/tunnel-handshake-gate.sh `stop_connector`: after TERM, check for the connector every 0.1 s (50 checks)
  instead of every 0.5 s (10 checks). Same 5 s bound before KILL. A connector just sent TERM is nearly always still
  alive at the first check, so every stop paid 0.5 s, three stops a case.
- tools/test-tunnel-handshake-gate.sh: the two deadline-path cases (no tunnel up, a ticket failure that keeps
  retrying) pass `--timeout 3` after run()'s `--timeout 6` (the gate keeps the last), and their
  expected texts say 3s. They wait out the whole timeout on each attempt by design; their control stub comes up at
  once, so 3 s keeps room under load. Every other case keeps 6 s.

## Proven
- Alone on Agent1s: 98 s before, 57 to 60 s after; 57 of 57 pass each time.
- Review 1 said the "different page" case is not time-bound; I answered with a measurement (12.8 s at 6, 4.3 s at 3)
  and kept it. Review 2 read the code (the serve stage never reads TIMEOUT), and an INTERLEAVED re-measure agreed with
  it: 3.19, 2.62, 2.78 s at 6 against 2.69, 2.97, 2.66 s at 3. My first numbers were one noisy run each, not an
  effect. The flag is removed from that case; the 98 s to 57 s total is the measured outcome, not split by cause.

## Not covered (before or after)
- A connector that ignores TERM (the KILL after 5 s): no case exercises it. The bound is unchanged (50 x 0.1 s).

## Weakest premise
That the effective window is enough for the control stub under a loaded suite. The gate's deadline is whole
seconds (date +%s), so `--timeout 3` is between about 2 and 3 s (review 1). The control stub comes up at once; if a
loaded run ever reds one of these cases, the gate says CANNOT TELL (exit 2, the test wants 1), so it fails loudly, and
the fix is a larger number, not a retry.
- Each poll now starts an external sleep (up to 50, not 10); under load that can only stretch the 5 s grace before
  KILL, never shorten it. The only real caller is tools/promote-channel.sh, and stop_connector still ends with wait.
