# win32-remedy-copy-2304: platform-gate the installedCheck FAILURE-arm copy (#2304 defect-2)

## Problem

kosmos#2304 named three defects in `machine.installedCheck`'s Windows output. #2312
(merged) fixed defects 1 & 3 on the OK path: `installedCheck` is platform-injected, and
a Windows box with the runner present returns OK instead of "cannot run agents / requires
tmux / Download for macOS". It left **defect-2** open: the two FAILURE arms still carry
macOS-only copy on win32, which a Windows user meets the moment `platform.js` SUPPORTED
includes win32.

Three phrases read wrong on Windows:

1. **Missing-runner remedy** names the macOS download: "open installkosmos.com and click
   Download for macOS".
2. **Unusable-path detail** names the wrong OS: "the parts of macOS that start an agent".
3. **Unusable-path detail + remedy** list "a backslash" as a forbidden character, but on
   win32 a backslash is the path SEPARATOR and `create.unusablePath` allows it (#1889), so
   naming it would tell every Windows user their normal path is at fault.

## Decision (mine, per Josh's ruling that copy is reversible)

Parked needs-operator earlier for the Windows download URL + phrasing. Splinter's ruling:
copy is reversible, decide it, ship the best honest win32-gated default, document that Josh
can reword. Unparked.

- All three strings are platform-gated on the SAME injected `platform`/`isWin` the
  required-part list already uses (both branches assertable from a Mac, the #570/#2312
  pattern). **darwin is byte-identical** - the `?:` branches keep Josh's exact existing
  macOS wording.
- The **win32 missing-runner remedy is framed around the runner, NOT a Kosmos
  re-download**, and this is deliberate: on win32 the required "part that runs agents" IS
  the runner (Claude Code), so pointing a Windows user at a Kosmos reinstall would not put
  back a missing runner. This also sidesteps the unknown Windows-download-URL cleanly.
  A `TODO(#2304/#570)` records that the Windows install/download target is a product
  decision and Josh owns the final phrasing.
- win32 char list drops "a backslash"; win32 noun becomes "the part of this computer".

## What changed

- `engine/machine.js`: three platform-aware phrase helpers (`badChars`,
  `badCharsLower`, `agentStarter`) at the top of the copy-assembly section, and a win32
  branch on the missing-runner remedy. Product code, ~30 lines with comments.
- `engine/machine.test.js`: the existing "KNOWN FOLLOW-UP" comment is converted into real
  assertions; added a Windows unusable-path-arm test and two darwin CONTROL tests that pin
  the macOS wording byte-for-byte (so a win32 leak to darwin reds).

## Out of scope

- Defect-1 (what win32 actually requires) - fixed + merged via #2312.
- The Windows download TARGET / installer page - #570 / product; not invented here.
- End-to-end verification on a real Windows box - the #570 lane; the logic is unit-tested
  per-platform from this Mac.
