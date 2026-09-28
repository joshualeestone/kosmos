#!/bin/bash
# #4298: no script under tools/, install/ or bin/ may call `mktemp` without a path template.
#
# macOS `mktemp` ignores TMPDIR, so a bare `mktemp -d` (or `-t name`) lands in the
# real per-user temp root, outside the per-run root tools/run-tests.sh sets, and
# stays there unless the script removes it (#4273). A positional template such as
# "${TMPDIR:-/tmp}/<name>.XXXXXXXXXX" lands under TMPDIR, and its name says which
# script left it.
#
# Arms: the tree is clean, the checker FINDS each bare shape (so a clean result is
# not a silent instrument), it does NOT flag templated calls or the word in a
# message, and the scope is the population it claims.
set -u
cd "$(dirname "$0")/.." || exit 1
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/mktemp-template-4298.XXXXXXXXXX")" || { echo "FAIL  no scratch dir"; exit 1; }
trap 'rm -rf "$T"' EXIT

# The scope: every script under tools/ and its lib, not only the tests, plus the
# installer and bin scripts: the suite runs release.sh, verify-served.sh, the build
# scripts and the pkg postinstall too, and measured, those left most of the tmp.* a
# run made. A glob that matched nothing would pass the
# clean arm vacuously, so it carries a floor.
scope=()
for f in tools/*.sh tools/lib/*.sh install/*.sh install/kosmos install/pkg-scripts/* bin/*.sh; do
  # This file's own fixtures below are bare on purpose.
  [ "$f" = "tools/test-mktemp-template-4298.sh" ] || scope+=("$f")
done
[ "${#scope[@]}" -ge 150 ] && [ -f "${scope[0]}" ] \
  && ok "the scope holds ${#scope[@]} scripts (floor 150)" \
  || bad "the scope glob matched ${#scope[@]} files; the clean arm would prove nothing"

out="$(node tools/mktemp-template-check.js "${scope[@]}" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "no script under tools/, install/ or bin/ calls mktemp without a path template" \
  || bad "template-less mktemp calls (give each \"\${TMPDIR:-/tmp}/<name>.XXXXXXXXXX\"):
$out"

# NEGATIVE CONTROL: each bare shape must be found, by its own line number, so one
# line hitting twice can never cover for a shape that was missed.
cat > "$T/bare.sh" <<'SH'
a="$(mktemp -d)"
b="$(mktemp)"
c=`mktemp -d`
d="$(mktemp -t kosmos)"
e="$(mktemp -d -t kosmos)"
mktemp -d >/dev/null
f=$(mktemp -d) && g=1
h="$(/usr/bin/mktemp -d)"
i="$(mktemp 2>/dev/null || echo /tmp/x)"
j="$(command mktemp -d)"
k="$(env mktemp -d)"
l="$(TMPDIR=/x mktemp -d)"
if mktemp -d >/dev/null; then :; fi
{ mktemp -d; } >/dev/null
m="$(mktemp -dt kosmos)"
n="$(mktemp \
  -d)"
bash -c 'o=$(mktemp -d); echo "$o"'
sh -ec "o=\$(mktemp -d)"
x) mktemp -d >/dev/null ;;
r="$(nice -n 19 mktemp -d)"
s="$(sudo -u "$U" mktemp)"
eval 'u=$(mktemp -d)'
trap 'v=$(mktemp)' EXIT
w="$(mktemp -d -t "$(basename "$0")")"
"mktemp" -d >/dev/null
bash -c 'mktemp -d >/dev/null'
eval "mktemp -d"
timeout 5 mktemp -d >/dev/null
SH
got="$(node tools/mktemp-template-check.js "$T/bare.sh" | cut -d: -f2 | sort -n | tr '\n' ' ')"
want="1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 18 19 20 21 22 23 24 25 26 27 28 29 "
[ "$got" = "$want" ] && ok "CONTROL: all 28 bare shapes are found, each on its own line" \
  || bad "CONTROL: bare shapes found on lines [$got], want [$want]"

# The other side: templated calls and mentions are not calls to fix.
cat > "$T/good.sh" <<'SH'
a="$(mktemp -d "${TMPDIR:-/tmp}/x.XXXXXXXXXX")"
b="$(mktemp "$out.archive.XXXXXX")"
c="$(mktemp -d /tmp/cutguard-frozen.XXXXXX)"
j="$(/usr/bin/mktemp /tmp/kosmos-installing.XXXXXX 2>/dev/null || true)"
echo "FAIL  mktemp failed, so nothing ran"
echo "if mktemp fails, nothing ran"
echo "then mktemp -d is what failed"
: # if mktemp -d
echo 'if mktemp -d' # while mktemp -t x
bash -c 'q=$(mktemp -d "${TMPDIR:-/tmp}/z.XXXXXXXXXX")'
grep -c 'mktemp -d' /dev/null
if command -v mktemp >/dev/null 2>&1; then :; fi
echo "mktemp -d failed" >&2
x='mktemp'
y="$(mktemp -d "${TMPDIR:-/tmp}/$(basename "$0").XXXXXXXXXX")"
p="$(mktemp -d \
  "${TMPDIR:-/tmp}/y.XXXXXXXXXX")"
# a bare mktemp -d in a comment is not a call
SH
node tools/mktemp-template-check.js "$T/good.sh" >/dev/null \
  && ok "templated calls, a message and a comment are not flagged" \
  || bad "a templated call or a mention was flagged: $(node tools/mktemp-template-check.js "$T/good.sh")"

# THE INSTALLER'S PRODUCTION ARM. In a real .pkg install `sudo -u -H` strips TMPDIR, so the
# postinstall's verify dir must come from getconf (the per-user temp dir a bare mktemp used),
# not the shared /tmp, and under its `set -e` a failing getconf must fall back rather than
# abort. The harness tests all run with TMPDIR set, so they never reach this; it is run
# here on the line itself, with `mktemp -u` so nothing is created.
vt_line="$(grep -E '^[[:space:]]*_vt="\$\{TMPDIR:-' install/pkg-scripts/postinstall)"
[ -n "$vt_line" ] || bad "could not find the postinstall's _vt line; re-point this arm"
if [ -n "$vt_line" ]; then
  want_dir="$(/usr/bin/getconf DARWIN_USER_TEMP_DIR)"
  got="$(TMPDIR= /bin/sh -ec "$vt_line"'; printf %s "$_vt"')"
  [ "$got" = "$want_dir" ] && ok "installer arm: with TMPDIR stripped the verify dir is the per-user temp dir ($want_dir)" \
    || bad "installer arm: with TMPDIR stripped _vt is [$got], want [$want_dir]"
  # A getconf that fails: shadowing the absolute path with a function is impossible, so run the
  # same line with the path swapped for /usr/bin/false. It must not abort under set -e.
  fail_line="$(printf '%s' "$vt_line" | sed 's#/usr/bin/getconf#/usr/bin/false#')"
  got="$(TMPDIR= /bin/sh -ec "$fail_line"'; printf "ok[%s]" "$_vt"' 2>/dev/null)"
  [ "$got" = "ok[]" ] && ok "installer arm: a failing getconf leaves _vt empty under set -e (then /tmp), no abort" \
    || bad "installer arm: a failing getconf aborted or set _vt: [$got]"
fi

echo "mktemp-template: $FAILS failures"
exit $([ "$FAILS" -eq 0 ] && echo 0 || echo 1)
