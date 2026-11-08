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
elif [ "$(printf '%s\n' "$derive" | wc -l | tr -d ' ')" -gt 8 ] && printf '%s\n' "$derive" | grep -q '^SB="$(mktemp -d'; then
  bad "the harness's sandbox-root derivation grew past 8 lines: check that it still makes \$SB with no '//' (#6252), then raise this floor"
elif grep -q '^SB="$(mktemp -d' tools/test-install.sh; then
  bad "the harness's sandbox-root derivation changed shape (its first line is no longer the squeezed TMPDIR): check that \$SB still has no '//' under a TMPDIR ending in '/' (#6252), then update this lift"
else
  bad "could not find the harness's sandbox-root derivation in tools/test-install.sh"
fi
# setup.sh assigns KOSMOS_HOME in exactly three places: the default and these two lines. A new assignment (a resolved
# path, say, or one inside an if on one line) would change the label without this lift seeing it, so the count is
# pinned. Counted: any KOSMOS_HOME= at the start of a line or after a space or ';' (export, readonly and local
# included), comment lines left out. Not counted: an assignment spelled another way (read, eval, printf -v).
kh_sets="$(grep -vE '^[[:space:]]*#' install/setup.sh | grep -cE '(^|[;[:space:]])(export[[:space:]]+|readonly[[:space:]]+|local[[:space:]]+)?KOSMOS_HOME=')"
[ "$kh_sets" -eq 3 ] && ok "setup.sh assigns KOSMOS_HOME in 3 places (the default and the 2 lifted)" \
  || bad "setup.sh now assigns KOSMOS_HOME in $kh_sets places, not 3: lift the new one here so the label comparison sees it"
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
'"$hhome"'
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
arm() {   # $1 label  $2 TMPDIR  $3 the parent $SB must have  [$4 lines run before the derivation, e.g. MACOS_MKTEMP]
  local out sb hl sl
  out="$(run "${4:+$4
}$derive" "$2")" || { bad "$1: the harness refused or failed (TMPDIR=$2): $out"; return; }
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

# kosmos#8244: macOS's mktemp (and GNU's on ubuntu-24.04) keeps a '//' in the template it is given; the mktemp on
# ubuntu-26.04 returns the path squeezed, so there a reverted derivation made no '//' and this check could see nothing.
# MACOS_MKTEMP stands in for mktemp -d in the runs below that ask for it: the folder is made at the template exactly as
# given, its ten X's filled in, as macOS does. It refuses any other call, so a template that changed shape fails here.
MACOS_MKTEMP='mktemp() {
  [ "$#" -eq 2 ] && [ "$1" = -d ] || { echo "MACOS_MKTEMP: only mktemp -d <template> is stood in for: $*" >&2; return 1; }
  case "$2" in *XXXXXXXXXX) ;; *) echo "MACOS_MKTEMP: the template does not end in ten X: $2" >&2; return 1 ;; esac
  local _r; _r="$(LC_ALL=C tr -dc A-Za-z0-9 </dev/urandom | head -c 10)"
  mkdir "${2%XXXXXXXXXX}$_r" && printf "%s\n" "${2%XXXXXXXXXX}$_r"
}'
# The stand-in itself, checked on the shape that matters: it keeps the '//' it is handed.
sim="$(TMPDIR="$T/mac/" bash -c "$MACOS_MKTEMP"'
mktemp -d "$TMPDIR/x.XXXXXXXXXX"')"
case "$sim" in "$T/mac//x."??????????) [ -d "$sim" ] && ok "CONTROL: the macOS mktemp stand-in keeps '//' ($sim)" \
    || bad "CONTROL: the macOS mktemp stand-in made no folder ($sim)" ;;
  *) bad "CONTROL: the macOS mktemp stand-in did not keep the template as given ($sim)" ;; esac
# The fixed derivation under the stand-in: it squeezes before mktemp, so it holds on macOS's mktemp too.
arm "under macOS's mktemp: a TMPDIR ending in '/'" "$T/mac/" "$T/mac" "$MACOS_MKTEMP"

# NEGATIVE CONTROL: the derivation with its slash handling taken out (the #4298 shape: template at "$TMPDIR/x" as
# given, no refusal) must be caught on the macOS shape. Each removal is checked to have happened, so a lift that no
# longer matches these lines cannot turn this arm into a pass. It runs under the macOS mktemp stand-in (#8244), so it
# shows the defect whichever mktemp this machine has.
reverted="$(printf '%s\n' "$derive" | sed -e '/^_ti_tmp="\${_ti_tmp%\/}"$/d' -e 's#| /usr/bin/tr -s ./.##' -e '/^case "\$SB" in/d')"
if [ "$reverted" = "$derive" ] || printf '%s' "$reverted" | grep -q 'tr -s' || printf '%s' "$reverted" | grep -q '_ti_tmp%/'; then
  bad "NEGATIVE CONTROL: could not build the reverted derivation (the lines it removes changed)"
else
  out="$(run "$MACOS_MKTEMP
$reverted" "$T/mac/")"
  sb="$(printf '%s\n' "$out" | sed -n 1p)"; hl="$(printf '%s\n' "$out" | sed -n 2p)"; sl="$(printf '%s\n' "$out" | sed -n 3p)"
  case "$sb" in *//*) [ -n "$hl" ] && [ "$hl" != "$sl" ] && ok "NEGATIVE CONTROL: a reverted derivation gives '//' and two different labels ($hl, $sl)" \
      || bad "NEGATIVE CONTROL: '//' in \$SB but the labels agreed ($hl, $sl), so this check could not see the #6252 failure" ;;
    *) bad "NEGATIVE CONTROL: the reverted derivation had no '//' under a trailing-slash TMPDIR ($sb), so this check proves nothing" ;;
  esac
fi

[ "$FAILS" -eq 0 ] && echo "all passed" || { echo "$FAILS FAILED"; exit 1; }
