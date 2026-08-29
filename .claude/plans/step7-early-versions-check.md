# Ask for the versions entry at step 1, not after the build (#1453)

Branch `step7-early-versions-check`.

## Context

Four cuts died at step 7 on the versions-page gate: 0.5.80, 0.5.90, 0.5.91 and 0.6.06.
Each one paid about fifteen minutes of suite, browser gate, install gate and build to be
told something knowable in three seconds.

The finding is that **the check was never wrong, its position was**. Both halves of it
need only `$V` (argv, release.sh line 18) and `$SITE` (line 131), and both exist before
the script does any work at all.

Step 7 has two gates, not one, and the four failures were not one mechanism: 0.6.06 hit
presence (the entry was absent), 0.5.91 hit staleness (the site repo carries commit
`5406857`, "restamp the 0.5.91 entry", which changes one `rel-d` line and adds no
article). A single explanation would have aimed the fix at the wrong half.

## What changed

`tools/lib/versions-entry.sh` holds the gate as one function. `release.sh` calls it at the
end of step 1 and again at step 7.

**The step 7 call is kept.** The two ask different questions: step 1 asks whether the cut
can finish, step 7 asks whether the page is right at the moment we deploy, which still has
to hold because the site checkout can change under a fifteen-minute cut. One function and
two call sites, so the window cannot drift between copies.

The FUTURE side stays at 20 at both call sites. Widening it was proposed and rejected:
the guard's own comment records that the four newest entries of 2026-08-21 claimed release
times that had not happened yet, so forward stamps are exactly what it catches, and a wider
future window makes a guess satisfiable again.

The PAST side is NOT the same at both, and an earlier version of this plan said the window
was symmetric throughout. Step 1 accepts 5 minutes, step 7 accepts 20, because an entry
already fifteen minutes old passes a symmetric window at step 1 and then dies at step 7
once the cut has added its own fifteen. Step 1 can see that it is doomed. Tightening the
past is not the same move as loosening the future, and only one of them reopens a hole.

## What I got wrong in flight

1. I asserted, without running it, that an early stamp check would refuse correct entries,
   because a publication stamp sits about fifteen minutes in the future at step 1.
   Measured: `off = -15`, and `15 <= 20` passes. The constraint was false and it nearly
   cost the cheap half of this fix.
2. I then proposed an asymmetric window to fix that false constraint, which would have
   reopened the documented vulnerability. Rejected.
3. I placed the gate before the divergence guard, which pre-empted it: a cut from a
   diverged tree refused with "no versions entry" instead of naming the stranded commits.
   Three release-gate arms went red. It now runs last in step 1.
4. My first mutation test silently did not apply, because BSD sed ignores the `0,/re/`
   range, and the green it produced meant nothing.

## Finished when

- `tools/test-versions-entry-gate.sh` covers both axes in both directions and each arm is
  shown to go red under a deliberate mutation.
- The three release-gate arms that assert step 1 behaviour still pass.
- The full suite is green.

## Proof before the write

Twenty-six arms in tools/test-versions-entry-gate.sh and twenty in
tools.release-gate.test.js. Every guard added here was shown to go red under a deliberate
mutation, each applied by a method whose precondition is measured before the result is
read: window widened to 200, presence forced true, the step 1 call unwired, the awk
article bound removed, the shell integer guard removed (with node stubbed to exit 127,
because the node-side guard masks it otherwise), and the step 1 call moved above the
divergence guard.

Full suite: 2880 pass, 0 fail. The new test is confirmed to have run inside that suite
(grep 1, with a pre-existing test as control at 1), so the green is not a filter matching
nothing.
