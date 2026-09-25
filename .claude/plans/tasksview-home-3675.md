# Plan: render-tasks-view-3559 requires the #3675 sandbox home (main is red)

## Finished looks like
tools.browser-checks-home-3675.test.js passes on main again, and render-tasks-view-3559.js boots
its fixture board with its own empty account home, so it cannot list the host Mac's real accounts.

## Cause
A merge race: #3559 (d86df814) added render-tasks-view-3559.js, which boots the board in-process,
minutes before #3702 (caaf2e90) landed the guard that every board-booting check must require
lib-sandbox-home.js. Each PR was green on its own base; together, main fails the guard.

## Change
One line: `require('./lib-sandbox-home.js')` at the top of render-tasks-view-3559.js, before the
board, the same line the other 57 checks carry.

## Measured
Guard test 6/6 pass (was 1 failing on main: render-tasks-view-3559.js). The check itself passes
headless (exit 0, no FAIL lines).

## Weakest premise
That this is the only check that slipped in between the two merges. The guard test scans every
file, so a second one would show as red in the same test.
