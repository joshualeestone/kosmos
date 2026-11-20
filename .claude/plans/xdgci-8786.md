# xdgci-8786: #8786, a live systemd case for an install with another user's XDG_RUNTIME_DIR

## Call
xdgown-8786 (kosmos PR #8831, merged 96ffb7ab42) made installBoard use this user's own systemd runtime folder. Its
tests stub systemctl, so nothing had run the fix against real systemd. This adds case 5b to
tools/test-linux-cloud-update-live-8786.sh, which linux-systemd.yml runs on a real systemd runner:
- a CONTROL first: with a root-owned folder in XDG_RUNTIME_DIR, `systemctl --user show-environment` must fail on this
  runner, so a pass is the fix and not a bus found some other way (show-environment, not is-system-running, which
  also fails on a merely degraded manager: review 2);
- then the timer is disabled, installBoard runs with that folder in XDG_RUNTIME_DIR, and the timer must be enabled.
- Run as root it SKIPs (a root-owned folder is root's own); without passwordless sudo it fails, since the CI runner has it.

## Rejected
- A second workflow: the existing live script already sets up the user manager and the stub board.
- Asserting the log line only: enabled-or-not is what the person depends on.

## Measured
- Rebased onto main after #8831 merged (11:36 CST): the diff is this one file.
- The measurement is the PR's own linux-systemd CI run.

## Weakest premise
That a root-owned folder reproduces the Hetzner failure: there root's login passed its own runtime folder through
runuser, and the control shows this runner's user bus is unreachable with such a folder, which is the same symptom.
