# fileaccess-diag-3188 -- pin the #3188 false-granted mechanism (diagnostic, observation-only)

## Problem
The fresh-ungranted test20 read (brand-new macOS user, Casey's mini, 0.6.74 staging) returned
`file-access-status.json` granted:true with an EMPTY TCC log (no prompt, no event). The
enumerate-based verdict in `fileAccessReading()` cannot explain granted:true on a never-granted box.
Three candidate causes, and the fix differs per cause, so we must pin it before writing the fix:
- (a) `homeDirectoryForCurrentUser` under the launchd/app-exe hatch resolves to a redirected /
  container home, so the probe enumerates container folders (which exist and need no TCC) and never
  touches the real protected trio.
- (b) `contentsOfDirectory` (enumerate) is not the TCC-gated op for this process; the real import
  scan does head-READS (gated), so probe and workload test different permissions.
- (c) the hatch genuinely has access on test20 (granted:true honest).

## What finished looks like
A diagnostic build in which every `fileAccessReading()` call logs, to board.log, enough to pin
(a)/(b)/(c) from a single test20 re-run, WITHOUT changing the file-access verdict or behaviour.

## Change (native-app/main.swift, `fileAccessReading()`, observation-only)
- Log the RESOLVED home path once: `DIAG_DEBUG fileaccess #3188 resolvedHome=<path>` (catches (a):
  a home != /Users/<user> explains everything).
- Per folder (Documents/Downloads/Desktop), log: the enumerate outcome (`ok(entries=N)` or
  `THREW(domain,code)`) and a NON-MUTATING errno probe of a non-existent path
  (`open(<dir>/.kosmos-tcc-probe-3188-nonexistent, O_RDONLY)`): errno EPERM(1)/EACCES(13) => a real
  READ would be DENIED here (enumerate verdict is a false positive => (b)); ENOENT(2) => TCC allows
  the read, genuinely granted => (c). The errno probe works on a fresh box's EMPTY folders (no real
  file needed), reading errno immediately after open() before any call can clobber it.
- The RETURN value is unchanged (still `allGranted` from the enumerate), so the current false-green
  is preserved and measured; the fix (switch the probe to a read, or fix home resolution) is a
  SEPARATE follow-up change once this diag names the cause.

## Interpretation of the test20 re-run
- resolvedHome != /Users/test20 -> (a): fix home resolution under the hatch.
- resolvedHome ok, enumerate ok, errnoProbe EPERM/EACCES -> (b): switch the probe to a content
  head-read matching the scan (main.swift:571-577), which IS the gated op.
- resolvedHome ok, enumerate ok, errnoProbe ENOENT -> (c): granted:true is honest; the residual is
  ICK's onboarding-auto-POST JS gap + cosmetics, not a native false-positive.

## Scope
- Native-only (native-app/main.swift). No web/ change (browser-check gate chain does not fire), no
  engine/JS change. Non-mutating (the errno probe opens O_RDONLY on a non-existent path; creates
  nothing, reads no user data, logs no file contents -- only errno and entry counts).
- Ships via the cut (tools/build-kosmos-bundle.sh:235 swiftc + codesign on the release machine);
  Splinter routes a fast staging build to test20. I do not distribute locally.

## Test plan
- LOCAL compile-check at the floor target (done): `swiftc -target arm64-apple-macos13.5 -O
  native-app/main.swift` -> exit 0, no warnings, binary produced. This is the pre-PR safeguard so
  the cut never fails on a Swift error; it does not exercise the diag (that needs the fresh box).
- The real measurement is the test20 re-run after Baron's diag build; that pins (a)/(b)/(c).

Addresses #3188
