# linuxlegs-7933: the #7777 promote check's Linux legs (kosmos#7933)

## Goal
The promote check ran only the Mac artifact; for Linux it confirmed a pointer and a hash. Add the legs the Mac
check has, run on a stock ubuntu-24.04 runner (real x86_64, real systemd), against what the site serves.

## What exists and what is new
- Fresh install from /setup-staging: already linux-family-install-7281.yml (#7281). Unchanged; the promote check
  runs it.
- New: tools/promote-check-legs-7933.sh (verify, data, update) and tools/promote-check-seed-7933.js, run by
  .github/workflows/linux-promote-check-7933.yml (workflow_dispatch, plus pushes to linux-promote-ci-* so it runs
  before it is on main, as linux.yml does with linux-ci-*). Nothing else triggers it; push-to-main workflows
  (test.yml, android.yml) are unaffected.

## Decided
- A hosted runner, not a Rosetta container on Mortals: real x86_64 and real systemd, no load on the release box.
- **Update leg = /setup-staging over a prod install.** The first run (41826266536) showed a Linux board's
  /api/update refuses by design (engine/platform.js SELF_INSTALL is darwin and win32). A Linux install is updated
  by re-running the served installer, and setup.sh says "Updating it in place" and pauses the board under systemd.
  The leg records the board's refusal without failing on it. The board still OFFERS the update: filed as #7935.
- Verify and data take a platform argument (linux | mac), so they can be rehearsed on a Mac against the Mac
  artifacts. Update refuses outside CI (it installs for real under systemd), as tools/test-linux-systemd-live-4918.sh does.
- The seed goes through the build-under-test's own engine (projects, tasks), as the Mac check's seed.js.

## Measured
- Mac rehearsal, 0.7.86 -> 0.7.88: verify PASS (controls refused), data PASS.
- ubuntu-24.04, run 41828017088: verify PASS, data PASS, update PASS (0.7.86 -> 0.7.88, project kept, systemd active).

## Weakest premise
That a hosted runner stands in for a customer's Linux machine. It is one distro (Ubuntu 24.04, glibc 2.39), the
family's floor is 2.35, and a GitHub image is not a cloud box. Far more than a hash; not every Linux.

## Not in this branch
#7935 (the Linux Update button). Wiring this into the #7777 procedure doc, if one exists, after merge.
