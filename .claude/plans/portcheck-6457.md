# portcheck-6457: the install gate's default-port check asks who is listening, not who answers in a second

Card: kosmos#6457. The 0.7.56 staging cut's step 4b failed 1 of 165 checks, "port 16180 is as we found it (was: busy)":
the host's own board (same pid before and after) missed `curl -s -m 1` at load 39, read as free after the run, and cost
a re-run of about 2 h.

## Change
- `tools/test-install.sh`: `_ti_port_busy <port>` is busy when `lsof -nP -tiTCP:<port> -sTCP:LISTEN` names a listener,
  or, for one lsof cannot see (another account's), when `/usr/bin/nc -z -G 3` connects. Both the BEFORE and the AFTER
  probe of the default port use it, so the comparison stays like for like.
- `tools/test-install-portprobe-6457.sh` (wired into `test:shell`): runs that function as written in the harness.

## Decisions
- Busy/free, not the pid (the card's "better" option). Rejected: a pid comparison would turn a board restart (new pid)
  red, which #5831 deliberately keeps out of the release gate; its own check below compares the pid and start time.
- No HTTP fallback: a TCP connect covers what lsof cannot see without depending on the process's response time.
- Weakest premise: the kernel completes the connect from the listen backlog even when the board is saturated. A full
  backlog would drop the SYN; `-G 3` bounds that wait and the lsof arm, which does not connect at all, comes first.

## Checks
- A listener that accepts but never answers reads busy. CONTROL: the old 1 s curl calls it free (the cut's failure).
- A port with nothing on it reads free.
- Free before, a listener started, busy after: the gate's comparison still goes red for a leaked listener.
- Both gate probes call it; no 1 s curl probe of the default port is left.
- Mutation: the old curl probe put back inside the function fails the two behaviour arms.
