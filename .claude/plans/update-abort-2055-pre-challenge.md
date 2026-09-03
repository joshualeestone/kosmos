---
pre_challenge: true
method: challenge-loop
branch: update-abort-2055
diff_hash: 8fc7ed55dcc4b46d0cc7c60783a9ec640e91a243ac090e57188198994e48fd80
subdir_audit: passed
timestamp: 2026-09-03T17:27:10Z
iterations: 2
converged: true
---

# Challenge-loop proof: update-abort-2055 (kosmos#2055)

Makes a silently-permanent update failure visible (the engine half). On an update,
setup.sh's "could not be paused" die is silent on the automatic path (stderr /
install.log, unread), so a machine can stop receiving updates forever - 155
consecutive aborts on one machine. setup.sh now records a durable, consecutive-counted
marker at $LOG_DIR/update-abort (cleared once an update passes the pause); update.js
updateAbort() reads it; server.js exposes it at /api/status. Layer 1 (setup.sh KILLING
the process) is deliberately NOT built (a privilege decision, out of card).

Diff: install/setup.sh, engine/update.js, server.js, tools/test-update-abort-2055.sh,
engine/update.abort-2055.test.js, package.json, .claude/plans/update-abort-2055.md.
The board NOTICE (web/index.html) is a browser-verified follow-up, routed to Renet.

## Convergence

Converged after 2 iterations. Iteration 1 found only by-design semantic notes (the
marker tracks the pause-abort streak, not general update success; the reset clears on
passing the pause) plus comprehensive strengths; the semantics were made explicit in
the comments. Iteration 2 found zero. `sh -n`/`bash -n`/`node --check` clean; shell
test 10/10, node test 7/7 at convergence.

## Iteration findings (verbatim markers)

#### Iteration 1
- [WARNING] setup.sh reset clears on passing the PAUSE, not on update SUCCESS. RESOLVED as by-design (the marker tracks the board-would-not-pause streak; a later install failure is a separate signal, updateAttempt/install.status). Made the scope explicit in the updateAbort() doc and the reset comment so a reader does not read updateAbort:null as "update succeeded".
- [WARNING] on a no-lsof machine a silent-but-port-holding board passes the probe and reaches the reset. RESOLVED as by-design: with an empty probe body there is NO pause-abort (the die did not fire), so clearing the streak marker is correct; the port-still-held degraded state is the lsof guard's concern (Layer 1, out of card).
- [STRENGTH] errexit-safe record block; robust counter (corrupt/blank -> 1); updateAbort() cannot throw; server.js safe on every poll; tests drive the real shipped bytes with the card's control; POSIX-clean, no em dashes, no control chars.

#### Iteration 2 (converged)
- [BLOCKER] None. [WARNING] None. [CONVENTION] None material.
- [STRENGTH] Independently re-verified: the reset runs ONLY past the pause (every abort arm die's and exits); errexit safety; counter correctness; updateAbort() null-safe parse (NaN/missing/0/'' -> null); server.js can't break the handler; the shell test's reset arm proves the clean-update-leaves-no-marker control.

### Final Ledger

No open BLOCKER/WARNING/CONVENTION. Iteration 1's two WARNINGs were both by-design scope
choices (the reviewer said so), resolved by making the marker's semantics explicit in
the code rather than by a behaviour change. Converged.
