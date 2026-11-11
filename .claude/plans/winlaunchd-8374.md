# winlaunchd-8374: no launchd rows on Windows Settings (kosmos#8374)

## Problem
engine/machine.js check() runs restartCheck (launchctl gui/<uid>) and labelTruthCheck (LaunchAgents labels)
on every platform. On Windows process.getuid is undefined, so Settings > Computer shows "We could not check
the background jobs: we could not tell which user this computer is running Kosmos as" (Homer, installed 0.8.02,
keys installed, sleep, restart, labels, autostart).

## Change
In check(), both rows are null on win32 and filtered out with the existing .filter(Boolean). darwin unchanged.
The win32 autostart row already answers whether Kosmos and agents come back after a restart.

## Rejected
- A Windows labels check: the impostor-label trap (#224) is launchd-specific; the logon task is the autostart row.
- New wording for the uid line: it would still report a check that cannot exist on Windows.
- Changing Linux: out of scope, not measured.

## Test
engine/machine.test.js: win32 with a plist present and getuid removed has no restart/labels rows and no
"which user" text; darwin control with the same state still has both and the uid line. Red with the guard removed.

## Done when
Served on Windows and Homer's Settings > Computer shows no background-jobs row; keys installed, sleep, autostart.
