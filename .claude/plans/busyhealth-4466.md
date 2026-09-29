# busyhealth-4466: a busy board is not down, and an agent cannot restart-loop it

Card: #4466 (Splinter's priority, 2026-09-28 22:02 CDT, part 6 added 22:07). Owner: Baron Draxum.

## The failure
On an external tester's ~25-agent board the board process sat at ~80% of one core. `install/kosmos` `healthy()` did a
full GET of the app page (a few hundred KB) with `curl -m 2`, so every verb that checks health first
said "Kosmos is not running. Start it with: kosmos start" to a board that was only slow. Agents took
the CLI's own advice; a new Grok agent started and stopped the board 140 times in an hour, turning
2-10 s waits into minute-long blackouts.

## The calls
1. **`GET/HEAD /api/health`** in `server.js`, answered right after `remoteWriteGuard` and before the
   board-token gate: a fixed body `{"app":"kosmos","ok":true}`, `no-store`. No account data, so it is
   public on an enforcing board for the same reason `/` and `PUBLIC_WORLD_ROUTES` are. Network peers are
   still refused by `remoteWriteGuard` (it runs first).
2. **`healthy()`** probes `/api/health`; any other answer falls back to the page and the old identity
   match (an older board has no route: 404, or 403 from its token gate). It sets `HEALTH_STATE`:
   `up`, `down` (curl 7, refused), `stranger`, `busy` (timeout or cut reply). Busy retries with a longer
   timeout each time (2, 4, 8, 8 s) until `KOSMOS_BUSY_WAIT` (20 s). `healthy --once` is one probe (2 s
   per request; an older board without /api/health costs a second request for the page) for the start/stop polling loops. Errexit-safe (`&& rc=0 || rc=$?`, no bare false tests).
3. **`say_not_up`**: the one message for all 13 verbs. Busy says "running but too busy... it does not
   need a restart"; only a real refusal keeps "Start it with: kosmos start".
4. **`kosmos status`**: busy exits **4** (not 1, which is the start advice, and not 0, which would hide a
   wedged board). `start` / `board-run` treat busy as running (never start a second board).
5. **`bin/board-watchdog.sh`** reads `kosmos status`'s exit code. Exit 4 counts toward the down streak
   with `KOSMOS_WATCHDOG_BUSY_GRACE` (300 s) instead of `GRACE` (45 s). Before this change the watchdog
   itself would `kickstart -k` a board busy for 45 s.
6. **Part 6, `agent_board_guard`** before start/stop/restart. An agent is `KOSMOS_AGENT_SESSION` (now
   always exported by `bin/agent-supervisor.sh`), `KOSMOS_AGENT_TOKEN`, or the pane's session carrying
   the supervisor's `@kosmos_agent` claim (covers agents launched before this update). While the board
   answers (up or busy): stop/restart refused (exit 1), start says it is running (exit 0). On a down
   board a start/restart goes ahead once per `KOSMOS_AGENT_RESTART_COOLDOWN` (300 s) since the board was
   last started (`$KOSMOS_HOME/board.started-at`, written by `cmd_start` and `board-run`). A person in
   their own Terminal is unaffected; `--force` skips the guard and the refusal never mentions it.
7. **Windows CLI**: no health pre-check and no agent start/stop/restart verbs (the board runs from
   Kosmos.exe; the verbs-parity test exempts them). Its one path toward a restart was
   `ctx.unreachable` asking "Is it running at <url>?" on a timeout; a timeout now says busy.
8. Follow-up for the single-core load: #4468.

## Review round 1 changes
- **Busy only when the listener is OUR board.** A no-answer (curl 28, 52 or 56) is `busy` only if lsof
  says the port's listener is a Kosmos server run by this user; a non-Kosmos process or another account's
  board is `stranger`, so start/status keep their stranger and reclaim paths (#2988, #3079). Any other curl
  failure (a non-HTTP answer) is `stranger`. When lsof cannot say, it stays busy (a wrong "busy" costs a
  wait; a wrong "stranger" could cost a restart).
- **An agent's stop of a board that does not answer is a no-op**, so it never writes the deliberate-stop
  marker that switches off the watchdog.
- **A person's stop of a busy board this command did not start** leaves it alone (it used to fall through
  to "not running" and write the marker).
- **Internal callers are never agents:** `engine/boardrestart.js` (the Restart button and a Kosmos switch)
  spawns `kosmos restart --force` and drops the agent markers from the child's env; every board
  start/stop/restart in `install/setup.sh` passes `--force`; an unsupervised board started from an agent's
  pane is launched with the agent markers removed from its env.
- **Watchdog on a busy board:** see round 3 (the reclaim flag); arms 6c/6d in test-board-watchdog-2955.sh.

## Review round 2 decisions (deferred, with the reason)
- **A person's `kosmos start` no longer reclaims a same-user Kosmos board that holds the port and never
  answers**: it says "already running (busy)". Deliberate: start cannot tell busy from wedged, and killing
  a busy board is this card's bug. (Round 3 corrected this: restart and kickstart do NOT cover a detached
  holder that neither the pidfile nor launchd tracks. So after its 5-minute busy grace the watchdog runs
  `KOSMOS_RECLAIM_BUSY=1 kosmos start`, which skips the busy early-return and reaches the #3079 reclaim.)
- **`kosmos open`** goes through the same agent guard as start for a down board, and opens a busy board
  instead of waiting out the busy window twice.
- **`kosmos restart` of a busy board this command did not start** refuses with exit 1 (`die` in cmd_stop
  ends the script), so it is never a silent no-op; a test arm pins it.
- **`setup.sh`'s update-pause `stop --force` on a busy board with no pidfile** leaves that board running,
  the same outcome as on main (which called it "not running" and continued); every Kosmos-started board
  writes a pidfile, so this is the rare hand-started case.

## Review round 6 decisions
- The reclaim flag is `KOSMOS_RECLAIM_BUSY` (it was named for the watchdog). Its second caller is
  `install/setup.sh`'s board start: the installer has just stopped the old board, so a Kosmos that still holds
  the port without answering is a stale build and the #3079 reclaim frees it (a plain start would call it
  "already running (busy)" and leave the update on a dead board until the watchdog's grace ran out).
- The Windows busy sentence carries no "try again": the same path serves timed-out WRITES, where the board may
  already have acted, so it says to check before doing it again.
- Deferred: with no lsof at all a reclaim-flagged start finds no listener to reclaim and its own start fails on
  the held port. macOS always has /usr/sbin/lsof, and the failure is a refused start, not a second board.

## Review round 8 decisions
- The board is started with the reclaim flag removed from its env too (`env -u KOSMOS_RECLAIM_BUSY`), and
  `engine/boardrestart.js` deletes it: it is for the one start that set it, and a board that carried it would
  pass leave to kill a busy board to every `kosmos start` it runs. Arm in `engine/boardrestart-2238.test.js`.
- One probe keeps to one budget: when `/api/health` answers but not as ours, the page request gets what is
  left of the probe's time (at least half a second), not a fresh one. Arm "one probe keeps to ONE budget",
  red on the old fallback (11.3 s against a 6 s budget).
- The Windows busy sentence says "it may still have happened" only after a write; a timed-out read says only
  busy and no restart.
- Deferred (again, first raised round 7): a busy board run from a source checkout whose path lacks "kosmos"
  reads as a stranger, because the ownership test is #3079's `is_kosmos`. Installed boards run from
  ~/.local/share/kosmos/app/server.js (measured on Mortals), so this is development only; widening
  `is_kosmos` changes #3079's reclaim rule and belongs in its own card.
- Not changed: "no reply in 20 s" and "did not answer within 20 s" are true as written even when the real
  wait ran a little past 20 s.

## Review round 9 decisions
- An `--auto` report (every hook event) waits 6 s on a busy board, not 20, unless KOSMOS_BUSY_WAIT is set.
  SessionStart's delivery check runs it in the foreground under Claude Code's 15 s hook timeout, and a kill
  there prints nothing, so the "reporting is OFF" sentence would never show; the background reports would
  spend a busy board's CPU on 20 s of retries per event. A person's or an agent's own report keeps 20 s.
  Arm: "an --auto report (the hook) gives up ... inside the hook's 15 s timeout", with the not-auto control
  (red without the change: it said "no reply in 20 s").
- Deferred: each `--auto` report on a busy board still runs one lsof sweep (the ownership check). The
  heartbeat is throttled to one a minute per pane, and caching the verdict across processes is a new
  shared-state file for a best-effort report; #4468 is the load itself.
- Deferred NITs: a board that dies between connect and reply reads busy for one `--once` probe (the full
  loop corrects on the next probe, and the guard refusal it could cause is one "running" sentence); a
  Windows connect that hangs is also called busy (Windows has no restart verbs for an agent to misuse);
  "no reply in 0 s" when someone sets KOSMOS_BUSY_WAIT=0.

## Review round 10 decisions
- Deferred, not real: "an empty lsof owner reads as stranger". `port_listener_owner` prints a line on every
  success path and returns 1 on an empty pid or uid, which `_health_no_answer` maps to unknown, then busy.
- Deferred: "a future refactor could call healthy in a subshell". The comment above `healthy()` already
  forbids it (HEALTH_STATE is a global); nothing does it today.

## Review round 11 decisions
- The watchdog's every attempt on a busy board past the grace is the reclaim-flagged start, never kickstart:
  the #3079 reclaim kills our listener whoever tracks it (a superset of kickstart for the port), and falling
  back to kickstart after one failed reclaim left a detached holder wedged until the cooldown. Arm 6d now
  pins it (red on the old escalation); 6b is the plain-down control that still kickstarts.
- The CLI's numbers are named: BUSY_WAIT_DEFAULT_S (20), BUSY_PROBE_MAX_S (8), AUTO_REPORT_BUSY_WAIT_S (6),
  AGENT_RESTART_COOLDOWN_S (300, was written twice), each with its reason. The header names status exit 4.
- Deferred again: the dev-path stranger (rounds 7 and 8).

## Review round 12 decisions
- The whole `--auto` report stays inside AUTO_REPORT_TOTAL_S (12 s): the POST gets what is left after the
  health check (at least 2 s), so a board that answers health slowly and then sits on the POST cannot
  hold SessionStart past Claude Code's 15 s. Arm "END TO END", red at 17.6 s with the POST's own 15 s.
  12, not 13: SECONDS counts whole seconds, and 13 left under a second of room.
- A listener that our own lsof cannot name is another account's (measured here: non-root lsof sees 13 of
  23 listening ports), so it is a stranger, not our busy board. Only a Mac with no lsof keeps "cannot
  tell" (busy). A board that exits between connect and lsof reads stranger for one probe. Arm with the
  no-lsof control.
- Every verb whose request fails AFTER the health check passed goes through `say_unreached`: a timeout
  or cut reply says busy and "does not need a restart" (after a write: "it may still have happened,
  check first"); a refused connection keeps "Is it running at ...?". 14 sites; the 3 that already treat
  a timeout as "maybe delivered" (exit 3: send, post, react) are unchanged. #2662's arm (a cut reply on
  task add) now accepts either sentence: it pins that the failure is reported.
- `board-run` asks `healthy --once`: busy still exits 0, and a KeepAlive relaunch no longer spends 20 s.
- An agent's `stop` on a stranger-held port says "Kosmos is not running here" (it said "not answering").
- Deferred NIT: `lastWasRead` on Windows treats only GET as a read; nothing sends HEAD.

## Review round 13 decisions
- The watchdog times the busy grace from `busy_since`, the first BUSY reading of the streak, not from
  `down_since`: a board down for a while that comes back slow is busy for the first time, and timing
  from the down streak reclaimed (killed) it on that first reading. `busy_since` clears when a reading
  is not busy. Arms 6f (down 400 s then busy: no reclaim; red on the old timing) and 6g (busy then down
  clears it); 6c/6d seed `busy_since`.
- An owner lookup that succeeds but prints nothing is treated as no owner named (unreachable today).
- The agent restart guard is Mac-only by design: the Windows `kosmos` has no start/stop/restart verbs
  for agents (the board runs from Kosmos.exe), so the only Windows path to a restart was the "Is it
  running?" sentence, which now says busy.
- Deferred: `kosmos status` exit 4 is documented in the file header and read by the watchdog, its only
  non-test caller. The plan file name has no timestamp, like most siblings in this directory; the gate
  finds it by branch.
- Deferred NIT: "Kosmos is busy, retrying..." can appear inside SessionStart's "reporting is OFF"
  reason; it is true there.

## Review round 14 decisions
- The END TO END arm's floor is 10 s, not 11: whole-second SECONDS can give the POST a second less than
  the true remainder, which landed the total just over 11 s; 10 s still tells a cut-short POST (~4.5 s)
  and the old 15 s POST (~17 s) from the fix.
- One `_lsof_present` for all three lsof checks, so the test seam governs every one.
- The test file says it is slow on purpose; CLAUDE.md "Where to Find Things" has a row for this area; the
  pane-claim comment says "usually" and why.
- Deferred again: plan file name (round 13); HEAD on Windows (round 12).

## Review round 15 decisions
- A person's `kosmos restart` of a busy board of ours that nothing tracks now reclaims it: with auto-restart
  off there is no watchdog to do it, and the round 2 refusal left only a reboot or a manual kill. Agents
  cannot reach this (the guard refuses an agent's restart of a board that is up or busy); `stop` alone still
  leaves it (setup.sh's update pause relies on that) and now names `kosmos restart` as the way out. This
  REVERSES round 2's "restart refuses" for a person; the arm now pins the reclaim, with an agent control.
- The watchdog clears `busy_since` when it attempts a reclaim, so a replacement that is also busy gets its
  own grace instead of relying on THROTTLE x 2 outlasting BUSY_GRACE.

## Review round 16 decisions
- By design, recorded: `board.started-at` is also written by each launchd `board-run` relaunch, so a board
  that crash-loops keeps an agent inside the restart cooldown. Only agents are held: a person, and the
  watchdog (it passes `--force`), recover it as before. A crash-looping board is the case agents must not
  keep restarting.
- The transient "stranger" (a board that exits between connect and lsof) is said in the code to be unable
  to cause a kill: the reclaim path asks lsof again.
- Deferred again: exit 4 in the usage text (round 13); the Windows guard (round 13); Windows
  `lastTimedOut` shared state (its invariant is stated where it is read).

## Review round 17 decisions
- `msg`, `post` and `react` keep their exit 3 "maybe delivered" for a timeout (28), and every OTHER failure
  now goes through `say_unreached` as a write: a cut reply (52/56) is busy, not "is it running?" (the
  #2255 and #2321 arms, a cut reply, now accept that sentence too: they pin that it is reported). This
  finishes round 12, which had left these three alone because of their timeout branch.
- The END TO END arm measures from the board's first request, where the CLI's budget starts, instead of the
  process wall clock (start-up varies by machine and would flake a slow runner): under 14 s, at least 10.
- Deferred NITs: `kosmos open` can print "already running" twice when the board comes up between checks;
  `board.started-at` in a source checkout is untracked like `board.pid` and `board.stopped`; HEAD on Windows.

## Review round 18 decisions
- A piped `msg`/`post` whose reply was cut still keeps its copy (it may not have arrived), but says "may not
  have been sent ... check before sending it again", not "was not sent": the busy sentence above it says it
  may have happened, and "was not sent" invited a duplicate. Arm with `msg --stdin`. (Round 17's own change
  exposed this.)
- Agents CLAIM a start atomically (`board.agent-claim`, noclobber) after the start-time check: several agents
  acting at once all read the same old start time and went ahead, each killing the last one's board. A claim
  older than the cooldown is replaced atomically; people never claim. Arm: 8 simultaneous agent restarts,
  exactly one goes ahead (all 8 on the old check), with a person control.
- Deferred NITs: a person's restart says "Restarting it" and the board may answer during the start's wait
  (then nothing is restarted, which is the good outcome); Windows says "Is it running" on a connection reset
  (no agent restart verbs there); a person attached to an agent's tmux session inherits its marker (recorded
  under weakest premises: the guard is a deterrent).
- 6g on f737fbbb1 went RED on the #4273 leak guard only (1 x `kosmos-unsent.*`, every test green): round
  18's `msg --stdin` arm saved its copy to the real $TMPDIR. The arm now points TMPDIR inside SCRATCH_HOME
  and asserts the copy is there with the piped text.

## Review round 19 (sonnet): zero NEW, loop CONVERGED
- No BLOCKER or WARNING. Two NITs, both already in the ledger: Windows `lastTimedOut`/`lastWasRead` shared
  state (deferred rounds 13 and 16, invariant stated where read); the page probe's half-second floor after
  a slow `/api/health` (the round 8 one-budget design; the reviewer notes it errs toward busy, the safe way).

## Merge of origin/main (174 commits, 2026-09-29 05:0x), after convergence
- Merged rather than rebased (19 commits, one resolution; the PR squashes). Conflicts: CLAUDE.md (both
  routing rows kept) and install/setup.sh, where #4356's mode file now decides whether the installer
  stops, starts and restarts the board. Kept #4356's logic and put this branch's `--force` (and
  `KOSMOS_RECLAIM_BUSY=1` on the start) on each of its calls, including its new end-of-run `stop` for a
  computer that became connect: the installer acts on its own board and must not be refused as an agent.
- main brought three verbs with their own "Kosmos is not running ... Start it with: kosmos start" line
  (`connections`, `connect`, `community read`), which is this card's bug on a busy board. All three now
  use `say_not_up` (a down board gets the same sentence as before). New arm "the verbs that arrived after
  it", red with main's sentence restored.
- Weakest premise: the three were found by grepping for the sentence; a new verb that words its own
  "not running" differently would not be. The Mac app's `kosmos stop`/`start` run as the person (no agent
  markers), so the guard does not touch them.
- Final validation on the merge (7e8cadadb): GREEN.

## Review round 20 (fable, on the merge): 1 NEW WARNING, fixed; loop continues
- W: replacing a STALE claim was `rm` then create, not atomic, and the claim file outlives every start,
  so every outage after the first took that path (the 8-agent arm only covered no file). Now serialised
  under `board.agent-claim.lock` (mkdir), the stamp re-read inside it, the swap by rename (the file never
  goes missing, so the noclobber create cannot race it); a lock over a minute old is cleared and that
  attempt refuses. Arms: 8 agents over a stale claim, three waves, exactly one (old code: 4 and 5 of 8);
  a killed agent's lock, fresh-lock control. Red-checked.
- NIT fixed: `_mark_board_started` says why it is written before the launch (a failing start still holds
  agents off; that is the deterrent).
- NIT fixed: the installer arm asserts EVERY start carries the flags (not "exactly one start"), and every
  installer stop/restart carries `--force` (red with #4356's end-of-run stop un-forced).
- NIT deferred, MEASURED: `display-message -t <pane> '#{@kosmos_agent}'` does read a session option on the
  real tmux 3.6a (throwaway server: "mara"; a session without it: empty).
- NIT deferred: the plan file name has no timestamp; the gate finds it by branch, as for most siblings.
- 6g on f70a9de8e: GREEN.

## Review round 21 (opus): 1 NEW NIT fixed, 3 deferred; loop continues
- FIXED: a person whose reclaim of an UNTRACKED holder failed was told "Stop it with 'kosmos stop'", which
  leaves such a board alone (and `restart` repeats the kill that failed). `_stop_advice <pid>` now says
  "Quit process N (kill -9 N), or reboot"; a tracked board keeps the stop advice. Arm with a no-pid control
  and an agent control, red-checked.
- FIXED (comment only): the watchdog says at the busy-grace site that a wedged board now waits 300 s, not
  45 s (the trade-off was only in the weakest premises).
- DEFERRED, by design: busy `status` never mentions `kosmos restart`. Busy and wedged cannot be told apart,
  and "a busy board is never told to restart" is this card's rule (pinned by "NO start or restart advice
  anywhere"); a wedged board is the watchdog's, or the person's own judgement.
- DEFERRED, out of scope: `say_not_up` on a stranger-held port says "not running ... kosmos start" exactly as
  main does; this branch does not change what a stranger hears.
- 6g on 9e571d3b1: GREEN.

## Review round 22 (sonnet): 1 NEW WARNING fixed; loop continues
- FIXED: busy, then plainly down, kept the OLD `down_since`, so the first down reading after a long busy
  spell restarted at once; the process that held the port is gone and launchd may be relaunching it, so
  `kickstart -k` could kill it mid-boot. Leaving busy for down now restarts the down clock (a fresh
  GRACE). Arm 6h plus a plain-long-down control; red on the old watchdog (restarted at once).
- DUPLICATE: "the guard is a deterrent, not enforcement" (weakest premises, round 18).
- NOT REAL: "the cooldown only covers `kosmos start`": `board-run` writes `board.started-at` before its
  exec (install/kosmos, cmd_board_run), and every watchdog kickstart relaunches through board-run (round 16).
- DUPLICATES: the 20 s busy wait on agent verbs (by design, "busy, retrying" on stderr); Windows
  `lastTimedOut` shared state (rounds 13, 16, 19).
- 6g on 4d81fa6da: GREEN.

## Review round 23 (fable): 1 NEW CONVENTION + 2 NEW NITs fixed; loop continues
- FIXED (CONVENTION): the watchdog header said it "adds no destructive action of its own"; past BUSY_GRACE
  it now grants the #3079 reclaim (`KOSMOS_RECLAIM_BUSY=1 kosmos start --force`), and the header says so.
- FIXED (NIT, comment): a board that alternates busy and down every tick is never restarted and raises no
  crash-loop alert (round 22's clock reset made that shape); accepted, same as the old up/down flap.
- FIXED (NIT, plan): the weakest premise's watchdog tick time (about a minute, not 20 s).
- DUPLICATE (W): `--force` is not discoverable for a person typing into an agent's pane. Recorded as the
  cost of never printing it (Rejected: "Refusing --force from agents"); `kosmos help` is read by agents
  too, so naming it there would undo the deterrent.
- DEFERRED: `healthy --once` on the `KOSMOS_RECLAIM_BUSY` start path. The full wait is the last chance for
  a board that has just come back before the reclaim kills it; 18 s on a wedged board's recovery is cheap.
- DEFERRED: a distinct sentence when the claim cannot be written (unwritable KOSMOS_HOME): the CLI is
  broken in that state anyway, and "another agent is starting it" still refuses, the safe direction.
- DEFERRED: the --auto report arm measures from spawn on purpose: Claude Code's 15 s hook timeout is
  wall-clock from spawn too, so that is the number that must stay under it.
- 6g on 5acff166d: GREEN.

## Review round 24 (opus): 1 NEW WARNING + 2 NEW NITs fixed, 2 deferred; loop continues
- FIXED (W, and it was this plan's own named weakest premise): after the merge, `connections`,
  `community read` and `agent role-draft` still said "Is it running at ..." when their REQUEST failed after
  the health check (a timeout or cut reply on a busy board). The merge sweep grepped for "Start it with"
  and missed "Is it running". All three now use `say_unreached` (reads); an empty body with exit 0 gets its
  own sentence. New stub mode `datacut` (health answers, the data read is cut) and an arm over all three;
  red on the old code ("Is it running at ...").
- FIXED (NIT): the Windows `connections` read now goes through `ctx.unreachable` (its timeout said "Is it
  running"). NOT REAL: Windows `connect` returns on a timeout before its "Is it running" line, which is
  then only reached on a refused connection, where it is true.
- FIXED (NIT): `kosmos status` answers a stranger from healthy()'s own reading instead of a second probe,
  which could read busy the next moment and print the start advice. Arm with stubbed probes; red on the old
  code ("Kosmos is not running. Start it with: kosmos start").
- DEFERRED: `kosmos open` takes no `--force` for a person in an agent's pane; `kosmos start --force` then
  `open` covers it, and open's own guard is a subshell for a reason (it must not end open early).
- Sweep after the fix: `grep -n 'Is it running' install/kosmos tools/windows/kosmos-cli.js` leaves only
  the two helpers' refused-connection branches and Windows `connect` (above). All 222 cli + reporthook
  tests green.

## Rejected
- Just raising the curl timeout: still a false "down" past the new cap, and still the start advice.
- `busy` as status exit 0: hides a wedged board (#2955) from the watchdog forever.
- Detecting an agent by `KOSMOS_WORLD` being set-but-empty: works today, but by accident of the
  supervisor's env handling; an explicit variable says what it means.
- Refusing `--force` from agents: the card says the person can force it, and a person typing into an
  agent's pane is that case. Mitigated by never printing `--force` in a refusal.

## Weakest premises
- **The `/api/health` answer is only as fast as the event loop.** A board pinned at 100% still answers
  it slowly; the fix is that slow now reads busy and is retried, not that it is fast. #4468 is the speed.
- **The agent guard is a DETERRENT, not enforcement.** An agent that passes `--force` or clears its
  environment gets through. It exists to stop an agent that follows the CLI's own advice (the 140-restart
  case); nothing a process running as the same user does can be stopped by that same user's CLI.
- **A watchdog tick can take about a minute on a busy board**: `kosmos status` waits its 20 s busy budget,
  and past BUSY_GRACE the reclaim start runs its own full `healthy()` (another 20 s), then the kill waits
  (up to 7 s) and the come-up loop. It is a launchd job with StartInterval 30, and launchd never starts a
  second instance of a job while one runs, so ticks cannot stack on a busy board. (Round 23 corrected the
  number, which said 20 s.)
- **A slow dev board reads as a stranger** (round 8): the busy verdict needs "kosmos" in the listener's
  command line, which an installed board always has.
- **Agent detection is by environment.** An agent run by some other harness, with none of the three
  markers, is treated as a person. Every Kosmos-launched agent has at least the claim.
- **300 s busy grace** is a judgement: long enough that a busy board is not restarted by the watchdog,
  short enough that a wedged one is recovered in minutes.
- The live `/api/report` path and the tester's real board are not measured here; this is measured on stub boards
  and the real server's route.

## Tests
- `cli.busy-health-4466.test.js` (28 arms, the first 11 below; later rounds added the rest): slow status and post wait, say busy, succeed; the old
  `healthy()` verbatim as the CONTROL (says "not running" to the same slow board); stopped = "not
  running" at once; never answers = busy, exit 4, no start advice; stranger; older board fallback;
  agent refusal; 10 rapid agent restarts of a down board go ahead once, a person 10 times, `--force`
  goes ahead; token-only and pane-claim agents (with an unclaimed control).
- `server.health-4466.test.js` (4 arms): enforcing board, no token, tiny identity answer; a gated route
  still 403 (control); HEAD; the page premise.
- `tools.windows-kosmos-cli-busy-4466.test.js` (3 arms): a timed-out read says busy; a timed-out write adds that
  it may have happened; refused keeps the old line.
- `tools/test-board-watchdog-2955.sh` arms 6e/6c/6d/6f/6g (6f: down then busy, no reclaim; 6g: busy then down clears busy_since): busy 60 s no restart (red on the old watchdog), busy
  400 s recovered by the reclaim start, busy after a failed reclaim reclaims again (no kickstart).
- Red-capability measured: on main's `install/kosmos`, 6 of the 10 CLI arms fail and the 4 that should
  hold on both (stopped, stranger, older board, control) pass.

## Status
- [x] server route, CLI, watchdog, supervisor, Windows CLI, tests, red checks
- [x] full suite (green at every iteration's commit)
- [x] challenge loop convergence (iteration 19)
- [ ] PR, merge
