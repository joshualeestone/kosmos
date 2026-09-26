# win32-nofollow-1777: #1777 item 3, the instructions.js backup symlink guard on win32

## Goal
`engine/instructions.js` opens `CLAUDE.md.previous` with a bare `| fs.constants.O_NOFOLLOW`.
On win32 that constant is undefined and `X | undefined === X`, so the symlink guard silently
vanishes on a platform we ship to. Close it the way securewrite closed #1776.

## Decision
Build now; the Windows box is not required. The guard is made platform-independent
(`refuseSymlinkTarget(path, undefined)`, an lstat hand check) and a test seam drops the
kernel flag so a Mac can observe the hand check doing the work.

## Changes
- engine/instructions.js: capture `KERNEL_NOFOLLOW`, OR `(NOFOLLOW || 0)`, call
  `refuseSymlinkTarget(`${file}.previous`, undefined)` before the open; `_setNofollowForTest` seam.
- engine/instructions.test.js: arm with the flag dropped and a planted symlink.
- engine/windows-coupling-audit-1732.test.js: row -> guarded-vanish; drop the now-unused
  macos-covers-removal disposition; add a #1777 source pin.
- engine.reachable.test.js: excuse `_setNofollowForTest` by name.
- docs/windows-source-coupling-1732.md: note the last bare site is closed.

## Verification (measured)
- new arm green; delete the refuseSymlinkTarget call -> new arm RED by name (outside file
  overwritten), existing flag-present arm stays GREEN (why the seam exists).
- revert the open to bare `| fs.constants.O_NOFOLLOW` -> #1777 pin RED and #1732 ratchet RED.
- full suite (bash tools/run-tests.sh): 9994 tests, 9842 pass, 152 skipped, 0 fail, rc=0.

## Out of scope
Item 4 (awk dialect false red): no gawk/mawk on this box; unverifiable here.
