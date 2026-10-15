# Plan: stop computerprint-5532 flaking the Windows CI job (#6222)

## Problem
`engine/computerprint-5532.test.js` has a Windows-only test (skipped off win32) that forces reg.exe
to fail so it exercises the REAL PowerShell MachineGuid fallback, then asserts the PowerShell print
equals the reg.exe print. On the loaded self-hosted Windows runner, powershell.exe intermittently
exceeds the 10s read timeout (POWERSHELL_TIMEOUT_MS in engine/computerprint.js), so the read returns
null and the assertion fails with "a different value, or none". It went red on two unrelated PRs on
2026-10-15 (#6202, #6221), each took 11s (= the 10s timeout + overhead), and both cleared on rerun.
It is a transient timeout returning null, not a wrong value and not a reader bug.

## Why it is test-only (production is safe)
On a double-failed read (reg.exe fails AND PowerShell times out): readMachineGuid throws; hardwareId
catches to null and only a SUCCESSFUL read is cached, so a prior good print is kept (never
re-derived); fingerprint returns null; printFor defers (send 'later') and after 10 min sends a
print-LESS request. It never mints a new or different print, so one computer cannot look like two.
Confirmed on the card before building.

## Approach (test-only, no production change)
Wrap the forced-fallback read in the Windows test in a bounded retry: up to 3 tries, resetting the
runner each try (cp._testRunner(..., { platform: 'win32', fallback: 'real' }), which clears cached +
failedAt + backoff so each try is a fresh real read). Take the first non-null read and require it to
equal the reg.exe print a (a genuinely DIFFERENT value is a reader bug and still fails at once); fail
only if EVERY try returns null (a persistently unreadable PowerShell, the real "no way in"). A single
transient 10s timeout no longer reds the job.

Rejected: raising POWERSHELL_TIMEOUT_MS. That lengthens how long a real Windows read may hang the
board (a product decision), not a test fix. Not KNOWN_RED either: the test is green on main most of
the time, so it is flaky, not known-broken.

## Files
- `engine/computerprint-5532.test.js` (the retry; the only change)

## Verification
- Local (macOS): node --check OK; the suite runs 15 pass / 0 fail / 1 skipped (the Windows test
  skips off win32). The retry's real effect can only be seen on the Windows CI runner, which cannot
  run locally; the card's bar is N consecutive green Windows runs.
- The retry still fails on a different value (reg.exe and PowerShell read the same MachineGuid key, so
  a mismatch is deterministic, caught on try 1) and on a persistently-null fallback.
