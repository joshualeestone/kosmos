#!/bin/bash
# kosmos#6562: tools/lib/tar-owner-gate.sh refuses a release tarball whose entries record the build account as owner,
# passes one packed with the neutral names the bundle uses, and refuses rather than skips when it cannot look.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/lib/tar-owner-gate.sh"
T="$(mktemp -d "${TMPDIR:-/tmp}/tar-owner-gate-6562.XXXXXXXXXX")"; trap 'rm -rf "$T"' EXIT
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
ME="$(id -un)"
mkdir -p "$T/s/app"; printf 'x\n' > "$T/s/app/f"; printf 'y\n' > "$T/s/VERSION"

tar -czf "$T/neutral.tgz" --uname kosmos --gname staff -C "$T/s" app VERSION
if tar_owner_gate "$T/neutral.tgz" "$ME" 2>/dev/null; then pass "CONTROL: a tarball packed with the neutral names passes"
else fail "CONTROL: the neutral tarball was refused, so every refusal below is vacuous"; fi

tar -czf "$T/plain.tgz" -C "$T/s" app VERSION
out="$(tar_owner_gate "$T/plain.tgz" "$ME" 2>&1)"; rc=$?
if [ "$rc" -ne 0 ] && printf '%s' "$out" | /usr/bin/grep -qF "'$ME'"; then pass "a tarball packed plainly (owner = this account) is refused and the account named"
else fail "a plainly packed tarball must be refused (rc=$rc): $out"; fi

tar -czf "$T/grp.tgz" --uname kosmos --gname zz-builder -C "$T/s" app VERSION
if ! tar_owner_gate "$T/grp.tgz" "zz-builder" 2>/dev/null; then pass "an entry whose GROUP name is the account is refused too"
else fail "a group name equal to the account must be refused"; fi

out="$( ( tar_owner_gate "$T/plain.tgz" ) 2>&1 )"; rc=$?
if [ "$rc" -ne 0 ]; then pass "with no account given, the running account (id -un) is used"
else fail "the default account must be the running one: $out"; fi

if tar_owner_gate "$T/plain.tgz" "zz-not-the-builder" 2>/dev/null; then pass "another account's name is not a hit (the gate names the building account only)"
else fail "an unrelated account must not be refused"; fi

printf 'not a tarball\n' > "$T/junk.tgz"
if ! tar_owner_gate "$T/junk.tgz" "$ME" 2>/dev/null; then pass "a file that is not a tarball is refused, never passed"
else fail "an unlistable tarball must be refused"; fi

if ! tar_owner_gate "$T/missing.tgz" "$ME" 2>/dev/null; then pass "a missing tarball is refused"
else fail "a missing tarball must be refused"; fi

if ! ( id() { :; }; tar_owner_gate "$T/neutral.tgz" ) 2>/dev/null; then pass "an account it cannot read is refused, never skipped"
else fail "an empty account must be refused"; fi

B="$HERE/build-kosmos-bundle.sh"
if /usr/bin/grep -qF 'tar -czf "$TARBALL_OUT" --uname kosmos --gname staff -C "$STAGE"' "$B" && /usr/bin/grep -qx 'tar_owner_gate "$TARBALL_OUT" || exit 1' "$B"; then pass "the bundle build packs with the neutral names and calls the gate"
else fail "tools/build-kosmos-bundle.sh must pack with --uname kosmos --gname staff and call tar_owner_gate"; fi
if /usr/bin/grep -qF 'tar -czf "$TARBALL" --uname kosmos --gname staff' "$HERE/build-tmux-bundle.sh"; then pass "the tmux bundle packs with the neutral names"
else fail "tools/build-tmux-bundle.sh must pack with --uname kosmos --gname staff"; fi

if [ "$fails" -ne 0 ]; then echo "$fails check(s) failed"; exit 1; fi
echo "all checks passed"
