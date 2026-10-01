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
- Rejected: resetting the shared home between checks. A reset has to know every place a check writes and must run
  after every check, including one that dies; a per-check folder needs neither. (Review 1 corrected my first reason:
  KOSMOS_CUT_PARALLEL overlaps the node suite with the page checks, it does not run the checks concurrently.)
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

## Review 1 (Opus, blind, source-only): 1 blocker, 2 warnings, 3 nits
- B1 the control could never fail: the seed went into the run home, which the fix stops anything reading, so seeded
  and clean runs were equal by construction (a false clean). FIXED: the seed reaches every home the fix makes, each
  board's (board_home) and each self-booting check's (lib-sandbox-home.js). The control's positive arm: on this branch
  render-teamcreate-4557 is still the unfixed #4719 arm (tcfix-4719 is not merged), so a seeded run must red it; a
  seeded run that reds nothing is not a pass.
- W2 the seed failed silently and could leak into a cut: FIXED, the run says SEEDED RUN, refuses a missing folder or
  the real home, records a failed copy and fails at the summary (not an exit inside $(...), which would have handed a
  board an empty home), and release.sh clears KOSMOS_BC_SEED_HOME at both page-check sites (tested).
- W6 boards booted after the gated loop no longer start with leaked state, so a check that passed only because of a
  leak goes red: the control's clean arm is exactly the full run on this branch, before any merge.
- N3 the boot scan accepted the run home and did not tie the sandbox to the boot: FIXED (the sandbox must be the one
  its AGENT_WORKFORCE_DATA names; $RUN_DIR refused). N4 comments that still said the home is shared: FIXED (lib,
  runner, release.sh). N5 the parallel-mode reason: corrected above.

## Review 2 (Sonnet, blind, source-only): 0 blockers, 3 warnings, 5 nits
- W1 a seed refusal exited before the cleanup trap and leaked the run folder: FIXED, the seed is checked before the run
  folder exists.
- W2 a caller-set home silently disabled the seed while the banner claimed it: FIXED, refused.
- W3 the runner's seed paths were untested: ADDED, board_home seeds once, a failed copy still hands the board its own
  home and leaves the marker, the marker reaches the verdict, and the refusal precedes the run folder (source-pinned).
- N4 the banner overclaimed (sb1/sb4/sb8 and the walk pair name their own homes and are not seeded): reworded.
- N5 the boot scan does not see boot_thread_server: kept (thread-server.js requires the lib, so it gets a fresh home).
- N6 AMBIENT now drops KOSMOS_BC_SEED_HOME. N7 seed edge cases: documented (keep a seed small). N8 board_home
  re-seeding a re-booted board: FIXED, only an empty home is seeded.
