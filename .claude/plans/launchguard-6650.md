# launchguard-6650: a sandboxed install must not leave real launch agents behind

Card: kosmos#6650.

## Finished looks like
A sandboxed install shaped like the Mortals incident is refused before it writes anything, with a sentence that names the way through. The incident shape: another KOSMOS_HOME, the account's real HOME, no AGENT_WORKFORCE_LAUNCH, and a temp-folder home or the account's default port. Release walks (a kept home on their own port), harnesses (a fake HOME or their own launch folder), and real installs and self-updates are unchanged.

## Measured (Mortals, quarantined plists, read-only)
All three leaked jobs ran `<mktemp -d>/home/bin/kosmos board-run`, with HOME set to the real account home, `AGENT_WORKFORCE_HALF_SANDBOX_OK=1` (setup.sh writes that for a sandboxed home in the real LaunchAgents), and KOSMOS_PORT 16180 (two of them) or 57015. No AGENT_WORKFORCE_LAUNCH was set. The caller is still unknown: nothing on the box recorded it.

## Decided
- Refuse in setup.sh, before preflight and after `--uninstall` has branched away, because the leak is a class: any caller in this shape leaks, whichever test it is. A per-caller fix would miss the next caller.
- Two triggers. A temp-folder home (/tmp, /private/tmp, /var/folders, or TMPDIR), because the cleaner deletes it and leaves the job behind. Or the account's default port, because it fights the real board, which is what cost Mortals three hours.
- The guard fires only when HOME is the account's own home as the directory service records it. A harness's fake HOME writes its own LaunchAgents and must keep working.
- Ways through: AGENT_WORKFORCE_LAUNCH (a folder of the caller's own), or KOSMOS_ALLOW_TEMP_LAUNCH=1. The opt-in is persisted in the login job, so that install's own self-update is not refused later.
- Rejected:
  - Auto-routing such installs to a sandbox launch folder. A loaded job keeps respawning wherever its plist lives, and that would silently hide the caller.
  - Refusing at plist-write time. Too late: the pause and the board start have run by then.

## Weakest premise
That no legitimate caller runs a sandboxed install with the real HOME, no launch folder, and the default port or a temp home. If a release step does exactly that, the next cut fails at that step with the sentence above, instead of leaking. That is louder, and it names the caller the card could not find.

## Not covered
Linux (systemd user units) has the same shape, in a different folder, and is not changed here.
