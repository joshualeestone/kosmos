#!/bin/bash
# #4298: no script under tools/ may call `mktemp` without a path template.
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
SH
got="$(node tools/mktemp-template-check.js "$T/bare.sh" | cut -d: -f2 | sort -n | tr '\n' ' ')"
want="1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 "
[ "$got" = "$want" ] && ok "CONTROL: all 16 bare shapes are found, each on its own line" \
  || bad "CONTROL: bare shapes found on lines [$got], want [$want]"

# The other side: templated calls and mentions are not calls to fix.
cat > "$T/good.sh" <<'SH'
a="$(mktemp -d "${TMPDIR:-/tmp}/x.XXXXXXXXXX")"
b="$(mktemp "$out.archive.XXXXXX")"
c="$(mktemp -d /tmp/cutguard-frozen.XXXXXX)"
j="$(/usr/bin/mktemp /tmp/kosmos-installing.XXXXXX 2>/dev/null || true)"
echo "FAIL  mktemp failed, so nothing ran"
echo "if mktemp fails, nothing ran"
p="$(mktemp -d \
  "${TMPDIR:-/tmp}/y.XXXXXXXXXX")"
# a bare mktemp -d in a comment is not a call
SH
node tools/mktemp-template-check.js "$T/good.sh" >/dev/null \
  && ok "templated calls, a message and a comment are not flagged" \
  || bad "a templated call or a mention was flagged: $(node tools/mktemp-template-check.js "$T/good.sh")"

echo "mktemp-template: $FAILS failures"
exit $([ "$FAILS" -eq 0 ] && echo 0 || echo 1)
