#!/bin/bash
# The race, reproduced (#597): a pull into the "main checkout" while a release
# is between its bump and its build must not change what the release builds.
# Driven against scratch repos; nothing here touches ~/work or the network.
set -u
cd "$(dirname "$0")/.." || exit 1
. tools/lib/release-freeze.sh

FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/kosmos-release-test.XXXXXX")"
trap 'rm -rf "$T"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

# A bare origin, a "main checkout" that a release would run in, and a second
# clone standing in for every other agent on the machine.
git init -q --bare "$T/origin.git"
git clone -q "$T/origin.git" "$T/main" 2>/dev/null
echo 'console.log("A")' > "$T/main/server.js"; echo '{"version":"1.0.0"}' > "$T/main/package.json"
git -C "$T/main" add -A && git -C "$T/main" commit -q -m A && git -C "$T/main" push -q origin HEAD:main 2>/dev/null
A="$(git -C "$T/main" rev-parse HEAD)"
git clone -q "$T/origin.git" "$T/other" 2>/dev/null

# 1. The release freezes at A.
BUILD="$(release_freeze "$T/main" "$A" "$T/root")" || bad "freeze returned non-zero"
[ -d "$BUILD" ] && ok "the frozen tree exists" || bad "no frozen tree at '$BUILD'"

# 2. Somebody else lands B and the main checkout is pulled, mid-release.
echo 'console.log("B")' > "$T/other/server.js"
git -C "$T/other" commit -qam B && git -C "$T/other" push -q origin HEAD:main 2>/dev/null
git -C "$T/main" pull -q --ff-only origin main 2>/dev/null
B="$(git -C "$T/main" rev-parse HEAD)"
[ "$B" != "$A" ] && ok "CONTROL: the main checkout really moved (${A:0:7} -> ${B:0:7})" || bad "the control pull did not move the checkout, so nothing below is tested"
[ "$(cat "$T/main/server.js")" = 'console.log("B")' ] && ok "CONTROL: the main checkout's file is B's" || bad "control file"

# 3. The frozen tree is still A: the thing the release tests and builds.
[ "$(git -C "$BUILD" rev-parse HEAD)" = "$A" ] && ok "the frozen tree is still at A after the pull" || bad "the frozen tree moved to $(git -C "$BUILD" rev-parse --short HEAD)"
[ "$(cat "$BUILD/server.js")" = 'console.log("A")' ] && ok "the frozen tree's file is A's" || bad "the frozen tree's file changed"
[ -z "$(git -C "$BUILD" status --porcelain)" ] && ok "the frozen tree is clean" || bad "the frozen tree is dirty"

# 4. Freezing at a sha that does not exist refuses rather than building something.
if release_freeze "$T/main" "0000000000000000000000000000000000000000" "$T/root" >/dev/null 2>&1; then bad "freezing at a sha that does not exist returned 0"; else ok "freezing at a sha that does not exist refuses"; fi

# 5. The served-bundle comparison: a bundle built from the frozen tree matches,
#    one with a changed file does not, and the baked version line is allowed.
mkdir -p "$T/bundle/app/web"
cp "$BUILD/server.js" "$BUILD/package.json" "$T/bundle/app/"
echo '<meta name="kosmos-version" content="__KOSMOS_VERSION__">' > "$BUILD/web-index.tmp"
mkdir -p "$BUILD/web"; mv "$BUILD/web-index.tmp" "$BUILD/web/index.html"
sed 's/__KOSMOS_VERSION__/1.0.0/' "$BUILD/web/index.html" > "$T/bundle/app/web/index.html"
tar -czf "$T/good.tgz" -C "$T/bundle" app
release_bundle_matches_tree "$T/good.tgz" "$BUILD" >/dev/null && ok "a bundle built from the tree matches it (version bake allowed)" || bad "a matching bundle was called different"
echo 'console.log("B")' > "$T/bundle/app/server.js"; tar -czf "$T/bad.tgz" -C "$T/bundle" app
release_bundle_matches_tree "$T/bad.tgz" "$BUILD" >/dev/null && bad "a bundle with a changed file was called matching" || ok "a bundle with a changed file is caught"
cp "$BUILD/server.js" "$T/bundle/app/server.js"; echo x > "$T/bundle/app/extra.js"; tar -czf "$T/extra.tgz" -C "$T/bundle" app
release_bundle_matches_tree "$T/extra.tgz" "$BUILD" >/dev/null && bad "a bundle with a file the tree lacks was called matching" || ok "a bundle with a file the tree lacks is caught"
# The one relocation the build makes: install/kosmos-report-hook.sh ships as app/bin/.
mkdir -p "$BUILD/install" "$T/bundle/app/bin"; echo 'hook' > "$BUILD/install/kosmos-report-hook.sh"; cp "$BUILD/install/kosmos-report-hook.sh" "$T/bundle/app/bin/"
rm -f "$T/bundle/app/extra.js"; tar -czf "$T/reloc.tgz" -C "$T/bundle" app
release_bundle_matches_tree "$T/reloc.tgz" "$BUILD" >/dev/null && ok "the relocated report hook is compared against install/" || bad "the relocated report hook was called missing"
echo 'other' > "$T/bundle/app/bin/kosmos-report-hook.sh"; tar -czf "$T/reloc-bad.tgz" -C "$T/bundle" app
release_bundle_matches_tree "$T/reloc-bad.tgz" "$BUILD" >/dev/null && bad "a changed relocated hook was called matching" || ok "a changed relocated hook is caught"
rm -rf "$BUILD/install" "$T/bundle/app/bin"
mkdir -p "$T/empty/app"; tar -czf "$T/empty.tgz" -C "$T/empty" app
release_bundle_matches_tree "$T/empty.tgz" "$BUILD" >/dev/null && bad "an empty bundle was called matching" || ok "an empty bundle is caught"
rm -rf "$BUILD/web"

# 6. Thaw removes the worktree and its registration.
release_thaw "$T/main" "$BUILD"
[ ! -d "$BUILD" ] && ok "thaw removed the frozen tree" || bad "the frozen tree is still on disk"
git -C "$T/main" worktree list | grep -q "$BUILD" && bad "the worktree is still registered" || ok "the worktree is no longer registered"

echo "release-detached: $FAILS failures"
[ "$FAILS" -eq 0 ]
