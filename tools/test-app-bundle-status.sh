#!/bin/sh
# test-app-bundle-status.sh -- unit test for setup.sh's #2028 app-bundle-status
# block: the greppable LOG marker + the update-not-made operator note.
#
# setup.sh is served as a single curl|sh file and sources nothing, so this block
# cannot live in a tools/lib the test could source. Instead we EXTRACT the exact
# shipped bytes of the block from install/setup.sh (the same technique
# test-install.sh uses for the default-port and derivation-formula fragments) and
# drive it through every arm with a stubbed info() and a temp LOG. This tests the
# code that actually ships, not a re-implementation.
set -u

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SETUP="$HERE/install/setup.sh"
[ -f "$SETUP" ] || { echo "FAIL: cannot find install/setup.sh at $SETUP" >&2; exit 1; }

# Extract from the #2028 start marker up to (not including) the next "# ---- "
# section header. Both anchors are unique in setup.sh.
BLOCK="$(awk '
  /^# ---- #2028: make a skipped\/failed app-bundle write VISIBLE/ { f=1 }
  f && /^# ---- the permission acceptance/ { exit }
  f { print }
' "$SETUP")"

if [ -z "$BLOCK" ]; then
  echo "FAIL: could not extract the #2028 app-bundle-status block from setup.sh" >&2
  exit 1
fi
# Guard the extraction itself: it must contain the marker printf and the note, or
# a silently-mismatched anchor would make every assertion below vacuous.
case "$BLOCK" in
  *"app-bundle: made="*) : ;;
  *) echo "FAIL: extracted block is missing the marker printf (anchor drift?)" >&2; exit 1 ;;
esac
case "$BLOCK" in
  *"did not refresh the Kosmos app itself"*) : ;;
  *) echo "FAIL: extracted block is missing the operator note (anchor drift?)" >&2; exit 1 ;;
esac

PASS=0; FAIL=0
TMP="$(mktemp -d "${TMPDIR:-/tmp}/appbundle.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# Run the extracted block once with a given environment. Captures the operator
# note output (stdout of the stubbed info) to $NOTE_OUT and the log marker line
# to $MARK_OUT. Every scenario sets ALL variables the block reads, so set -u
# inside the block is exercised honestly.
run_block() {
  # args: made skip_icon skip_reason fresh sys_stale sys_failed home_foreign logpath
  APP_MADE="$1"; APP_SKIP_ICON="$2"; APP_SKIP_REASON="$3"; FRESH_INSTALL="$4"
  APP_SYS_STALE="$5"; APP_SYS_FAILED="$6"; APP_HOME_FOREIGN="$7"; LOG="$8"
  # info() stubbed to stdout, matching setup.sh's contract (prints, returns 0).
  info() { printf '%s\n' "$*"; }
  # The block runs under setup.sh's `set -euo pipefail`; assert it here so an
  # errexit-unsafe line in the block is caught.
  ( set -eu; eval "$BLOCK" )
}

chk() { # desc  condition-cmd...
  desc="$1"; shift
  if "$@"; then PASS=$((PASS+1)); # echo "ok: $desc"
  else FAIL=$((FAIL+1)); echo "FAIL: $desc" >&2; fi
}

# ---- marker is written on EVERY run, with the actual state -------------------

L="$TMP/log1"; : > "$L"
NOTE="$(run_block yes no none yes no no no "$L")"
MARK="$(cat "$L")"
chk "fresh made=yes: marker records made=yes fresh_install=yes" \
  sh -c 'case "$1" in *"made=yes"*"fresh_install=yes"*) exit 0;; esac; exit 1' _ "$MARK"
chk "fresh made=yes: NO operator note" \
  sh -c '[ -z "$1" ]' _ "$NOTE"

L="$TMP/log2"; : > "$L"
NOTE="$(run_block yes no none no no no no "$L")"
MARK="$(cat "$L")"
chk "update made=yes: marker records made=yes fresh_install=no" \
  sh -c 'case "$1" in *"made=yes"*"fresh_install=no"*) exit 0;; esac; exit 1' _ "$MARK"
chk "update made=yes: NO operator note (bundle was rewritten)" \
  sh -c '[ -z "$1" ]' _ "$NOTE"

# ---- both APP_SKIP_ICON arms on an UPDATE -> marker + note ------------------

L="$TMP/log3"; : > "$L"
NOTE="$(run_block no yes same no no no no "$L")"
MARK="$(cat "$L")"
chk "update skip_icon=same: marker records skip_icon=yes skip_reason=same" \
  sh -c 'case "$1" in *"skip_icon=yes"*"skip_reason=same"*"fresh_install=no"*) exit 0;; esac; exit 1' _ "$MARK"
chk "update skip_icon=same: operator note fires" \
  sh -c 'case "$1" in *"did not refresh the Kosmos app itself"*) exit 0;; esac; exit 1' _ "$NOTE"
chk "update skip_icon=same: note routes to browser / kosmos open, NOT relaunch" \
  sh -c 'case "$1" in *"kosmos open"*) case "$1" in *relaunch*) exit 1;; *) exit 0;; esac;; esac; exit 1' _ "$NOTE"

L="$TMP/log4"; : > "$L"
NOTE="$(run_block no yes unknown no no no no "$L")"
MARK="$(cat "$L")"
chk "update skip_icon=unknown: marker records skip_reason=unknown" \
  sh -c 'case "$1" in *"skip_icon=yes"*"skip_reason=unknown"*) exit 0;; esac; exit 1' _ "$MARK"
chk "update skip_icon=unknown: operator note fires" \
  sh -c 'case "$1" in *"did not refresh the Kosmos app itself"*) exit 0;; esac; exit 1' _ "$NOTE"

# ---- the other not-made arms on an UPDATE also fire the note ----------------

L="$TMP/log5"; : > "$L"
NOTE="$(run_block no no none no no no yes "$L")"
MARK="$(cat "$L")"
chk "update home_foreign: marker records home_foreign=yes made=no" \
  sh -c 'case "$1" in *"made=no"*"home_foreign=yes"*) exit 0;; esac; exit 1' _ "$MARK"
chk "update home_foreign: operator note fires" \
  sh -c 'case "$1" in *"did not refresh the Kosmos app itself"*) exit 0;; esac; exit 1' _ "$NOTE"

L="$TMP/log6"; : > "$L"
NOTE="$(run_block no no none no swap yes no "$L")"
MARK="$(cat "$L")"
chk "update make_app-failed: marker records made=no sys_stale=swap sys_failed=yes" \
  sh -c 'case "$1" in *"made=no"*"sys_stale=swap"*"sys_failed=yes"*) exit 0;; esac; exit 1' _ "$MARK"
chk "update make_app-failed: operator note fires" \
  sh -c 'case "$1" in *"did not refresh the Kosmos app itself"*) exit 0;; esac; exit 1' _ "$NOTE"

# ---- control: FRESH install that did NOT make the bundle must NOT note ------
# (a fresh install has no previous bundle to be stale; the note is update-only)

L="$TMP/log7"; : > "$L"
NOTE="$(run_block no no none yes no yes no "$L")"
MARK="$(cat "$L")"
chk "fresh made=no: marker still records made=no fresh_install=yes" \
  sh -c 'case "$1" in *"made=no"*"fresh_install=yes"*) exit 0;; esac; exit 1' _ "$MARK"
chk "fresh made=no: NO operator note (control -- gate is fresh_install=no)" \
  sh -c '[ -z "$1" ]' _ "$NOTE"

# ---- errexit safety: an unwritable LOG must not abort the block ------------
# The marker redirect is `>> "$LOG" 2>/dev/null || true`; point LOG at a path
# under a non-existent dir so the redirect fails, and confirm the block still
# completes (exit 0) AND still emits the operator note.
BADLOG="$TMP/nonexistent-dir/log"
NOTE="$(run_block no yes same no no no no "$BADLOG")"; RC=$?
chk "unwritable LOG: block does not abort under set -e (redirect guarded)" \
  sh -c '[ "$1" = 0 ]' _ "$RC"
chk "unwritable LOG: operator note still fires" \
  sh -c 'case "$1" in *"did not refresh the Kosmos app itself"*) exit 0;; esac; exit 1' _ "$NOTE"

# ---- negative control: prove chk CAN fail ----------------------------------
# (a silent test harness returns clean the same way a real pass does)
NEG=0
( info() { :; }; case "x" in *"never-appears-token"*) exit 0;; esac; exit 1 ) || NEG=1
chk "negative control: a false condition is actually detected" \
  sh -c '[ "$1" = 1 ]' _ "$NEG"

echo "test-app-bundle-status: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
