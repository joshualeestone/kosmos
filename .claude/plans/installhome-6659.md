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

Neither the Mac app nor the .pkg postinstall uses run-setup (checked: no caller in native-app or install/pkg-scripts),
so neither relies on the old behaviour. For a copy in the default home nothing changes: the value is the same.

## Test
install.setup-sig-6468.test.js, the run-setup harness with real signed fixtures: the installer records
`${KOSMOS_HOME:-unset}`. It must be the home handed in, with no KOSMOS_HOME in the environment and with ANOTHER one
there. It was red ("unset") before the fix.

## Not covered
- Other variables the installer reads from the environment (a port, say) still pass through as they are. This change
  is only about which copy is installed into.
- Not measured with a real installer and a real non-default install: the stand-in proves what the installer is
  given, and setup.sh's own `KOSMOS_HOME="${KOSMOS_HOME:-$HOME/.local/share/kosmos}"` (line 105) does the rest.

## Weakest premise
That nothing depends on a non-default board updating the default home. The only reading under which that was
intended would be a person who moved their board but still expects the default copy updated; nothing in the tree
says so.
