# restoreguard-5536: an agent in a Restored world starts with git hooks and fsmonitor off (kosmos#5536 slice 4c-1)

Design call on #5536 (comment 6511811154). The first of 4c's three parts; the review screen and enable follow.

## Change
- bin/agent-supervisor.sh: before the #1704 world block, when KOSMOS_WORLD is set, ask
  engine/restoreworld.js isRestoredWorld (base = worlds.baseRoot(preWorldEnv(env))). Any doubt or a throw reads as
  restored (it fails closed). The answer is a shell variable, RESTORED_WORLD, never exported.
- Beside the pane's world roots: in a restored world, -e GIT_CONFIG_COUNT=2, core.hooksPath=/dev/null,
  core.fsmonitor=false. Git's environment config is command scope, so it outranks the repo's own .git/config.

## Decided
- In the supervisor, not plistFor: a plist env entry does not reach a pane on a running tmux server (#1704, measured).
- Never exported: a supervisor that cold-starts the tmux server hands it its environment, and the guard would then
  reach every later pane in every world.
- Checked BEFORE the world block: that block exports the world's roots without the marker that records the originals,
  so a later check reads the world folder as the base and answers "not restored". The first version did that; its
  test caught it.
- Rejected: `-c` flags (the provider runs git, not us); rewriting each project's .git/config (it changes restored
  data, and a later `git config` undoes it).
- Windows (engine/win32launch.js) is Homer's; handed off separately. The Mac half does not wait on it.
- Weakest premise: a provider could start git with its own env that drops GIT_CONFIG_*. Claude Code and Codex inherit
  the pane's environment for their tool shells (the same premise the world roots and the token already rest on).

## Measured
- Premise, on git 2.53 with a throwaway repo: a pre-commit hook fired 1 time without the env and 0 with it; an
  fsmonitor command ran 1 time without it and 0 with it.
- engine/create.test.js: the restored arm uses a world made by prepareRestoreWorld; the control is the plain qa world.
  There is also a source pin that nothing exports the guard. 3/3 with the #1704 neighbour.
- Mutation: the PANE_ENV push disabled reds the restored arm; restored byte for byte.
- Every test file naming agent-supervisor or restoreworld (41 files): 1325 tests, 1323 pass, 0 fail, 2 skipped.

## Review rounds (ledger)
1. sonnet: 0 BLOCKER, 3 MAJOR, 3 MINOR, 1 NIT.
   - MAJOR fixed: a failed precondition (no engine, node or restoreworld.js) left the guard off, so it failed open.
     A named world now reads as restored then (an over-guard in a broken install, the safe direction).
   - MAJOR fixed: a launch whose environment names another base than the board that made the world read it as absent.
     The supervisor now also looks for the mark at <world>/restored-world.json beside the agent's own folder
     (<world>/workers/<name>), which needs no base. Test: a deliberately wrong base still guards (red with the check
     off). A pin test keeps the shell's file name equal to restoreworld.js's RESTORED_MARK.
   - MAJOR, claim narrowed: env config cannot switch off every command a restored .git/config can run (a filter driver
     named by .gitattributes, textconv, core.pager, core.sshCommand, credential helpers, includes). The guard is hooks
     and fsmonitor only, and says so; the rest is a requirement on 4c-2's review screen, recorded on #5536.
   - MINOR documented: an inherited GIT_CONFIG_COUNT is replaced, not extended (its entries are lost in this pane).
   - MINOR documented: a session already running keeps its environment. Restored agents exist only after a restore and
     an enable, so none predate this.
   - MINOR fixed: a control for an existing unmarked world folder; the export pin also refuses declare -x and set -a.
     Not tested at runtime: the no-engine branch (the harness always installs engine-path).
   After: 5/5 named tests; 41 files 1327 tests, 0 fail.
2. sonnet: 0 BLOCKER, 0 MAJOR, 4 MINOR, 2 NIT, all addressed:
   - the git 2.31 floor for GIT_CONFIG_COUNT is said in the comment (an older git ignores it silently);
   - the workdir mark check takes absolute paths only, and counts a link (-L) as present, as isRestoredWorld's lstat does;
   - restoreworld.js's header no longer claims every start path asks: it says the Mac supervisor, Windows is Homer's;
   - the new tests hide the worlds they make and remove the other base in a finally;
   - the export pin's comment says it covers the export forms only.
   After: 5/5 named tests; 41 files 1327 tests, 0 fail.
