# fingerprint-5532-win32b: the Windows reader for the computer print (#5532), on main's module

**Posture:** production

Written 2026-10-10 by the Windows lane. Supersedes PR #5557 (branch `fingerprint-5532-win32`), which was stacked on the
first Mac commit (d3fbd84eb) and could not merge once the Mac module was rebuilt and merged as #5565 (4d620e429).
This branch redoes it on main, following the Mac owner's review on #5557.

## Finished looks like
On Windows, `printFor(salt, company)` answers `print` with HMAC-SHA256(salt, company + ':' + MachineGuid), read by
reg.exe and then PowerShell; a failed read follows exactly the Mac's retry rule; no export returns the raw id; a
real-registry test on this box and on the CI Windows runner passes, comparing prints only as booleans.

## What changed in engine/computerprint.js
- `realRun(platform)` dispatches: darwin runs ioreg (unchanged options), win32 runs reg.exe
  (`query HKLM\SOFTWARE\Microsoft\Cryptography /v MachineGuid /reg:64`, System32 by full path, 5 s timeout).
- `readMachineGuid()` (private): reg.exe parsed by `parseRegQuery` (a REG_SZ in the GUID shape only); if that gives
  nothing, PowerShell's `Get-ItemPropertyValue` (System32, or Sysnative from a 32-bit process; 10 s timeout) parsed by
  `parsePsValue`. Returns the id or throws an error that carries neither the value nor any output.
- `hardwareId()` and `printFor()` treat darwin and win32 as the platforms with a reader. The retry state, the
  one-minute wait, the ten-minute give-up to `none` and the doubling backoff to an hour are main's, untouched and shared.
- Windows never sets `noIdHere`: a missing or non-GUID MachineGuid is a failed read (review item 6), so it defers for
  ten minutes and then sends `none`.
- Exported, for fixtures and pins only: `parseRegQuery`, `parsePsValue`, `regExe`, `powershellExe`, `REG_ARGS`,
  `PS_ARGS`. Not exported: `readRegistry`, `readPowerShell`, `readMachineGuid`, `realRun`, `hardwareId` (a test pins
  their absence).
- `_testRunner(fn, opts)`: `fn` is the first read on either platform; `opts.fallback` is Windows' second read (a
  function, `'real'` for production's PowerShell read, or absent, which runs no PowerShell when `fn` is swapped).

## Dropped from #5557
- The 5 / 15 / 60 minutes then never-again rule and its `_resetCache` seam (and its engine.reachable excuse). The
  Mac owner's reasons, accepted: it delayed the first retry by five minutes, and "never again" left a board with no
  print until restart.
- Any change to the Mac arm's caching, and the options on `hardwareId`/`fingerprint` (main has none, by review 4).

## Tests (engine/computerprint-5532.test.js)
- Fixtures: `parseRegQuery` (CRLF and LF, REG_BINARY refused, braced GUID refused, error text), `parsePsValue`.
- The Windows print is the same HMAC; printFor answers it; the raw-id readers are not exported.
- PowerShell runs when reg.exe refuses or answers a non-GUID, and not when reg.exe answers.
- The shared rule on Windows: reads inside the minute are skipped, two non-GUID answers stay `later`, `none` at ten
  minutes, a doubling wait after, and a recovered reader is noticed and kept.
- Paths and arguments pinned (/reg:64, System32, Sysnative).
- Real registry (skipped off win32): two fresh reads and production's PowerShell read give one print, as booleans.
- The existing Windows expectations on main ("Windows answers null", printFor `none` on win32) now use linux for "no
  reader" and expect `later` for a failed Windows read.
- tools/windows-tests.js runs the file on the Windows CI job (its real-registry arm branches on a win32 host).

## Decided
- Kept the reads exactly as #5557 had them (the Mac owner's item 5).
- Weakest premise: a fifteen-second synchronous stall (reg.exe then PowerShell both hanging) once a minute for ten
  minutes, then at most once an hour, is acceptable on a managed PC that blocks both. The Mac owner accepted it on
  #5557; if measured worse, a lasting "both tools refused" answer is the place to stop, not a fixed count.
- A cloned disk image or VM clone copies MachineGuid (stated on #5532); that ends at the consent prompt.
