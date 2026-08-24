#!/bin/bash
# The site deploy export, with the controls that make it mean something
# (#649): a stray file, a stray ignored file and a half-edited page are all
# in the working tree and none of them ship; the named artifacts do.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tools/lib/site-deploy.sh
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/site-deploy-export.XXXXXX")"; trap 'rm -rf "$T"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
S="$T/site"; git init -q "$S"
printf '<h1>committed</h1>\n' > "$S/index.html"; printf '{}\n' > "$S/vercel.json"; printf 'docs/\n' > "$S/.vercelignore"
printf 'dist/*.tar.gz\ndist/*.tar.gz.sha256\ndist/*.pkg\ndist/*.pkg.sha256\ndist/*.pkg.inputs\n.vercel\n*.log\n' > "$S/.gitignore"
mkdir -p "$S/dist"; printf '{"version":"1.0.0"}\n' > "$S/dist/latest.json"
git -C "$S" add -A && git -C "$S" commit -q -m "site"
# the named artifacts, gitignored, in the working tree
printf 'TARBALL\n' > "$S/dist/kosmos-1.0.0-arm64.tar.gz"; printf 'x  kosmos-1.0.0-arm64.tar.gz\n' > "$S/dist/kosmos-1.0.0-arm64.tar.gz.sha256"
printf 'OLD\n' > "$S/dist/kosmos-0.9.0-arm64.tar.gz"; printf 'TMUX\n' > "$S/dist/tmux-arm64.tar.gz"
printf 'PKG\n' > "$S/dist/Kosmos.pkg"; printf 'y  Kosmos.pkg\n' > "$S/dist/Kosmos.pkg.sha256"; printf 'in\npkg:z\n' > "$S/dist/Kosmos.pkg.inputs"
mkdir -p "$S/.vercel"; printf '{"projectId":"p"}\n' > "$S/.vercel/project.json"
# the hazards: an untracked stray, an ignored stray in dist, and a half-edited page
printf 'stray\n' > "$S/notes.txt"; printf 'junk\n' > "$S/dist/build.log"; printf '<h1>HALF EDITED</h1>\n' > "$S/index.html"
# CONTROL: the hazards are really in the working tree.
[ "$(cat "$S/index.html")" = "<h1>HALF EDITED</h1>" ] && ok "CONTROL: the working tree really holds the half-edit" || bad "control: the half-edit is not in the tree"
git -C "$S" status --porcelain | grep -q "notes.txt" && ok "CONTROL: the stray file is really untracked in the working tree" || bad "control: the stray is not there"

O="$T/out"; man="$(site_deploy_export "$S" "$O")"; rc=$?
[ "$rc" = 0 ] && ok "the export returns 0" || bad "the export refused (rc $rc): $man"
[ "$(cat "$O/index.html" 2>/dev/null)" = "<h1>committed</h1>" ] && ok "the page ships AS COMMITTED, not the half-edit" || bad "the half-edited page shipped: $(cat "$O/index.html" 2>/dev/null)"
[ ! -e "$O/notes.txt" ] && ok "the untracked stray does not ship" || bad "the untracked stray shipped"
[ ! -e "$O/dist/build.log" ] && ok "the ignored stray in dist does not ship" || bad "the ignored stray shipped"
git -C "$S" check-ignore -q dist/build.log && ok "CONTROL: the stray really is gitignored (so only the named patterns could have carried it)" || bad "control: the stray is not ignored, the test would not distinguish ignored from untracked"
[ -f "$O/dist/kosmos-1.0.0-arm64.tar.gz" ] && [ -f "$O/dist/kosmos-1.0.0-arm64.tar.gz.sha256" ] && ok "the versioned bundle pair ships" || bad "the versioned bundle pair is missing"
[ -f "$O/dist/kosmos-0.9.0-arm64.tar.gz" ] && ok "an earlier versioned bundle still ships (a just-read latest.json may ask for it)" || bad "the earlier bundle was dropped"
[ -f "$O/dist/tmux-arm64.tar.gz" ] && ok "the tmux bundle ships" || bad "the tmux bundle is missing"
[ -f "$O/dist/Kosmos.pkg" ] && [ -f "$O/dist/Kosmos.pkg.sha256" ] && [ -f "$O/dist/Kosmos.pkg.inputs" ] && ok "the pkg triple ships" || bad "the pkg triple is incomplete"
[ -f "$O/.vercel/project.json" ] && ok "the Vercel project link ships" || bad "the project link is missing"
[ -f "$O/dist/latest.json" ] && [ -f "$O/vercel.json" ] && [ -f "$O/.vercelignore" ] && ok "the committed release files and the upload filter ship from the commit" || bad "a committed file is missing"
[ ! -e "$O/.git" ] && ok "no .git in the export" || bad ".git shipped"
printf '%s\n' "$man" | grep -q "untracked: notes.txt" && ok "the manifest names the untracked stray as left behind" || bad "the manifest did not name notes.txt: $man"
printf '%s\n' "$man" | grep -q "ignored:   dist/build.log" && ok "the manifest names the ignored stray as left behind" || bad "the manifest did not name build.log: $man"
printf '%s\n' "$man" | grep -q "modified:  index.html (deploys as committed)" && ok "the manifest names the half-edited page and says it deploys as committed" || bad "the manifest did not name index.html: $man"
printf '%s\n' "$man" | grep -q "carried: 4 bundle files" && ok "the manifest counts the bundle files carried" || bad "the bundle count is wrong: $man"

# refusals: a missing project link, a non-empty output dir, a non-repo.
rm -rf "$T/out2"; rm "$S/.vercel/project.json"
if site_deploy_export "$S" "$T/out2" >/dev/null 2>&1; then bad "an export with no project link did not refuse"; else ok "no .vercel/project.json refuses"; fi
printf '{"projectId":"p"}\n' > "$S/.vercel/project.json"
if site_deploy_export "$S" "$O" >/dev/null 2>&1; then bad "exporting into a non-empty dir did not refuse"; else ok "a non-empty output dir refuses"; fi
if site_deploy_export "$T" "$T/out3" >/dev/null 2>&1; then bad "a non-repo did not refuse"; else ok "a directory that is not a git checkout refuses"; fi

# a clean tree reports nothing left behind.
git -C "$S" checkout -q -- index.html; rm -f "$S/notes.txt" "$S/dist/build.log"
man="$(site_deploy_export "$S" "$T/out4")"
printf '%s\n' "$man" | grep -q "left behind: nothing" && ok "a clean tree reports nothing left behind" || bad "a clean tree reported strays: $man"

echo "site-deploy-export: $FAILS failures"; [ "$FAILS" -eq 0 ]
