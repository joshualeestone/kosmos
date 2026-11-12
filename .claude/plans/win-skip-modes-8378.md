# win-skip-modes-8378: the POSIX-modes cluster of #8378 (kosmos#8378)

**Posture:** production

## Problem
#8378, fourth cluster. Tests that fail on a Windows host only because they check POSIX file modes (0600/0700/0644,
`mode & 0o777`, a loose file or folder "tightened", umask). Windows keeps no POSIX mode bits, so these assertions cannot
hold there; the behaviour around them (a token stored, read back, never leaked, a file replaced not rewritten) can.

## How the set was chosen
From the #8368 per-test reasons (main 53a164708d), 26 candidate files whose recorded failing reasons looked like mode checks; 24 taken after reading each test (2 not taken, below).
Re-measured on origin/main a551c86ddf on the Windows box (node 24.19.0, TAP): all 26 still fail, 47 failing tests, the
same counts. Each failing test was read and run.

## Change (test-only; no production code)
- One file-level `NO_POSIX_MODES = skipOnWin32('it checks POSIX file modes, which Windows does not keep')` per file
  (the same reason string everywhere), false off Windows, so macOS and Linux run every assertion as before.
- A test only about modes is skipped whole on Windows (sendertoken x4, dirmode-1763 x3, backupmemberkey-5744 x2,
  wouldping x3 incl. its mode CONTROL, trust.createifabsent-2129 x1, accounts.delete-primary-2684, backupagy,
  prompternudge).
- A test that checks other behaviour too keeps running on Windows with only its mode assertions guarded
  (`if (!NO_POSIX_MODES)`), e.g. cloudflare/githubdevice/tokendoors (the inode-replaced check still runs), fedseal
  (key reuse, invites, stray temp), server.claude-apikey-2420 (the key never in the response or settings).
- tools/windows-tests.js: 22 new HOST_BRANCH_EXCLUDED entries and 2 rewritten (communitysend had its own
  `process.platform === 'win32'` mode skip from #5431, now NO_POSIX_MODES so the file has one win32 branch; sendertoken's
  old "measured red on Windows (#1777)" entry), all carrying the reason.

## Not taken (left for other clusters)
- cli.token-off-argv-1970 :71: fails before any mode check (runs install/kosmos, a bash CLI, and a #!/bin/sh fake curl).
- server.limitdm-5805 :232: uses chmod 0o400/0o500 to make a removal fail; Windows does not enforce that on folders, so
  it is a fault injected through permissions, which needs its own reason or a seam.

## Not a fix
None of these is a Windows bug: the assertion is about POSIX mode bits. Whether Windows protects these files another
way (the user profile's ACL) is a separate question, not measured here and not claimed: card #8439.

## Done when
- The 24 changed test files run 0 failed on the Windows box.
- windows-tests-1777, windows-coupling-audit-1732, engine.reachable, win32-separator-guard, fixture-discipline,
  no-name-refs green.
- Mac/Linux CI green (the guards read false there; none of the files is newly selected for Windows CI).
