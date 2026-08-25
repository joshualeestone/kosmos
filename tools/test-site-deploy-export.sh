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
# the hazards: an untracked stray, an ignored stray in dist, a half-edited page,
# a STAGED new page, and a tarball in a subdirectory of dist.
printf 'stray\n' > "$S/notes.txt"; printf 'junk\n' > "$S/dist/build.log"; printf '<h1>HALF EDITED</h1>\n' > "$S/index.html"
printf '<h1>staged</h1>\n' > "$S/new.html"; git -C "$S" add new.html
mkdir -p "$S/dist/sub"; printf 'DEEP\n' > "$S/dist/sub/kosmos-9.9.9-arm64.tar.gz"
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
ls "$O".archive.* >/dev/null 2>&1 && bad "the archive temp file was left beside the export" || ok "no archive temp file left beside the export"
printf '%s\n' "$man" | grep -q "untracked: notes.txt" && ok "the manifest names the untracked stray as left behind" || bad "the manifest did not name notes.txt: $man"
printf '%s\n' "$man" | grep -q "ignored:   dist/build.log" && ok "the manifest names the ignored stray as left behind" || bad "the manifest did not name build.log: $man"
printf '%s\n' "$man" | grep -q "modified:  index.html (deploys as committed)" && ok "the manifest names the half-edited page and says it deploys as committed" || bad "the manifest did not name index.html: $man"
printf '%s\n' "$man" | grep -q "carried: 4 bundle files" && ok "the manifest counts the bundle files carried" || bad "the bundle count is wrong: $man"
[ ! -e "$O/new.html" ] && ok "a staged, uncommitted page does not ship" || bad "a staged page shipped"
printf '%s\n' "$man" | grep -q "staged, not committed: new.html (does not deploy)" && ok "the manifest says a staged page does not deploy (not 'deploys as committed')" || bad "the manifest misdescribed the staged page: $man"
[ ! -e "$O/dist/sub/kosmos-9.9.9-arm64.tar.gz" ] && ok "a tarball in a subdirectory of dist is not carried" || bad "a nested tarball was carried"
# (untracked, not ignored: the site's dist/*.tar.gz pattern does not cross a slash)
printf '%s\n' "$man" | grep -q "untracked: dist/sub/kosmos-9.9.9-arm64.tar.gz" && ok "and the manifest lists the nested tarball as left behind (it is not a named class)" || bad "the nested tarball was neither carried nor listed: $man"

# refusals: a missing project link, a non-empty output dir, a non-repo.
rm -rf "$T/out2"; rm "$S/.vercel/project.json"
if site_deploy_export "$S" "$T/out2" >/dev/null 2>&1; then bad "an export with no project link did not refuse"; else ok "no .vercel/project.json refuses"; fi
printf '{"projectId":"p"}\n' > "$S/.vercel/project.json"
# (a fresh dir holding one unrelated file: the previous control reused $O, whose hard
# links made the carry step refuse, so the emptiness guard was never what failed)
mkdir -p "$T/outfull"; printf 'x\n' > "$T/outfull/unrelated.txt"
if site_deploy_export "$S" "$T/outfull" >/dev/null 2>"$T/err"; then bad "exporting into a non-empty dir did not refuse"; else grep -q "is not empty" "$T/err" && ok "a non-empty output dir refuses, by the emptiness guard" || bad "the non-empty dir refused for another reason: $(cat "$T/err")"; fi
# (GIT_CEILING_DIRECTORIES makes this independent of whether some ancestor of TMPDIR is a checkout)
if GIT_CEILING_DIRECTORIES="$T" site_deploy_export "$T/notarepo" "$T/out3" >/dev/null 2>&1; then bad "a non-repo did not refuse"; else ok "a directory that is not a git checkout refuses"; fi

# a partial pkg triple refuses (the pkg present, its sidecar missing).
rm -rf "$T/out5"; rm "$S/dist/Kosmos.pkg.inputs"
if site_deploy_export "$S" "$T/out5" >/dev/null 2>"$T/err"; then bad "a pkg without its inputs sidecar did not refuse"; else grep -q "without dist/Kosmos.pkg.inputs" "$T/err" && ok "a partial pkg triple refuses and names the missing file" || bad "the refusal did not name the file: $(cat "$T/err")"; fi
[ ! -e "$T/out5" ] && ok "a refusal leaves no partial export behind (the output dir is removed)" || bad "a refused export left files in the output dir"
printf 'in\npkg:z\n' > "$S/dist/Kosmos.pkg.inputs"
# a git that cannot list the tree is a refusal, never "left behind: nothing".
# (the stub execs the REAL git by absolute path; `env git` would find the stub again and recurse forever)
# (the stubs read the SUBCOMMAND after any -C <dir> / -c k=v, not "$*", which contains paths)
REALGIT="$(command -v git)"; mkdir -p "$T/bin"
printf '#!/bin/bash\norig=("$@"); sub=""; while [ $# -gt 0 ]; do case "$1" in -C|-c) shift 2;; -*) shift;; *) sub="$1"; break;; esac; done\n[ "$sub" = status ] && exit 128\nexec %s "${orig[@]}"\n' "$REALGIT" > "$T/bin/git"; chmod +x "$T/bin/git"
rm -rf "$T/out6"; if PATH="$T/bin:$PATH" site_deploy_export "$S" "$T/out6" >"$T/man6" 2>"$T/err6"; then bad "a failing git status did not refuse: $(cat "$T/man6")"; else grep -q "could not list the working tree" "$T/err6" && ok "a failing git status refuses instead of claiming a clean tree" || bad "the refusal did not say why: $(cat "$T/err6")"; fi
grep -q "left behind: nothing" "$T/man6" && bad "the clean-tree claim was printed on a failed listing" || ok "no clean-tree claim on a failed listing"

# an orphan sidecar (no pkg beside it) and a dotfile tarball match the name patterns but are
# NOT carried; the manifest must list them, keyed on what was carried, not on the pattern.
git -C "$S" reset -q -- new.html; rm -f "$S/new.html"; rm -rf "$S/dist/sub"
mv "$S/dist/Kosmos.pkg" "$T/pkg.aside"; printf 'DOT\n' > "$S/dist/.hidden.tar.gz"; printf 'SP\n' > "$S/dist/kosmos-1.0.0-arm64 copy.tar.gz"; printf 'UTF\n' > "$S/dist/café.tar.gz"
rm -rf "$T/out7"; man="$(site_deploy_export "$S" "$T/out7")"
[ ! -e "$T/out7/dist/Kosmos.pkg.sha256" ] && ok "an orphan checksum (no pkg) is not carried" || bad "an orphan checksum was carried"
printf '%s\n' "$man" | grep -q "ignored:   dist/Kosmos.pkg.sha256" && ok "and the manifest lists the orphan checksum as left behind" || bad "the orphan checksum vanished from the manifest: $man"
[ ! -e "$T/out7/dist/.hidden.tar.gz" ] && ok "a dotfile tarball is not carried" || bad "a dotfile tarball was carried"
printf '%s\n' "$man" | grep -q "ignored:   dist/.hidden.tar.gz" && ok "and the manifest lists the dotfile tarball as left behind" || bad "the dotfile tarball vanished from the manifest: $man"
# names with a space or non-ASCII bytes are carried AND not listed as left behind (porcelain -z, never quoted).
[ -f "$T/out7/dist/kosmos-1.0.0-arm64 copy.tar.gz" ] && ok "a tarball with a space in its name is carried" || bad "the spaced tarball was not carried"
printf '%s\n' "$man" | grep -q "arm64 copy\.tar\.gz" && bad "the carried spaced tarball was listed as left behind (quoted path missed the carried list): $man" || ok "and it is not listed as left behind"
[ -f "$T/out7/dist/café.tar.gz" ] && ok "a non-ASCII tarball is carried" || bad "the non-ASCII tarball was not carried"
# ⚠️ The FILENAME, not three letters: `grep -q "caf"` also matched the site
# COMMIT SHA in the manifest's "pages: commit …f63c2caf" line, so this check
# went red whenever a commit hash happened to end in those hex letters and
# green otherwise (#850: intermittent inside the chain, 40/40 green alone).
printf '%s\n' "$man" | grep -q "café\.tar\.gz" && bad "the carried non-ASCII tarball was listed as left behind: $man" || ok "and it is not listed as left behind"
rm -f "$S/dist/kosmos-1.0.0-arm64 copy.tar.gz" "$S/dist/café.tar.gz"
mv "$T/pkg.aside" "$S/dist/Kosmos.pkg"; rm -f "$S/dist/.hidden.tar.gz"
# a TRACKED file that matches a carry glob refuses (the export would overwrite the committed copy).
printf 'tracked\n' > "$S/dist/tmux-arm64.tar.gz.sha256"; git -C "$S" add -f dist/tmux-arm64.tar.gz.sha256 && git -C "$S" commit -qm "force-tracked artifact"
rm -rf "$T/out12"; if site_deploy_export "$S" "$T/out12" >/dev/null 2>"$T/err12"; then bad "a tracked file matching a carry glob did not refuse"; else grep -q "tracked by git AND matches a carry pattern" "$T/err12" && ok "a tracked file matching a carry glob refuses and says why" || bad "the refusal did not say why: $(cat "$T/err12")"; fi
git -C "$S" rm -q --cached dist/tmux-arm64.tar.gz.sha256 && git -C "$S" commit -qm "untrack it"
# the same guard on the pkg triple.
git -C "$S" add -f dist/Kosmos.pkg.inputs && git -C "$S" commit -qm "force-tracked sidecar"
rm -rf "$T/out17"; if site_deploy_export "$S" "$T/out17" >/dev/null 2>"$T/err17"; then bad "a tracked sidecar in the pkg triple did not refuse"; else grep -q "dist/Kosmos.pkg.inputs is tracked by git" "$T/err17" && ok "a tracked file in the pkg triple refuses too" || bad "the triple refusal did not say why: $(cat "$T/err17")"; fi
git -C "$S" rm -q --cached dist/Kosmos.pkg.inputs && git -C "$S" commit -qm "untrack the sidecar"
# a tracked file deleted in the working tree says "deleted", and deploys as committed.
rm "$S/vercel.json"; rm -rf "$T/out8"; man="$(site_deploy_export "$S" "$T/out8")"
[ -f "$T/out8/vercel.json" ] && ok "a file deleted in the working tree still deploys as committed" || bad "a working-tree deletion reached the export"
printf '%s\n' "$man" | grep -q "deleted:   vercel.json (deploys as committed)" && ok "and the manifest says deleted" || bad "the deletion was not described as deleted: $man"
git -C "$S" checkout -q -- vercel.json
# a staged rename is two records under -z; the old name must not be re-parsed as a path.
git -C "$S" mv vercel.json about.json
rm -rf "$T/out13"; man="$(site_deploy_export "$S" "$T/out13")"
printf '%s\n' "$man" | grep -q "renamed, not committed: vercel.json -> about.json" && ok "a staged rename is described with both names" || bad "the rename was mangled: $man"
# (the mangled form was a status word followed by the old name minus its first three characters)
printf '%s\n' "$man" | grep -qE "(modified|untracked|ignored|deleted): +cel\.json" && bad "a truncated path leaked into the manifest: $man" || ok "no truncated path in the manifest"
[ -f "$T/out13/vercel.json" ] && [ ! -e "$T/out13/about.json" ] && ok "the rename deploys as committed, under the old name" || bad "the rename reached the export"
git -C "$S" mv about.json vercel.json
# a WORK-TREE rename (intent-to-add) has the same two-record shape with the R in the other column.
git -C "$S" mv vercel.json about.json && git -C "$S" reset -q -- vercel.json about.json && git -C "$S" add -N about.json
rm -rf "$T/out16"; man="$(site_deploy_export "$S" "$T/out16")"
printf '%s\n' "$man" | grep -q "renamed, not committed: vercel.json -> about.json" && ok "a work-tree rename (intent-to-add) is described with both names" || bad "the work-tree rename was mangled: $man"
printf '%s\n' "$man" | grep -qE "(modified|untracked|ignored|deleted): +cel\.json" && bad "a truncated path leaked for the work-tree rename: $man" || ok "no truncated path for the work-tree rename"
git -C "$S" reset -q -- about.json; mv "$S/about.json" "$S/vercel.json"; git -C "$S" checkout -q -- vercel.json 2>/dev/null || true
# the status listing's failure is seen WITHOUT the caller's pipefail (a clean-tree claim came from tr's 0 before).
rm -rf "$T/out14"; if ( set +o pipefail; PATH="$T/bin:$PATH" site_deploy_export "$S" "$T/out14" ) >"$T/man14" 2>"$T/err14"; then bad "a failing git status did not refuse without pipefail: $(cat "$T/man14")"; else grep -q "could not list the working tree" "$T/err14" && [ ! -e "$T/out14" ] && ok "a failing git status refuses without the caller's pipefail, and leaves nothing" || bad "wrong reason or dir remained: $(cat "$T/err14")"; fi
# the pkg triple is COPIED, not linked: an in-place overwrite of the shared pkg must not change the export's copy.
rm -rf "$T/out15"; site_deploy_export "$S" "$T/out15" >/dev/null; printf 'OVERWRITTEN\n' > "$S/dist/Kosmos.pkg"
[ "$(cat "$T/out15/dist/Kosmos.pkg")" = "PKG" ] && ok "the export's pkg is a copy: an in-place overwrite of the shared dist does not reach it" || bad "the export's pkg followed an in-place overwrite (hard link)"
printf 'PKG\n' > "$S/dist/Kosmos.pkg"
# the archive's failure is seen WITHOUT the caller's pipefail (an empty site read as ready before).
printf '#!/bin/bash\norig=("$@"); sub=""; while [ $# -gt 0 ]; do case "$1" in -C|-c) shift 2;; -*) shift;; *) sub="$1"; break;; esac; done\n[ "$sub" = archive ] && exit 128\nexec %s "${orig[@]}"\n' "$REALGIT" > "$T/bin/git-noarchive"; chmod +x "$T/bin/git-noarchive"
mkdir -p "$T/bin2"; cp "$T/bin/git-noarchive" "$T/bin2/git"
rm -rf "$T/out9"; if ( set +o pipefail; PATH="$T/bin2:$PATH" site_deploy_export "$S" "$T/out9" ) >/dev/null 2>"$T/err9"; then bad "a failing git archive did not refuse without pipefail (an empty site would deploy)"; else grep -q "git archive of" "$T/err9" && [ ! -e "$T/out9" ] && ok "a failing git archive refuses without the caller's pipefail, and leaves nothing" || bad "the archive failure was not the reason, or the dir remained: $(cat "$T/err9")"; fi
# the export takes a commit: the FIRST commit's page, not HEAD's, when asked for it.
FIRST="$(git -C "$S" rev-parse HEAD)"; printf '<h1>second</h1>\n' > "$S/index.html"; git -C "$S" commit -qam "second"
rm -rf "$T/out10"; site_deploy_export "$S" "$T/out10" "$FIRST" >/dev/null
[ "$(cat "$T/out10/index.html")" = "<h1>committed</h1>" ] && ok "the export archives the commit it is given, not HEAD" || bad "the export ignored the commit argument: $(cat "$T/out10/index.html")"
rm -rf "$T/out11"; if site_deploy_export "$S" "$T/out11" "nosuchsha" >/dev/null 2>&1; then bad "a non-commit argument did not refuse"; else ok "a commit argument that is not a commit refuses"; fi
git -C "$S" reset -q --hard "$FIRST"
git -C "$S" checkout -q -- index.html; rm -f "$S/notes.txt" "$S/dist/build.log"
man="$(site_deploy_export "$S" "$T/out4")"
printf '%s\n' "$man" | grep -q "left behind: nothing" && ok "a clean tree reports nothing left behind" || bad "a clean tree reported strays: $man"

echo "site-deploy-export: $FAILS failures"; [ "$FAILS" -eq 0 ]
