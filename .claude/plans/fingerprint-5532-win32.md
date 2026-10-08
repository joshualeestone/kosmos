# fingerprint-5532-win32: the Windows arm of the per-computer fingerprint (#5532, contract v1.5)

**Posture:** production

Stacked on `fingerprint-5532` (the Mac half, by the Mac fleet; no PR yet). Asked by Splinter on 2026-10-07 for Renet,
under the 09-16 rule that the Windows box builds the Windows side. Spec: Renet's latest comment on #5532.

## What this branch builds
- `engine/computerprint.js`, `hardwareId()` win32 arm: MachineGuid from
  `reg query HKLM\SOFTWARE\Microsoft\Cryptography /v MachineGuid /reg:64`, run as System32's reg.exe by full path
  (never off PATH), 5s timeout, no window, stderr discarded. Readable by a standard user with no elevation.
- `parseRegQuery(text)`: only a `REG_SZ` in the GUID shape counts, upper-cased like the Mac arm; else null.
- A successful read is kept for the run; a failed one is NOT (shared with the Mac arm): a reg.exe timeout at logon,
  when Defender scans are worst, must not leave the board with no print until it restarts. Never printed or logged.
  `fingerprint(salt)` unchanged. `_resetCache()` and `opts.useCache` exist only for the cache's own test.
- `regExe()` uses `path.win32.join` with the SystemRoot / windir / C:\Windows fallback, as machine.js and runners.js do.
- `REG_ARGS` and `regExe()` exported so a test pins the command.
- `tools/windows-tests.js` ALSO gains the test file, so the real-registry arm runs on Windows CI (the #1777 audit
  requires any test file branching on a win32 host to be run there or excluded with a reason).

## Decided
- `/reg:64`: a 32-bit node would otherwise read WOW6432Node's copy, which has no MachineGuid, and answer null silently.
- reg.exe over PowerShell: no profile, no execution policy, fast, and its value line is not localized.
- Weakest premise: a disk or VM clone keeps MachineGuid (sysprep resets it), so a clone reads as the same computer.
  Already stated on #5532; it ends at the consent prompt, not at lost data.

## Tests
- `engine/computerprint-5532.test.js`: reg-query fixtures (CRLF, LF, wrong type, braced, not a GUID, error text);
  the win32 print and no cross-platform parse; the pinned reg.exe path and arguments; a real-registry arm on Windows
  (shape, upper case, stability; assert.ok so a failure prints no value).
- Counts differ by host: on Windows the Mac real-hardware arm skips, on macOS the Windows one does; on Linux both skip.
- Verified on the Windows box: all pass + 1 Mac skip; windows-tests-1777 23/23; the read matches PowerShell's
  Get-ItemPropertyValue (match only printed); with the arm stashed the three new Windows tests fail.
