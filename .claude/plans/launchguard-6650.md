# launchguard-6650: a sandboxed install must not leave real launch agents behind

Card: kosmos#6650.

## Finished looks like
A sandboxed install shaped like the Mortals incident is refused before it writes anything, with a sentence that names the way through. The incident shape: another KOSMOS_HOME, the account's real HOME, no AGENT_WORKFORCE_LAUNCH, and a temp-folder home or the account's default port. Release walks (a kept home on their own port), harnesses (a fake HOME or their own launch folder), and real installs and self-updates are unchanged.

## Measured (Mortals, quarantined plists, read-only)
All three leaked jobs ran `<mktemp -d>/home/bin/kosmos board-run`, with HOME set to the real account home, `AGENT_WORKFORCE_HALF_SANDBOX_OK=1` (setup.sh writes that for a sandboxed home in the real LaunchAgents), and KOSMOS_PORT 16180 (two of them) or 57015. No AGENT_WORKFORCE_LAUNCH was set. The caller is still unknown: nothing on the box recorded it.

## Decided
- Refuse in setup.sh, before preflight and after `--uninstall` has branched away, because the leak is a class: any caller in this shape leaks, whichever test it is. A per-caller fix would miss the next caller.
- One trigger: a temp-folder home (/tmp, /var/tmp, /var/folders, their /private spellings, or this run's TMPDIR). The cleaner deletes it and leaves the job behind. All three leaked homes were temp folders. A second trigger, the account's default port, was dropped in iteration 2, because it refused a person self-hosting with their own kept KOSMOS_HOME.
- A fake HOME is NOT an exemption (iteration 1): it scopes the plist file, not launchd, which still bootstraps the job into this account's own domain. test-install.sh records the same fact.
- Ways through: AGENT_WORKFORCE_LAUNCH (a folder of the caller's own), or KOSMOS_ALLOW_TEMP_LAUNCH=1. The opt-in is not persisted: a self-update runs with the default home (the board's env carries no KOSMOS_HOME), so a persisted key would never be read there, and it would leak into every process the board starts.
- Rejected:
  - Auto-routing such installs to a sandbox launch folder. A loaded job keeps respawning wherever its plist lives, and that would silently hide the caller.
  - Refusing at plist-write time. Too late: the pause and the board start have run by then.

## Weakest premise
That no legitimate caller runs a sandboxed install with the real HOME, no launch folder, and the default port or a temp home. If a release step does exactly that, the next cut fails at that step with the sentence above, instead of leaking. That is louder, and it names the caller the card could not find.

## Not covered
Linux (systemd user units) has the same shape, in a different folder, and is not changed here.

## Review log
### Iteration 1 (opus)
- [BLOCKER] fixed: the test's "kept" homes were inside the checkout, which a release cut copies into a temp folder, so the cut's `yarn test` would have gone red. It now uses fixed non-temp path strings; the guard never creates or enters them.
- [BLOCKER] fixed: the fake-HOME exemption let the incident through, because launchd registers the job in the real domain regardless. It is removed (with the dscl lookup and its seam), and the fake-HOME arm now expects a refusal. All 325 install tests and the six setup.sh shell tests pass without it.
- [WARNING] fixed: the persisted opt-in never reached a self-update and would have spread to the board's children. Dropped.
- [WARNING] moot: the dscl branch was untested. It is gone.
- [NIT] fixed: the comment now says Linux is not covered. The test runs the guard under `set -eu`, as setup.sh does.
- Noted for a card: a sandboxed board's in-app update runs setup.sh with the default home (the board env has no KOSMOS_HOME). This is pre-existing and not changed here.
### Iteration 2 (sonnet)
- [WARNING] fixed: the default-port arm refused a person self-hosting with a kept custom KOSMOS_HOME. Dropped: the temp-home arm alone catches the incident shape, since every leaked home was a temp folder. A new arm checks that a kept home is not refused on any port.
- [NIT] fixed: the TMPDIR arm was never exercised. A new arm uses TMPDIR=/Users/Shared, which is in none of the fixed spellings; a control without that arm turns it red. /var/tmp has been added.
- [NIT] deferred: the Darwin gate is not testable off macOS from a lifted function. The ordering test stays textual.
