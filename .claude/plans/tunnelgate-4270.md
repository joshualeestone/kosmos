# tunnelgate-4270: a release gate that runs a REAL tunnel handshake with the shipped connector (kosmos#4270)

Before this, no gate touched remote access. The Mac cut checks that kosmos-tunnel is current and signed, and the
browser checks use fakes, so a build whose connector cannot get a ticket, authenticate at the relay or serve
passed every gate and reached every Kosmos+ Mac.

## What
- tools/tunnel-handshake-gate.sh. It takes the connector FROM THE STAGED TARBALL (the bytes being promoted) and
  runs it against the live coordinator and relay with ONE reserved identity (release-gate@gate.invalid,
  enrolled once per kosmos-relay deploy/release-gate.md). One attempt covers three steps:
  - `ticket`: a relay ticket from the coordinator;
  - `dial-auth`: TLS and AUTH at the relay, "tunnel up";
  - `serve`: a visitor through the relay gets the connector's session page, over the gate's own certificate.
- Fault is decided by a CONTROL, not by reading log sentences. The control is the connector of the build prod
  serves now. When the candidate fails, the control runs:
  - control fails: CANNOT TELL (2);
  - control passes: the candidate retries. A pass is PASS (and says RETRY). A second failure runs the control
    again: FAIL (1) if it still passes, CANNOT TELL if not.
  - With no control, a candidate failure is CANNOT TELL.
- The build is judged FIRST: a tarball without a regular, executable connector is FAIL, whatever the machine's
  state.
- Preflight holds (2): no identity; the coordinator's /v1/meta not 2xx (Caddy's 502); the relay port
  unreachable; another connector holding the identity (pgrep, keyed on the address); another gate run (an
  atomic mkdir lock with dead-owner and takeover recovery).
- Certificate renewal: carried back into the enrolled state only from a PASSING attempt. The first control's
  renewal is held until the verdict, so the retry faces the same certificate state as the first attempt.
- tools/promote-channel.sh runs it as the fourth Mac gate: `--tarball <staged>`, plus
  `--control-tarball <prod's artifact>` when it is on disk as a bare filename. 1 refuses and is never
  forceable; 2 holds and is forceable after a hand check.

## Tests
- tools/test-tunnel-handshake-gate.sh (in test:shell): 52 rows with stub connectors (the real connector's
  wording) and a local HTTPS server. The row count is pinned. Every row's extra arguments go last, so they
  take effect.
- tools/test-staging-channel-2036.sh: the promote arms (0 / 1 unforceable / 2 hold / 2 plus --force), the exact
  staged tarball, the control passed when served, and no control (with a NOTE) when absent or path-like.
- Mutants run across the rounds: each fix has a mutant that reds its own row. That includes the round-7 false
  PASS, reproduced by keeping the renewal early.
- Real runs:
  - against a local relay and coordinator: PASS; a broken candidate FAILs; a wrong relay CA holds (both fail);
    the coordinator down holds; a hand-started connector holds.
  - **against production on Mortals:** candidate 0.7.05, control 0.6.99, PASS.

## Not covered (stated in the header)
After the first visit (keepalives, reconnects, a renewal on reconnect); how the APP launches the connector
(flags, env, supervision across an update); first enrolment; a copy of the identity on another machine.

## Rollout
The identity is enrolled on Mortals, where promote-channel.sh runs (kosmos#4270, 00:1x 09-28). A machine
without it holds every Mac promote at this gate until enrolled.
