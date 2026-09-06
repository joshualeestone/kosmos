# openonce-2151 - com.kosmos.open-once launchd self-teardown (#2151)

## The gap
The one-shot app-opener launchd job `com.kosmos.open-once` (install/setup.sh) deletes its
plist FILE after RunAtLoad but never `launchctl bootout`s itself, so the job lingers
loaded-but-idle in launchd's registry until logout. Impact LOW (idle entry, does no work,
never re-runs since the file is gone). Split out of #2125.

## Fix
Append a self-bootout to the plist program: `open "$0"; rm -f "$1"; launchctl bootout
"gui/<uid>/com.kosmos.open-once"`. The uid+label are baked in at plist-write time.

## The guard collision (and why the refinements are safe)
Two source-sweep launchd-safety guards text-matched the plist-embedded bootout even
though it is login-time data, not an install-executed command:
- install.board-job.test.js no-bootout block (sweeps the last step to EOF, which includes
  the open-once plist). Fix: a local `runsNoPlistData()` drops plist `<string>`/markup
  lines for THAT claim only; shared `runs()` stays markup-preserving because a sibling
  claim inspects the board plist's <key>/<string> shape.
- install.uninstall-sweep.test.js sandbox-gate sweep (requires a gate within 12 lines of
  every launchctl; the long plist heredoc pushes the enclosing pkg-mode gate out of
  reach). Fix: skip launchctl on a plist `<string>` line; its safety is the plist WRITE's
  enclosing `[ -z "${AGENT_WORKFORCE_LAUNCH:-}" ]` gate.
Both refinements preserve the real protection: a bare install-path `launchctl bootout` is
never an XML line, so it still trips both. A positive test pins the self-bootout.

## Weakest premise
A RunAtLoad job booting ITSELF out while running is a small race (launchd may SIGTERM the
process as bootout lands). open+rm run first, bootout last, so the app is launched and the
file removed regardless; worst case the registry entry clears a moment later or the next
tick. Needs a fresh-Mac verify that the registry entry is actually gone (launchd state is
not observable in the JS suite). Dev/native-install, LOW severity, NON cut-gating.
