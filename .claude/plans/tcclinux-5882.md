# tcclinux-5882: Linux and Windows boards scan Documents, Downloads and Desktop for agents to import

Card: kosmos#5882 (filed by Mona Lisa 2026-10-11). Checked live on main before building: discover.js marked all three
roots tcc:true on every platform.

## Change
- engine/platform.js: hasFolderPermission(platform = process.platform), true only on darwin (FOLDER_PERMISSION), in the
  file's existing fail-closed list shape.
- engine/discover.js defaultScanRoots: the three import roots carry `tcc: true` only where hasFolderPermission. Elsewhere
  they are plain roots the engine walks. opts.platform is the test seam (scan passes its opts through).

## Decisions
- Windows has the same gap (card point 3, "not measured"): it has no TCC and no native app answering the hatch, so it is
  fixed by the same rule and tested (win32 arm).
- The predicate lives in platform.js, not as a `process.platform === 'darwin'` in discover.js: platform questions are
  answered there (the memory of the coupling analysis: a bare platform test scattered in modules is what hid this).
- An unknown platform walks the folders (no TCC exists outside macOS); not routed to a hatch nothing answers.

## Rejected
- Asking promptrequest.nativePresent() instead of the platform: a Mac with the app not running would then walk
  Documents in the engine and fire the very prompt #2125 removed.

## Weakest premise
That no Linux desktop or Windows setup prompts on reading these folders. Flatpak/Snap sandboxes can deny them, but
deny, not prompt: the walk then reads nothing there, which is no worse than today.

## Tests
engine/discover.tcc-linux-5882.test.js (3): the predicate; the roots' marks on linux, win32, darwin; a real import scan
in a sandboxed HOME finding an agent in Documents on linux and win32 with the hatch never asked, and the darwin control
handing all three to the hatch and not walking Documents. On main's discover.js: 1 pass, 2 fail. All 206 discover tests
pass; platform tests 15/15; engine.reachable 7/7, #1732 8/8, #1777 23/23.

## Mutants
Measured 20:13 CDT from `date` (with the #2125 test file alongside, 8 tests): P1 permission everywhere: red. P2 nowhere: red. P3 opts.platform ignored (this Mac is darwin, so linux arms go to the hatch): red. P4 Documents always tcc: red.
