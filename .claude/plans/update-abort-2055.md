# Plan: update-abort-2055

Addresses **kosmos#2055**: an update that cannot pause the board aborts silently and
forever. Found by me while retracting a different claim about a confounded specimen;
Splinter carded it and assigned it to me.

## The bug

On an UPDATE, `install/setup.sh` runs `kosmos stop` then probes the port; if the board
still answers, it `die`s: "A Kosmos board is still running on port N and could not be
paused... paste the install line again" (setup.sh:2534). `kosmos stop` only stops the
board it OWNS (the installed/launchd one). A board running OUTSIDE that supervision -
started manually, wedged, a permission changed, or (the code's OWN comment at 2545-2546)
"a board outside launchd's supervision on the prior version, the exact after-state found
on Josh's machine, 2026-08-24" - is not stopped, so the update dies EVERY time.

On the AUTOMATIC path the board's in-process updater spawned this `curl | sh`, so the
die goes to stderr / install.log, which nobody reads. Measured: **155 consecutive
aborts on one machine**, visible only in a log file. A machine in this state stops
receiving updates permanently - including the fix for whatever else is wrong with it -
and neither the user nor we can tell. The message is good; it is addressed to a human
who ran the installer by hand, on a path where no human is watching.

## The fix: make the abort visible (Splinter's "Layer 2")

Layer 1 (setup.sh KILLING the surviving process) is deliberately NOT built: it is a
privilege decision (terminating a process the installer does not own, on a string-match
port probe) and is out of this card. Layer 2 - surface the repeated abort - has no such
hazard and is the actual harm.

**Engine half (this PR, buildable + testable by me):**
1. `install/setup.sh`: at the pause-abort, record a durable, CONSECUTIVE-counted marker
   at `$LOG_DIR/update-abort` (the same `logs/` dir the board reads install.status
   from), with reason/port/ts. Cleared once an update gets past the pause, so a machine
   that recovers stops showing it.
2. `engine/update.js`: `updateAbort()` reads the marker, returning `{count, reason,
   port, ts}` when stuck (count>0) or null when healthy.
3. `server.js`: `/api/status` carries `updateAbort` alongside `updateAttempt`.

**Board notice (a browser-verified follow-up, NOT in this PR):** web/index.html shows a
notice when `updateAbort.count` is significant, worded for the automatic-path audience
(what the machine will do / what to press - not "paste the install line again"). This
is a frontend change and needs a screenshot + browser-test, which this default session
cannot produce; routed to a browser-capable agent.

## Test (the card requires a control that FAILS on a clean update)

- `tools/test-update-abort-2055.sh` (wired into `test:shell`): extracts setup.sh's record
  block and drives it - first abort writes count=1 with the reason, consecutive aborts
  increment, a corrupt count resets to 1; and the RESET clears the marker so a clean
  update leaves nothing (the control - a healthy machine cannot read as failing). Pass
  under sh and bash 3.2.
- `engine/update.abort-2055.test.js` (7 cases, auto-globbed by the node runner): a stuck
  machine reports count+reason; NO marker => null (the healthy-machine control);
  cleared/garbage/blank => null and never throws; no installed root => null.

## Scope

- Layer 1 (perform-a-kill) is out of this card (privilege decision, #2055 body).
- The board notice is a browser-verified follow-up (frontend lane).
- Related: #2051 (the stale-bundle question - the abort is candidate (i), split out so it
  is not closed with the others); #2036 (staging, why the update path sat untested).
