# whatsnewplat-4928: What's new shows on a platform cut on another number

Card: kosmos#4928 (from the daily feedback, one install): "When one platform is cut on a different version number
from the other, people on that platform see no What's New at all."

## Measured
- The board shows web/whats-new.json only when its "version" equals the version running (engine/whatsnew.js read;
  server.js /api/whats-new). One number per file.
- The Mac cut refuses a file that is not for the version being cut (release.sh 1b-ii and 2b-ii). The Windows build
  (tools/build-kosmos-windows.sh) never checks it.
- Served today: Windows 0.7.13 (no v0713 version commit on main) beside Mac 0.7.11; staging 0.7.16 on both. The file
  in the 0.7.11 tree said 0.7.08; in 0.7.14 and 0.7.15 it said 0.7.11. So a build on another number than the file's
  shows no window, and Windows had no check to stop it.

## Done looks like
A Windows build on another number for the same release can carry the same highlights, and a Windows build whose
file is not for its version stops (or is opted out on purpose), as the Mac cut does.

## Change
- engine/whatsnew.js: an optional "also": [versions] the same highlights are for; problems() (shared by the board's
  read and tools/whats-new-check.js) accepts the main version or any listed one, and refuses a malformed "also".
- tools/build-kosmos-windows.sh: after baking the version, runs tools/whats-new-check.js for it, with the Mac cut's
  opt-out (KOSMOS_CUT_NO_WHATS_NEW=1) and a message that names the "also" fix.
- docs/releasing.md: one paragraph on both.

## Decisions
- "also", not a list of separate entries per version: the card's case is the SAME release on two numbers, so the
  same words. A real platform-only release with its own words is not this card. Rejected: showing the newest file
  at or below the running version (#3955 rules that last release's text never appears).
- The Windows build stops rather than warns, as the Mac cut does; the opt-out is the same variable.
- Weakest premise: the operator has to add the Windows number to "also" when the platforms diverge; the build now
  says so in its refusal, which is where they will see it.

## Validation
Focused: every test that reads whatsnew, whats-new, build-kosmos-windows or releasing.md, plus the scanning guards
(19 files + 3, 765 run, 0 failed). Reverting the "also" match fails the new whatsnew test; removing the Windows
check fails the new source pin (both measured).
