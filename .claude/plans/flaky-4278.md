# flaky-4278: the hand-off limit arm stops racing the network (#4278)

## Finished means
engine/win32handoff.test.js's "round 6 finding 1" arm proves the same contract without depending on how
a real network refuses: repeated runs on windows-latest all pass, and the arm still goes red if the
hand-off's single limit or the every-address connect limit is broken. FLAKY in tools/windows-tests.js is
empty.

## What was wrong (measured)
The arm's second half probed the runner's own IPv4 address on a closed port. On Windows that refusal
arrives after about 2 s, and the arm needed it to arrive AFTER the hand-off's 2 s limit. On one run in six
(windows-latest, run 36364391579) it arrived at 2005 ms and the hand-off read "refused". The arm raced
the network, and the code was fine.

## Build
- The network half is replaced by an in-process case. A socket whose name lookup never answers stays
  connecting, and a timer refuses it with ECONNREFUSED at REFUSED_AT_MS (3.5 s).
  - Hand-off look (probeBoard with no options: one PROBE_TIMEOUT_MS for the connect and the answer),
    through http.globalAgent.createConnection: must be timed-out, in 1.9 s to 3.5 s.
  - Every-address look (5 s connect limit), through its createConnection option: must be refused.
  - The OUTCOMES are the contract. The time bounds are a sanity check, and the lower one is the limit.
- The arm runs on every platform now (it used to be Windows-only, since it needed that network).
- FLAKY emptied (its one entry was this arm); the mechanism stays.
- No product code changed. The timeout was not widened, and "refused" is not accepted.

## Proof
- Mutations, on this Mac:
  - request.timeout removed from probeBoard: RED, "the hand-off look waited for the refusal ...
    refused in 3502 ms".
  - CONNECT_TIMEOUT_MS set to 2000: RED, "the every-address look did not wait ... connect-timed-out".
- windows-latest, probe-4278 run 36374029933: 3 shards x 10 runs of the arm, 30 passed, 0 failed.
- windows job on the branch, run 36374029737: win32handoff 69/69; 99 passed, 1 known red (#4266).

## Decided
- Rejected: widening the upper bound, and accepting "refused" (Liu Kang's conditions); a loopback-only
  hung listener alone (that covers the answer phase, which the arm's first half already does, not a
  pending connect).

## Weakest part
- The simulation overrides http.globalAgent.createConnection for the hand-off look, and restores it in a
  finally. Another test in the same file running concurrently would share it; node:test runs a file's
  tests serially, so it cannot today.
- It no longer observes Windows' real slow refusal. That was measured once and is what this card calls
  environment, not code.
