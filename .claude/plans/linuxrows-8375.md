# linuxrows-8375: Linux Settings stops showing macOS's checks (kosmos#8375)

## Problem
`machine.check()` ran the two macOS launchd checks (restart, background jobs) everywhere but Windows (#8374), and the sleep row ran `/usr/bin/pmset` everywhere but Windows. On Linux, measured with `check({ platform: 'linux' })` and every command failing as it would there, Settings > Computer showed three "could not check" rows about macOS, the sleep one pointing at System Settings.

## Change
- The two launchd rows run on macOS only (`isMac`), not "everywhere but Windows".
- On Linux there is no sleep row either. This board has no Linux reading of sleep, so a row could only ever say it did not check, and it would stand in the "could not check" count on every Linux board, as `agentAutostartCheck` already avoids by returning nothing off macOS.

## Decided
- Built on PigeonPete's #8374, agreed with him, and rebased onto main once that merges.
- Linux's own answers are not built here: the board is an enabled systemd user unit and reads linger back (engine/linuxboard.js, engine/linuxjob.js), and logind decides laptop sleep. Rows reading those are a feature, filed as #8384.
- Rejected: keeping a Linux sleep row with platform-neutral words. Review 1 showed it still claimed a read that never happened.

## Weakest premise
That a Linux board's commands fail the way the test's runner does. Not run on a real Linux board.

## Not done
`sleepGate` (the setup wizard's sleep read) still asks pmset off Windows. On Linux that read fails and the gate reads as unknown, which is honest; it is on #8384.
