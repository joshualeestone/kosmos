# fsyncwrite3-5434: #5434 slice 3, the provider settings writers

Addresses #5434. Slices 1 and 2 (#5441, #5480) made `securewrite.writeSecret` flush before the rename
and moved the account stores onto it. This slice moves three settings writers that wrote a
`<file>.kosmos.<pid>.new` temp and renamed it without flushing:

- `engine/reporthook.js` `writeSettings` (shared with `engine/allowance.js`): the Claude settings.json hooks.
- `engine/groksettings.js` `ensurePrepared`: the Grok hook file.
- `engine/geminisettings.js` `ensurePrepared`: the Gemini settings file.

## Decisions
- **Same behaviour as before, plus the flush.** These write a person's own config files, so the mode
  rule is NOT tightened here (unlike slice 2's Kosmos-owned account settings):
  - an existing file keeps its exact mode (`prevMode`, as before);
  - a new file takes the process umask default, as `writeFileSync` without a mode did. writeSecret
    gains this: `mode` null or undefined means create at 0666 less the umask and set no mode. An
    explicit mode is still set exactly (control arm).
  - reporthook still writes through a symlink (its caller resolves the realpath first), as before.
- **atomicOnly**, as slice 2: when every atomic attempt fails the save fails (the callers already turn
  that into "we could not save the settings file") and the file is left as it was. Before, a failure
  also left it as it was, so no fallback is the like-for-like choice.
- **Temp name.** writeSecret's temp is unique per process, thread, start and write, so the reason these
  were pid-suffixed (two concurrent writers must not share a staging file) still holds. A temp left by a
  death in the window is reaped by writeSecret's existing reaper on the next write into that folder.
  An old-format `<file>.kosmos.<pid>.new` an earlier release left is NOT reaped (it does not match the
  reaper's shape); nothing removed those before either.
- **Two visible changes, accepted:**
  - before writing, writeSecret reaps dead temps. These callers pass `ownTempsOnly`, so in the person's
    config folders (`~/.claude`, the Grok and Gemini homes, or where a symlinked settings file resolves)
    it removes only THIS file's own writeSecret temps whose writer is provably dead, never a folder-wide
    sweep and never anything else.
  - a flush the disk refuses (EIO, ENOSPC, EDQUOT) now fails the save, which the callers already report
    as "we could not save the settings file"; before, that error was never seen and the rename could
    publish bytes the disk had refused. Failing is the point of the slice.
  - the other way round, for the mode: main's `chmodSync(tmp, prevMode)` was fatal, so on a mount that
    refuses a chmod (SMB, exFAT, some FUSE, a file owned by someone else) the save failed. writeSecret's
    chmod is best effort, so there the save now succeeds and the file takes `prevMode` less the umask
    instead of `prevMode` exactly. A working save beats a refused one; "keeps its exact mode" holds
    wherever the file system allows a chmod.
- **Cost:** about 8 ms per save on this Mac (slice 1's measurement); these run once per agent birth or
  wiring, not in a loop.

Not in this slice, so these are NOT yet flushed (each a later slice on the card):
- `install/setup.sh`'s inline node writer of the same Claude settings.json (`<file>.kosmos.new`, fixed
  name). So the Claude settings.json is durable when Kosmos saves it, not yet when the installer does.
- `engine/allowance.js` `calibrate` (`<file>.<pid>.new`).
- `engine/kosmos-statusline.js` (same pattern).
- `store.js` profile and settings saves (after #5418 merges), the write/close error rule from slice 1,
  and the other files the card lists.

## Tests
`engine/settingswrite.fsync-5434.test.js`, 12 arms, in `tools/windows-tests.js` ALSO. For each writer:
- it flushes the exact temp it renames into the file (fails on main);
- an existing 0600/0640/0664 file keeps its mode after a real rewrite, a new file is 0644 under umask
  022 and 0600 under 077 (guards: pass on main; fail under a mutant that ignores the umask);
- with every atomic attempt failing, the writer reports failure and the file is unchanged, after a
  control save on the same file succeeds (fails without atomicOnly).
Plus: an explicit mode is still exact over the umask; reporthook still writes through a symlink; in a
config folder only the written file's own dead temps are reaped (fails without `ownTempsOnly`).

## Weakest premises
1. That nothing relied on the old `<file>.kosmos.<pid>.new` temp name (a cleanup or an ignore rule). A
   grep of engine/, install/ and tools/ found no reader of that name besides these three writers.
2. A symlinked settings file that resolves into a folder synced between two Macs (Dropbox, iCloud). A
   live writer's temp of THIS file on the other Mac has a pid that does not exist here, so the reaper
   would take it and the deletion syncs back; the worst case is that writer's rename failing and
   retrying under a new name (three attempts, then the save reports failure). Small, stated, not fixed.
