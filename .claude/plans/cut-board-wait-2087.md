# Plan: #2087 — give step 10's local-board restart a load-generous deadline

## Problem
The 0.6.27 cut published successfully (steps 8 deploy + 9 verify-served all green) then
exited 1 at step 10 ("the board on THIS Mac"): the local com.kosmos.board did not serve
0.6.27 within restart-local-board.sh's 45s deadline, so it read as "never served" (exit 1)
and failed the cut. The board recovered on its own moments later -- it flipped at ~50s, just
past the window. The cut record read `outcome=failed served=1 step=_10`.

## Corrected analysis (my filed card's option 1 was wrong)
restart-local-board.sh ALREADY distinguishes slow-but-healthy (flips late -> exit 0) from
genuinely stale/down (never serves -> exit 1), and step 10 being fatal on a genuinely stale
board is the #360 point (a dev's board silently serving old code). Making step 10 non-fatal
would reintroduce #360. The real bug is the 45s DEADLINE being too short on a LOADED release
machine (the full suite + a full build + a sandboxed install run right before it).

## Fix
Step 10 in release.sh passes `KOSMOS_BOARD_WAIT_SECS=120` (operator env override still wins).
This gives a slow-but-fine board room to flip while keeping the #360 catch (a genuinely stale
board still reds, just later). It costs nothing on a healthy cut -- restart-local-board.sh
polls and exits the instant the board flips. restart-local-board.sh itself is UNCHANGED (its
45s default stays right for a manual dev run on a quiet box).

## Verification
- release.sh `bash -n` clean.
- install.local-board.test.js step-10 assertions still hold: `indexOf('tools/restart-local-board.sh')`
  still finds it (the env prefix keeps the string), still after verify-served; package.json
  test:shell still syntax-checks restart-local-board.sh.
- restart-local-board.sh's own arm-tests (test-restart-local-board.sh) unaffected (script unchanged).
