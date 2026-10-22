#!/usr/bin/env bash
# test-deploy-site-exit-trap-6826.sh - kosmos#6826: deploy-site.sh must not exit 0 when it dies.
#
# On macOS /bin/sh (bash 3.2), a script with an EXIT trap that dies on a failed `.` (a missing library) or an
# unset variable (set -u) reaches the trap with $? already 0, and exits 0. deploy-site.sh did exactly that on
# 2026-10-21: a dry run stopped on a missing tools/lib/setup-floor.sh and exited 0.
#
# The fix is a finished flag: every success exit sets _DS_FINISHED=1, and the EXIT trap turns any other 0 into 1.
# This test runs the REAL trap line, lifted out of deploy-site.sh, against each way to end:
#   R1 a failed `.`              must exit non-zero (and, where the shell loses the status, say so)
#   R2 an unset variable         must exit non-zero (likewise)
#   R3 an explicit `exit 3`      must keep 3
#   R4 a finished `exit 0`       must exit 0 (the success path still works)
#   C  CONTROL: the old trap (`trap '_fetch_cleanup' EXIT`) on R1, to show this shell really loses the status.
#      It runs FIRST. Where the shell keeps the status (dash, bash 5) the trap has nothing to turn into a failure
#      and prints nothing, so R1, R2, E1 and E2 then check only the non-zero exit.
# End to end, on a COPY of the real deploy-site.sh with one death injected right after its EXIT trap line (a site
# repo, the real tools, a stub vercel; nothing is fetched or deployed, the run dies first):
#   E1 a failed `.`       must reach the injected line (it prints a marker) and exit non-zero (with the
#                         message, where the shell loses the status)
#   E2 an unset variable  must exit non-zero (likewise)
#   EC CONTROL: the same copy with the old plain trap, on E1 (exits 0 on macOS /bin/sh)
# And one source pin:
#   P  every exit in command position (outside quotes) is a literal non-zero code, or `exit 0` as the whole line
#      directly after `_DS_FINISHED=1`. Anything else could end a success without the flag.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
DEPLOY="$HERE/deploy-site.sh"
[ -f "$DEPLOY" ] || { echo "FAIL: deploy-site.sh not found at $DEPLOY"; exit 1; }

fails=0
pass() { printf 'PASS  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fails=$((fails + 1)); }

TRAP=$(grep -E "^trap '_ds_rc=" "$DEPLOY")
[ "$(printf '%s\n' "$TRAP" | grep -c .)" = 1 ] || { echo "FAIL: expected exactly one _ds_rc EXIT trap line in deploy-site.sh, found: $TRAP"; exit 1; }
grep -qx '_DS_FINISHED=0' "$DEPLOY" || { echo "FAIL: deploy-site.sh no longer starts _DS_FINISHED at 0"; exit 1; }

TMP=$(mktemp -d "${TMPDIR:-/tmp}/exittrap-6826.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

# A stand-in _fetch_cleanup that ends in assignments, as the real one does (that is what makes the trap return 0).
run() {   # run <name> <trap line> <body>; prints the exit status
  printf '%s\n' 'set -eu' '_fetch_cleanup() { _a=""; _b=""; }' '_DS_FINISHED=0' "$2" "$3" > "$TMP/$1.sh"
  sh "$TMP/$1.sh" > "$TMP/$1.out" 2>&1
  echo $?
}

rc=$(run c "trap '_fetch_cleanup' EXIT" ". $TMP/no-such-lib.sh")
if [ "$rc" = 0 ]; then pass "C: CONTROL: the old trap exits 0 on a failed . on this shell, so R1 is measuring the real danger"
else pass "C: CONTROL: this shell keeps the status even with the old trap (rc=$rc), so R1 cannot show the danger here; it does on macOS /bin/sh"; fi
LOSES=0; [ "$rc" = 0 ] && LOSES=1   # 1: this shell loses the status, so the trap must print its line
said() { [ "$LOSES" = 0 ] || grep -q 'stopped before finishing' "$1"; }

rc=$(run r1 "$TRAP" ". $TMP/no-such-lib.sh")
[ "$rc" != 0 ] && said "$TMP/r1.out" \
  && pass "R1: a failed . exits $rc and says the run did not finish" \
  || bad "R1: a failed . exited $rc: $(cat "$TMP/r1.out")"

rc=$(run r2 "$TRAP" 'echo "$NO_SUCH_VAR_6826"')
[ "$rc" != 0 ] && said "$TMP/r2.out" \
  && pass "R2: an unset variable exits $rc and says the run did not finish" \
  || bad "R2: an unset variable exited $rc: $(cat "$TMP/r2.out")"

rc=$(run r3 "$TRAP" 'exit 3')
[ "$rc" = 3 ] && ! grep -q 'stopped before finishing' "$TMP/r3.out" \
  && pass "R3: an explicit exit 3 keeps 3" \
  || bad "R3: an explicit exit 3 became $rc: $(cat "$TMP/r3.out")"

rc=$(run r4 "$TRAP" '_DS_FINISHED=1; exit 0')
[ "$rc" = 0 ] && [ ! -s "$TMP/r4.out" ] \
  && pass "R4: a finished run exits 0 and says nothing" \
  || bad "R4: a finished run exited $rc: $(cat "$TMP/r4.out")"


# E: the real script, copied, with a death injected straight after its trap line.
REPO=$(cd "$HERE/.." && pwd)
mkdir -p "$TMP/site/.vercel" "$TMP/bin"
printf '{}\n' > "$TMP/site/.vercel/project.json"
git -C "$TMP/site" init -q && git -C "$TMP/site" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q --allow-empty -m t
printf '#!/bin/sh\nexit 0\n' > "$TMP/bin/vercel"; chmod +x "$TMP/bin/vercel"
e2e() {   # e2e <name> <injected line> [old]; prints the exit status
  awk -v inj="$2" -v old="${3:-}" '
    /^trap '"'"'_ds_rc=/ { if (old) print "trap '"'"'_fetch_cleanup'"'"' EXIT"; else print; print inj; n++; next }
    { print } END { if (n != 1) exit 3 }' "$DEPLOY" > "$TMP/$1.sh" || { echo "inject-failed"; return; }
  KOSMOS_SITE="$TMP/site" KOSMOS_REPO="$REPO" PATH="$TMP/bin:$PATH" sh "$TMP/$1.sh" > "$TMP/$1.out" 2>&1
  echo $?
}
rc=$(e2e e1 "echo INJECTED-6826; . $TMP/no-such-lib.sh")
[ "$rc" != 0 ] && [ "$rc" != inject-failed ] && grep -q INJECTED-6826 "$TMP/e1.out" && said "$TMP/e1.out" \
  && pass "E1: the real script, dying on a failed . after its trap, exits $rc and says so" \
  || bad "E1: the real script exited $rc: $(tail -3 "$TMP/e1.out")"
rc=$(e2e e2 'echo INJECTED-6826; : "$NO_SUCH_VAR_6826"')
[ "$rc" != 0 ] && [ "$rc" != inject-failed ] && grep -q INJECTED-6826 "$TMP/e2.out" && said "$TMP/e2.out" \
  && pass "E2: the real script, dying on an unset variable after its trap, exits $rc and says so" \
  || bad "E2: the real script exited $rc: $(tail -3 "$TMP/e2.out")"
rc=$(e2e ec ". $TMP/no-such-lib.sh" old)
if [ "$rc" = 0 ]; then pass "EC: CONTROL: the real script with the old trap exits 0 on that death on this shell, so E1 measures the danger"
elif [ "$rc" = inject-failed ]; then bad "EC: could not inject into deploy-site.sh"
else pass "EC: CONTROL: this shell keeps the status with the old trap too (rc=$rc), so E1 cannot show the danger here"; fi

# P: every exit in command position, outside quotes: a literal non-zero code, or `exit 0` as the whole line directly
# after `_DS_FINISHED=1`. A bare `exit`, `exit "$var"`, `|| exit 0` or an inline `exit 0` could end a success
# without the flag, so each is reported.
pin_awk() {
  cat <<'AWK'
# Every exit in command position, outside quotes: a literal non-zero code passes; `exit 0` passes only as the whole line, directly
# after `_DS_FINISHED=1`; anything else (bare exit, exit "$var", an inline exit 0) is reported as NR: line.
{ t = $0; sub(/^[ \t]+/, "", t) }
t ~ /^#/ { prev = t; next }
{
  rest = " " $0
  gsub(/'[^']*'/, "''", rest)                 # quoted text (awk programs, trap strings, messages) is not the
  gsub(/"([^"\\]|\\.)*"/, """", rest)    # script's own flow
  while (match(rest, /(^|[;&|{(])[ \t]*exit([ \t]+[^ \t;}&|)]+)?/)) {
    m = substr(rest, RSTART, RLENGTH); rest = substr(rest, RSTART + RLENGTH)
    sub(/^[;&|{( \t]*exit[ \t]*/, "", m)
    if (m ~ /^[1-9][0-9]*$/) continue
    if (m == "0" && t == "exit 0" && prev == "_DS_FINISHED=1") continue
    print NR ": " $0
  }
  prev = t
}
AWK
}
unflagged=$(awk "$(pin_awk)" "$DEPLOY")
exits=$(grep -cx '[[:space:]]*exit 0' "$DEPLOY")
[ "$exits" -ge 2 ] && [ -z "$unflagged" ] \
  && pass "P: every exit in deploy-site.sh is a non-zero code or one of its $exits flagged success exits" \
  || bad "P: exits that could end a success without _DS_FINISHED=1 ($exits flagged exit 0 lines): ${unflagged:-none}"

echo
[ "$fails" = 0 ] && { echo "test-deploy-site-exit-trap-6826: all passed"; exit 0; }
echo "test-deploy-site-exit-trap-6826: $fails failed"; exit 1
