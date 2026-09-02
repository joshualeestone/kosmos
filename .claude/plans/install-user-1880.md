# kosmos#1880 - install for the user who INVOKED the install, not the console holder

## Problem
The pkg `postinstall` chose the install target with `stat -f '%Su' /dev/console`,
which names whoever holds the PHYSICAL console session, not who is running
Installer. On a multi-account Mac (fast user switching, a second admin account,
Screen Sharing into a virtual session - Josh's machine, #1880) those diverge,
producing either a false refusal ("no one is signed in") or, the dangerous arm,
resolving to the OTHER logged-in user and dropping privileges into a home folder
that never asked for Kosmos - a silent misinstall.

## Approach
Factor the decision into `install/pkg-scripts/resolve-install-user.sh`, sourced
by the postinstall and bundled the same way `installing.html` already is
(`pkgbuild --scripts` copies the whole dir; `$(dirname "$0")` resolves it at
install time). `resolve_install_user` picks, in order:

1. the owner of the running GUI **Installer** process - who actually invoked the
   install - confirmed to hold a live Aqua session (`launchctl print gui/<uid>`);
2. the `/dev/console` user, same session confirmation, as fallback;
3. otherwise it **refuses with a message naming which check failed** and the best
   guess, never the flat "no one is signed in".

Downstream keeps `CONSOLE_USER` / `CONSOLE_UID`; only their source changes.

### Why not "walk up from the script's process" (the card's literal candidate 1)
macOS runs package scripts as root under `installd`, detached from Installer.app,
so the script's own ancestry walks to `installd` (root), never the person. The
reliable signal for "who invoked this" is the owner of the live GUI `Installer`
process (it stays up showing its progress bar while scripts run).

## Testing
`tools/test-resolve-install-user.sh` (wired into `test:shell`) sources the shipped
resolver, overrides its sensor functions, and drives every arm: normal, the
false-refusal arm, the silent-misinstall arm, genuine-nobody, ambiguous (+console
tiebreak), the gui-session gate, root-owner filtering, plus a CONTROL proving the
Aqua-session gate actually gates and a parse arm over real `ps` output. Verified
the test reds on the old console-only behavior before trusting it.

## Not in scope / follow-on
The fix reaches users only once the pkg is rebuilt and re-served; the `pkg-inputs`
hash already forces that (the new helper is a tracked install input). Building and
serving is a release step, not this card.

Recommended follow-on (deferred, needs a real Mac / operator, not doable in a bot
session): one real multi-account `.pkg` install smoke that confirms end-to-end the
GUI `Installer.app` owner is the invoking user and that a passing
`launchctl print gui/<uid>` really does mean the downstream `asuser`/`bootstrap
gui/<uid>` succeeds. The gate is not stricter than the existing requirement
(downstream already needs that same session), so this is confidence, not a blocker.

## Weakest premise
The awk that parses real `ps` output for GUI-Installer owners is exercised on
canned lines, not a live `.pkg` install - a bot session cannot run a real install.
The resolution logic itself is fully driven by the stubbed sensors.
