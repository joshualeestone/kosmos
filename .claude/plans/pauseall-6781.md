# pauseall-6781: the installs the update pause did not hold (kosmos#6781, O04-5c)

Stacked on updpause-6620 (kosmos#6620 board half, PR #6783), which added the fleet's update pause to run-setup (Mac)
and win32update.begin (Windows). Its plan named three installs the pause did not hold; this branch holds them.

## The three gaps, and what holds each now
1. **A pasted install line over an existing install** runs install/setup.sh directly, never run-setup.
2. **A .pkg on its pinned path** (once install/pkg-verify/floor stops reading "off") runs the checked installer
   directly too.
   Both now meet the same ask inside the installer: `update_paused` in install/setup.sh, called right after the
   installer knows it is updating in place (FRESH_INSTALL=no), after its log is opened and the release pointer read,
   and before the update is downloaded or anything installed is changed. Paused:
   it says so in a plain sentence and exits 96 (the .pkg's "a retry can succeed").
3. **A connect computer** (no board) runs `kosmos update --if-newer`, which run-setup already held, but its one-line
   answer to the native app was `failed <version>`, so the app said "could not update". The CLI now asks first
   (`manifest-verify.js paused`, a new form beside run-setup) and answers `paused <version>`; the native app reads
   the word (UpdateAnswer.paused), keeps the offer with a sentence saying why, and looks again later.

## How the installer asks (the same question as run-setup)
- `"updates_paused": true` exactly, from the coordinator's /v1/meta, 5 s, curl -q (no .curlrc), no redirect. No answer
  of any kind is "not paused" (fail open, as in run-setup: a fleet that holds every update whenever the coordinator
  blinks cannot take a security fix).
- Address: KOSMOS_UPDATE_PAUSE_URL if set, else `${AGENT_WORKFORCE_TUNNEL_COORDINATOR:-https://login.kosmosplus.com}/v1/meta`,
  the default pinned equal to manifest-verify's by a test.
- Skipped: a first install (nothing running to protect, no update installed); KOSMOS_UPDATE_IGNORE_PAUSE=1 (the
  operator's override, as in run-setup); KOSMOS_UPDATE_PAUSE_ASKED=1, which run-setup now sets on the installer it
  runs, so a board's update asks once, not twice.

## Decided
- **The installer asks only for bytes from the production site**: KOSMOS_RELEASE_BASE under
  https://installkosmos.com/ and no local copy (KOSMOS_SRC), unless a test names the address. 37 tools/ scripts run
  the installer, some inside `env -i` sandboxes that drop tools/run-tests.sh's dead-port export, and they install from
  a file:// or local base; the Linux CI job (test-linux-setup-4920) and a thumb-drive install supply KOSMOS_SRC with
  the default base. So none of those asks the production coordinator, and during an incident pause a cut's own
  install gate is not held. (Review 3 found the first version gated on the base alone and missed KOSMOS_SRC.) Rejected: exporting the dead port into every sandbox (37
  places to forget one). Cost: an install from a mirror or a staging host is not held; the pause is containment for
  the production release, which is the one a fleet takes.
- **The shell read is a pattern, not a JSON parse**: `"updates_paused"` then `:` then `true` then `,` or `}`, with any
  whitespace and newlines. A quoted "true", 1, or `truex` are not paused. Weakest point: a nested object holding
  `"updates_paused": true` would read as paused where run-setup's JSON read says not; /v1/meta is the coordinator's
  own flat object, so that needs control of the coordinator, which can pause anyway.
- **`--install` does not pass a pause**: it overrides "updates are off here", not the fleet's hold.
- **The CLI asks before run-setup** rather than reading run-setup's 96, because 96 also means "a download failed",
  and the app must not say "paused" for a network error. A copy of manifest-verify.js too old to know `paused` exits
  non-zero for it, which reads as not paused, and run-setup then holds as before (answer `failed`).
- **An app too old to know `paused`** reads it as unknown, which retries later: the right behaviour for a pause.

## Not done
- Running the whole installer end to end over a fake existing install was not possible here (this session may not
  run install/setup.sh); the ask is tested as the function setup.sh defines, lifted out and run alone, plus source
  pins that it runs after FRESH_INSTALL is known and before the first download, and exits 96. tools/test-install.sh
  (the cut's install gate) runs the real installer in CI.
- Windows: whether a pasted install line over an existing Windows install (install.ps1) passes the pause is NOT
  checked by this branch. Its card asked about the Mac paths; a Windows gap, if any, gets its own card.

## Validation
install.installer-pause-6781.test.js (6 tests); cli.update-ifnewer-4382.test.js (+2: paused, its control, --install,
fail open, nothing newer); native-app.update-ifnewer-4382.test.js (the paused arm pinned); the native app's
--kosmos-app-update-selftest (+3 rows, 26). Mutants, each red: a first install held, any release site asking, a
`truex` lookalike, ASKED ignored, run-setup not setting ASKED, the CLI not asking.

## Review decisions
- Review 1 (opus): run-setup's KOSMOS_UPDATE_PAUSE_ASKED was inherited by the board the installer starts, and by
  everything the board starts, so a later pasted line from that environment skipped the pause: now unset right
  after the ask (pinned). A `paused` answer threw away a waiting Restart (an installed update is on disk, not held):
  the Restart offer now stays. The app's sentence promised an automatic update, false with updates off: it now says
  "Try again later." The CLI's documented answers name `paused`; a held look writes one line to install.log; the 96
  and "before anything is changed" comments say what is true.
  Left: a connect computer that is not paused asks twice (the CLI, then run-setup), up to 10 s against a coordinator
  that does not answer; making run-setup trust the CLI's ask would add a second way past it. An app older than this
  shows "could not reach its update server" when the person pressed Update during a pause; unchanged for them.
- Review 2 (sonnet): `paused` is added to manifest-verify's capabilities line (the installer reads it to learn what
  an installed copy understands); install.recoverykey-setup-6609.test.js's pin of that line now allows forms after
  keylist. The app's retry comment says what it does: one look within the hour, then the usual looks.
  Left, stated: on Linux the installer's ask fails open if /usr/bin/curl, tr or grep is missing (this card is the Mac
  paths). An older signed installer run by a new run-setup does not unset KOSMOS_UPDATE_PAUSE_ASKED, so its board
  inherits it until the fleet carries this installer. Each held look adds one line to install.log.
- Review 3 (opus): BLOCKER, a local-copy install (KOSMOS_SRC, the Linux CI job, a thumb drive) kept the default
  production base and so asked the production coordinator, and would be held during a real pause: the ask now skips
  when KOSMOS_SRC supplies the bytes, with an arm. WARNING, a repair or reinstall of the SAME version was held, with a
  sentence ("keeps working") false for a broken install: only a target NEWER than the installed version (compared by
  number, with arms for 1.10.0 over 1.9.9, equal and older) or a version either side cannot read is held, and the
  sentence now says nothing was installed and Kosmos stays as it is. The lifted function now runs under setup.sh's
  `set -eu` and pipefail. A mutant comparing as text survives because it is equivalent (awk's split yields numeric
  strings); the `+ 0` is belt and braces.
- Review 4 (sonnet): an install whose bin/kosmos was deleted but whose app/ is there read as a first install and
  was not held; a readable app/package.json now counts as an existing install (arm; the mutant is red). The ask now
  reads the answer whole (64 KiB at most) and greps to the end instead of `-q`. That is defence in depth, NOT a fix of
  a live bug: review 4 reasoned that `grep -q` under setup.sh's pipefail could SIGPIPE its writer and read a real pause
  as none, but `tr -d '\n\r'` makes the body one line, so grep cannot match before the end; the 60 KB arm passes with
  the old pipeline too (measured, as reviews 2 and 3 found). The comment now says a nested or repeated key can read as
  paused in the shell where run-setup's JSON read says not; only the coordinator writes the answer. The test's default
  environment now sets KOSMOS_HOME, as setup.sh always does (the new `set -u` caught it).
- Review 5 (opus): the operator's KOSMOS_UPDATE_IGNORE_PAUSE leaked into the board the installer starts, so that
  board ignored the pause until it restarted: it is now unset with the asked-word (pinned). KOSMOS_UPDATE_PAUSE_URL is
  kept on purpose: test-install.sh relies on it reaching the boards it starts, so they never ask production.
  manifest-verify's comment said an older Kosmos could not be paused; the installer now holds it, and its board shows
  the hold as a failed install (run-setup maps the installer's 96 to 1, and only this code knows "paused"): said in
  the comment. The ordering pin now also requires the ask after TARGET_VERSION is final. A CLI test title claimed
  "never asks"; it now says what it checks.
  Left, stated: the CLI's and run-setup's ask hold any base (a mirror, file://), the installer's only the production
  site's bytes; the launcher's own repair advice ("reinstalling fixes this") is held during a pause when the installed
  version cannot be read (the latest release is the suspect one); note_claude_code may create the person's claude
  link before a held run exits.
- Review 6 (sonnet): a target version present but not a.b.c ("latest", "v1.2.3") compared as not newer and failed
  open; only a strict a.b.c on both sides is compared now, anything else is held (arms for six shapes). The ask
  called /usr/bin/curl, tr and grep by absolute path, which fails open on a Linux whose tools live elsewhere; it now
  calls them by name like the rest of setup.sh, and reads the whole answer as run-setup does (the 64 KiB cap is gone,
  so the two readers see the same bytes).
  Left, stated: a pointer naming a valid OLDER version is not held, and if that version's tarball is missing the
  installer falls back to the unversioned (latest) one. That needs control of the release site's pointer and files,
  which is the incident the pause exists for; the signed manifest and the board's own run-setup still apply.
- Review 7 (opus): CONVERGED (no BLOCKER, WARNING or CONVENTION). NITs left as they are: the held look's install.log
  append orders `>>` before `2>/dev/null` (harmless: the app discards the CLI's stderr); a pointer naming the SAME
  version can fall back to the unversioned tarball on a transient HEAD failure (the signed manifest check of the
  archive against TARGET_VERSION refuses foreign bytes on a Mac); a .pkg on its pinned path has no operator override
  (sudo drops the env) and its held sentence reaches only install.log, like every other early exit; run-setup holds a
  same-version reinstall while the installer does not (each defensible, now stated); the asked-word vouches for an
  answer seconds old; an older signed installer run by a new run-setup leaves the asked-word on the board it starts
  until the fleet carries this installer (stated in review 2).
