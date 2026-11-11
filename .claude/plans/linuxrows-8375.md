# linuxrows-8375: Linux Settings stops showing macOS's checks (kosmos#8375)

## Problem
`machine.check()` ran the two macOS launchd checks (restart, background jobs) everywhere but Windows (#8374), and the sleep row ran `/usr/bin/pmset` everywhere but Windows. On Linux, measured with `check({ platform: 'linux' })` and every command failing as it would there, Settings > Computer showed three "could not check" rows about macOS, the sleep one pointing at System Settings.

## Change
- The two launchd rows run on macOS only (`isMac`), not "everywhere but Windows".
- On Linux the sleep row stays, since a Linux laptop can sleep, but pmset is not run and its words name no macOS place: "You can see it in this computer's power settings." No button.

## Decided
- Built on PigeonPete's #8374, agreed with him, and rebased onto main once that merges.
- Linux's own "do agents come back after a restart" row is not built: Linux has none today, and adding one is a feature, not this fix.

## Weakest premise
That a Linux board's commands fail the way the test's runner does. Not run on a real Linux board.

## Not done
`sleepGate` (the setup wizard's sleep read) still asks pmset off Windows. On Linux that read fails and the gate reads as unknown, which is honest; it was not changed here.
