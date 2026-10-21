#!/usr/bin/env bash
# test-deploy-site-exit-trap-6826.sh - kosmos#6826: deploy-site.sh must not exit 0 when it dies.
#
# On macOS /bin/sh (bash 3.2), a script with an EXIT trap that dies on a failed `.` (a missing library) or an
# unset variable (set -u) reaches the trap with $? already 0, and exits 0. deploy-site.sh did exactly that on
# 2026-10-21: a dry run stopped on a missing tools/lib/setup-floor.sh and exited 0.
#
# The fix is a finished flag: every success exit sets _DS_FINISHED=1, and the EXIT trap turns any other 0 into 1.
# This test runs the REAL trap line, lifted out of deploy-site.sh, against each way to end:
#   R1 a failed `.`              must exit non-zero
#   R2 an unset variable         must exit non-zero
#   R3 an explicit `exit 3`      must keep 3
#   R4 a finished `exit 0`       must exit 0 (the success path still works)
#   C  CONTROL: the old trap (`trap '_fetch_cleanup' EXIT`) on R1, to show this shell really loses the status.
#      Where the shell keeps it (dash, bash 5), the control cannot show the danger and says so; R1 to R4 still hold.
# End to end, on a COPY of the real deploy-site.sh with one death injected right after its EXIT trap line (a site
# repo, the real tools, a stub vercel; nothing is fetched or deployed, the run dies first):
#   E1 a failed `.`       must exit non-zero with the message
#   E2 an unset variable  must exit non-zero with the message
#   EC CONTROL: the same copy with the old plain trap, on E1 (exits 0 on macOS /bin/sh)
# And one source pin:
#   P  every `exit 0` alone on its line in deploy-site.sh is directly preceded by `_DS_FINISHED=1`. An inline
#      `exit 0` (inside `{ ...; }`) is not seen; it would fail safe, a success reported as a failure.
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

rc=$(run r1 "$TRAP" ". $TMP/no-such-lib.sh")
[ "$rc" != 0 ] && grep -q 'ended without finishing' "$TMP/r1.out" \
  && pass "R1: a failed . exits $rc and says the run did not finish" \
  || bad "R1: a failed . exited $rc: $(cat "$TMP/r1.out")"

rc=$(run r2 "$TRAP" 'echo "$NO_SUCH_VAR_6826"')
[ "$rc" != 0 ] && grep -q 'ended without finishing' "$TMP/r2.out" \
  && pass "R2: an unset variable exits $rc and says the run did not finish" \
  || bad "R2: an unset variable exited $rc: $(cat "$TMP/r2.out")"

rc=$(run r3 "$TRAP" 'exit 3')
[ "$rc" = 3 ] && ! grep -q 'ended without finishing' "$TMP/r3.out" \
  && pass "R3: an explicit exit 3 keeps 3" \
  || bad "R3: an explicit exit 3 became $rc: $(cat "$TMP/r3.out")"

rc=$(run r4 "$TRAP" '_DS_FINISHED=1; exit 0')
[ "$rc" = 0 ] && [ ! -s "$TMP/r4.out" ] \
  && pass "R4: a finished run exits 0 and says nothing" \
  || bad "R4: a finished run exited $rc: $(cat "$TMP/r4.out")"

rc=$(run c "trap '_fetch_cleanup' EXIT" ". $TMP/no-such-lib.sh")
if [ "$rc" = 0 ]; then pass "C: CONTROL: the old trap exits 0 on a failed . on this shell, so R1 is measuring the real danger"
else pass "C: CONTROL: this shell keeps the status even with the old trap (rc=$rc), so R1 cannot show the danger here; it does on macOS /bin/sh"; fi

# E: the real script, copied, with a death injected straight after its trap line.
REPO=$(cd "$HERE/.." && pwd)
mkdir -p "$TMP/site/.vercel" "$TMP/bin"
printf '{}\n' > "$TMP/site/.vercel/project.json"
git -C "$TMP/site" init -q && git -C "$TMP/site" -c user.name=t -c user.email=t@t commit -q --allow-empty -m t
printf '#!/bin/sh\nexit 0\n' > "$TMP/bin/vercel"; chmod +x "$TMP/bin/vercel"
e2e() {   # e2e <name> <injected line> [old]; prints the exit status
  awk -v inj="$2" -v old="${3:-}" '
    /^trap '"'"'_ds_rc=/ { if (old) print "trap '"'"'_fetch_cleanup'"'"' EXIT"; else print; print inj; n++; next }
    { print } END { if (n != 1) exit 3 }' "$DEPLOY" > "$TMP/$1.sh" || { echo "inject-failed"; return; }
  KOSMOS_SITE="$TMP/site" KOSMOS_REPO="$REPO" PATH="$TMP/bin:$PATH" sh "$TMP/$1.sh" > "$TMP/$1.out" 2>&1
  echo $?
}
rc=$(e2e e1 ". $TMP/no-such-lib.sh")
[ "$rc" != 0 ] && [ "$rc" != inject-failed ] && grep -q 'ended without finishing' "$TMP/e1.out" \
  && pass "E1: the real script, dying on a failed . after its trap, exits $rc and says so" \
  || bad "E1: the real script exited $rc: $(tail -3 "$TMP/e1.out")"
rc=$(e2e e2 ': "$NO_SUCH_VAR_6826"')
[ "$rc" != 0 ] && [ "$rc" != inject-failed ] && grep -q 'ended without finishing' "$TMP/e2.out" \
  && pass "E2: the real script, dying on an unset variable after its trap, exits $rc and says so" \
  || bad "E2: the real script exited $rc: $(tail -3 "$TMP/e2.out")"
rc=$(e2e ec ". $TMP/no-such-lib.sh" old)
if [ "$rc" = 0 ]; then pass "EC: CONTROL: the real script with the old trap exits 0 on that death on this shell, so E1 measures the danger"
elif [ "$rc" = inject-failed ]; then bad "EC: could not inject into deploy-site.sh"
else pass "EC: CONTROL: this shell keeps the status with the old trap too (rc=$rc), so E1 cannot show the danger here"; fi

# P: every `exit 0` line (any indent) is directly preceded by a `_DS_FINISHED=1` line.
unflagged=$(awk '{ t = $0; sub(/^[ \t]+/, "", t) } t == "exit 0" && prev != "_DS_FINISHED=1" { print NR } { prev = t }' "$DEPLOY")
exits=$(grep -cE '^[[:space:]]*exit 0$' "$DEPLOY")
[ "$exits" -ge 2 ] && [ -z "$unflagged" ] \
  && pass "P: all $exits success exits in deploy-site.sh set _DS_FINISHED=1 first" \
  || bad "P: success exits without _DS_FINISHED=1 just before them, at lines: ${unflagged:-none} ($exits exit 0 lines)"

echo
[ "$fails" = 0 ] && { echo "test-deploy-site-exit-trap-6826: all passed"; exit 0; }
echo "test-deploy-site-exit-trap-6826: $fails failed"; exit 1
