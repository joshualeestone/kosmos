# bootadds-5584: the install gate's added-files check runs at PR time (#5584)

## Problem
`tools/test-install.sh` checks that an install adds exactly `EXPECTED_ADDS`, but only inside a release cut. A PR
that makes the board write a new file at start merged green and failed the next cut hours in. It has happened at
least four times: .world-confirmed.json, ping.json, prompter-nudges.json, and board-alive.json (0.7.28).

## Decided (PigeonPete): the card's option 1, made exact
- **A node test, `install.boot-adds-5584.test.js`.** It boots the real `server.js` the way the gate's smoke boot
  does: the gate's exported variables pointed into a sandbox, the gate's seeded person data, DRY_RUN, and the
  gate's first request to `/`. It waits until the added set is stable for 3s, bounded at 20s, then compares it with
  `EXPECTED_ADDS`. The list is read live from `tools/test-install.sh`, so there is one list, not two.
- **Rejected: the card's static writer scan.** Finding every boot-path writer by reading code misses writers
  reached indirectly. Booting the real start path cannot.
- **Rejected: running the whole gate on PRs.** It does a real Claude Code download and a full install, which is
  too heavy and too network-bound for every PR. The added-files half needs only the board's start.
- **The test's own exceptions:**
  - `source-channel` is written by setup.sh, not the board, so it is set aside, named.
  - `ping.json` is written only outside a test runner, because engine/ping.js is inert under NODE_TEST_CONTEXT.
    The child keeps that variable: about twenty modules (updating, remote, connect) go inert on it, and a test must
    not wake them. The test asserts that this reason still holds.
- **This PR also blesses board-alive.json.** It is the same change as the 0.7.28 cut's `installgate-5359` branch.
  Main writes the file today, so without the bless this test would fail every PR until the release merges back.
  The two diffs are identical and merge cleanly.

## Controls
- Main as it stands (no bless): FAILS, naming `./Kosmos/board-alive.json`. That is the real 0.7.28 defect.
- Main plus the release branch's gate script: PASSES.

## Weakest premise
That every board-start write happens with NODE_TEST_CONTEXT set. A future start file whose writer is also inert
under test would be invisible here and would still fail only in the cut. What would change it: a second such file.
Then boot the child without NODE_TEST_CONTEXT, in a sandbox whose network is blackholed.
