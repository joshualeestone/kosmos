#!/bin/bash
# kosmos#7192: .githooks/pre-push runs the two browser-check gates (#1720 coarse, #2518 surface) before a push.
# Builds a throwaway repo with an origin, copies in the hook and the gate libraries, and drives the hook the way git
# does (pushed refs on stdin). Each refusal has a passing twin, and a push with no web/ change, or of another branch,
# never reaches the gates.
#   bash tools/test-prepush-gates-7192.sh
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
fails=0
ok() { printf 'OK    %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; fails=$((fails + 1)); }

git init -q --bare "$T/origin.git"
git init -q -b main "$T/w"
cd "$T/w" || exit 1
git config user.email t@example.com; git config user.name t
mkdir -p web docs/browser-checks tools/lib .githooks
cp "$REPO/.githooks/pre-push" .githooks/pre-push
cp "$REPO"/tools/lib/browser-check-gate.sh "$REPO"/tools/lib/browser-check-surface-gate.sh "$REPO"/tools/lib/browser-check-surface-lib.sh tools/lib/
printf '<div class="seat-chip">a</div>\n' > web/index.html
printf "// Browser-check-surface: seat-chip\n'use strict';\n" > docs/browser-checks/render-seat-1.js
printf "'use strict';\n" > docs/browser-checks/render-other-1.js
git add -A && git commit -qm base
git remote add origin "$T/origin.git"
git push -q origin main
git fetch -q origin

# The hook as git calls it: "<local ref> <local sha> <remote ref> <remote sha>" per pushed ref.
hook() { printf 'refs/heads/%s %s refs/heads/%s %s\n' "$1" "$(git rev-parse "$1")" "$1" 0000000000000000000000000000000000000000 \
  | bash .githooks/pre-push origin "$T/origin.git" >"$T/out" 2>&1; }

# 1. No web/ change: passes without asking either gate.
git checkout -qb docs-only main
printf 'x\n' > README.md; git add README.md; git commit -qm 'docs only'
if hook docs-only; then ok 'a branch with no web/ change passes'; else bad 'a branch with no web/ change was refused: '"$(cat "$T/out")"; fi

# 2. #1720: a web/ change with no browser-check change and no trailer is refused, naming the gate.
git checkout -qb web-bare main
printf '<div class="seat-chip">b</div>\n' > web/index.html; git add web; git commit -qm 'web change'
if hook web-bare; then bad 'a web/ change with no check and no trailer was let through'
elif grep -q 'browser-check-gate' "$T/out"; then ok 'the coarse gate refuses a web/ change with no check, and says which gate'
else bad 'refused, but without naming the gate: '"$(cat "$T/out")"; fi
# ...and its twin: the same change with a Browser-check trailer passes the coarse gate. The surface gate still reads
# the touched token (seat-chip), so this twin carries both trailers: it proves the coarse refusal above was the gate's.
git commit -q --amend -m 'web change

Browser-check: copy only
Browser-check-surface: render-seat-1.js copy only, the chip is unchanged'
if hook web-bare; then ok 'CONTROL: the same change with both trailers passes'; else bad 'CONTROL: trailers did not let it through: '"$(cat "$T/out")"; fi

# 3. #2518: a web/ change that touches a check's surface token, with another check updated (so the coarse gate
#    passes) but not that one, is refused by the surface gate.
git checkout -qb web-surface main
printf '<div class="seat-chip">c</div>\n' > web/index.html
printf "'use strict';\n// touched\n" > docs/browser-checks/render-other-1.js
git add -A; git commit -qm 'web change, wrong check updated'
if hook web-surface; then bad 'a surface-token change with its own check untouched was let through'
elif grep -q 'browser-check-surface-gate' "$T/out"; then ok 'the surface gate refuses a token change whose check was not updated'
else bad 'refused, but not by the surface gate: '"$(cat "$T/out")"; fi
# ...and its twin: updating the check that owns the token passes.
printf "// Browser-check-surface: seat-chip\n'use strict';\n// updated\n" > docs/browser-checks/render-seat-1.js
git add -A; git commit -qm 'and its check'
if hook web-surface; then ok 'CONTROL: updating the owning check passes'; else bad 'CONTROL: the owning check did not let it through: '"$(cat "$T/out")"; fi

# 4. A push of a branch that is not the one checked out is not checked here (the gates read HEAD). The checkout is a
#    branch the coarse gate refuses, so checking HEAD by mistake would refuse this push.
git checkout -qb web-bad main
printf '<div class="seat-chip">d</div>\n' > web/index.html; git add web; git commit -qm 'web change, no trailer'
if hook docs-only; then ok 'a push of another branch is not checked against the checkout'
else bad 'a push of another branch was checked against the checkout: '"$(cat "$T/out")"; fi
if hook web-bad; then bad 'CONTROL: the checked-out bad branch was let through'; else ok 'CONTROL: the checked-out bad branch is refused'; fi

[ "$fails" -eq 0 ] && echo 'prepush-gates-7192: all passed' || { echo "prepush-gates-7192: $fails failed"; exit 1; }
