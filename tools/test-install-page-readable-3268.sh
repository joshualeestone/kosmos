#!/bin/bash
# test-install-page-readable-3268.sh
#
# GUARD for kosmos#3268: the .pkg install-time progress page (installing.html, the
# #3233 download bar) did not show, because install/pkg-scripts/postinstall rendered
# it by dropping to the console user (`sudo -u`) and reading the SOURCE page directly
# from PAGE_SRC -- which lives in the root-owned PKInstallSandbox Scripts dir. The
# console user cannot READ that, so `sed "$0"` failed, the inner `set -e` aborted the
# sub-shell, and "install page opened=0". The fix stages a WORLD-READABLE copy of the
# page AS ROOT (explicit /tmp path, not $TMPDIR which is the same sandbox under
# installd) and renders from that.
#
# This test does NOT need root: the invariant the fix guarantees is that the render
# SOURCE is world-readable (o+r). A mode-600 fixture stands in for the unreadable
# root-owned Scripts file (no o+r bit, exactly like the real source from the console
# user's view). The extracted staging block must turn that into a world-readable copy
# with identical content. If the fix is reverted, the staging block is gone (extraction
# empty -> loud fail) or the render arg points back at the 600 source (structural check
# below fails).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
PI="$REPO/install/pkg-scripts/postinstall"
fails=0
tmpclean=""
cleanup() { [ -n "$tmpclean" ] && /bin/rm -f "$tmpclean" 2>/dev/null; [ -n "${_pr_tmp:-}" ] && /bin/rm -f "$_pr_tmp" 2>/dev/null; }
trap cleanup EXIT INT TERM
[ -f "$PI" ] || { echo "FAIL  postinstall not found at $PI"; exit 1; }

# Extract the staging block: from `_PAGE_READABLE="$PAGE_SRC"` through its closing `fi`
# (2-space indent). If the fix is reverted this is empty and the non-vacuity check fails.
_staging_block() {
  /usr/bin/awk '/^  _PAGE_READABLE="\$PAGE_SRC"$/{f=1} f{print} f&&/^  fi$/{exit}' "$PI"
}
BLOCK="$(_staging_block)"

# A. non-vacuity: the staging block exists (guards a silent revert).
if [ -n "$BLOCK" ]; then
  echo "PASS  the readable-copy staging block was found in postinstall"
else
  echo "FAIL  no readable-copy staging block in postinstall -- the #3268 fix is missing or was reverted (a false pass otherwise)"
  exit 1
fi

# B. the copy goes to an explicit /tmp path, NOT mktemp's default dir ($TMPDIR is the
#    root-owned sandbox under installd, so a temp there would be unreadable too).
if printf '%s\n' "$BLOCK" | /usr/bin/grep -qE 'mktemp[[:space:]]+/tmp/'; then
  echo "PASS  the staging copy uses an explicit /tmp path (not \$TMPDIR/the sandbox)"
else
  echo "FAIL  the staging copy does not use an explicit /tmp path -- under installd \$TMPDIR is the root-owned sandbox and the copy would be unreadable"
  fails=$((fails+1))
fi

# C. behavioural: a mode-600 source (stand-in for the root-owned unreadable page) is
#    turned into a world-readable copy with identical content.
FIX="$(/usr/bin/mktemp /tmp/kosmos-3268-src.XXXXXX)"; tmpclean="$FIX"
printf 'PORT=__KOSMOS_PORT__\n<html>installing</html>\n' > "$FIX"
/bin/chmod 600 "$FIX"   # no o+r: the console user could not read this, like the real Scripts file
PAGE_SRC="$FIX"
_pr_tmp=""
eval "$BLOCK"

if [ "$_PAGE_READABLE" != "$PAGE_SRC" ]; then
  echo "PASS  a copy was staged (_PAGE_READABLE is not the 600 source)"
else
  echo "FAIL  _PAGE_READABLE is still the unreadable source -- the console-user render would fail as before"
  fails=$((fails+1))
fi

# world-readable? (o+r bit set on the staged copy)
if [ "$_PAGE_READABLE" != "$PAGE_SRC" ]; then
  # stat %Sp yields a mode string like -rw-r--r-- ; char 8 is the other-read bit.
  perm="$(/usr/bin/stat -f '%Sp' "$_PAGE_READABLE" 2>/dev/null)"
  other="$(printf '%s' "$perm" | /usr/bin/cut -c8)"
  if [ "$other" = "r" ]; then
    echo "PASS  the staged copy is world-readable (other-read bit set: $perm)"
  else
    echo "FAIL  the staged copy is NOT world-readable ($perm) -- the console user still could not read it"
    fails=$((fails+1))
  fi
  # content identical?
  if /usr/bin/cmp -s "$_PAGE_READABLE" "$PAGE_SRC"; then
    echo "PASS  the staged copy is byte-identical to the source page"
  else
    echo "FAIL  the staged copy differs from the source page"
    fails=$((fails+1))
  fi
fi

# D. structural: the sudo -u render passes the STAGED copy as its source arg, not the
#    raw PAGE_SRC. Guards a revert that keeps the staging block but re-points the render.
if /usr/bin/grep -qE "^  ' \"\\\$_PAGE_READABLE\" \"\\\$PAGE_DIR\"" "$PI"; then
  echo "PASS  the sudo -u render is invoked with \$_PAGE_READABLE (the staged copy) as source"
else
  echo "FAIL  the render's source arg is not \$_PAGE_READABLE -- it may read the root-owned PAGE_SRC directly"
  fails=$((fails+1))
fi

if [ "$fails" -ne 0 ]; then echo "$fails check(s) failed"; exit 1; fi
echo "all install-page readable-copy checks passed"
