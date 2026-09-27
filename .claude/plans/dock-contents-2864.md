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
  person removes the stale one once. No code edits anyone's Dock. The release-note line is in
  the PR body for the cut owner (the notes file is release-lane), not in this diff.

## What review changed (rounds 1 to 12)
- /usr/bin/stat by path (a GNU stat on PATH would skip the swap silently).
- The staged folder's location decides, never the exit code: a swap that happened but reported
  failure is kept; a staged folder found in neither place is built again and installed by the
  whole-bundle rename (not kept stale and reported as made, not failed on to ~/Applications).
- Flags 18 (RENAME_SWAP | RENAME_NOFOLLOW_ANY) on the folder's physical path: a planted link
  anywhere makes the call fail (ELOOP, the other folder untouched) and the rename runs; the
  physical path is needed because the flag also refuses system links such as /var.
- Ownership is proved again, on that physical path, right before the swap.
- The install log's app-bundle line records app_path=swap|rename|rename-swap-skipped|
  rename-swap-refused (per make_app call), and swap_errno plus swap_dir for the last swap
  attempted (0, or why the kernel refused: 1 EPERM such as App Management, 45 ENOTSUP,
  22 EINVAL, 62 ELOOP), kept across the home-folder retry (reasoned from the code, not driven
  by a test: no harness case refuses the system folder's swap and then retries), so a report of duplicate icons can
  say whether the swap ran on that machine, where, and if not, why.
- A swap hands back the old Contents; it is deleted only while it still proves ours.
- A staged folder found in neither place is looked for once more, then rebuilt in a fresh
  folder, so a stage that cannot be removed cannot send the step on to ~/Applications.
- A running Kosmos keeps its bundle path while Contents changes under it (its executable runs on
  from the old, unlinked file; kosmos-install.json is read at launch). New state, not expected to
  matter.

## Tests (tools/test-install.sh)
A first install logs app_path=rename; the update keeps the folder inode and replaces Contents
(app_path=swap, swap_errno=0); CONTROL swap-off gives a new folder (app_path=rename-swap-skipped); a failing stub, a no-op stub, a swap-then-fail stub and a
moves-it-away stub each end complete, with where it came from asserted; the installer's syscall
through a planted link fails and leaves the target untouched (control: a link-free path swaps);
the deep-locked bundle runs with the swap on and off; the residue check has a positive control.

## Who runs the proof
tools/test-install.sh is not in CI (GitHub), but every release cut runs it: tools/release.sh
runs it with KOSMOS_INSTALL_GATE=1, which stops at "the release gate stops here (#624)". The
#2864 update, control and stub checks sit before that stop, so every cut runs them (about
six extra installer runs added to the cut's gate); the
deep-locked on/off pass sits after it, so only a full `yarn test:install` does. The PR carries
this branch's full run.

## Weakest part
That the Dock follows the folder's identity (the bookmark's file id and creation date) is
reasoned from the measured bookmarks, not watched on a Dock: no Dock was driven here. What
would change my mind: a kept icon going stale after an update that kept the folder's inode.
Also new: the Kosmos.app root folder now lasts across updates, so its own attributes (owner,
flags, extended attributes such as a stray quarantine) are no longer reset by an update the way
the whole-bundle rename reset them. A root-owned folder refuses the swap (EACCES) and falls back;
a quarantine attribute on the root would survive.
Also unverified: whether macOS App Management treats changing entries inside Kosmos.app as a
protected modification; if so the swap gets EPERM (the fallback runs, safe) and an update may show
a "prevented from modifying apps" notice. Next thing to watch on a real Dock: with the folder's identity now constant, the Dock may keep a
cached icon image after an update (the 2026-08-17 icon-refresh hypothesis in make_app_register).

## Merge
Installer is release-lane code: a Splinter/Baron reviewer on #2864 before merging (Liu Kang).
