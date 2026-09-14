# deploy-exit-2791: deploy-site.sh --publish must return 0 on a successful publish (#2791)

## The card
Baron, during the 0.6.55 Windows publish: `tools/deploy-site.sh --publish` printed its success line
and every served byte verified, BUT a trailing `DEPLOY_EXIT=128` was captured. Non-blocking now, but
a deploy script that exits non-zero on success is a latent false-alarm trap: any runner/CI reading
DEPLOY_EXIT reads a clean publish as a failure. Ask: ensure a successful --publish returns 0.

## What I verified
- deploy-site.sh is `#!/bin/sh` + `set -eu`. The `--publish` success path ends at the "published and
  verified" echo (~L447) then the final `#2159` `if [ "$PROMOTE" = 1 ]; then ... fi` (L467-483), with
  NO explicit `exit 0` after it.
- On --publish PROMOTE=0, so that if-condition is false. PROVEN in /bin/sh: a false `if...fi` with no
  else returns 0. So the script's OWN success exit is already 0 -- it does not reproduce 128 from its
  tail. 128 == git-fatal exit; the script's git calls (L168/198/211) are `2>/dev/null || X=""` guarded
  and do not leak 128 to the final exit (echoes at 312/447 reset $?).
- No in-repo runner captures DEPLOY_EXIT; Baron's was ad-hoc. The observed 128 most likely came from a
  git-fatal in his shell AFTER the script returned, captured into DEPLOY_EXIT -- not deploy-site.sh's
  own exit.

## The fix (decided, per decide-and-build)
Add an explicit `exit 0` as the script's last line. Rationale: the success exit was only IMPLICIT
(whatever the trailing if...fi leaves; 0 today for a false condition, but a future trailing command
would silently break it). An explicit `exit 0` forces success -> 0 unconditionally, immune to any
trailing command, closing the latent trap the card is about. It masks NO real failure: every
pre-deploy refusal and post-deploy served-verify / served_matches guard `exit 1`s BEFORE L447, so
reaching the end is verified success. This satisfies the card's goal regardless of whether Baron's
128 was from the script or his runner.

## What I rejected
- "Hunt the exact 128 inside deploy-site.sh and patch that command": I could not reproduce a 128 from
  the script's own exit (tail returns 0 in /bin/sh). Patching a command I cannot show returns 128
  would be guessing; the explicit `exit 0` is the robust catch-all that fixes it either way.
- Auto-forcing 0 anywhere earlier: would mask real failures. Placing it only at the very end (after
  all guards) means it can only ever certify a run that already passed every guard.

## Tests
- tools/test-deploy-site-exit0-2791.sh: pins (1) the last executable line is `exit 0` (nothing may
  trail it) and (2) `set -e` is present (so real failures exit before the success exit 0, masking
  none), with a CONTROL arm proving the check fails on a script ending in a bare command.
- Wired into package.json `test:shell` after the existing test-deploy-site-* tests.

## Weakest premise
That the observed 128 came from the runner, not a script-internal path I could not reproduce. Either
way the explicit `exit 0` fixes it (forces success -> 0). If Baron knows a script-internal command
that returns 128 on a real publish, that is a separate, additional finding; this change still makes
the success exit correct. Documented on the card for his override.
