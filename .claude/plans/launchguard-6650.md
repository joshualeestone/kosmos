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
- Linux (systemd user units) has the same shape, in a different folder, and is not changed here.
- A temp HOME with a KEPT KOSMOS_HOME and no launch folder: launchd registers the job and the cleaner deletes its plist, but the job runs a kept home until logout. Not the incident shape (real HOME, temp home), and no caller found.

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
### Iteration 3 (opus)
- [WARNING] fixed: the temp-folder match was literal, so a symlink into a temp folder, the /System/Volumes/Data spelling, or other capitals got through. The home is now checked as written and as resolved (its nearest existing folder through `pwd -P`, then the rest appended), slash-squeezed and lowercased. TMPDIR is checked both as given and as resolved.
- [WARNING] fixed: AGENT_WORKFORCE_LAUNCH pointed at the account's own LaunchAgents (`-ef`) was accepted as a way through, though its plist loads at the next login. It no longer counts.
- [NIT] fixed: a TMPDIR as broad as HOME, or above it (/, /Users), is ignored, so it cannot refuse every kept home.
- [NIT] fixed: the unused port parameters are gone from the test.
- Each of the four new defences has a control that turns its arm red when that defence alone is removed.
### Iteration 4 (sonnet)
- [WARNING] fixed: the test said the guard runs "under set -eu", but it is called in an `||` context (in setup.sh as in the test), so `-e` is off inside it. The comment now says so. Every fallible step in it is already guarded.
- [WARNING] fixed: three arms refused only because this machine's TMPDIR is a standard temp folder, a false red where it is not. They now use fixed /private/tmp homes, and the symlink arm links into /private/tmp.
- [CONVENTION] fixed: the /Users/Shared sub-check skips where that folder cannot be written.
- [NIT] fixed: on a new account where ~/Library/LaunchAgents does not exist yet, `-ef` matched nothing, so AGENT_WORKFORCE_LAUNCH spelled as that folder passed. It is now also matched by spelling, with or without a trailing slash. A control without the spelling match turns the new-account arm red.
- [NIT] accepted: a fake-HOME harness that points AGENT_WORKFORCE_LAUNCH at its own fake LaunchAgents is refused. No caller does this, and refusing is the safe side.
- Note: in the focused run after iteration 3, install.connect-pause-4676 failed once, after 50 s, beside another suite. Run alone it passes 13 of 13. Its pause code is unchanged here.
### Iteration 5 (opus)
- [WARNING] fixed: a temp HOME with no KOSMOS_HOME got through, because the home then equals the default. launchd would still register the job, and under the bare `com.kosmos.board` label, the real board's own. The default-home condition is dropped. A real install's default home is under a temp folder only when HOME itself is, so real installs and self-updates are unaffected. The refusal sentence now reads "puts Kosmos in a temporary folder". A control that restores the condition turns the new arm red.
- [NIT] fixed: the LaunchAgents spelling compare is now case-blind, like the disk. A control without it turns the capitals arm red.
- [NIT] fixed: a folder that cannot be entered no longer drops a prefix of the resolved spelling; only the written spelling is checked then.
- [NIT] accepted (weakest premise): a TMPDIR the caller used but did not pass on to setup.sh is not seen. The fixed temp spellings still apply.
- [NIT] fixed: the "release walk on its own port" arm could not fail. It now asserts that a kept home on the default port goes through, which guards against a port rule coming back.
### Iteration 6 (sonnet)
- [BLOCKER] fixed: the release install gate's own default-home control (tools/test-install.sh, #924/#5831) would have been refused. It installs with a fake HOME in its temp sandbox, no KOSMOS_HOME, and AGENT_WORKFORCE_LAUNCH at that fake HOME's LaunchAgents. The guard read that as "the account's own LaunchAgents". Iteration 4's note "no caller does this" was wrong. Since a set launch folder means setup.sh runs no launchctl at all, the only harm left is a plist in the ACCOUNT's real LaunchAgents, which loads at the next login. The compare now targets the account's home from the directory service (HOME when that cannot be read; KOSMOS_ACCOUNT_HOME is the test seam), not HOME. New arms: the gate's exact shape goes through, and an unpinned arm exercises the dscl read for real. A control comparing HOME turns the gate arm red, and a control blanking dscl turns the unpinned arm red.
- [WARNING] fixed with that: the arms for the account's real LaunchAgents now pin the account to the HOME they use.
- [NIT] fixed: a /Users/Shared sub-check that cannot run now says so in a diagnostic instead of passing silently.
### Iteration 7 (opus)
Every setup.sh run in tools/test-install.sh was traced (HOME, KOSMOS_HOME, AGENT_WORKFORCE_LAUNCH, TMPDIR); none is refused, and no BLOCKER was found.
- [WARNING] fixed: the unpinned arm compared against os.homedir(), which only echoes HOME, so it would go red under a redirected HOME. It now uses os.userInfo().homedir (the account record), and skips with a diagnostic when the directory service does not answer.
- [NIT] fixed: `dscl .` misses network and directory accounts, and puts a home with a space on its own indented line, so the guard fell back to HOME and could refuse the gate's fake-HOME control on such a Mac. It now reads `/Search` and joins the two-line form. Measured on both forms: "/Users/agent1", and "/Users/a b" from the two-line shape.
- [NIT] recorded under "Not covered": a temp HOME with a kept KOSMOS_HOME.
### Iteration 8 (sonnet)
- [WARNING] fixed: `dscl /Search` has no timeout and could stall an install on a Mac bound to a directory that does not answer. It is now consulted only when the launch folder is spelled `.../Library/LaunchAgents` (case-blind). Every harness that points at `$SB/launch` never calls it. Residual: a launch folder spelled otherwise that is a symlink to the real LaunchAgents is not caught.
- [WARNING] fixed: a silent directory service fell back to HOME, which would refuse the gate's fake-HOME controls (test-install.sh, clean-machine.sh). HOME now stands in only when it is not itself a temp folder. A real account HOME never is; a harness's fake one is. Residual: that fallback branch is not reached by a test, because dscl is called by absolute path with no seam. Its two outcomes are the pinned arms' outcomes.
- [WARNING] not a defect: the behavioural arms skip off macOS, but the node part of CI runs on the Mac runner (test.yml, the mac_runner matrix).
- [NIT] accepted: the /Users/Shared symlink sub-check reports a diagnostic where it cannot run.
