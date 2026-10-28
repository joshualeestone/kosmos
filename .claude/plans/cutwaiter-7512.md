# #7512: the cut's quiet-box wait counts a suite that is only waiting on the cut's own claim (0.7.73 deadlock)

## Finding (from the card, re-read against the live wrapper)

mortals:~/.cut-0773.sh's `running()` counts every `pgrep -f "bash tools/run-tests\.sh"` as busy. A full suite that meets
the cut's machine claim waits in kosmos_wait_until_clear's suite queue and runs no test, so the cut waited on the
suite and the suite waited on the cut, for about 20 minutes, until someone stopped the suite by hand.

## Change

- `tools/lib/cut-guard.sh`: `kosmos_cut_quiet_box_busy`, the wrapper's `running()` as one committed function, in the
  same order: relay pre-push build, suite, stray shell-shard workers, install harness, browser-checks. The suite arm
  drops the caller's own subtree and any suite holding a verified waiting marker, or descended from one
  (`_kosmos_drop_suite_waiters`, the rule kosmos_refuse_if_suite_live already uses). Anything unreadable is busy.
  The shard check is `_kosmos_shell_shards_live`, so a test can stub it.
- The per-cut wrapper sources the Mortals main checkout's cut-guard.sh already (#5470's note). The next wrapper uses
  the FAIL-CLOSED shape in the function's comment (only 0 and 1 are answers; anything else, a missing function's 127
  included, is busy), never a bare `running() { kosmos_cut_quiet_box_busy; }`, which reads a checkout older than
  this as a quiet box.

## Tests (tools/test-cut-guard.sh, beside the #4498 waiter arms, reusing their stand-in waiter process)

- CONTROL: an unmarked suite holds the cut, named by its pid.
- A suite holding a verified waiting marker does not (the 0.7.73 case).
- A running suite beside a waiter still holds it, named by the running one's pid.
- A suite read that fails holds it (busy).
- A browser-checks run holds it while a suite only waits.

- Review 1, the real chain: a suite queued behind a real foreign claim (the real kosmos_refuse_if_machine_claimed
  inside the real kosmos_wait_until_clear --suite-queue, in the test's marker folder) is marked while it sleeps and
  reads as not running; its marker is gone once it gives up; CONTROL: the same suite with no wait reads as running.
- Review 1, the wiring: run-tests.sh's box check asks about the claim on its first line, and it waits for that check
  in the suite queue.

- Review 3: each other check holds the cut alone (a pre-push build; shard workers, and a pgrep that fails; an install
  harness, and one that cannot be read); CONTROL: all quiet reads quiet, saying nothing.

Mutants: no waiter drop (3 red), every suite dropped (2 red), an unreadable read taken as quiet (1 red), the queue
writing no marker (the chain arm red), the claim check moved out of the box check and the suite queue dropped (the
wiring arms red); review 3's five: no pre-push, no shards, a shard error read as none, no install, cannot-tell read as
quiet (each red on its own arm).

## Rejected / out of scope

- Having run-tests.sh write a separate "waiting on a claim" marker: the suite queue already writes a verified one
  after the first refused check, and a second marker would be a second truth to keep in step.
- `heavy-gate.sh --quiet-box` also counts a waiting suite as busy. It answers once and does not wait, so it cannot
  deadlock; it only makes a pre-check say busy a little longer. Not changed here.

## Weakest premise / residual

- A suite started with the suite check off (KOSMOS_TESTS_IGNORE_SUITE=1, or inside a test) waits without a marker, so
  it still reads as busy. Its own wait gives up at KOSMOS_WAIT_MAX_S (20 minutes), so the cut is held at most that long.
- In the moment before a queued suite's first refused check, it has no marker yet and reads as busy; the next poll
  sees the marker.
- Merged is not in effect until mortals:~/work/agent-workforce is pulled AND the next wrapper calls the function.
