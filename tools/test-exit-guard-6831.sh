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
  # Falling off the end unfinished ('true') always goes through the conversion, whatever the shell, so its line
  # is required everywhere; the two deaths print it only where the shell loses the status.
  for death in ". $TMP/no-such.sh" 'echo "$NO_SUCH_VAR_6831"' 'true'; do
    rc=$(run "$sh" "$death")
    if [ "$death" = true ]; then sd() { grep -q 't6831: the run stopped before finishing' "$TMP/out"; }; else sd() { said; }; fi
    [ "$rc" != 0 ] && sd && grep -q CLEANED "$TMP/out" \
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
  # A cleanup that fails does not stop the conversion, and does not turn a finished run into a failure.
  "$sh" -c "set -eu; . '$LIB'; c(){ false; }; kosmos_exit_guard c t6831; true" > "$TMP/out" 2>&1; rc=$?
  [ "$rc" = 1 ] && grep -q 't6831: the run stopped before finishing' "$TMP/out" \
    && pass "L: $sh, a failing cleanup still lets an unfinished run exit 1 with its line" || bad "L: $sh, failing cleanup + unfinished gave $rc: $(cat "$TMP/out")"
  "$sh" -c "set -eu; . '$LIB'; c(){ false; }; kosmos_exit_guard c t6831; kosmos_finished" > "$TMP/out" 2>&1; rc=$?
  [ "$rc" = 0 ] && pass "L: $sh, a failing cleanup does not fail a finished run" || bad "L: $sh, failing cleanup + finished gave $rc: $(cat "$TMP/out")"
  # A cleanup that dies on an unset variable (a fatal shell error, not a return code) is contained too.
  "$sh" -c "set -eu; . '$LIB'; c(){ echo \"\$NO_SUCH_VAR_6831\"; }; kosmos_exit_guard c t6831; kosmos_finished" > "$TMP/out" 2>&1; rc=$?
  [ "$rc" = 0 ] && pass "L: $sh, a cleanup dying on an unset variable does not fail a finished run" || bad "L: $sh, dying cleanup + finished gave $rc: $(cat "$TMP/out")"
  "$sh" -c "set -eu; . '$LIB'; c(){ echo \"\$NO_SUCH_VAR_6831\"; }; kosmos_exit_guard c t6831; true" > "$TMP/out" 2>&1; rc=$?
  [ "$rc" = 1 ] && grep -q 't6831: the run stopped before finishing' "$TMP/out" \
    && pass "L: $sh, a cleanup dying on an unset variable still lets an unfinished run say so" || bad "L: $sh, dying cleanup + unfinished gave $rc: $(cat "$TMP/out")"
done

# R: release.sh's own two trap lines, run by the `bash` on PATH (what `bash tools/release.sh` uses), so the
# "does this shell lose the status" probe uses that same interpreter, not /bin/bash.
bash -c 'set -eu; c(){ :; }; trap c EXIT; : "$NO_SUCH_VAR_6831"' >/dev/null 2>&1 && LOSES_rel=1 || LOSES_rel=0
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
  if [ "$LOSES_rel" = 1 ]; then
    [ "$r" = "1 1" ] && grep -q 'release: the cut stopped before finishing' "$TMP/out" \
      && pass "R$n: a cut dying on an unset variable records 1 and exits 1" || bad "R$n: a dying cut gave '$r': $(cat "$TMP/out")"
  else
    [ "${r%% *}" != 0 ] && pass "R$n: a dying cut exits ${r%% *} (this bash keeps the status)" || bad "R$n: '$r'"
  fi
  # With stderr closed the trap's message cannot be written; the cut must still be recorded as failed.
  rm -f "$TMP/recorded"; bash "$TMP/rel.sh" > "$TMP/out" 2>&-; rc=$?; got=$(cat "$TMP/recorded" 2>/dev/null || echo none)
  if [ "$LOSES_rel" = 1 ]; then
    [ "$rc $got" = "1 1" ] && pass "R$n: with stderr closed, a dying cut is still recorded as 1 and exits 1" \
      || bad "R$n: with stderr closed a dying cut gave rc=$rc recorded=$got"
  fi
  r=$(rel '_REL_FINISHED=1')
  [ "$r" = "0 0" ] && pass "R$n: a finished cut records 0 and exits 0" || bad "R$n: a finished cut gave '$r': $(cat "$TMP/out")"
  r=$(rel 'exit 3')
  [ "$r" = "3 3" ] && pass "R$n: exit 3 records 3 and exits 3" || bad "R$n: exit 3 gave '$r': $(cat "$TMP/out")"
done < "$TMP/traps"
# After release.sh's first guarded trap, no literal `exit 0` and no bare `exit` in its own flow (outside quotes):
# either would end a good cut unmarked. Its claim-renewer subshell, with its own `exit 0`s, sits before that trap.
# `exit "$_vdep_rc"` is allowed: it is the failed-deploy branch, which carries the deploy's non-zero code.
g=$(grep -nE "^trap '_rc=\\\$\\?; \\[ \"\\\$_rc\" != 0 \\]" "$REL" | head -1 | cut -d: -f1)
relx=$(awk -v g="${g:-0}" 'NR > g { t = $0; sub(/^[ \t]+/, "", t); if (t ~ /^#/) next
    r = " " $0; gsub(/'"'"'[^'"'"']*'"'"'/, "Q", r); gsub(/"([^"\\]|\\.)*"/, "Q", r)
    if (r ~ /(^|[;&|{(]|[ \t](then|else|do))[ \t]*exit([ \t]+0)?([ \t]*[;}&|)]|[ \t]*$)/) print NR ": " $0 }' "$REL")
[ -n "$g" ] && [ -z "$relx" ] && pass "R: release.sh has no exit 0 or bare exit after its guarded trap (line $g)" \
  || bad "R: release.sh exits that would end a good cut unmarked (guard at line ${g:-none}): $relx"
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
  # After the guard, every exit in the script's own flow (outside quotes) is a literal non-zero code, or `exit 0`
  # directly after the mark. A bare `exit` or `exit "$var"` could carry 0 on a success path, so it is reported.
  g=$(grep -n "kosmos_exit_guard " "$f" | head -1 | cut -d: -f1)
  extra=$(awk -v g="$g" 'NR > g { t = $0; sub(/^[ \t]+/, "", t); if (t ~ /^#/) { prev = t; next }
      r = " " $0; gsub(/'"'"'[^'"'"']*'"'"'/, "Q", r); gsub(/"([^"\\]|\\.)*"/, "Q", r)
      while (match(r, /(^|[;&|{(]|[ \t](then|else|do))[ \t]*exit([ \t]+[^ \t;}&|)]+)?/)) {
        m = substr(r, RSTART, RLENGTH); r = substr(r, RSTART + RLENGTH); sub(/^[;&|{( \t]*((then|else|do)[ \t]+)?exit[ \t]*/, "", m)
        if (m ~ /^[1-9][0-9]*$/) continue
        if (m == "0" && t == "exit 0" && prev == "kosmos_finished") continue
        print NR ": " $0 } }
    { prev = t }' "$f")
  [ -z "$extra" ] && pass "P: $s.sh has no exit after its guard that could end a success unmarked" || bad "P: $s.sh exits without the mark: $extra"
done

# The Windows builder's cleanup removes $TMP only once the script made it: the flag must be set on the line right
# after that mktemp, never before (an inherited TMP would then be removed).
wb="$HERE/build-kosmos-windows.sh"
awk 'p ~ /^TMP="\$\(mktemp -d\)"$/ && $0 ~ /^_win_tmp_made=1/ { ok = 1 } { p = $0 } END { exit !ok }' "$wb" \
  && [ "$(grep -c '^_win_tmp_made=1' "$wb")" = 1 ] \
  && pass "P: build-kosmos-windows.sh sets _win_tmp_made=1 only on the line after TMP=\$(mktemp -d)" \
  || bad "P: build-kosmos-windows.sh's _win_tmp_made=1 is not exactly once, directly after TMP=\$(mktemp -d)"

echo
[ "$fails" = 0 ] && { echo "test-exit-guard-6831: all passed"; exit 0; }
echo "test-exit-guard-6831: $fails failed"; exit 1
