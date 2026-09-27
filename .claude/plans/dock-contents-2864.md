# dock-contents-2864: an update keeps the Kosmos.app folder, so kept Dock icons stay valid

Card: joshualeestone/kosmos#2864 (Kano). Measured cause and the go on option A: the card
(Kano's measurement comment of 2026-09-27; Liu Kang m1757).

## Finished means
An install or update over an existing Kosmos.app keeps the SAME Kosmos.app folder (same
inode) and replaces only its Contents, atomically. A failed or disbelieved swap falls back to
today's whole-bundle rename. The visible app is only ever complete old or complete new.
tools/test-install.sh proves all of it, with a control showing today's path gives a new folder.

## Build
- install/setup.sh make_app: when the target is an existing real folder we can prove is ours,
  on Darwin, exchange $stage/Contents and $app/Contents with renameatx_np(RENAME_SWAP) through
  /usr/bin/perl (syscall 488, AT_FDCWD -2, flags 18 = RENAME_SWAP | RENAME_NOFOLLOW_ANY, on the folder's physical path). Believe it only if $app/Contents now has
  the staged Contents' inode. Then delete the stage (which now holds the old Contents).
  Registration (touch + lsregister) moved to make_app_register, called by both paths.
- Anything else (no folder yet, a symlink, not ours, no perl, not Darwin,
  KOSMOS_CONTENTS_SWAP=off, a failed or no-op swap): the existing whole-bundle rename, unchanged.
- tools/test-install.sh: after the existing update, the folder inode is unchanged and Contents'
  is not; CONTROL with the swap off gives a new folder; a failing swap (stub perl exit 1) and
  a lying swap (stub exit 0, nothing moved) both end in a complete app via the fallback.

## Decided
- A (swap Contents) over B (edit the person's Dock): B changes someone's own settings. Liu Kang.
- An atomic exchange, not two renames: two renames leave a moment with no Contents, and an
  installer killed there leaves a husk (Liu Kang condition 2).
- perl, not a compiled helper: /usr/bin/perl ships with macOS (5.34 here on 26.6.2) and needs
  nothing downloaded; its absence falls back safely.
- Stops NEW duplicates only. A Dock that already has two kept Kosmos icons keeps them until the
  person removes the stale one once (release note). No code edits anyone's Dock.

## Review round 1 (applied)
- /usr/bin/stat by path (a GNU stat on PATH would skip the swap silently).
- Decide by where the staged folder IS: a swap that happened but reported failure is taken as
  done; a staged folder found in neither place fails the step instead of guessing. Tested with
  a stub that really swaps and then exits 1.
- Flags 18 (RENAME_SWAP | RENAME_NOFOLLOW_ANY): a symlink anywhere in either path makes the call
  fail (measured ELOOP, the other folder untouched) and the rename fallback runs.
- A running Kosmos now keeps its bundle path while Contents changes under it (its executable runs
  on from the old, unlinked file; kosmos-install.json is read at launch). Before, the whole bundle
  moved aside. Not expected to matter; noted as a new state.

## Review rounds 2 and 3 (applied)
- Flags 18 refuse every link in a path, including /var -> /private/var, so the call now gets the
  folder's physical path (the installer test caught the silent fallback under /var).
- A staged folder found in neither place keeps the app when it is still provably ours: failing
  there sends the caller on to ~/Applications, and a second Kosmos.app is the duplicate itself.

## Weakest part
That the Dock follows the folder's identity (the bookmark's file id and creation date) is
reasoned from the measured bookmarks, not watched on a Dock: no Dock was driven here. What
would change my mind: a kept icon going stale after an update that kept the folder's inode.
Next thing to watch on a real Dock: with the folder's identity now constant, the Dock may keep a
cached icon image after an update (the 2026-08-17 icon-refresh hypothesis in make_app_register).

## Merge
Installer is release-lane code: a Splinter/Baron reviewer on #2864 before merging (Liu Kang).
