# kosmos#8786 S2: a Kosmos Cloud box installs the newest PROD build once a night

Owner of #8786: Baron Draxum (S1, the press). S2 handed to Renet Tilley, 2026-11-19 23:38 CST, on the card's S1 to
S2 interface (issuecomment by Baron, 23:38).

## Decided on the card (Baron)
- Once a night, on a Kosmos Cloud box only; the person can turn it off.
- PROD only (`latest-linux.json`), never staging, whatever channel the box was created on.
- Skip the night if an agent was busy in the last few minutes; try the next night.
- Skip the night (log a line) unless the signed check is available: `app/engine/manifest-verify.js` and
  `runtime/bin/node` present, and a key pinned (verifier exit 3 is not a pass).
- Interface: one installer at a time through `logs/install.started`; S2 runs OUTSIDE the board unit (its own systemd
  user timer and service); S2 does not touch engine/update.js's press code; `canSelfInstall` and
  `autoInstallWouldStart` stay as they are.

## Read in code before building (premise, posted on the card 23:5x)
- `engine/update.js updateChannel()`: on Linux an explicit `AGENT_WORKFORCE_UPDATE_CHANNEL`, then
  `KOSMOS_UPDATE_CHANNEL`, wins ("'staging' is staging, ANY other value is prod"). So S2 sets both to prod and runs the
  existing `kosmos update --if-newer`; no channel-logic change.
- Side effect, decided: `cmd_update` then passes `KOSMOS_SOURCE_CHANNEL=prod`, and setup.sh rewrites the box's
  `source-channel` stamp to prod. A Cloud box created on staging is on prod for good after its first nightly install.
- The Cloud signal is `engine/cloudmachine.js isCloudMachine()` (the tunnel's `hosted` latch), not `KOSMOS_CLOUD=1`,
  which never reaches the board.
- The off switch: the board's existing Updates switch (autoupdate consent). `kosmos update --if-newer` WITHOUT
  `--install` installs nothing when it is off, so S2 adds no new switch.

## Shape
1. `engine/cloudnightly.js`: `decide()` returns run or skip-with-reason, all seams injectable for tests:
   not Linux or not a cloud machine (skip, silent); updates switched off (skip); `install.started` under 30 min
   (skip); signed check unavailable (skip, logged); an agent busy now or at a second look a few minutes later (skip);
   board unreadable (skip, logged). Otherwise run.
2. `kosmos cloud-update` (install/kosmos): runs the module; on run, `KOSMOS_UPDATE_CHANNEL=prod cmd_update --if-newer`;
   every skip and the result go to logs/install.log with a `cloud-update:` prefix.
3. `engine/linuxboard.js`: `cloudUpdateNames()` and `cloudUpdateUnitsFor()` (kosmos-cloud-update[.<hash>].service and
   .timer), written and enabled by `installBoard` only when `isCloudMachine()`; removed by `removeBoard`; names kept
   apart from kosmos-board* as the pause check's are. Timer: 08:00 UTC, fixed in UTC because a Cloud box's clock says
   nothing about where its person is (the small hours across the Americas; daytime in Europe and Asia, where the busy
   check is what protects the person), plus up to 2h at random so the fleet does not all fetch at once,
   Persistent=false (a missed night is simply skipped). The service carries the board unit's PATH, port and carried
   values (setup.sh rewrites the board unit from the environment it runs in), KillMode=process (a board the installer
   starts outside systemd lands in this cgroup), and TimeoutStartSec=3h. installBoard on a box that is no longer a
   Cloud box removes earlier nightly units. setup.sh says when systemd would not enable the timer.
4. setup.sh's Linux uninstall and its own unit-name helper learn the new names, as they do the pause check's.

## Known limit, stated on the card
The timer is written by an install or update, so a box frozen today gets it only after one update (S1's press, or a
box created after this ships). S2 alone does not reach today's frozen boxes.

## Done when
A throwaway Linux box with the latch, on an older build, installs the newer PROD build from its timer (a separate
unit, not the board's cgroup), board and agents back; a busy agent skips the night; updates off skips.
