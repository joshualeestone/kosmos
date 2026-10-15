#!/bin/bash
# kosmos#6275: tools/test-install.sh must derive its sandbox root so that "$SB/home" is exactly what install/setup.sh
# makes of it, for any TMPDIR. The cut's install gate (step 4b) hashes "$SB/home" as written into the board's login-job
# label (BOARD_LABEL_SUFFIX), while setup.sh squeezes repeated slashes out of KOSMOS_HOME and drops a trailing one
# before hashing. macOS's TMPDIR ends in '/', so a harness that templated at "$TMPDIR/x" put '//' in $SB, the two
# hashes named different plists, and every login-job check failed (#6252, a regression of #4298).
#
# Nothing else in CI sees this: the suite and CI run under run-tests.sh's own TMPDIR, which has no trailing slash. So
# this runs the harness's REAL derivation (lifted from tools/test-install.sh between its anchors) and setup.sh's REAL
# normalization (lifted the same way) under TMPDIRs a cut shell can have, and compares the two hash inputs.
#
# Arms: each TMPDIR shape gives a $SB with no '//' whose "$SB/home" setup.sh leaves unchanged; a REVERTED derivation
# (the slash handling removed) is caught on the macOS shape, so a clean result is not a silent instrument.
#
#   bash tools/test-install-sbroot-6275.sh
set -u
cd "$(dirname "$0")/.." || exit 1
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/install-sbroot-6275.XXXXXXXXXX")" || { echo "FAIL  no scratch dir"; exit 1; }
trap 'rm -rf "$T"' EXIT
# This shell's own TMPDIR may end in '/' too (it does on macOS); the expected parents below are written without '//'.
T="$(printf '%s' "$T" | tr -s '/')"

# The harness's derivation, as written in tools/test-install.sh: from its first line to the mktemp that makes $SB, and
# the '//' refusal right after it when it is there (a revert that drops it is then caught by the '//', not the lift).
derive="$(awk '/^_ti_tmp="\$\(printf .%s. "\$\{TMPDIR:-\/tmp\}"/{p=1} p&&!m{print} p && /^SB="\$\(mktemp -d /{m=1; next} m{ if ($0 ~ /^case "\$SB" in /) print; exit }' tools/test-install.sh)"
# setup.sh's normalization of KOSMOS_HOME: its two lines, as written.
norm="$(grep -E '^KOSMOS_HOME="\$\(printf .%s. "\$KOSMOS_HOME" \| /usr/bin/tr -s ./.\)"$|^KOSMOS_HOME="\$\{KOSMOS_HOME%/\}"$' install/setup.sh)"
# Floors: a lift that found nothing would pass every arm below vacuously.
[ "$(printf '%s\n' "$derive" | wc -l | tr -d ' ')" -ge 2 ] && printf '%s\n' "$derive" | grep -q '^SB="$(mktemp -d' && [ "$(printf '%s\n' "$derive" | wc -l | tr -d ' ')" -le 8 ] \
  && ok "lifted the harness's sandbox-root derivation ($(printf '%s\n' "$derive" | wc -l | tr -d ' ') lines)" \
  || bad "could not lift the derivation from tools/test-install.sh (its anchors moved): $derive"
[ "$(printf '%s\n' "$norm" | wc -l | tr -d ' ')" -eq 2 ] \
  && ok "lifted setup.sh's KOSMOS_HOME normalization (2 lines)" \
  || bad "could not lift setup.sh's KOSMOS_HOME normalization (expected 2 lines): $norm"

# Runs a derivation under one TMPDIR; prints "$SB" and setup.sh's form of "$SB/home", one per line, or exits non-zero
# (the harness's own refusal included).
run() {   # $1 derivation  $2 TMPDIR
  TMPDIR="$2" bash -c "$1"'
printf "%s\n" "$SB"
KOSMOS_HOME="$SB/home"
'"$norm"'
printf "%s\n" "$KOSMOS_HOME"' 2>/dev/null
}
# One arm: a $SB was made, under the squeezed TMPDIR, with no '//', and setup.sh leaves "$SB/home" as the harness has it.
arm() {   # $1 label  $2 TMPDIR  $3 the parent $SB must have
  local out sb home
  out="$(run "$derive" "$2")" || { bad "$1: the derivation refused or failed (TMPDIR=$2)"; return; }
  sb="$(printf '%s\n' "$out" | sed -n 1p)"; home="$(printf '%s\n' "$out" | sed -n 2p)"
  case "$sb" in *//*) bad "$1: \$SB has '//' ($sb)"; return ;; esac
  [ -d "$sb" ] && [ "$(dirname "$sb")" = "$3" ] || { bad "$1: \$SB is not a new folder under $3 ($sb)"; return; }
  [ "$home" = "$sb/home" ] && ok "$1: \$SB=$sb, and setup.sh hashes \"\$SB/home\" as the harness does" \
    || bad "$1: setup.sh makes \"$sb/home\" into \"$home\", so the two login-job labels differ"
}
mkdir -p "$T/mac" "$T/in/ner" "$T/plain"
arm "a macOS TMPDIR (ends in '/')"   "$T/mac/"       "$T/mac"
arm "a '//' inside TMPDIR"           "$T//in//ner/"  "$T/in/ner"
arm "CONTROL: a TMPDIR with no slash at the end" "$T/plain" "$T/plain"

# NEGATIVE CONTROL: the derivation with its slash handling taken out (the #4298 shape: template at "$TMPDIR/x" as
# given, no refusal) must be caught on the macOS shape. Each removal is checked to have happened, so a lift that no
# longer matches these lines cannot turn this arm into a pass.
reverted="$(printf '%s\n' "$derive" | sed -e '/^_ti_tmp="\${_ti_tmp%\/}"$/d' -e 's#| /usr/bin/tr -s ./.##' -e '/^case "\$SB" in/d')"
if [ "$reverted" = "$derive" ] || printf '%s' "$reverted" | grep -q 'tr -s' || printf '%s' "$reverted" | grep -q '_ti_tmp%/'; then
  bad "NEGATIVE CONTROL: could not build the reverted derivation (the lines it removes changed)"
else
  out="$(run "$reverted" "$T/mac/")"
  sb="$(printf '%s\n' "$out" | sed -n 1p)"; home="$(printf '%s\n' "$out" | sed -n 2p)"
  case "$sb" in *//*) [ "$home" != "$sb/home" ] && ok "NEGATIVE CONTROL: a reverted derivation gives '//' and a label setup.sh does not make ($sb)" \
      || bad "NEGATIVE CONTROL: '//' in \$SB but setup.sh agreed, so this check could not see the #6252 failure" ;;
    *) bad "NEGATIVE CONTROL: the reverted derivation had no '//' under a trailing-slash TMPDIR ($sb), so this check proves nothing" ;;
  esac
fi

[ "$FAILS" -eq 0 ] && echo "all passed" || { echo "$FAILS FAILED"; exit 1; }
