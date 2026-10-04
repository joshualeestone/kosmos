# reclaim-4679: prevent kosmos start #3079 reclaim from killing another install's board

Card: #4679 (bug, claimed:scorpion; Liu Kang m4174).
Branch: reclaim-4679.

## Finished means
- `port_listener_owner` in `install/kosmos` returns a 4th field, `ours`: 1 only when the listener command line contains `"$KOSMOS_HOME/app/server.js"`, and 0 otherwise.
- `_kosmos_reclaim_decision` in `install/kosmos` accepts `[ours]` as the 4th argument, defaulting to 0 for backwards compatibility. It echoes `reclaim` only when `luid == myuid`, `iskos == 1`, and `ours == 1`. In all other cases (including another install of Kosmos by the same user where `ours == 0`), it echoes `keep`.
- `cmd_start` in `install/kosmos`: when the port is held by a same-uid Kosmos process from another install (`iskos == 1` but `ours == 0`), it dies with actionable advice: "Another Kosmos install of yours on this computer is already using port $PORT. Quit that board, or set KOSMOS_PORT to a different number." It never kills that process.
- `_health_no_answer` in `install/kosmos`: sets `HEALTH_STATE=busy` only when `ours == 1`. When `ours == 0` (even if same uid and Kosmos), it sets `HEALTH_STATE=stranger`, so `status` and `start` stop reporting another install's board as ours or busy.
- `tools/test-kosmos-addr-reclaim-3079.sh` verifies the pure decision with the 4th argument, and tests owner resolution against a listener from this install (ours=1, reclaim) vs another home (ours=0, keep).
- A focused node test `cli.start-reclaim-4679.test.js` runs `cmd_start` under `KOSMOS_RECLAIM_BUSY=1` against a stub board from another home, asserting the stub is not killed and the refusal message is printed.

## Measurement
On origin/main (b33a96db5):
- A listener running under `.../second-kosmos/app/server.js` by the same user has `_iskos=1`.
- `_kosmos_reclaim_decision "$MYUID" "$MYUID" 1` evaluates to `reclaim`.
- Under `KOSMOS_RECLAIM_BUSY=1` (installer update or watchdog recovery after grace), `kosmos start` executes `kill "$_lpid"`, killing the other install's board.

## Decisions
- Anchored path match: `case "$_cmd" in *"$KOSMOS_HOME/app/server.js"*) _ours=1 ;; esac`. This matches the proven pattern in `install/setup.sh` (`BOARD_OURS` lines 2804 and 4324).
- Safe default: `_ours="${4:-0}"` in `_kosmos_reclaim_decision` so any caller omitting the 4th parameter fails safe (keep).
- Refusal advice: follows the #964 pattern, telling the user another Kosmos install of theirs is using port $PORT, and advising to quit that board or set KOSMOS_PORT.
- Rejected: bare `kill -0` or PID-only check (vulnerable to recycled PIDs across reboots).
- Rejected: killing another install's board on the assumption that it is always stale (violates multi-install setups by the same user on a Mac).
- Weakest premise: That `$KOSMOS_HOME/app/server.js` is always spelled identically between the running process command line and the CLI's computation. `board-run` launches `$NODE $APP` with `APP="$KOSMOS_HOME/app/server.js"`, so the path is identical by construction.

## Tests
- `tools/test-kosmos-addr-reclaim-3079.sh`: tests the pure decision matrix with 4 arguments; adds real listener tests for this home (`$SANDBOX/home/app/server.js`) vs another home (`$SANDBOX/other/Kosmos/app/server.js`).
- `cli.start-reclaim-4679.test.js`: launches a stub board under a second home directory; runs `kosmos start` with `KOSMOS_RECLAIM_BUSY=1`; confirms exit code is non-zero, the refusal message names another Kosmos install, and the stub board process remains alive.
