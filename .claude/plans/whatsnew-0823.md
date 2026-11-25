# whatsnew-0823: the What's New list for 0.8.23

Built with `node tools/whats-new-pool.js build 0.8.23` (online) on origin/main at 81df14e88e, for the cut the gap alarm
asked for on #1050 (main 86 commits past 0.8.22).

## What the build did
- Read Mac prod 0.8.22 and Windows prod 0.8.22, and marked 0.8.22's three highlights shown. lastProd and lastProdWin
  are now 0.8.22.
- Four highlights pending, so the window has four on the Mac and Linux and two on Windows (two are tagged mac).

## Pool additions
Each was read from its PR's "what changes for the person", or the code where the PR was unclear.
- **Fewer safety prompts reach you** (#9001 part 1b, PR #9035, mac, since 0.8.22, rank 8). It rode 0.8.22 with no
  highlight, by Splinter's call (noted on #9001), so it is announced now. The wording is Mona Lisa's. Tagged mac: its
  plan-file half is in install/kosmos-report-hook.sh, the Mac and Linux hook.
- **Mac agent restarts say why** (#8988, PR #9037, mac, rank 9). The Mac half of 0.8.21's Windows highlight: the card
  says when and why the process restarted.
- **A file that did not arrive whole is refused** (#9016, PR #9042, rank 10). Its size check needs the sender to state
  a size, which the board does and the phone does not yet (the PR says so), so the line says "a file sent from the
  board". A document whose ending is missing is marked to send again.
- **Account moves ask for a handoff first** (#9010, PR #9043, rank 11). The handoff is asked for on every platform. The
  pickup is delivered to the new session, with a note when it cannot be (engine/handoff-restart.js pickupMissedNote).
- notesOnly: **The guide pointer shows once per agent** (#9015, PR #9039) and **No feedback ask without a day of
  work** (#9033, PR #9041). Both are agent-facing.

## Not added
- #9028 (PR #9034) and #7352 (agerating): the iPhone app, which ships through TestFlight.
- #9018 (PR #9046): release tooling.

## Checks
- `whats-new-check.js 0.8.23 --platform=mac` and `--platform=windows`: exit 0.
- The test files that read these two files: 534 pass, 0 fail.

## Weakest premise
That #9035's two halves both hold on the Mac and Linux. They rest on its PR's tests and six review rounds, not on a
prompt seen on a Mac since it shipped.
