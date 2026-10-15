#!/bin/bash
# #4298: no test under tools/test-*.sh may call `mktemp` without a path template.
#
# macOS `mktemp` ignores TMPDIR, so a bare `mktemp -d` (or `-t name`) lands in the
# real per-user temp root, outside the per-run root tools/run-tests.sh sets, and
# stays there unless the test removes it (#4273, #4273 slice 2). A positional
# template such as "${TMPDIR:-/tmp}/<name>.XXXXXXXXXX" lands under TMPDIR, and its
# name says which test left it. This is a STATIC source check on purpose: on macOS
# the suite's runtime per-run-root scan (lib/test-leak-guard.sh) cannot see a
# template-less mktemp, because the file it would scan for never lands in the root
# it scans. The static check does not depend on where the OS puts the file.
#
# SCOPE: tools/test-*.sh -- the kosmos suite's shell tests. Non-test scripts stay
# out of scope (card #4298: "non-test tools/*.sh out of scope unless they leak");
# several carry bare calls and are named by tests, and being named is not being run,
# so whether a test executes one is MEASURED in the heavy run (the real-root tmp.*
# count), not assumed. A lib an in-scope test sources and runs carries the same
# obligation and is templated at its call (tools/lib/app-port-selftest.sh today).
# ios/tools/test-*.sh is a separate iOS build lane the kosmos suite never runs (not
# referenced by package.json, run-tests.sh or shell-shard.js), so it is out of scope
# too; a bare mktemp there is an iOS-lane follow-up, not this card.
#
# Arms: the test tree is clean, the checker FINDS each bare shape (so a clean
# result is not a silent instrument), it does NOT flag templated calls or the word
# in a message, and the scope is the population it claims.
set -u
cd "$(dirname "$0")/.." || exit 1
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/mktemp-template-4298.XXXXXXXXXX")" || { echo "FAIL  no scratch dir"; exit 1; }
trap 'rm -rf "$T"' EXIT

# The scope: every tracked tools/test-*.sh, except this file (its fixtures below
# are bare on purpose). A glob that matched nothing would pass the clean arm
# vacuously, so it carries a floor.
scope=()
while IFS= read -r f; do
  [ "$f" = "tools/test-mktemp-template-4298.sh" ] && continue
  scope+=("$f")
done < <(git ls-files 'tools/test-*.sh')
[ "${#scope[@]}" -ge 120 ] && [ -f "${scope[0]}" ] \
  && ok "the scope holds ${#scope[@]} test scripts (floor 120)" \
  || bad "the scope glob matched ${#scope[@]} files; the clean arm would prove nothing"

out="$(node tools/mktemp-template-check.js "${scope[@]}" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "no tools/test-*.sh calls mktemp without a path template" \
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
z="$(mktemp -d "${TMPDIR:-/tmp}/fixed-name")"
aa="$(mktemp -d -t x "${TMPDIR:-/tmp}/n.XXXXXX")"
ab="$(\mktemp -d)"
caffeinate -i mktemp -d >/dev/null
arch -arm64 mktemp -d >/dev/null
ac="$(builtin command mktemp)"
printf 'x\n' | xargs -I{} mktemp -d >/dev/null
SH
got="$(node tools/mktemp-template-check.js "$T/bare.sh" | cut -d: -f2 | sort -n | tr '\n' ' ')"
want="1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 "
[ "$got" = "$want" ] && ok "CONTROL: all 35 bare shapes are found, each on its own line" \
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
say "x" mktemp
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

echo "mktemp-template: $FAILS failures"
exit $([ "$FAILS" -eq 0 ] && echo 0 || echo 1)
