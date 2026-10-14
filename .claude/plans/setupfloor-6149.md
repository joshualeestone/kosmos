# setupfloor-6149: the rollback floor (#6149 point 1)

## Why
#4455 (merged as #6146, in 0.7.49, now on staging) makes the installed app read-only. An installer older than 0.7.45
does not lift that lock: it removes bin/, fails at the read-only app/, and cannot put the board back, on every Mac and
Linux install that 0.7.49 touched. The rule ("never serve a /setup or /setup-staging older than 0.7.45") was prose
only. Splinter asked for it in the promote and rollback path before Josh's go for 0.7.49's prod promote.

## What
- tools/lib/setup-floor.sh: KOSMOS_SETUP_FLOOR (0.7.45) and `kosmos_setup_floor_ok <label> <version>`, a numeric
  part-by-part compare (0.7.100 is above 0.7.45). A version that is not plain numbers and dots is refused (the floor
  cannot be checked).
- It is called at every place a Mac pointer comes to name a build, which is also what /setup and /setup-staging
  serve with it:
  - publish-staging-pointer.sh, before the staging pointer is written;
  - promote-channel.sh (mac family), on the staging snapshot, before prod is touched;
  - deploy-site.sh, on both COMMITTED Mac pointers, before anything is served (the choke point: nothing is served
    unless it deploys).
- No override for real use: the fix for an old build is a newer build, never a flag.

## Decided
- The floor is unconditional, not "only once 0.7.49 is served": a rollback of staging to 0.7.47 would disarm a
  conditional floor, and the next step down would break installs that had 0.7.49.
- Tests whose fixtures are 0.6.x builds lower it with KOSMOS_SETUP_FLOOR=0.0.0, which prints a warning on every
  check. Weakest premise: that knob is an environment variable an operator could also set. It is loud, named for
  tests, and a real promote or deploy never sets it.
- Windows is out of scope: its pointers and zips have no /setup (the floor is about the Mac and Linux installer).
- deploy-site.sh is tested by its existing tests: the four with 0.6.x fixtures went red on the floor's own refusal
  before they had the knob (measured), so the floor provably runs inside deploy-site.sh; the new test pins its two
  calls by line.

## Tests
tools/test-setup-floor-6149.sh: the library (boundary, numeric compare, unreadable versions, the lowered-floor
warning), then the REAL promote-channel.sh and publish-staging-pointer.sh on a temp site (refused below the floor with
nothing written; a 0.7.49 control gets past the floor), and the deploy-site pins. Registered in test:shell.
