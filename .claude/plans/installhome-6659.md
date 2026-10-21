# installhome-6659: an update installs into the copy being updated, not the default home (kosmos#6659)

## Problem (measured)
`engine/manifest-verify.js` runSetup (what the in-app update and `kosmos update` run) hands the installer
`process.env` minus NODE_OPTIONS. The board runs with no KOSMOS_HOME exported, because `install/kosmos` sets it
unexported. So `install/setup.sh` took its default, `~/.local/share/kosmos`. MEASURED with a stand-in installer that
records what it was given: with no KOSMOS_HOME in the environment it received none ("unset"), and so it would install
into the default home. A board installed anywhere else, a test board in a temp home (#6650) or a home of the person's
choosing, therefore updated, stopped and replaced the person's DEFAULT copy instead of itself.

## Change
runSetup sets `KOSMOS_HOME` to the `home` it was handed (the installed root it reads the current version from),
over anything the environment says. Both callers already pass the copy they are updating:
- `engine/update.js` passes installedRoot();
- `install/kosmos` passes its own `$KOSMOS_HOME`.

The .pkg postinstall is a THIRD caller (install/pkg-scripts/postinstall, run-setup with `$HOME/.local/share/kosmos`):
it passes the default string, so nothing changes for it. The Mac app does not call run-setup.

Review 1 (BLOCKER): installedRoot() is __dirname-based and Node resolves links in it, while setup.sh tells the default
copy from a sandboxed one, and names its launch label, data folders and ~/.local/bin, by the path STRING. So:
- install/kosmos exports KOSMOS_INSTALLED_HOME (the path it ran under) on both board launches. It is not KOSMOS_HOME,
  which stays unexported, so the agents a board starts do not inherit the installed path;
- update.js passes that path to run-setup when it resolves to this very copy, and installedRoot() otherwise;
- runSetup hands a home that resolves to the default copy over as the default string itself (an older board, or one
  started without the variable).
For a copy in the default home reached by its plain path nothing changes.

## Test
install.setup-sig-6468.test.js, the run-setup harness with real signed fixtures: the installer records
`${KOSMOS_HOME:-unset}`.
- It must be the home handed in, with no KOSMOS_HOME in the environment and with ANOTHER one there (red, "unset",
  before the fix).
- With HOME a scratch folder whose default path is a LINK to the copy, handing the resolved path gives the default
  string; another home reached through its own link is passed exactly as handed.
- Source pins: both board launches export KOSMOS_INSTALLED_HOME, KOSMOS_HOME is never exported, and the update passes
  installedHomeAsInstalled(). Two existing pins (cli.startedby-5450, engine/update.test.js) follow the changed lines.

## Not covered
- Other variables the installer reads from the environment (a port, say) still pass through as they are. This change
  is only about which copy is installed into.
- Not measured with a real installer and a real non-default install: the stand-in proves what the installer is
  given, and setup.sh's own `KOSMOS_HOME="${KOSMOS_HOME:-$HOME/.local/share/kosmos}"` (line 105) does the rest.

- The first update a board started BEFORE this change performs still runs that board's own older manifest-verify.js,
  which sets no KOSMOS_HOME, so a non-default copy is updated wrongly that one time. Not fixable from here.

- (Review 3.) The board takes KOSMOS_INSTALLED_HOME out of its environment at startup (server.js, beside
  KOSMOS_BOARD_STARTED_BY), so no agent inherits it. KOSMOS_HOME is a different matter: runSetup now hands it to
  setup.sh, and a board setup.sh starts WITHOUT launchd (`kosmos start --force`, the fallback when launchd
  registration fails) inherits it, and so do that board's agents. Its value is that board's own home, the right one,
  and on Linux the systemd unit sets KOSMOS_HOME for the board on purpose; stripping it at those calls broke the Linux
  install tests (the stand-in kosmos expects it), so it is kept and stated. A board under launchd is restarted with
  kickstart and gets only the plist's environment.
- A home reached through the default link is always treated as the default copy (asTheInstallerNamesIt).
- A board launched by an OLDER install/kosmos has no KOSMOS_INSTALLED_HOME, so a NON-default home reached through a
  link is handed over as its resolved path for that update (only the default-copy case is repaired); the next launch
  by the new install/kosmos sets it.

## Weakest premise
That nothing depends on a non-default board updating the default home. The only reading under which that was
intended would be a person who moved their board but still expects the default copy updated; nothing in the tree
says so.
