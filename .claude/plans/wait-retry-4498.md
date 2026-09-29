# wait-retry-4498: test-install and run-tests wait for a quiet box

Card: #4498 (Liu Kang, m2795 and m2864). Follows #4410's mutual refusal.

## Finished means
- A second `yarn test` started beside a live one waits (every 30 s, up to 20 minutes), saying whose run it waits on,
  then starts; `KOSMOS_NO_WAIT=1` refuses at once.
- `tools/test-install.sh` beside a live suite or cut waits the same way and starts when it clears; `--no-wait` (or
  `KOSMOS_NO_WAIT=1`) refuses at once, as before. A mistyped flag is refused, never taken as a 20-minute wait.
- Two waiting suites never wait on each other, and two freed by the same finish never start together.
- Each rule is shown red and green in tools/test-cut-guard.sh, and each is proven by a mutation that turns a test red.

## Decided, and why
- One shared loop, `kosmos_wait_until_clear` in tools/lib/cut-guard.sh, used by both scripts. A copy per script is
  how the two guards drifted before (#4410's review history).
- run-tests.sh takes `KOSMOS_NO_WAIT=1` only, no flag: every argument it gets goes to `node --test`, and taking one
  out would change what `yarn test <file>` means.
- The suite queue (a `suitewait.<pid>` marker, oldest first, a second ask on leaving the queue). Rejected: a lock
  file held for the whole run. A lock outlives a crashed run unless something cleans it, and the run markers here
  already solve that with a pid plus command check; the queue reuses that shape.
- A run-tests.sh inside a test (a node --test ancestor, or the kt sandbox) skips the suite check: it is part of the
  suite that started it, and would otherwise wait 20 minutes on its own parent.
- The cut's own runs (holding the machine claim) skip the wait, as they skipped the refusal.
- The machine-claim refusal in run-tests.sh stays immediate: a cut's claim is long and has its own tooling
  (tools/who-has-the-box.sh); waiting on it is Baron's call (m2795), not this card's.

## Weakest part
- A harness jumps the queue: a waiting suite yields to any test-install, even one that arrived later, so a suite
  behind a long harness can reach its 20-minute bound and refuse. The safe side, but a real cost on a busy night.
- A waiting run-tests.sh is still a run-tests.sh process, so plain heavy-gate and older guards on other checkouts
  (without this change) count it as a live suite. That over-refuses, never under.
- A targeted `yarn test <file>` waits like a full suite. Cheap runs could skip the queue; not done, because a
  targeted run still boots boards on the same ports.
- test-install does not ask about another test-install (it never did). Out of this card's scope.
