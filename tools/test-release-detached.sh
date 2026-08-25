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
git init -q --bare --initial-branch=main "$T/origin.git"
git clone -q "$T/origin.git" "$T/main" 2>/dev/null
echo 'console.log("A")' > "$T/main/server.js"; echo '{"version":"1.0.0"}' > "$T/main/package.json"
git -C "$T/main" add -A && git -C "$T/main" commit -q -m A && git -C "$T/main" push -q origin HEAD:main 2>/dev/null
A="$(git -C "$T/main" rev-parse HEAD)"
git clone -q "$T/origin.git" "$T/other" 2>/dev/null

# 1. The release freezes at A.
BUILD="$(release_freeze "$T/main" "$A" "$T/root")" || bad "freeze returned non-zero"
if [ -d "$BUILD" ]; then ok "the frozen tree exists"; else
  # ⚠️ EVERYTHING BELOW builds paths under $BUILD. An empty BUILD would make
  # them root-anchored (mkdir /web, rm -rf /install) -- harmless as a non-root
  # user, real on a root CI. Stop here rather than compute on the empty string.
  bad "no frozen tree at '$BUILD'"; echo "release-detached: $FAILS failures"; exit 1
fi

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

# 5. The served-bundle comparison. A bundle built from the frozen tree matches;
#    a changed, extra, or missing file does not; the version bake and the two
#    relocations (bin/kosmos, app/bin/kosmos-report-hook.sh) are allowed.
#    The fixture carries a valid app/ AND bin/ from the start, so every tarball
#    below is well-formed and each negative case perturbs exactly one file.
mkdir -p "$T/bundle/app/web" "$T/bundle/app/bin" "$T/bundle/app/engine" "$T/bundle/bin" "$BUILD/install" "$BUILD/web" "$BUILD/engine"
# A Kosmos tree has web/ and engine/ (#609: the expected set is refused without them).
echo 'module.exports = 1;' > "$BUILD/engine/keep.js"; cp "$BUILD/engine/keep.js" "$T/bundle/app/engine/"
cp "$BUILD/server.js" "$BUILD/package.json" "$T/bundle/app/"
echo '<meta name="kosmos-version" content="__KOSMOS_VERSION__">' > "$BUILD/web/index.html"
sed 's/__KOSMOS_VERSION__/1.0.0/' "$BUILD/web/index.html" > "$T/bundle/app/web/index.html"
echo 'the kosmos command'     > "$BUILD/install/kosmos";                 cp "$BUILD/install/kosmos"                 "$T/bundle/bin/kosmos"
echo 'the report hook'        > "$BUILD/install/kosmos-report-hook.sh";  cp "$BUILD/install/kosmos-report-hook.sh"  "$T/bundle/app/bin/kosmos-report-hook.sh"

bundle() { tar -czf "$T/$1" -C "$T/bundle" app bin; }        # a well-formed served bundle from the current fixture

bundle good.tgz
release_bundle_matches_tree "$T/good.tgz" "$BUILD" >/dev/null && ok "a bundle built from the tree matches it (version bake and both relocations allowed)" || bad "a matching bundle was called different"

echo 'console.log("B")' > "$T/bundle/app/server.js"; bundle bad.tgz; cp "$BUILD/server.js" "$T/bundle/app/server.js"
release_bundle_matches_tree "$T/bad.tgz" "$BUILD" >/dev/null && bad "a changed app file was called matching" || ok "a changed app file is caught"

echo x > "$T/bundle/app/extra.js"; bundle extra.tgz; rm -f "$T/bundle/app/extra.js"
release_bundle_matches_tree "$T/extra.tgz" "$BUILD" >/dev/null && bad "a file the tree lacks was called matching" || ok "a file the tree lacks is caught"

echo 'stale command' > "$T/bundle/bin/kosmos"; bundle binbad.tgz; cp "$BUILD/install/kosmos" "$T/bundle/bin/kosmos"
release_bundle_matches_tree "$T/binbad.tgz" "$BUILD" >/dev/null && bad "a stale top-level bin/kosmos was called matching" || ok "a stale bin/kosmos is caught (compared against install/kosmos)"

# ---- the other direction (#609): a file the build FORGOT ---------------------
# The loop that walks the bundle cannot see a file that is not in it; the
# expected set is derived from the tree and the app, never from the build's
# hand list, and each of its sources gets a case that drops exactly one file.
exp="$(release_bundle_expected_files "$BUILD" | sort -u)"
printf '%s\n' "$exp" | grep -qx 'app/web/index.html' && printf '%s\n' "$exp" | grep -qx 'app/engine/keep.js' && ok "the expected set is derived from the tree (web/index.html from web/, engine/keep.js from engine/; neither is pinned)" || bad "the expected set is missing the tree's own files: $exp"
rm -f "$T/bundle/app/web/index.html"; bundle noweb.tgz; sed 's/__KOSMOS_VERSION__/1.0.0/' "$BUILD/web/index.html" > "$T/bundle/app/web/index.html"
out="$(release_bundle_matches_tree "$T/noweb.tgz" "$BUILD")" && bad "a bundle without web/index.html was called matching" || { printf '%s' "$out" | grep -q "missing from the bundle.*app/web/index.html" && ok "a bundle that forgot web/index.html is caught, and the red names the file" || bad "the red did not name web/index.html: $out"; }
echo 'test' > "$BUILD/engine/keep.test.js"; rm -f "$T/bundle/app/engine/keep.js"
bundle noengine.tgz
out="$(release_bundle_matches_tree "$T/noengine.tgz" "$BUILD")" && bad "a bundle without engine/keep.js was called matching" || { printf '%s' "$out" | grep -q "missing from the bundle.*app/engine/keep.js" && ok "a bundle that forgot an engine/*.js is caught (derived from the tree's glob)" || bad "the red did not name engine/keep.js: $out"; }
printf '%s' "$out" | grep -q "keep.test.js" && bad "a *.test.js was demanded of the bundle" || ok "and *.test.js files are not demanded (the build skips them)"
mkdir -p "$T/bundle/app/engine"; cp "$BUILD/engine/keep.js" "$T/bundle/app/engine/"
# a module the server requires from OUTSIDE engine/: only the require walk can see it.
mkdir -p "$BUILD/lib" "$T/bundle/app/lib"; echo 'module.exports = 2;' > "$BUILD/lib/helper.js"
printf 'require("./lib/helper");\nconsole.log("A")\n' > "$BUILD/server.js"; cp "$BUILD/server.js" "$T/bundle/app/server.js"
bundle nolib.tgz
out="$(release_bundle_matches_tree "$T/nolib.tgz" "$BUILD")" && bad "a bundle without a module the server requires was called matching" || { printf '%s' "$out" | grep -q "missing from the bundle.*app/lib/helper.js" && ok "a bundle that forgot a module the server requires (outside engine/) is caught, from the require graph" || bad "the red did not name lib/helper.js: $out"; }
cp "$BUILD/lib/helper.js" "$T/bundle/app/lib/"; bundle complete.tgz
release_bundle_matches_tree "$T/complete.tgz" "$BUILD" >/dev/null && ok "CONTROL: with every expected file present the bundle matches again" || bad "CONTROL: a complete bundle was called incomplete: $(release_bundle_matches_tree "$T/complete.tgz" "$BUILD")"
# a file the engine resolves under bin/ by path is demanded, from the engine's own code.
printf "const path = require('path'); module.exports = path.join(__dirname, '..', 'bin', 'needed.sh');\n" > "$BUILD/engine/paths.js"; cp "$BUILD/engine/paths.js" "$T/bundle/app/engine/"
bundle nobin.tgz
out="$(release_bundle_matches_tree "$T/nobin.tgz" "$BUILD")" && bad "a bundle without a bin/ file the engine resolves by path was called matching" || { printf '%s' "$out" | grep -q "missing from the bundle.*app/bin/needed.sh" && ok "a bundle that forgot a bin/ file the engine resolves by path is caught (#731's shape)" || bad "the red did not name bin/needed.sh: $out"; }
mkdir -p "$BUILD/bin"; echo 'x' > "$BUILD/bin/needed.sh"; cp "$BUILD/bin/needed.sh" "$T/bundle/app/bin/needed.sh"; bundle withbin.tgz
release_bundle_matches_tree "$T/withbin.tgz" "$BUILD" >/dev/null && ok "CONTROL: with the bin/ file present it matches again" || bad "CONTROL: a bundle with the bin/ file was called incomplete"
rm -f "$BUILD/engine/paths.js" "$T/bundle/app/engine/paths.js" "$T/bundle/app/bin/needed.sh" "$BUILD/bin/needed.sh"

echo 'other' > "$T/bundle/app/bin/kosmos-report-hook.sh"; bundle relocbad.tgz; cp "$BUILD/install/kosmos-report-hook.sh" "$T/bundle/app/bin/kosmos-report-hook.sh"
release_bundle_matches_tree "$T/relocbad.tgz" "$BUILD" >/dev/null && bad "a changed relocated hook was called matching" || ok "a changed relocated hook is caught (compared against install/)"

# The Plus connector (#583): verified against a checksum, never the tree.
mkdir -p "$T/bundle/app/bin"; printf 'connector-v1' > "$T/bundle/app/bin/kosmos-tunnel"
_tsha="$(shasum -a 256 "$T/bundle/app/bin/kosmos-tunnel" | awk '{print $1}')"
bundle tun.tgz
release_bundle_matches_tree "$T/tun.tgz" "$BUILD" "$_tsha" >/dev/null && ok "a connector matching the expected checksum passes, and is not sought in the tree" || bad "a matching connector was rejected"
release_bundle_matches_tree "$T/tun.tgz" "$BUILD" "deadbeef" >/dev/null && bad "a connector with the wrong checksum was called matching" || ok "a connector with the wrong checksum is caught"
release_bundle_matches_tree "$T/tun.tgz" "$BUILD" "" >/dev/null && bad "a connector with no expected checksum was passed (skipped)" || ok "a connector with no expected checksum is refused, not skipped"
printf 'connector-v2' > "$T/bundle/app/bin/kosmos-tunnel"; bundle tun2.tgz
release_bundle_matches_tree "$T/tun2.tgz" "$BUILD" "$_tsha" >/dev/null && bad "a changed connector still matched the old checksum" || ok "a changed connector no longer matches the old checksum"
rm -f "$T/bundle/app/bin/kosmos-tunnel"
# Presence, not just checksum-if-present: with the connector now removed, a
# bundle whose tree files match but which lacks the connector must fail when a
# connector sha is expected (the #583 failure), and pass when none is expected.
bundle noconn.tgz
release_bundle_matches_tree "$T/noconn.tgz" "$BUILD" "$_tsha" >/dev/null && bad "a bundle missing the connector passed with an expected sha" || ok "a bundle missing the connector is caught when one is expected"
release_bundle_matches_tree "$T/noconn.tgz" "$BUILD" "" >/dev/null && ok "a bundle with no connector and no expectation passes" || bad "no-connector-no-expectation was wrongly failed"

# The derivation refuses rather than shrinking (#609 review): without node the
# require walk (the only source for modules outside engine/) would go silent
# and a bundle lacking one would pass; a tree without engine/ or web/ is not a
# Kosmos tree and would derive a near-empty set that passes a near-empty bundle.
bundle complete2.tgz
out="$(PATH=/usr/bin:/bin release_bundle_matches_tree "$T/complete2.tgz" "$BUILD" 2>&1)"; rc=$?
hit=0; printf '%s' "$out" | grep -q "node is not on PATH" && hit=1
[ "$rc" = 2 ] && [ "$hit" = 1 ] && ok "no node on PATH: the comparator refuses (2) and names node, rather than passing with the require walk silent" || bad "no node on PATH: rc $rc, '$out'"
rm -rf "$T/noeng"; cp -R "$BUILD" "$T/noeng"; rm -rf "$T/noeng/engine"
out="$(release_bundle_matches_tree "$T/complete2.tgz" "$T/noeng" 2>&1)"; rc=$?
hit=0; printf '%s' "$out" | grep -q "not a Kosmos tree" && hit=1
[ "$rc" = 2 ] && [ "$hit" = 1 ] && ok "a tree without engine/ is refused (2) as not a Kosmos tree, not compared" || bad "tree without engine/: rc $rc, '$out'"

# The pinned relocations each get a drop case too (round 2: they had none, so
# a derivation that forgot them stayed green). And the "names a web/ and an
# engine/ file" guard gets a tree with a present-but-empty engine/, the only
# state past the directory guard that can reach it.
rm -f "$T/bundle/bin/kosmos"; bundle nocmd.tgz; cp "$BUILD/install/kosmos" "$T/bundle/bin/kosmos"
out="$(release_bundle_matches_tree "$T/nocmd.tgz" "$BUILD")" && bad "a bundle without bin/kosmos was called matching" || { printf '%s' "$out" | grep -q "missing from the bundle (the tree and the app need it): bin/kosmos" && ok "a bundle without the kosmos command is red and names bin/kosmos (pinned relocation)" || bad "wrong words for a missing bin/kosmos: $out"; }
rm -f "$T/bundle/app/bin/kosmos-report-hook.sh"; bundle nohook.tgz; cp "$BUILD/install/kosmos-report-hook.sh" "$T/bundle/app/bin/kosmos-report-hook.sh"
out="$(release_bundle_matches_tree "$T/nohook.tgz" "$BUILD")" && bad "a bundle without the report hook was called matching" || { printf '%s' "$out" | grep -q "missing from the bundle (the tree and the app need it): app/bin/kosmos-report-hook.sh" && ok "a bundle without the report hook is red and names it (pinned relocation)" || bad "wrong words for a missing hook: $out"; }
printf "const path = require('path'); module.exports = path.resolve(__dirname, '..', 'bin', 'resolved.sh');\n" > "$BUILD/engine/paths2.js"; cp "$BUILD/engine/paths2.js" "$T/bundle/app/engine/"
bundle noresolved.tgz
out="$(release_bundle_matches_tree "$T/noresolved.tgz" "$BUILD")" && bad "a bin/ file the engine resolves with path.resolve was not demanded" || { printf '%s' "$out" | grep -q "app/bin/resolved.sh" && ok "a bin/ file resolved with path.resolve (not join) is demanded too" || bad "wrong words for the resolve( case: $out"; }
rm -f "$BUILD/engine/paths2.js" "$T/bundle/app/engine/paths2.js"
rm -rf "$T/emptyeng"; cp -R "$BUILD" "$T/emptyeng"; rm -f "$T/emptyeng/engine/"*
bundle complete3.tgz
out="$(release_bundle_matches_tree "$T/complete3.tgz" "$T/emptyeng" 2>&1)"; rc=$?
hit=0; printf '%s' "$out" | grep -q "names no web/ file or no engine/ file" && hit=1
[ "$rc" = 2 ] && [ "$hit" = 1 ] && ok "a tree whose engine/ is present but empty is refused (2): the derived set would name no engine file" || bad "empty engine/: rc $rc, '$out'"

# Round 3: the web half of the derived-set guard, the icon pin, the tunnel
# exclusion, and a node that runs but fails, each with its own case.
rm -rf "$T/emptyweb"; cp -R "$BUILD" "$T/emptyweb"; rm -f "$T/emptyweb/web/"*
out="$(release_bundle_matches_tree "$T/complete3.tgz" "$T/emptyweb" 2>&1)"; rc=$?
hit=0; printf '%s' "$out" | grep -q "names no web/ file or no engine/ file" && hit=1
[ "$rc" = 2 ] && [ "$hit" = 1 ] && ok "a tree whose web/ is present but empty is refused (2): the derived set would name no web file" || bad "empty web/: rc $rc, '$out'"
mkdir -p "$BUILD/assets" "$T/bundle/app/assets"; printf 'icns' > "$BUILD/assets/Kosmos.icns"
bundle noicon.tgz; cp "$BUILD/assets/Kosmos.icns" "$T/bundle/app/assets/Kosmos.icns"
out="$(release_bundle_matches_tree "$T/noicon.tgz" "$BUILD")" && bad "a bundle without the icon the tree has was called matching" || { printf '%s' "$out" | grep -q "app/assets/Kosmos.icns" && ok "a bundle without the icon the tree carries is red and names it (pinned when the tree has it)" || bad "wrong words for a missing icon: $out"; }
bundle withicon.tgz
release_bundle_matches_tree "$T/withicon.tgz" "$BUILD" >/dev/null && ok "CONTROL: with the icon present it matches again" || bad "CONTROL: a bundle with the icon was called mismatching"
printf "const path = require('path'); module.exports = path.join(__dirname, '..', 'bin', 'kosmos-tunnel');\n" > "$BUILD/engine/paths3.js"; cp "$BUILD/engine/paths3.js" "$T/bundle/app/engine/"
bundle tunnelref.tgz
release_bundle_matches_tree "$T/tunnelref.tgz" "$BUILD" "" >/dev/null && ok "an engine file resolving app/bin/kosmos-tunnel by path does not make the tree demand it: the connector stays the checksum argument's" || bad "the tunnel exclusion is not working: the tree demanded the connector"
rm -f "$BUILD/engine/paths3.js" "$T/bundle/app/engine/paths3.js"
printf "module.exports = require('path').join(__dirname, '..', 'bin', 'only-in-a-test.sh');\n" > "$BUILD/engine/fake.test.js"
bundle testref.tgz
release_bundle_matches_tree "$T/testref.tgz" "$BUILD" >/dev/null && ok "a bin/ reference inside a *.test.js is not demanded (the bundle carries no tests)" || bad "a *.test.js reference was demanded of the bundle"
rm -f "$BUILD/engine/fake.test.js"
mkdir -p "$T/nodeshim"; printf '#!/bin/sh\necho boom >&2; exit 3\n' > "$T/nodeshim/node"; chmod +x "$T/nodeshim/node"
out="$(PATH="$T/nodeshim:$PATH" release_bundle_matches_tree "$T/withicon.tgz" "$BUILD" 2>&1)"; rc=$?
hit=0; printf '%s' "$out" | grep -q "the require walk failed (node exit 3): boom" && hit=1
[ "$rc" = 2 ] && [ "$hit" = 1 ] && ok "a node that runs but fails is a refusal (2) with node's own words, not a shorter set" || bad "failing node: rc $rc, '$out'"

# ---- a failed cut leaves the site checkout claiming a version it never served (#609 review) ----
SITE="$T/site"; git init -q --initial-branch=main "$SITE"; mkdir -p "$SITE/dist"
echo '{"version":"1.0.0"}' > "$SITE/dist/latest.json"; echo 'oldsha  setup' > "$SITE/setup.sha256"; echo '<html>versions</html>' > "$SITE/versions.html"
printf 'dist/*.tar.gz\ndist/*.tar.gz.sha256\n' > "$SITE/.gitignore"
git -C "$SITE" add -A && git -C "$SITE" commit -q -m site
echo '{"version":"1.0.1"}' > "$SITE/dist/latest.json"; echo 'newsha  setup' > "$SITE/setup.sha256"; echo '<html>versions + 1.0.1 entry</html>' > "$SITE/versions.html"
printf 'tgz' > "$SITE/dist/kosmos-1.0.1-arm64.tar.gz"; printf 'sha' > "$SITE/dist/kosmos-1.0.1-arm64.tar.gz.sha256"
out="$(release_site_restore "$SITE" "1.0.1" 0)"; rc=$?
[ "$rc" = 0 ] && [ "$(cat "$SITE/dist/latest.json")" = '{"version":"1.0.0"}' ] && [ "$(cat "$SITE/setup.sha256")" = 'oldsha  setup' ] && ok "after a failed cut, latest.json and setup.sha256 are back at their committed bytes (the checkout no longer claims 1.0.1)" || bad "restore left the site claiming the new version (rc $rc): $(cat "$SITE/dist/latest.json") / $(cat "$SITE/setup.sha256")"
[ ! -f "$SITE/dist/kosmos-1.0.1-arm64.tar.gz" ] && [ ! -f "$SITE/dist/kosmos-1.0.1-arm64.tar.gz.sha256" ] && ok "and the versioned pair this cut created is gone (the name is cache-immutable; cut 5 of 0.5.24 refused over a leftover)" || bad "the versioned pair lingered"
[ "$(cat "$SITE/versions.html")" = '<html>versions + 1.0.1 entry</html>' ] && ok "and versions.html, hand-written for the re-cut, is left exactly as it was" || bad "restore touched versions.html"
printf '%s' "$out" | grep -q "put back: dist/latest.json" && printf '%s' "$out" | grep -q "removed: dist/kosmos-1.0.1-arm64.tar.gz" && ok "and it says what it did" || bad "restore was silent: $out"
printf 'served' > "$SITE/dist/kosmos-1.0.1-arm64.tar.gz"; printf 'sha' > "$SITE/dist/kosmos-1.0.1-arm64.tar.gz.sha256"
release_site_restore "$SITE" "1.0.1" 1 >/dev/null
[ "$(cat "$SITE/dist/kosmos-1.0.1-arm64.tar.gz")" = served ] && ok "CONTROL: a pair that existed before the cut (an earlier, served cut's) is not ours to remove" || bad "restore removed a pair it did not create"
out="$(release_site_restore "$SITE" "1.0.1" 1)"; [ -z "$out" ] && ok "CONTROL: with nothing changed it does nothing and says nothing" || bad "restore acted on a clean checkout: $out"

# A tarball missing a whole tree (no bin member) is a setup failure (2), not a pass.
tar -czf "$T/noroot.tgz" -C "$T/bundle" app
release_bundle_matches_tree "$T/noroot.tgz" "$BUILD" >/dev/null; [ "$?" = 2 ] && ok "a bundle missing bin/ is refused as malformed (2), not passed" || bad "a bundle missing bin/ was not refused as malformed"

# An empty-but-well-formed bundle: the zero-tree-files guard fires (1).
mkdir -p "$T/empty/app" "$T/empty/bin"; tar -czf "$T/empty.tgz" -C "$T/empty" app bin
release_bundle_matches_tree "$T/empty.tgz" "$BUILD" >/dev/null && bad "an empty bundle was called matching" || ok "an empty bundle is caught"

rm -rf "$BUILD/web" "$BUILD/install"

# 6. Thaw removes the worktree and its registration.
release_thaw "$T/main" "$BUILD"
[ ! -d "$BUILD" ] && ok "thaw removed the frozen tree" || bad "the frozen tree is still on disk"
git -C "$T/main" worktree list | grep -qF "$BUILD" && bad "the worktree is still registered" || ok "the worktree is no longer registered"

echo "release-detached: $FAILS failures"
[ "$FAILS" -eq 0 ]
