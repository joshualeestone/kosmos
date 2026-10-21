# pauseall-6781: the installs the update pause did not hold (kosmos#6781, O04-5c)

Stacked on updpause-6620 (kosmos#6620 board half, PR #6783), which added the fleet's update pause to run-setup (Mac)
and win32update.begin (Windows). Its plan named three installs the pause did not hold; this branch holds them.

## The three gaps, and what holds each now
1. **A pasted install line over an existing install** runs install/setup.sh directly, never run-setup.
2. **A .pkg on its pinned path** (once install/pkg-verify/floor stops reading "off") runs the checked installer
   directly too.
   Both now meet the same ask inside the installer: `update_paused` in install/setup.sh, called right after the
   installer knows it is updating in place (FRESH_INSTALL=no) and before anything is downloaded or changed. Paused:
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
- **The installer asks only for a release from the production site** (KOSMOS_RELEASE_BASE under
  https://installkosmos.com/), unless a test names the address. Every test installs from a file:// or local release,
  and 37 tools/ scripts run the installer, some inside `env -i` sandboxes that drop tools/run-tests.sh's dead-port
  export. Gating on the release site means none of them can ever ask the production coordinator (and during an
  incident pause, a cut's own install gate is not held). Rejected: exporting the dead port into every sandbox (37
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
