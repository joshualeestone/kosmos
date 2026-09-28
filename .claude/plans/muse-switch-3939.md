# #3939: a switch for the Meta Muse preview that survives updates

Branch muse-switch-3939, off origin/main 26345dc11. Angel, 2026-09-28.

## Finished looks like
On a Mac, Josh can turn the Meta Muse preview on with one line he runs once, and it stays on through
board restarts, reboots and Kosmos updates; deleting one file turns it off. No screen changes for
anyone who has not done that.

## Why (measured)
The only switch was AGENT_WORKFORCE_MUSE=1 in the board's environment. The board's launchd job is
rewritten on every install and self-update with a fixed list of variables (install/setup.sh ~3833),
and `kosmos board-run` reads no env file, so a hand edit to the plist vanishes at the next update.
Every Muse slice is waiting on Josh's real sign-in, which nothing could reach without a lasting switch.

## Change
engine/musestatus.enabled(): on a Mac, on when AGENT_WORKFORCE_MUSE=1 OR the file `muse-preview-on`
exists in the board's data folder (store.ROOT; on a Mac ~/Library/Application Support/Kosmos). Read on
every check, so creating or deleting it needs no restart. Every reader of the flag goes through this one
function (create.museEnabled, discover, server /api/muse and the accounts row), checked by grep.

## Decided
- A hidden marker file, not a Settings switch: this is a preview only Josh should see (Splinter agreed
  12:0x). A Settings switch can follow if Josh wants one.
- In the board's data folder, not the install folder: the installer replaces app files; it does not
  touch the data folder.
- The line Josh runs installs Muse Code first if ~/.local/bin/muse is missing (Meta's
  dev.meta.ai/install.sh with MUSE_NO_MODIFY_PATH=1 MUSE_LOGIN=0, as run on the Mortals Mac 09-26),
  then creates the marker. That line is given to Splinter, not built into Kosmos.
- Weakest premise: that the data folder the board uses on Josh's Mac is the default one. A board with
  AGENT_WORKFORCE_DATA set reads the marker from that folder instead (store.ROOT follows it); Josh's
  install is the default.

## Tests
engine/musestatus.test.js: marker alone turns it on (Mac), not on another platform, removing it turns
it off, the variable still works alone, any other value is off, and the marker path is inside the
sandboxed data folder.

## Status
- 12:1x: built, musestatus tests 26/26.
