#!/usr/bin/env bash
# test-exit-guard-6831.sh - kosmos#6831 (after #6826): a script with `set -e` and an EXIT trap must not exit 0
# when it dies. On bash 3.2 (macOS /bin/sh and /bin/bash) an unset variable or a failed `.` reaches the EXIT trap
# with $? already 0, so without a guard the script exits 0 having stopped part way.
#
#   L  tools/lib/exit-guard.sh under /bin/sh and /bin/bash: a failed `.`, an unset variable and falling off the end
#      unfinished exit 1 with the line; `exit 3` keeps 3; a finished run exits 0; the cleanup runs every time.
#   LC CONTROL: the same deaths with a plain `trap c EXIT` exit 0 on this shell (so L measures the real danger;
#      where a shell keeps the status it says so, and L's arms then check only the non-zero exit).
#   R  release.sh's two EXIT trap lines, lifted from the file and run with a stub cut_record_done: a death RECORDS 1
#      and exits 1; a finished cut records 0; an explicit `exit 3` records 3.
#   P  each guarded script: its guard is installed, and it ends finished (the last executable line is the finish
#      mark, or the mark sits directly before its final `exit 0`).
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
LIB="$HERE/lib/exit-guard.sh"
REL="$HERE/release.sh"
for f in "$LIB" "$REL"; do [ -f "$f" ] || { echo "FAIL: $f not found"; exit 1; }; done

fails=0
pass() { printf 'PASS  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fails=$((fails + 1)); }

TMP=$(mktemp -d "${TMPDIR:-/tmp}/exitguard-6831.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

# LC first: does this shell lose the status at all?
for sh in /bin/sh /bin/bash; do
  "$sh" -c 'set -eu; c(){ :; }; trap c EXIT; . '"$TMP"'/no-such.sh' >/dev/null 2>&1; rc=$?
  if [ "$rc" = 0 ]; then pass "LC: $sh with a plain EXIT trap exits 0 on a failed . (the danger is real here)"; LOSES=1
  else pass "LC: $sh keeps the status even with a plain trap (rc=$rc); L checks only the non-zero exit there"; LOSES=0; fi
  eval "LOSES_$(basename "$sh")=$LOSES"
done

run() {   # run <shell> <body>; prints rc, output in $TMP/out
  "$1" -c "set -eu; . '$LIB'; c(){ echo CLEANED; }; kosmos_exit_guard c t6831; $2" > "$TMP/out" 2>&1
  echo $?
}
for sh in /bin/sh /bin/bash; do
  eval "loses=\$LOSES_$(basename "$sh")"
  said() { [ "$loses" = 0 ] || grep -q 't6831: the run stopped before finishing' "$TMP/out"; }
  for death in ". $TMP/no-such.sh" 'echo "$NO_SUCH_VAR_6831"' 'true'; do
    rc=$(run "$sh" "$death")
    [ "$rc" != 0 ] && said && grep -q CLEANED "$TMP/out" \
      && pass "L: $sh, '$death' (unfinished) exits $rc, says so, and cleans up" \
      || bad "L: $sh, '$death' exited $rc: $(cat "$TMP/out")"
  done
  rc=$(run "$sh" 'exit 3')
  [ "$rc" = 3 ] && grep -q CLEANED "$TMP/out" && ! grep -q 'stopped before' "$TMP/out" \
    && pass "L: $sh, exit 3 keeps 3" || bad "L: $sh, exit 3 became $rc: $(cat "$TMP/out")"
  for fin in 'kosmos_finished; exit 0' 'kosmos_finished'; do
    rc=$(run "$sh" "$fin")
    [ "$rc" = 0 ] && grep -q CLEANED "$TMP/out" && ! grep -q 'stopped before' "$TMP/out" \
      && pass "L: $sh, '$fin' exits 0 and says nothing" || bad "L: $sh, '$fin' exited $rc: $(cat "$TMP/out")"
  done
done

# R: release.sh's own two trap lines.
grep -E "^trap '_rc=\\\$\\?; \\[ \"\\\$_rc\" != 0 \\]" "$REL" > "$TMP/traps"
[ "$(grep -c . "$TMP/traps")" = 2 ] || { bad "R: expected 2 guarded EXIT traps in release.sh, found $(grep -c . "$TMP/traps")"; }
n=0
while IFS= read -r t; do
  n=$((n + 1))
  rel() {   # rel <body>; prints "rc recorded"
    cat > "$TMP/rel.sh" <<EOF
set -eu
cut_record_done() { echo "\$1" > "$TMP/recorded"; }
kosmos_release_machine() { :; }
release_site_restore() { :; }
release_thaw() { :; }
DEPLOYED=1; SITE=; V=; _pair_had=; _ptr_had=; BUILD_ROOT=$TMP/br; _staging_ptr_had=; MAIN_REPO=; BUILD=
_REL_FINISHED=0
$t
$1
EOF
    rm -f "$TMP/recorded"; bash "$TMP/rel.sh" > "$TMP/out" 2>&1; echo "$? $(cat "$TMP/recorded" 2>/dev/null || echo none)"
  }
  r=$(rel ': "$NO_SUCH_VAR_6831"')
  if [ "$LOSES_bash" = 1 ]; then
    [ "$r" = "1 1" ] && grep -q 'release: the cut stopped before finishing' "$TMP/out" \
      && pass "R$n: a cut dying on an unset variable records 1 and exits 1" || bad "R$n: a dying cut gave '$r': $(cat "$TMP/out")"
  else
    [ "${r%% *}" != 0 ] && pass "R$n: a dying cut exits ${r%% *} (this bash keeps the status)" || bad "R$n: '$r'"
  fi
  r=$(rel '_REL_FINISHED=1')
  [ "$r" = "0 0" ] && pass "R$n: a finished cut records 0 and exits 0" || bad "R$n: a finished cut gave '$r': $(cat "$TMP/out")"
  r=$(rel 'exit 3')
  [ "$r" = "3 3" ] && pass "R$n: exit 3 records 3 and exits 3" || bad "R$n: exit 3 gave '$r': $(cat "$TMP/out")"
done < "$TMP/traps"
last=$(grep -vE '^[[:space:]]*(#|$)' "$REL" | tail -1)
[ "$last" = "_REL_FINISHED=1" ] && pass "R: release.sh's last executable line marks the cut finished" \
  || bad "R: release.sh's last executable line is '$last', not _REL_FINISHED=1"

# P: each guarded script installs the guard and ends finished.
for s in build-installer-pkg build-tmux-from-source build-kosmos-bundle build-kosmos-windows dist-retention; do
  f="$HERE/$s.sh"
  grep -qE "^[[:space:]]*kosmos_exit_guard [A-Za-z_]+ $s\$" "$f" || { bad "P: $s.sh does not install the exit guard"; continue; }
  tail2=$(grep -vE '^[[:space:]]*(#|$)' "$f" | tail -2 | tr '\n' '|')
  case "$tail2" in
    *"|kosmos_finished|") pass "P: $s.sh installs the guard and its last line marks it finished" ;;
    "kosmos_finished|exit 0|") pass "P: $s.sh installs the guard and marks it finished before its final exit 0" ;;
    *) bad "P: $s.sh does not end finished (last lines: $tail2)" ;;
  esac
  # no other exit 0 in the script's own flow (outside quotes) once the guard is set
  g=$(grep -n "kosmos_exit_guard " "$f" | head -1 | cut -d: -f1)
  extra=$(awk -v g="$g" 'NR > g { t = $0; sub(/^[ \t]+/, "", t); if (t ~ /^#/) next; r = " " $0; gsub(/'"'"'[^'"'"']*'"'"'/, "", r); gsub(/"([^"\\]|\\.)*"/, "", r); if (r ~ /(^|[;&|{(])[ \t]*exit[ \t]+0([ \t;}&|)]|$)/ && prev != "kosmos_finished") print NR ": " $0 } { prev = t }' "$f")
  [ -z "$extra" ] && pass "P: $s.sh has no unmarked exit 0 after its guard" || bad "P: $s.sh exits 0 without the mark: $extra"
done

echo
[ "$fails" = 0 ] && { echo "test-exit-guard-6831: all passed"; exit 0; }
echo "test-exit-guard-6831: $fails failed"; exit 1
