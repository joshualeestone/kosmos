# fingerprint-5532-win32: the Windows arm of the per-computer fingerprint (#5532, contract v1.5)

**Posture:** production

Stacked on `fingerprint-5532` (the Mac half, by the Mac fleet; no PR yet). Asked by Splinter on 2026-10-07 for Renet,
under the 09-16 rule that the Windows box builds the Windows side. Spec: Renet's latest comment on #5532.

## What this branch builds
- `engine/computerprint.js`, `hardwareId()` win32 arm: MachineGuid from
  `reg query HKLM\SOFTWARE\Microsoft\Cryptography /v MachineGuid /reg:64` (`readRegistry`), run as Windows' own reg.exe
  by full path, 5s timeout, no window, stderr discarded. Readable by a standard user with no elevation.
- `parseRegQuery(text)`: only a `REG_SZ` in the GUID shape counts, upper-cased like the Mac arm; else null.
- When reg.exe refuses (the DisableRegistryTools policy, or an AppLocker rule aimed at reg.exe: common on the managed
  PCs Enterprise is for), `readPowerShell` (`Get-ItemPropertyValue`, works in Constrained Language mode; Sysnative for a
  32-bit node, 10s timeout) is the fallback, parsed by `parsePsValue`. It runs only when reg.exe gave nothing. A PC that
  blocks both answers null, as an older board would.
- Caching, SHARED WITH THE MAC ARM (a behaviour change in the base branch's code, flagged in the PR for its owner): a
  successful read is kept for the run. A failed one is not kept for good, since a logon-time timeout must not leave the
  board with no print until it restarts; it is retried after `RETRY_AFTER_MS` = 5, 15, 60 minutes for the 1st, 2nd and
  3rd failure in a row, then not again this run, so a permanently blocked PC pays the synchronous spawn (up to 15s) a
  few times, not forever. The window is on `performance.now()` (monotonic), so a clock correction cannot stretch it.
  Callers should still read the print off any request path. `fingerprint(salt)` unchanged.
- Test seams: `opts.run`, `opts.runFallback`, `opts.now`, `opts.useCache`, `_resetCache()` (excused in
  engine.reachable.test.js with its reason).
- Exported and pinned by tests: `REG_ARGS`, `PS_ARGS`, `regExe()`, `powershellExe()`, `readRegistry`, `readPowerShell`,
  `parsePsValue`, `RETRY_AFTER_MS`. Paths use `path.win32.join` with the SystemRoot / windir / C:\Windows fallback, as
  machine.js and runners.js do (determinism, not a security boundary: SystemRoot is as environment-set as PATH).
- `tools/windows-tests.js` ALSO gains the test file, so the real-registry arm runs on Windows CI (the #1777 audit
  requires any test file branching on a win32 host to be run there or excluded with a reason).

## Decided
- `/reg:64` and Sysnative: a 32-bit node would otherwise read WOW6432Node's copy, which has no MachineGuid, and answer
  null silently.
- reg.exe first, PowerShell second: reg.exe has no profile or execution policy, starts fast, and its value line is not
  localized; PowerShell is there for the policies that block reg.exe.
- Sync, like the Mac arm: nothing calls this yet; the capped retry bounds the cost, and the caller's placement is the
  place to keep it off a request path.
- Weakest premise: a disk or VM clone keeps MachineGuid (sysprep resets it), so a clone reads as the same computer.
  Already stated on #5532; it ends at the consent prompt, not at lost data.

## Tests
- `engine/computerprint-5532.test.js`:
  - reg-query fixtures (CRLF, LF, wrong type, braced, not a GUID, error text); the win32 print; no cross-platform parse.
  - the PowerShell fallback: used when reg.exe refuses, not run when reg.exe answers, null when both fail or the output
    is not one GUID; `parsePsValue` fixtures.
  - the cache: a success is kept; a failure waits 5, 15, 60 minutes with no spawn inside a window, then is never retried.
  - the pinned reg.exe and PowerShell paths and arguments, including Sysnative for a 32-bit process.
  - a real-registry arm on Windows through production's own readers: shape, upper case, two fresh reads stable, and the
    real PowerShell fallback reads the same value (assert.ok throughout, so a failure prints no value).
- Counts differ by host: on Windows the Mac real-hardware arm skips, on macOS the Windows one does; on Linux both skip.
- Verified on the Windows box: all pass + 1 Mac skip; windows-tests-1777 23/23; engine.reachable green; the read matches
  PowerShell's Get-ItemPropertyValue (match only printed).
