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
- **Watchdog on a busy board:** its first attempt, `kosmos start`, is a no-op on a busy board (already
  running), so recovering a truly wedged board is the next escalation, `kickstart -k`, one throttle later.
  Test arms 6c/6d assert exactly that.

## Review round 2 decisions (deferred, with the reason)
- **A person's `kosmos start` no longer reclaims a same-user Kosmos board that holds the port and never
  answers**: it says "already running (busy)". Deliberate: start cannot tell busy from wedged, and killing
  a busy board is this card's bug. Recovery of a wedged board is `kosmos restart` (the pidfile path kills
  it, supervised or not) or, for a supervised board, the watchdog's `kickstart -k` after the busy grace.
- **`kosmos restart` of a busy board this command did not start** refuses with exit 1 (`die` in cmd_stop
  ends the script), so it is never a silent no-op; a test arm pins it.
- **`setup.sh`'s update-pause `stop --force` on a busy board with no pidfile** leaves that board running,
  the same outcome as on main (which called it "not running" and continued); every Kosmos-started board
  writes a pidfile, so this is the rare hand-started case.

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
- **Agent detection is by environment.** An agent run by some other harness, with none of the three
  markers, is treated as a person. Every Kosmos-launched agent has at least the claim.
- **300 s busy grace** is a judgement: long enough that a busy board is not restarted by the watchdog,
  short enough that a wedged one is recovered in minutes.
- The live `/api/report` path and the tester's real board are not measured here; this is measured on stub boards
  and the real server's route.

## Tests
- `cli.busy-health-4466.test.js` (11 arms): slow status and post wait, say busy, succeed; the old
  `healthy()` verbatim as the CONTROL (says "not running" to the same slow board); stopped = "not
  running" at once; never answers = busy, exit 4, no start advice; stranger; older board fallback;
  agent refusal; 10 rapid agent restarts of a down board go ahead once, a person 10 times, `--force`
  goes ahead; token-only and pane-claim agents (with an unclaimed control).
- `server.health-4466.test.js` (4 arms): enforcing board, no token, tiny identity answer; a gated route
  still 403 (control); HEAD; the page premise.
- `tools.windows-kosmos-cli-busy-4466.test.js` (2 arms): timeout says busy; refused keeps the old line.
- `tools/test-board-watchdog-2955.sh` arms 6b/6c: busy 60 s no restart (red on the old watchdog), busy
  400 s recovered.
- Red-capability measured: on main's `install/kosmos`, 6 of the 10 CLI arms fail and the 4 that should
  hold on both (stopped, stranger, older board, control) pass.

## Status
- [x] server route, CLI, watchdog, supervisor, Windows CLI, tests, red checks
- [ ] full suite, challenge loop, PR, merge
