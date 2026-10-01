# sandboxhome-4909: each browser check and each fixture board gets its own home (kosmos#4909)

Card: joshualeestone/kosmos#4909 (April, 2026-10-01 16:45, from the red that aborted the 0.7.16 cut). Routed by
Splinter: build the class; do not touch tcfix-4719 or #4907; queue runs behind theirs.

## Measured first (origin/main 0a7157d41)
- tools/browser-checks.sh exports ONE AGENT_WORKFORCE_HOME ($RUN_DIR/home) and one AGENT_WORKFORCE_SKILLS_DIR for
  the whole run; docs/browser-checks/lib-sandbox-home.js keeps any home a caller set, so every check that boots its
  own board shares them. render-chatgpt-green-4064 writes a ChatGPT sign-in into "the sandbox home" (the shared one
  under the runner); render-personal-instr-4446 writes ~/.claude/CLAUDE.md there.
- The runner's own boards (boot_board, boot_board_rich, boot_board_org, sandboxes 5 and 6, the walk pair) inherit
  the same run home and skills; sandboxes 4 and 8 already named their own homes.

## What changes
- The runner marks the folders IT made for the run (KOSMOS_BC_RUN_HOME, KOSMOS_BC_RUN_SKILLS).
- lib-sandbox-home.js gives a check a fresh home / skills folder when it was handed the run's; a folder a caller set
  for that check alone is kept (as before).
- Every fixture board the runner boots has its own home and skills: board_home / board_skills give it "<sandbox>/home"
  and "<sandbox>/skills" when it would inherit the run's; an explicitly named one is kept.
- KOSMOS_BC_SEED_HOME (the card's control): copies a prepared home into the run's home, so a whole run can be compared
  with a clean one.

## Decided, and rejected
- Rejected: resetting the shared home between checks. Checks run sequentially today, but KOSMOS_CUT_PARALLEL runs
  them concurrently; a per-check folder is correct in both, a reset is not.
- Checks that share ONE fixture board (a group run "in position" against one boot) still share that board's state
  by design; the control below is what finds any of them that reads state it never set.

## Weakest premise
That nothing relied on the shared home on purpose (a check planting state for a later check). Searched: the checks
that write into the home (chatgpt-green-4064, personal-instr-4446) boot their own boards and read only their own
writes. The control run is the measurement.

## Verification
tools.browser-checks-runhome-4909.test.js: a check handed the run's home or skills gets fresh ones (two checks get two
different ones) and a caller's own is kept; every board boot in the runner names its own home and skills (counted,
>= 8); board_home's arms. Control (queued): the whole set clean vs seeded with an OpenAI-only sign-in.
