#!/bin/bash
# Test for tools/lib/board-restart-nonfatal.sh (kosmos#2087). Verifies step 10's
# board restart is NON-FATAL: a failing restart returns 0 (with a loud warning),
# so under set -e it does not abort the cut. Uses stub scripts; touches nothing.
set -u
cd "$(dirname "$0")/.." || exit 1
. tools/lib/board-restart-nonfatal.sh

FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS + 1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/board-restart-test.XXXXXX")"
trap 'rm -rf "$T"' EXIT

printf '#!/bin/bash\nexit 0\n' > "$T/ok.sh"; chmod +x "$T/ok.sh"
printf '#!/bin/bash\necho "THE LOCAL BOARD DID NOT COME BACK" >&2\nexit 1\n' > "$T/fail.sh"; chmod +x "$T/fail.sh"

# 1. A successful restart returns 0 and does NOT warn.
out="$(board_restart_or_warn "$T/ok.sh" 2>&1)"; rc=$?
[ "$rc" = 0 ] && ok "success: returns 0" || bad "success: rc=$rc"
printf '%s' "$out" | grep -q 'WARNING (step 10' && bad "success: warned when it should not" || ok "success: no warning"

# 2. THE FIX: a FAILING restart STILL returns 0, with a loud #2087 warning.
out="$(board_restart_or_warn "$T/fail.sh" 2>&1)"; rc=$?
[ "$rc" = 0 ] && ok "failure: non-fatal, returns 0 (the #2087 fix)" || bad "failure: rc=$rc (should be 0)"
printf '%s' "$out" | grep -q 'WARNING (step 10, non-fatal, kosmos#2087)' && ok "failure: warns loudly" || bad "failure: no warning"
printf '%s' "$out" | grep -q 'exited 1' && ok "failure: the warning names the exit code" || bad "failure: exit code not named"

# 3. THE CONTROL that can return the dangerous answer: under set -e (as release.sh
#    runs), a failing restart must NOT abort the caller. Without the fix (a bare
#    `bash "$script"`), set -e would abort before REACHED and this reds.
( set -e
  . tools/lib/board-restart-nonfatal.sh
  board_restart_or_warn "$T/fail.sh" >/dev/null 2>&1
  echo REACHED ) > "$T/sete-out" 2>&1
grep -q REACHED "$T/sete-out" && ok "set -e: the caller continues past a failing restart" \
  || bad "set -e: the caller aborted on a failing restart (the #2087 bug)"

# 4. CONTROL: the helper actually INVOKES the script (not a no-op that always
#    returns 0, which would pass arm 2 vacuously).
printf '#!/bin/bash\necho ran > "%s/marker"\nexit 1\n' "$T" > "$T/mark.sh"; chmod +x "$T/mark.sh"
board_restart_or_warn "$T/mark.sh" >/dev/null 2>&1
[ -f "$T/marker" ] && ok "control: the helper actually ran the restart script" || bad "control: script was never invoked"

if [ "$FAILS" = 0 ]; then echo "board-restart-nonfatal: ALL PASS"; exit 0; else echo "board-restart-nonfatal: $FAILS FAILED"; exit 1; fi
