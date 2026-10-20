# prepushwait-6756: releases and queued heavy turns wait for a relay pre-push build

Card: #6756 (Josh, 2026-10-20 19:27Z). Claimed after Liu Kang's claim check. Reviewer: Raiden.
Depends on relay PR #513 (open): do not merge before it merges.

## Finished means

1. A release cut or a queued heavy turn that starts while a relay pre-push cargo step runs on this machine waits for it,
   bounded, with a message naming the holder; past the bound it gives up and says so.
2. A lock file left behind by a finished or killed build blocks nothing.
3. A test proves both, with a real lockf.

## What the build does

As the card says: it holds a kernel lock (lockf) on `~/.cache/prepush/machine.lock` for each cargo step, publishes no
claim or marker of its own, and reads the machine claim before each step, stopping when a release or a queued heavy
run holds it.
The line-by-line evidence for this (read from the relay branch, not from memory, as Liu Kang asked) is in a comment on
relay PR #513, which is private; it is not repeated here because this repository is public.

## Decisions

1. **Live means the kernel lock is held now**: `lockf -k -s -t 0 <file> true`, exit 75 = held. Liu Kang first asked for
   "pid alive and is the build's process"; he agreed that the kernel lock replaces that: nothing is read from the file,
   and the kernel drops the lock when its holder exits, so a stale file cannot block and pid reuse cannot arise.
   Rejected: a marker file of our own (a second source of truth that can go stale).
2. **The probe is instant**: -t 0 and `true`, so on a free lock it holds it only while `true` runs; a build step
   starting in that instant waits that long. -k so the file is never deleted under a waiting build. No file means no
   build, and asking never creates the file.
3. **lsof names the holder** in the message, by pid and program name only (never the command line, which does not
   belong in logs); it never decides liveness.
4. **Callers and bounds:**
   - `tools/release.sh`: waits after it claims the machine (the claim stops the build's next step), bounded at 6000 s
     (100 min, past the card's longest step). `KOSMOS_CUT_PREPUSH_WAIT_S` sets it; `KOSMOS_CUT_IGNORE_PREPUSH=1` cuts
     anyway. Past the bound `kosmos_wait_until_clear` says "gave up" and the cut exits. Each poll of the wait (every
     30 s) renews the cut's claim first: the claim lasts 30 minutes and only step() renewed it, so a long wait would
     let it lapse and the build would start its next step beside the cut (review 1). Only a claim that is still the
     cut's, or none, is renewed, as the cut's renewer does (#5134). Rejected (review 3): running the wait inside the
     renewer, whose first renewal came 10 minutes after it started and whose reach the bound had to mirror.
   - `tools/queued-heavy.sh`: in `_qh_clear`, so a heavy turn waits in the queue under the queue's own bound. A light
     turn is not held back (a light run beside a heavy one is what the side turn already allows). In the main lane it
     still claims the machine for its own run, so the build's next step stops on that claim; a side-lane light turn
     exists only beside a heavy run that already holds the machine claim.
   - NOT `tools/run-tests.sh` (dropped after review 1): a full run never claims the machine, so waiting would cover only
     the cargo step running at that moment, and the build's next step would start beside it. Partial cover that reads
     as full cover is worse than none. A full run that must not share the box goes through `queued-heavy.sh`.
5. **A missing lockf is not a build** (another OS, a broken path).
6. **Own seam names** (`KOSMOS_CUT_LOCKF_BIN`, `KOSMOS_PREPUSH_MACHINE_LOCK`, `KOSMOS_PREPUSH_RECHECK_S`): nothing
   here reads a name the build itself reads, so neither side's settings move the other (review 3).
7. **Held means held twice, a moment apart.** Another probe holds the
   lock for an instant too; a second look 0.3 s later tells those from a build, which holds it for minutes.

## Residuals (named, not fixed here)

- Measured on this Mac's lockf utility: the lock belongs to the process that took it, not to the command it runs. If
  the lock's holder were killed while work it started ran on, the lock would read free and a cut could start beside
  that work. That needs someone to kill the holder by hand.
- A cut waits up to 100 minutes for a long `cargo test` step; it does not stop the build (the card's second option was
  rejected: failing a push to save a cut's minutes is the wrong trade, and the claim already stops the next step).
- A full run through `tools/run-tests.sh` (the validation helper's path) does not see a pre-push build (decision 4).
- A queued heavy turn passes its check while no step holds the lock and then claims; a build step that starts in the
  instant between that check and the claim being written runs beside the turn.
- Tests and the real lock (measured, review 6): with the probe instrumented to log every path it resolves and the
  setting cleared, the 12 shell tests that run queued-heavy.sh or release.sh made no probe call at all, and the two node
  tests that do (tools.release-gate.test.js, 27 calls; tools.cut-home-2724.test.js, 9) resolved every path inside
  their own temporary HOME, with no hit on the real ~/.cache. tools/run-tests.sh still points the lock path at one that
  cannot exist for every test it runs, and the two queued-heavy tests set their own, as a guard for tests added later.
