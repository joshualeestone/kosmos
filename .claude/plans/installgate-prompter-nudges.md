# Plan: install-gate allowlist for prompter-nudges.json (unblocks 0.6.90)

## Context (a cut-blocker, not a filed card)
The 0.6.90 staging cut (mine) halted at step 4b, the #624 install-gate in tools/test-install.sh:
"THE BUNDLE JUST BUILT DOES NOT INSTALL ... added, not expected: ./Kosmos/prompter-nudges.json".
The gate boots the installed bundle and asserts the added-file set equals EXPECTED_ADDS exactly.

## Root cause
Pete's Prompter feature (#3508, merged as #3513) added a new boot-written store,
./Kosmos/prompter-nudges.json: the runner tick writes the current nudge set to it each tick (an
empty set when the Prompter is off or nothing is stalled), and the web UI reads it via
/api/prompter-nudges (server.js, engine/prompternudge.js). It is a local 0600 file, nothing leaves
the Mac. Pete's PR did not add it to EXPECTED_ADDS, so the first cut carrying it (0.6.90) red-flagged
it. This is exactly the class the gate's own comment documents (.world-confirmed.json #2528, ping.json
#3038 - both boot-written files that landed here and were blessed).

## Decision
Bless it: add ./Kosmos/prompter-nudges.json to EXPECTED_ADDS in sort order (between ping.json and
source-channel, verified via LC_ALL=C sort) with a matching comment bullet explaining it is a
boot-written store like the two already listed. This teaches the gate about a file the install
already writes; it changes nothing about what installs.

## Rejected
- Treat prompter-nudges.json as a bug (an eager/stray write Pete should remove): checked the write
  logic - it is an intended, designed store (server.js + engine/prompternudge.js + tests
  web.prompter-nudges-3508.test.js / engine/prompternudge.test.js), written unconditionally each
  runner tick (empty when idle), same as .world-confirmed.json. Not a bug; the gate allowlist is the
  correct place to fix.
- Bounce to Pete: his PR introduced the gap, but the install-gate is release tooling (my lane), the
  fix is small and confident, and it blocks MY cut now; bouncing would stall the cut on his
  availability. Noted the pattern to Splinter/Pete so feature PRs update EXPECTED_ADDS in future.
- Skip the install-gate for the cut: no - #624 is a real safety check (it caught a genuine unaccounted
  file); skipping would ship an unverified install.

## Weakest premise
That prompter-nudges.json appears ONLY in EXPECTED_ADDS and not also in the update/survivor check. If
the update-path check (EXPECTED_SURVIVORS) also needs it, the re-cut would surface that at 4b too and
I would add it there. The failing assertion was specifically the added-set equality, so EXPECTED_ADDS
is the fix for the observed failure.

## Verify
- bash -n tools/test-install.sh: syntax OK.
- EXPECTED_ADDS is in LC_ALL=C sort order (diff against sort = empty).
- 0 em dashes.
- Ultimate proof: the re-cut of 0.6.90 passes step 4b (the install-gate) with prompter-nudges.json
  now accounted for.
