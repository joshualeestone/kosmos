#!/bin/bash
# kosmos#6275: tools/test-install.sh and install/setup.sh must name the same board login job for any TMPDIR. The cut's
# install gate (step 4b) computes the label from "$SB/home" (BOARD_LABEL_SUFFIX), while setup.sh squeezes repeated
# slashes out of KOSMOS_HOME and drops a trailing one before computing its label. macOS's TMPDIR ends in '/', so a
# harness that templated at "$TMPDIR/x" put '//' in $SB, the two labels differed, and every login-job check failed
# (#6252, a regression of #4298).
#
# Nothing else in CI sees this: the suite and CI run under run-tests.sh's own TMPDIR, which has no trailing slash. So
# this runs, as written in their files, the harness's sandbox-root derivation and its BOARD_LABEL_SUFFIX line, and
# setup.sh's KOSMOS_HOME normalization and its board label line, under TMPDIRs a cut shell can have, and compares the
# two labels.
#
# Arms: each TMPDIR shape gives a $SB with no '//' and one label on both sides; a REVERTED derivation (the slash handling
# removed) is caught on the macOS shape, so a clean result is not a silent instrument.
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
# setup.sh's normalization of KOSMOS_HOME (its two lines) and its board label (the first such line), as written.
norm="$(grep -E '^KOSMOS_HOME="\$\(printf .%s. "\$KOSMOS_HOME" \| /usr/bin/tr -s ./.\)"$|^KOSMOS_HOME="\$\{KOSMOS_HOME%/\}"$' install/setup.sh)"
slabels="$(grep -E '^[[:space:]]*_board_label="com\.kosmos\.board\.\$\(printf' install/setup.sh | sed 's/^[[:space:]]*//')"
slabel="$(printf '%s\n' "$slabels" | sed -n 1p)"
# The KOSMOS_HOME the harness's install runs under: its first export of it, the one BOARD_LABEL_SUFFIX is for.
hhome="$(grep -m1 -E '^export KOSMOS_HOME=' tools/test-install.sh)"
# The harness's label line, as written (any form: a change to what it hashes must reach the comparison).
hlabel="$(grep -E '^BOARD_LABEL_SUFFIX=' tools/test-install.sh)"
# Floors: a lift that found nothing would pass every arm below vacuously.
if [ "$(printf '%s\n' "$derive" | wc -l | tr -d ' ')" -ge 2 ] && printf '%s\n' "$derive" | grep -q '^SB="$(mktemp -d' && [ "$(printf '%s\n' "$derive" | wc -l | tr -d ' ')" -le 8 ]; then
  ok "lifted the harness's sandbox-root derivation ($(printf '%s\n' "$derive" | wc -l | tr -d ' ') lines)"
elif grep -q '^SB="$(mktemp -d' tools/test-install.sh; then
  bad "the harness's sandbox-root derivation changed shape (its first line is no longer the squeezed TMPDIR): check that \$SB still has no '//' under a TMPDIR ending in '/' (#6252), then update this lift"
else
  bad "could not find the harness's sandbox-root derivation in tools/test-install.sh"
fi
[ "$(printf '%s\n' "$norm" | wc -l | tr -d ' ')" -eq 2 ] \
  && ok "lifted setup.sh's KOSMOS_HOME normalization (2 lines)" \
  || bad "could not lift setup.sh's KOSMOS_HOME normalization (expected 2 lines): $norm"
# setup.sh computes the label in more than one place: they must all be the one line lifted here.
[ -n "$slabel" ] && printf '%s' "$slabel" | grep -q 'KOSMOS_HOME' && [ "$(printf '%s\n' "$slabels" | sort -u | grep -c .)" -eq 1 ] \
  && ok "lifted setup.sh's board label line ($(printf '%s\n' "$slabels" | grep -c .) identical places)" \
  || bad "setup.sh's board label lines are missing or differ from one another: $slabels"
printf '%s' "$hhome" | grep -q '"\$SB/' && ok "lifted the harness's KOSMOS_HOME export" || bad "could not lift the harness's first KOSMOS_HOME export: $hhome"
[ "$(printf '%s\n' "$hlabel" | grep -c .)" -eq 1 ] && ok "lifted the harness's BOARD_LABEL_SUFFIX line" || bad "expected one BOARD_LABEL_SUFFIX line in tools/test-install.sh: $hlabel"

# Runs a derivation under one TMPDIR. Prints "$SB", the harness's label and setup.sh's label (for the KOSMOS_HOME the
# harness exports), one per line, or the harness's own refusal (exit non-zero). setup.sh is POSIX sh, so its lines run
# under sh.
run() {   # $1 derivation  $2 TMPDIR
  local out sb hl sl
  out="$(TMPDIR="$2" bash -c "$1"'
printf "%s\n" "$SB"
'"$hlabel"'
printf "com.kosmos.board.%s\n" "$BOARD_LABEL_SUFFIX"' 2>&1)" || { printf '%s\n' "$out"; return 1; }
  sb="$(printf '%s\n' "$out" | sed -n 1p)"; hl="$(printf '%s\n' "$out" | sed -n 2p)"
  # setup.sh runs with the KOSMOS_HOME the harness exports for its install, as the harness writes it.
  sl="$(SB="$sb" sh -c "$hhome"'
'"$norm"'
'"$slabel"'
printf "%s\n" "$_board_label"')"
  printf '%s\n%s\n%s\n' "$sb" "$hl" "$sl"
}
# One arm: a $SB was made, under the squeezed TMPDIR, with no '//', and both sides name the same login job.
arm() {   # $1 label  $2 TMPDIR  $3 the parent $SB must have
  local out sb hl sl
  out="$(run "$derive" "$2")" || { bad "$1: the harness refused or failed (TMPDIR=$2): $out"; return; }
  sb="$(printf '%s\n' "$out" | sed -n 1p)"; hl="$(printf '%s\n' "$out" | sed -n 2p)"; sl="$(printf '%s\n' "$out" | sed -n 3p)"
  case "$sb" in *//*) bad "$1: \$SB has '//' ($sb)"; return ;; esac
  [ -d "$sb" ] && [ "$(dirname "$sb")" = "$3" ] || { bad "$1: \$SB is not a new folder under $3 ($sb)"; return; }
  case "$hl" in com.kosmos.board.????????) ;; *) bad "$1: the harness's label is not a board label ($hl)"; return ;; esac
  [ "$hl" = "$sl" ] && ok "$1: \$SB=$sb, and both name $hl" \
    || bad "$1: the harness names $hl but setup.sh names $sl for the same \$SB, so every login-job check would fail"
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
  sb="$(printf '%s\n' "$out" | sed -n 1p)"; hl="$(printf '%s\n' "$out" | sed -n 2p)"; sl="$(printf '%s\n' "$out" | sed -n 3p)"
  case "$sb" in *//*) [ -n "$hl" ] && [ "$hl" != "$sl" ] && ok "NEGATIVE CONTROL: a reverted derivation gives '//' and two different labels ($hl, $sl)" \
      || bad "NEGATIVE CONTROL: '//' in \$SB but the labels agreed ($hl, $sl), so this check could not see the #6252 failure" ;;
    *) bad "NEGATIVE CONTROL: the reverted derivation had no '//' under a trailing-slash TMPDIR ($sb), so this check proves nothing" ;;
  esac
fi

[ "$FAILS" -eq 0 ] && echo "all passed" || { echo "$FAILS FAILED"; exit 1; }
