#!/bin/bash
# #2276: a chaoskosmos-site merge that lands MID-CUT must not kill the site push.
# Drives the REAL site_push_with_replay (tools/lib/site-push.sh) -- the function
# release.sh calls at 7b -- against scratch repos. Nothing here touches ~/work or
# the network.
set -u
cd "$(dirname "$0")/.." || exit 1
. tools/lib/site-push.sh

FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/kosmos-sitepush-test.XXXXXX")"
trap 'rm -rf "$T"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

# The release paths, exactly as release.sh builds $_site_paths for a staging cut.
PATHS="dist/latest-staging.json dist/kosmos-9.9.9-arm64.manifest.json setup setup.sha256 versions.html"
MSG="9.9.9: the staging pointer, installer and versions entry"

# A bare origin (the site's origin/main), a "site" checkout (where the cut runs),
# and an "other" clone standing in for an agent merging a page PR on GitHub.
git init -q --bare --initial-branch=main "$T/origin.git"
git clone -q "$T/origin.git" "$T/site" 2>/dev/null
mkdir -p "$T/site/dist"
echo '{"version":"0.0.0"}' > "$T/site/dist/latest-staging.json"
echo '{"old":true}'        > "$T/site/dist/kosmos-9.9.9-arm64.manifest.json"
echo 'old-setup'           > "$T/site/setup"
echo 'oldsha  setup'       > "$T/site/setup.sha256"
echo '<html>versions old</html>' > "$T/site/versions.html"
echo '<html>home v1</html>'      > "$T/site/index.html"
printf 'dist/*.tar.gz\n' > "$T/site/.gitignore"
git -C "$T/site" add -A && git -C "$T/site" commit -q -m base
git -C "$T/site" push -q origin HEAD:main 2>/dev/null
git clone -q "$T/origin.git" "$T/other" 2>/dev/null

# ---- The cut writes this version's release files and commits ONLY those (as 7b
# does, path-limited), then leaves a colleague's UNCOMMITTED page edit in the tree.
echo '{"version":"9.9.9"}' > "$T/site/dist/latest-staging.json"
echo '{"new":true}'        > "$T/site/dist/kosmos-9.9.9-arm64.manifest.json"
echo 'new-setup'           > "$T/site/setup"
echo 'newsha  setup'       > "$T/site/setup.sha256"
echo '<html>versions 9.9.9</html>' > "$T/site/versions.html"
# shellcheck disable=SC2086
git -C "$T/site" add $PATHS
# shellcheck disable=SC2086
git -C "$T/site" commit -q -m "$MSG" -- $PATHS
SITE_SHA="$(git -C "$T/site" rev-parse HEAD)"
# a colleague's in-progress page work, uncommitted in the shared checkout
echo '<html>home v2 WIP by a colleague</html>' > "$T/site/index.html"
COLLEAGUE_WIP="$(cat "$T/site/index.html")"
INDEX_BEFORE="$(git -C "$T/site" status --porcelain)"

# ---- Case 1: a PAGE merge lands on origin/main mid-cut. The push must survive.
echo '<html>design mock by another agent</html>' > "$T/other/design-new.html"
git -C "$T/other" add -A && git -C "$T/other" commit -q -m "design mock"
git -C "$T/other" push -q origin HEAD:main 2>/dev/null
ORIGIN_MOVED="$(git -C "$T/origin.git" rev-parse main)"
[ "$ORIGIN_MOVED" != "$SITE_SHA" ] && ok "CONTROL: origin/main really moved ahead of the cut's commit" || bad "the concurrent merge did not move origin/main, so nothing below is tested"

NEW_SHA="$(site_push_with_replay "$T/site" "$SITE_SHA" "$MSG" "$T" 5 "$PATHS")"
RC=$?
[ "$RC" = 0 ] && ok "the push survived a concurrent merge (returned 0)" || bad "site_push_with_replay returned $RC on a routine race"
[ -n "$NEW_SHA" ] && [ "$NEW_SHA" != "$SITE_SHA" ] && ok "it replayed onto a NEW commit (${SITE_SHA:0:7} -> ${NEW_SHA:0:7})" || bad "no replay commit was produced (got '$NEW_SHA')"
[ "$(git -C "$T/origin.git" rev-parse main)" = "$NEW_SHA" ] && ok "origin/main now IS the replayed sha" || bad "origin/main is not the sha the function reported"

# origin/main must carry BOTH the concurrent page merge AND our release files.
git -C "$T/origin.git" cat-file -e "$NEW_SHA:design-new.html" 2>/dev/null && ok "the concurrent merge's file survived on origin/main (not clobbered)" || bad "the concurrent merge was lost -- the replay clobbered origin/main"
[ "$(git -C "$T/origin.git" show "$NEW_SHA:dist/latest-staging.json")" = '{"version":"9.9.9"}' ] && ok "the release pointer is on origin/main" || bad "the release pointer did not make it onto origin/main"
[ "$(git -C "$T/origin.git" show "$NEW_SHA:versions.html")" = '<html>versions 9.9.9</html>' ] && ok "the release versions.html is on origin/main" || bad "the release versions.html did not make it onto origin/main"

# The colleague's uncommitted work and the real index must be untouched.
[ "$(cat "$T/site/index.html")" = "$COLLEAGUE_WIP" ] && ok "the colleague's uncommitted page edit is untouched" || bad "the replay disturbed the shared working tree"
[ "$(git -C "$T/site" status --porcelain)" = "$INDEX_BEFORE" ] && ok "the site's real index/worktree state is unchanged" || bad "the replay leaked into the site's real index"

# ---- Case 2: the clean case -- no concurrent merge, push succeeds first try,
# no replay, the sha is unchanged.
git init -q --bare --initial-branch=main "$T/origin2.git"
git clone -q "$T/origin2.git" "$T/site2" 2>/dev/null
echo hi > "$T/site2/versions.html"; echo x > "$T/site2/setup"; echo y > "$T/site2/setup.sha256"
mkdir -p "$T/site2/dist"; echo p > "$T/site2/dist/latest-staging.json"; echo m > "$T/site2/dist/kosmos-9.9.9-arm64.manifest.json"
git -C "$T/site2" add -A && git -C "$T/site2" commit -q -m base && git -C "$T/site2" push -q origin HEAD:main 2>/dev/null
echo hi2 > "$T/site2/versions.html"
# shellcheck disable=SC2086
git -C "$T/site2" add $PATHS && git -C "$T/site2" commit -q -m "$MSG" -- $PATHS
S2="$(git -C "$T/site2" rev-parse HEAD)"
OUT2="$(site_push_with_replay "$T/site2" "$S2" "$MSG" "$T" 5 "$PATHS")"
[ "$?" = 0 ] && [ "$OUT2" = "$S2" ] && ok "clean case: pushes first try, sha unchanged (no needless replay)" || bad "clean case altered the sha or failed (got '$OUT2')"
[ "$(git -C "$T/origin2.git" rev-parse main)" = "$S2" ] && ok "clean case: origin/main is the original sha" || bad "clean case: origin/main wrong"

# ---- Case 3: bounded failure -- origin keeps moving and max is exhausted, the
# function refuses (returns non-zero) rather than looping forever.
echo '<html>c3</html>' > "$T/other/design-c3.html"
git -C "$T/other" add -A && git -C "$T/other" commit -q -m c3 && git -C "$T/other" push -q origin HEAD:main 2>/dev/null
# max=1: the first push is rejected and attempt>=max immediately, so it gives up.
OUT3="$(site_push_with_replay "$T/site" "$(git -C "$T/site" rev-parse HEAD)" "$MSG" "$T" 1 "$PATHS" 2>/dev/null)"
[ "$?" != 0 ] && ok "bounded: it refuses (non-zero) when the max is exhausted, not an infinite loop" || bad "bounded: it returned 0 despite an unresolvable race"

# ---- Case 4: a relative reindex_dir is refused (the temp index would land in the
# wrong place under `git -C`), before any push is attempted.
OUT4="$(site_push_with_replay "$T/site2" "$(git -C "$T/site2" rev-parse HEAD)" "$MSG" "relative/dir" 5 "$PATHS" 2>/dev/null)"
[ "$?" != 0 ] && ok "guard: a relative reindex_dir is refused" || bad "guard: a relative reindex_dir was accepted (got '$OUT4')"

echo "site-push-race: $FAILS failures"
[ "$FAILS" = 0 ] || exit 1
