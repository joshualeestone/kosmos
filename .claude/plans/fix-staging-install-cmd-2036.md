# Plan: fix the staging fresh-install command (channel var on sh, not curl)

## Why
The cut's staging hand-off (`release.sh`) and `docs/staging-channel.md` told a fresh-machine
tester to run `KOSMOS_UPDATE_CHANNEL=staging curl -fsSL .../setup | sh`. An env prefix binds to
the LEFT of a pipe, so the var was set for curl and the setup script (in sh) never saw it -> it
installed PROD (latest.json), not staging. A live fresh-machine gate test landed on the prior
release because of this. The mechanism is fine (the served /setup honors the channel); only the
command was wrong.

## What
- `tools/release.sh`: the staging hand-off echo -> `curl -fsSL .../setup | KOSMOS_UPDATE_CHANNEL=staging sh`,
  plus a two-line comment explaining the pipe-precedence pitfall.
- `docs/staging-channel.md`: same correction + a warning.
- `tools/test-staging-wire-2036.sh`: two source guards - one FAILS if the var-on-curl form
  returns, one FAILS if the correct var-on-sh form disappears.

## Decisions / rejected
- The docs warning deliberately still shows the wrong form as "what NOT to do"; no test greps
  docs, so it does not trip the guard (which greps release.sh only).
- Reworded the release.sh comment so it does NOT contain the literal wrong-command string the
  negative guard greps for (avoids the check-matches-its-own-documentation trap).

## Weakest premise
The guard is a source-drift assertion, not an end-to-end install test in CI (CI cannot run a live
fresh-machine install). The real proof is the next staging install using the corrected command.
