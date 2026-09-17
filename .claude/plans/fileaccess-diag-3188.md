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
A diagnostic build in which `fileAccessReading()` writes, to a store-dir FILE the test20 re-run can
read, the resolved home + per-folder enumerate outcome -- enough to distinguish cause (a) from
not-(a) -- WITHOUT changing the file-access verdict or behaviour.

## Change (native-app/main.swift, `fileAccessReading()`, observation-only)
- Record the RESOLVED home path (`resolvedHome=<path>`): catches (a), a home != /Users/<user> under
  the launchd/app-exe hatch, which alone explains granted:true with no real protected-folder access.
- Per folder (Documents/Downloads/Desktop), record the enumerate outcome: `ok(entries=N)` or
  `THREW(domain,code)`.
- Write it to a store-dir file via `writeFileAccessDiag` (`file-access-diag-3188.txt`), NOT via
  `logLine()`. logLine targets the app log ($KOSMOS_APP_LOG, else /tmp/kosmos-app-test/app.log),
  which does NOT exist on a real install, so those lines are silently dropped. The store dir is the
  proven channel: `file-access-status.json` lands and is read there on test20.
- The RETURN value is unchanged (still `allGranted` from the enumerate), so the current false-green
  is preserved and measured; the fix is a SEPARATE follow-up once the cause is named.
- The errno-probe idea (open() on a non-existent path) was DROPPED after challenge-loop review: its
  (b)-vs-(c) discrimination depended on an unverified premise (does macOS evaluate TCC before
  existence), and open() on an undecided protected folder could itself block on a headless process
  or fire extra TCC prompts. resolvedHome + enumerate are the premise-free, side-effect-free signals
  that matter; (b) vs (c) is settled instead by placing a REAL file in a folder and reading it (the
  definitive gated op) if the design still needs that distinction.

## Interpretation of the test20 re-run
Read `file-access-diag-3188.txt` from the store dir alongside `file-access-status.json`:
- resolvedHome != /Users/test20 -> (a): the hatch reads a redirected/container home and never
  touches the real protected trio; fix home resolution under the hatch. (Premise-free.)
- resolvedHome == /Users/test20 AND every enumerate `ok` with granted:true and an empty TCC log ->
  the app-exe enumerate succeeds on the REAL folders without prompting. That is the core finding
  (the app-exe path does not prompt), which is the evidence for switching to the under-tmux-agent
  subject-flip fix (Josh's Approve-Access design) rather than tuning the app-exe probe. Whether that
  is (b) enumerate-not-gated or (c) genuinely-granted is secondary once we switch subjects; if it
  must be settled, place a real file in one folder and read it.

## Design note (2026-09-17)
Josh's direction settled on a real agent running UNDER tmux performing the actual folder + a11y
access on the user's tap (tmux becomes the genuine TCC subject). So this diag's role is to CONFIRM
the app-exe path false-greens (evidence to switch subjects), not to choose among app-exe probe
patches. #3188 (folders) and #3113 (a11y) share that one subject-flip fix.

## Scope
- Native-only (native-app/main.swift). No web/ change (browser-check gate chain does not fire), no
  engine/JS change. Side-effect-free: writes only to the app's own store dir (Application Support,
  not a TCC-protected user folder), logs no file contents or user data (only the home path, folder
  names, and entry counts).
- Ships via the cut (tools/build-kosmos-bundle.sh:235 swiftc + codesign on the release machine);
  Splinter routes a fast staging build to test20. I do not distribute locally.

## Test plan
- LOCAL compile-check at the floor target (done): `swiftc -target arm64-apple-macos13.5 -O
  native-app/main.swift` -> exit 0, no warnings, binary produced. This is the pre-PR safeguard so
  the cut never fails on a Swift error; it does not exercise the diag (that needs the fresh box).
- The real measurement is the test20 re-run after Baron's diag build. After clicking Approve/grant
  once, read: `cat "$HOME/Library/Application Support/Kosmos/file-access-diag-3188.txt"`.

Addresses #3188
