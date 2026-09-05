#!/bin/bash
# #2276/#2278/#2286: the site push at release.sh 7b must survive a chaoskosmos-site
# merge that lands MID-CUT, WITHOUT touching the shared checkout, WITHOUT diverging
# local main, and WITHOUT overlaying a concurrent versions.html edit.
#
# Drives the REAL site_commit_on_fresh_main (tools/lib/site-push.sh) -- the function
# release.sh calls at 7b -- and the REAL tools/reinsert-versions-entry.js, against
# scratch repos. Nothing here touches ~/work or the network.
set -u
cd "$(dirname "$0")/.." || exit 1
REPO="$(pwd)"
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
VER="9.9.9"

# A real versions.html carrying one existing entry (id v9-9-8), the shape
# reinsert-versions-entry.js anchors on (4-space-indented <article class="rel">).
base_versions() {
  cat <<'HTML'
<!doctype html><html><body>
  <main>
    <article class="rel" id="v9-9-8">
      <div class="rel-h"><h2 class="rel-v">0.9.8</h2><span class="rel-d">old</span></div>
      <p>the previous release</p>
    </article>
  </main>
</body></html>
HTML
}
# Our cut's working-tree versions.html: the same page with our new v9-9-9 entry
# inserted above the newest one (what insert-release-entry.js would have produced).
our_versions() {
  cat <<'HTML'
<!doctype html><html><body>
  <main>
    <article class="rel" id="v9-9-9">
      <div class="rel-h"><h2 class="rel-v">9.9.9</h2><span class="rel-d">now</span></div>
      <p>this release</p>
    </article>
    <article class="rel" id="v9-9-8">
      <div class="rel-h"><h2 class="rel-v">0.9.8</h2><span class="rel-d">old</span></div>
      <p>the previous release</p>
    </article>
  </main>
</body></html>
HTML
}

# Build an origin + site checkout at the base, then lay down the cut's working-tree
# release files (UNCOMMITTED -- the function reads the working tree, as 7b now does).
mk_site() {
  local o="$1" s="$2"
  git init -q --bare --initial-branch=main "$o"
  git clone -q "$o" "$s" 2>/dev/null
  mkdir -p "$s/dist"
  echo '{"version":"0.0.0"}' > "$s/dist/latest-staging.json"
  echo 'old-setup'           > "$s/setup"
  echo 'oldsha  setup'       > "$s/setup.sha256"
  base_versions              > "$s/versions.html"
  echo '<html>home v1</html>'> "$s/index.html"
  printf 'dist/*.tar.gz\n'   > "$s/.gitignore"
  git -C "$s" add -A && git -C "$s" commit -q -m base
  git -C "$s" push -q origin HEAD:main 2>/dev/null
  # the cut writes this version's files into the working tree, uncommitted:
  echo '{"version":"9.9.9"}' > "$s/dist/latest-staging.json"
  echo '{"new":true}'        > "$s/dist/kosmos-9.9.9-arm64.manifest.json"   # a NEW, untracked file
  echo 'new-setup'           > "$s/setup"
  echo 'newsha  setup'       > "$s/setup.sha256"
  our_versions               > "$s/versions.html"
}

# =====================================================================
# Case A: a PAGE merge (a different file) lands on origin/main mid-cut.
# The push survives; the page and our release files both end up on origin/main;
# the shared checkout's real index and a colleague's uncommitted work are untouched.
mk_site "$T/oA.git" "$T/sA"
LOCAL_BEFORE_A="$(git -C "$T/sA" rev-parse HEAD)"
echo '<html>home v2 WIP by a colleague</html>' > "$T/sA/index.html"   # uncommitted colleague work
COLLEAGUE_WIP="$(cat "$T/sA/index.html")"
INDEX_BEFORE_A="$(git -C "$T/sA" status --porcelain)"
git clone -q "$T/oA.git" "$T/otherA" 2>/dev/null
echo '<html>design mock</html>' > "$T/otherA/design-new.html"
git -C "$T/otherA" add -A && git -C "$T/otherA" commit -q -m "design mock"
git -C "$T/otherA" push -q origin HEAD:main 2>/dev/null
NEW_A="$(site_commit_on_fresh_main "$T/sA" "$MSG" "$T" 5 "$PATHS" "$VER" "$REPO")"; RC=$?
[ "$RC" = 0 ] && [ -n "$NEW_A" ] && ok "A: push survived a concurrent page merge (rc0)" || bad "A: returned $RC / '$NEW_A' on a routine race"
[ "$(git -C "$T/oA.git" rev-parse main)" = "$NEW_A" ] && ok "A: origin/main IS the reported sha" || bad "A: origin/main is not the reported sha"
git -C "$T/oA.git" cat-file -e "$NEW_A:design-new.html" 2>/dev/null && ok "A: the concurrent page file survived on origin/main" || bad "A: the concurrent page merge was clobbered"
[ "$(git -C "$T/oA.git" show "$NEW_A:dist/latest-staging.json")" = '{"version":"9.9.9"}' ] && ok "A: the release pointer is on origin/main" || bad "A: the release pointer is missing"
git -C "$T/oA.git" cat-file -e "$NEW_A:dist/kosmos-9.9.9-arm64.manifest.json" 2>/dev/null && ok "A: the NEW untracked manifest landed on origin/main (temp-index add path)" || bad "A: the untracked manifest did not land"
git -C "$T/oA.git" show "$NEW_A:versions.html" | grep -q 'id="v9-9-9"' && ok "A: our versions entry is on origin/main" || bad "A: our versions entry is missing"
[ "$(cat "$T/sA/index.html")" = "$COLLEAGUE_WIP" ] && ok "A: colleague's uncommitted page edit untouched" || bad "A: the function disturbed the shared working tree"
[ "$(git -C "$T/sA" status --porcelain)" = "$INDEX_BEFORE_A" ] && ok "A: the site's real index/worktree state unchanged" || bad "A: the function leaked into the real index"
[ "$(git -C "$T/sA" rev-parse HEAD)" = "$LOCAL_BEFORE_A" ] && ok "A: local main was NOT moved (never diverges)" || bad "A: the function moved local main"

# =====================================================================
# Case B (the #2286 case): a concurrent merge EDITS versions.html (adds its own
# entry v9-9-8-1) mid-cut. The re-insert must keep BOTH that entry AND ours, not
# overlay our whole file. RED-CAPABLE: an overlay implementation loses v9-9-8-1.
mk_site "$T/oB.git" "$T/sB"
git clone -q "$T/oB.git" "$T/otherB" 2>/dev/null
# the concurrent merge adds a v9-9-8-1 entry above the existing one on origin/main:
python3 - "$T/otherB/versions.html" <<'PY'
import sys
p=sys.argv[1]
h=open(p).read()
entry='    <article class="rel" id="v9-9-8-1">\n      <p>concurrent hotfix</p>\n    </article>\n'
i=h.index('    <article class="rel"')
open(p,'w').write(h[:i]+entry+h[i:])
PY
git -C "$T/otherB" add -A && git -C "$T/otherB" commit -q -m "concurrent versions edit"
git -C "$T/otherB" push -q origin HEAD:main 2>/dev/null
NEW_B="$(site_commit_on_fresh_main "$T/sB" "$MSG" "$T" 5 "$PATHS" "$VER" "$REPO")"; RC=$?
[ "$RC" = 0 ] && ok "B: push survived a concurrent versions.html edit (rc0)" || bad "B: returned $RC on a concurrent versions edit"
BV="$(git -C "$T/oB.git" show "$NEW_B:versions.html")"
printf '%s' "$BV" | grep -q 'id="v9-9-9"'  && ok "B: OUR entry is present after re-insert" || bad "B: our entry was lost"
printf '%s' "$BV" | grep -q 'id="v9-9-8-1"' && ok "B: the CONCURRENT entry survived (re-insert, not overlay)" || bad "B: the concurrent versions entry was OVERLAID away"
printf '%s' "$BV" | grep -q 'id="v9-9-8"'  && ok "B: the pre-existing entry survived" || bad "B: the pre-existing entry was lost"
# our entry must sit above the concurrent one (newest on top)
printf '%s' "$BV" | awk '/id="v9-9-9"/{a=NR} /id="v9-9-8-1"/{b=NR} END{exit !(a && b && a<b)}' && ok "B: our entry is above the concurrent one (ordering)" || bad "B: ordering wrong"

# =====================================================================
# Case C: the clean case (no concurrent merge). It still builds a fresh commit on
# origin's tip and pushes it; origin advances by one commit carrying our files;
# local main is not moved.
mk_site "$T/oC.git" "$T/sC"
LOCAL_BEFORE_C="$(git -C "$T/sC" rev-parse HEAD)"
NEW_C="$(site_commit_on_fresh_main "$T/sC" "$MSG" "$T" 5 "$PATHS" "$VER" "$REPO")"; RC=$?
[ "$RC" = 0 ] && [ -n "$NEW_C" ] && ok "C: clean case pushed (rc0)" || bad "C: clean case failed ($RC)"
[ "$(git -C "$T/oC.git" rev-parse main)" = "$NEW_C" ] && ok "C: origin/main is the pushed sha" || bad "C: origin/main wrong"
git -C "$T/oC.git" show "$NEW_C:versions.html" | grep -q 'id="v9-9-9"' && ok "C: our entry landed" || bad "C: our entry missing on clean push"
[ "$(git -C "$T/sC" rev-parse HEAD)" = "$LOCAL_BEFORE_C" ] && ok "C: local main not moved on the clean path" || bad "C: local main moved on clean path"

# =====================================================================
# The push discrimination grep (site-push.sh: retry ONLY a genuine non-ff), the
# retry loop, and the max bound. These are driven deterministically with a
# pre-receive hook on the bare origin that counts push attempts and rejects each
# one -- the hook's stderr becomes the client's push error, so it controls which
# branch of the discrimination grep fires. (A LIVE moving-tip race is absorbed on
# the next fetch, so it cannot exhaust max in a unit test; the hook reproduces the
# rejected-push path without needing timing.)

# Case E1: a broken remote makes the FETCH fail first -- the function aborts before
# any push, non-zero.
mk_site "$T/oE.git" "$T/sE"
git -C "$T/sE" remote set-url origin "$T/does-not-exist.git"
OUT_E="$(site_commit_on_fresh_main "$T/sE" "$MSG" "$T" 5 "$PATHS" "$VER" "$REPO" 2>/dev/null)"; RC=$?
[ "$RC" != 0 ] && ok "E1: a broken remote (fetch fails) aborts non-zero" || bad "E1: a broken remote returned 0"

# Case E2: a NON-race push rejection (the hook's message does not match the non-ff
# grep) aborts after EXACTLY ONE attempt -- no retry storm.
mk_site "$T/oE2.git" "$T/sE2"
cat > "$T/oE2.git/hooks/pre-receive" <<EOF
#!/bin/sh
echo x >> "$T/e2-count"
echo "remote error: authentication required -- not a race" >&2
exit 1
EOF
chmod +x "$T/oE2.git/hooks/pre-receive"
rm -f "$T/e2-count"
OUT_E2="$(site_commit_on_fresh_main "$T/sE2" "$MSG" "$T" 5 "$PATHS" "$VER" "$REPO" 2>/dev/null)"; RC=$?
CNT2=$(wc -l < "$T/e2-count" 2>/dev/null | tr -d ' ')
{ [ "$RC" != 0 ] && [ "$CNT2" = 1 ]; } && ok "E2: a non-race push rejection aborts after ONE attempt (no retry)" || bad "E2: rc=$RC attempts=$CNT2 (expected non-zero + exactly 1)"

# Case E3: a persistent NON-FF rejection (the hook echoes 'non-fast-forward', which
# the grep matches) RETRIES up to max and then aborts. Exercises the retry loop and
# the bound. max=3 -> exactly 3 push attempts, then non-zero.
mk_site "$T/oE3.git" "$T/sE3"
cat > "$T/oE3.git/hooks/pre-receive" <<EOF
#!/bin/sh
echo x >> "$T/e3-count"
echo "non-fast-forward" >&2
exit 1
EOF
chmod +x "$T/oE3.git/hooks/pre-receive"
rm -f "$T/e3-count"
OUT_E3="$(site_commit_on_fresh_main "$T/sE3" "$MSG" "$T" 3 "$PATHS" "$VER" "$REPO" 2>/dev/null)"; RC=$?
CNT3=$(wc -l < "$T/e3-count" 2>/dev/null | tr -d ' ')
{ [ "$RC" != 0 ] && [ "$CNT3" = 3 ]; } && ok "E3: a persistent non-ff retries to max (3) then aborts" || bad "E3: rc=$RC attempts=$CNT3 (expected non-zero + exactly 3)"

# Case E4: the CORE recovery path -- a non-ff rejection on the FIRST push, then
# SUCCESS on retry (reject -> re-fetch/rebuild -> push accepted). The hook rejects
# attempt 1 with a non-ff message and accepts attempt 2.
mk_site "$T/oE4.git" "$T/sE4"
cat > "$T/oE4.git/hooks/pre-receive" <<EOF
#!/bin/sh
n=\$(cat "$T/e4-count" 2>/dev/null || echo 0); n=\$((n+1)); echo "\$n" > "$T/e4-count"
if [ "\$n" = 1 ]; then echo "fetch first (non-fast-forward)" >&2; exit 1; fi
exit 0
EOF
chmod +x "$T/oE4.git/hooks/pre-receive"
rm -f "$T/e4-count"
OUT_E4="$(site_commit_on_fresh_main "$T/sE4" "$MSG" "$T" 5 "$PATHS" "$VER" "$REPO" 2>/dev/null)"; RC=$?
CNT4=$(cat "$T/e4-count" 2>/dev/null)
{ [ "$RC" = 0 ] && [ -n "$OUT_E4" ] && [ "$CNT4" = 2 ]; } && ok "E4: a non-ff rejection then SUCCEEDS on retry (2 attempts)" || bad "E4: rc=$RC out='$OUT_E4' attempts=$CNT4 (expected rc0 + 2)"
git -C "$T/oE4.git" show "$OUT_E4:versions.html" 2>/dev/null | grep -q 'id="v9-9-9"' && ok "E4: our entry landed on origin/main after the retry" || bad "E4: our entry missing after retry"

# =====================================================================
# Case G: release_versions_entry_present must NOT false-abort on a PRODUCTION-SIZE
# versions.html under set -o pipefail. This is the regression guard for the SIGPIPE
# class: a `git show | grep -q` here dies of SIGPIPE (grep exits early) and pipefail
# turns the pipeline status into 141, which a caller reads as "entry absent". The
# capture+case implementation must return 0 on a >256KB page carrying the entry.
mk_site "$T/oG.git" "$T/sG"
python3 - "$T/sG/versions.html" <<'PY'
import sys
p=sys.argv[1]
top='<!doctype html><html><body>\n  <main>\n    <article class="rel" id="v9-9-9">\n      <p>this release</p>\n    </article>\n'
filler=''.join('    <article class="rel" id="v0-0-%d">\n      <p>%s</p>\n    </article>\n'%(i,'x'*200) for i in range(2000))
open(p,'w').write(top+filler+'  </main>\n</body></html>\n')
PY
git -C "$T/sG" add versions.html && git -C "$T/sG" commit -q -m big
BIGSHA="$(git -C "$T/sG" rev-parse HEAD)"
BIGSZ=$(wc -c < "$T/sG/versions.html" | tr -d ' ')
( set -euo pipefail; . "$REPO/tools/lib/site-push.sh"; release_versions_entry_present "$T/sG" "$BIGSHA" "9.9.9" ); RCG=$?
{ [ "$BIGSZ" -gt 262144 ] && [ "$RCG" = 0 ]; } && ok "G: entry-present check passes on a ${BIGSZ}-byte page under pipefail (no SIGPIPE false-abort)" || bad "G: large-file check rc=$RCG size=$BIGSZ (SIGPIPE/pipefail regression?)"
( set -euo pipefail; . "$REPO/tools/lib/site-push.sh"; release_versions_entry_present "$T/sG" "$BIGSHA" "1.2.3" ); RCG2=$?
[ "$RCG2" != 0 ] && ok "G: entry-present check correctly reports an ABSENT version (red-capable)" || bad "G: entry check false-passed for an absent version"

# =====================================================================
# Case F: guards -- a relative reindex_dir is refused; a paths set without
# versions.html is refused; both before any push.
mk_site "$T/oF.git" "$T/sF"
OUT_F1="$(site_commit_on_fresh_main "$T/sF" "$MSG" "relative/dir" 5 "$PATHS" "$VER" "$REPO" 2>/dev/null)"; [ "$?" != 0 ] && ok "F: relative reindex_dir refused" || bad "F: relative reindex_dir accepted"
OUT_F2="$(site_commit_on_fresh_main "$T/sF" "$MSG" "$T" 5 "dist/latest-staging.json setup" "$VER" "$REPO" 2>/dev/null)"; [ "$?" != 0 ] && ok "F: a paths set without versions.html refused" || bad "F: missing versions.html accepted"

# =====================================================================
# Unit: reinsert-versions-entry.js
RE="$REPO/tools/reinsert-versions-entry.js"
base_versions > "$T/ub.html"
our_versions  > "$T/uo.html"
U1="$(node "$RE" "$T/ub.html" "$T/uo.html" "$VER")"; RC=$?
[ "$RC" = 0 ] && printf '%s' "$U1" | grep -q 'id="v9-9-9"' && printf '%s' "$U1" | grep -q 'id="v9-9-8"' && ok "U: re-insert adds our entry and keeps the base entry" || bad "U: re-insert output wrong ($RC)"
# our entry above the base one
printf '%s' "$U1" | awk '/id="v9-9-9"/{a=NR} /id="v9-9-8"/{b=NR} END{exit !(a&&b&&a<b)}' && ok "U: re-insert places our entry on top" || bad "U: re-insert ordering wrong"
# idempotence: a base that already carries v9-9-9 is refused
our_versions > "$T/ubdup.html"
node "$RE" "$T/ubdup.html" "$T/uo.html" "$VER" >/dev/null 2>&1; [ "$?" != 0 ] && ok "U: re-insert refuses a version already on the fresh page (idempotence)" || bad "U: re-insert rewrote an existing version"
# a missing entry in our file is refused
node "$RE" "$T/ub.html" "$T/ub.html" "$VER" >/dev/null 2>&1; [ "$?" != 0 ] && ok "U: re-insert refuses when our file lacks the entry" || bad "U: re-insert accepted a missing entry"

echo "site-push-race: $FAILS failures"
[ "$FAILS" = 0 ] || exit 1
