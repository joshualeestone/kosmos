#!/bin/sh
# #2791: deploy-site.sh must return 0 EXPLICITLY on a successful --publish/--promote, so any runner
# or CI gate reading DEPLOY_EXIT never reads a clean publish as a failure (Baron saw DEPLOY_EXIT=128
# trail a verified 0.6.55 publish -- a latent false-alarm trap).
#
# The success exit used to be IMPLICIT: the script's last statement is the #2159
# `if [ "$PROMOTE" = 1 ]; then ... fi` block, and on a --publish that condition is false. A false
# `if...fi` with no else returns 0 (POSIX), so the exit happened to be 0 -- but only by that trailing
# construct's status, which a future trailing command would silently break. The fix is an explicit
# trailing `exit 0`. This test pins two things that make a successful publish's 0-exit robust:
#   1. the script's LAST executable line is `exit 0` (nothing may trail it), and
#   2. the script runs under `set -e` (so a REAL failure exits non-zero BEFORE that exit 0 -- the
#      explicit success exit masks no real failure).
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
DEPLOY="$HERE/deploy-site.sh"
[ -f "$DEPLOY" ] || { echo "FAIL: deploy-site.sh not found at $DEPLOY"; exit 1; }

fails=0

# 1) The last non-blank, non-comment line must be `exit 0`.
last=$(grep -vE '^[[:space:]]*(#|$)' "$DEPLOY" | tail -1 | sed 's/[[:space:]]*$//')
if [ "$last" = "exit 0" ]; then
  echo "PASS: deploy-site.sh ends with an explicit 'exit 0' -- a successful publish returns 0, immune to a trailing command"
else
  echo "FAIL: deploy-site.sh's last executable line is '$last', not 'exit 0'. A successful --publish's exit status is implicit/trailing again (#2791 latent false-alarm trap: a runner reading DEPLOY_EXIT could read a clean publish as a failure)."
  fails=$((fails + 1))
fi

# 2) `set -e` (or `set -eu`) is present, so real failures exit non-zero before the explicit exit 0.
if grep -qE '^[[:space:]]*set -e' "$DEPLOY"; then
  echo "PASS: deploy-site.sh runs under 'set -e', so a real failure exits before the explicit exit 0 (it masks no failure)"
else
  echo "FAIL: deploy-site.sh has no 'set -e' -- an explicit trailing 'exit 0' could then mask a mid-script failure"
  fails=$((fails + 1))
fi

# CONTROL: prove this test can FAIL. A script whose last line is a bare command, not `exit 0`, must
# be caught by the same check -- otherwise the arm above is vacuous.
tmp=$(mktemp "${TMPDIR:-/tmp}/ds-exit0-ctl.XXXXXX")
printf '#!/bin/sh\nset -eu\necho done\n' > "$tmp"
ctl_last=$(grep -vE '^[[:space:]]*(#|$)' "$tmp" | tail -1 | sed 's/[[:space:]]*$//')
rm -f "$tmp"
if [ "$ctl_last" = "exit 0" ]; then
  echo "FAIL: CONTROL -- a script ending in 'echo done' was read as ending in 'exit 0'; the check is broken"
  fails=$((fails + 1))
else
  echo "PASS: CONTROL -- a script ending in a bare command is correctly NOT read as 'exit 0' ($ctl_last)"
fi

[ "$fails" -eq 0 ] || { echo "$fails failing arm(s)"; exit 1; }
echo "test-deploy-site-exit0-2791: all arms passed"
