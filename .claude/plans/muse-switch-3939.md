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
  AGENT_WORKFORCE_DATA set reads <AGENT_WORKFORCE_DATA>/Kosmos/muse-preview-on instead (dataRootFor
  appends the app folder); Josh's install is the default. The marker is per macOS user: every board that
  user runs with the default data folder shares it.

## Tests
engine/musestatus.test.js: marker alone turns it on (Mac), not on another platform, removing it turns
it off, the variable still works alone, any other value is off, and the marker path is inside the
sandboxed data folder.

## Status
- 12:1x: built, musestatus tests 26/26.

## Review round 1 (opus, 12:03)
- Callers' comments said the switch was AGENT_WORKFORCE_MUSE=1 only; they now point at
  musestatus.enabled. The create form's comment no longer says the flag is read at board start.

## Review round 2 (sonnet, 12:31)
- The Create form kept a switched-off answer for the life of the page, so a marker created with the
  page open (the case this branch exists for) stayed invisible there until a reload, while Settings
  saw it. DECIDED: an off answer is asked again after 60 s (MUSE_OFF_RECHECK_MS). Rejected: dropping
  the settle (every flag-off board would read /api/muse on every paint again, 3c-3b round 1's finding).
  Weakest premise: a minute is short enough that Josh never sees the stale state; his one line ends with
  reopening the window anyway.
- The test asserts against the exported PREVIEW_MARKER, so the export has a reader.

## Review round 3 (opus, 12:50)
- The recheck test used its own copy of the window, so a changed page value passed; it now slices
  MUSE_OFF_RECHECK_MS from the page and pins it at one minute. Its name and the file header no longer say
  "not asked again". (Both lines were this loop's own round-2 output.)
- NITs taken: README row wording, create.test.js comment, a clause that the recheck runs on a paint, not
  a timer, and that enabled()'s store.ROOT read may run the one-time migration. Left: no operator-facing
  doc for the marker (the line goes to Josh through Splinter; a Settings switch would replace it).
- Validation after round 2 went red only on the #3011 LaunchAgents leak guard: three zz-test-4039-* agents
  created at 13:02 on the live board by #4039's owner, mid-run. Nothing in this branch names them;
  Splinter told.
