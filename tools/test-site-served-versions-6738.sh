#!/bin/bash
# kosmos#6738: the deploy export rebuilds the site's api/_servedversions.js from the history of the commit it deploys,
# so a just-moved pointer is in the served table, and never writes the shared site checkout. The generator here is a
# stand-in with the real one's interface (bash tools/served-versions.sh <ref>, writing <its repo>/api/_servedversions.js
# from `git log` of dist/latest*.json through a temp file); the real one lives in the site repo.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tools/lib/site-deploy.sh
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/site-served-6738.XXXXXX")"; trap 'rm -rf "$T"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

S="$T/site"; git init -q "$S"
mkdir -p "$S/dist" "$S/api" "$S/tools" "$S/.vercel"
printf '{"projectId":"p"}\n' > "$S/.vercel/project.json"
printf '.vercel\n' > "$S/.gitignore"
cat > "$S/tools/served-versions.sh" <<'GEN'
#!/bin/bash
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
REF="${1:-origin/main}"; OUT="$REPO/api/_servedversions.js"; TMP="$OUT.tmp.$$"; trap 'rm -f "$TMP"' EXIT
{ echo "/* GENERATED */"; echo "export const SERVED = Object.freeze(["
  git -C "$REPO" log --reverse --format='%H' "$REF" -- dist/latest-staging.json | while read -r h; do
    v=$(git -C "$REPO" show "${h}:dist/latest-staging.json" | sed -n 's/.*"version" *: *"\([0-9.]*\)".*/\1/p')
    printf "  ['t', 'latest-staging.json', '%s'],\n" "$v"
  done
  echo "]);"; } > "$TMP"
mv -f "$TMP" "$OUT"
GEN
printf '{"version":"0.9.1"}\n' > "$S/dist/latest-staging.json"
printf "/* GENERATED */\nexport const SERVED = Object.freeze([\n  ['t', 'latest-staging.json', '0.9.1'],\n]);\n" > "$S/api/_servedversions.js"
git -C "$S" add -A && git -C "$S" commit -q -m "0.9.1 and its table"
# A release moves the pointer; the committed table is NOT regenerated (today's gap).
printf '{"version":"0.9.2"}\n' > "$S/dist/latest-staging.json"
git -C "$S" add dist/latest-staging.json && git -C "$S" commit -q -m "0.9.2: the staging pointer"
SHA="$(git -C "$S" rev-parse HEAD)"
before="$(shasum "$S/api/_servedversions.js")"; status_before="$(git -C "$S" status --porcelain)"
# CONTROL: the committed table at that commit lacks the new version.
git -C "$S" show "$SHA:api/_servedversions.js" | grep -q "'0.9.2'" && bad "fixture: the committed table already names 0.9.2" || ok "control: the committed table at the deployed commit lacks 0.9.2"

man="$(site_deploy_export "$S" "$T/out" "$SHA" 2>"$T/err")"; rc=$?
[ "$rc" = 0 ] && ok "the export succeeded" || bad "the export failed: $(cat "$T/err")"
grep -q "'0.9.2'" "$T/out/api/_servedversions.js" && grep -q "'0.9.1'" "$T/out/api/_servedversions.js" \
  && ok "the exported table names the pointer the deployed commit moved (0.9.2) and the earlier one" \
  || bad "the exported table is stale: $(cat "$T/out/api/_servedversions.js")"
printf '%s\n' "$man" | grep -q "rebuilt api/_servedversions.js from the history of $(printf '%.8s' "$SHA") (2 rows; the commit had 1)" \
  && ok "the export says it rebuilt the table, from which commit, and how many rows" || bad "no rebuild line: $man"
printf '%s\n' "$man" | grep -q "pages:   commit $SHA, except api/_servedversions.js (rebuilt from its history, above)" \
  && ok "the manifest's pages line says which file is not the commit's" || bad "the pages line reads as an exact copy: $man"
[ "$(shasum "$S/api/_servedversions.js")" = "$before" ] && [ "$(git -C "$S" status --porcelain)" = "$status_before" ] \
  && ok "the shared site checkout is untouched (its table byte for byte, its status)" || bad "the export wrote the site checkout"

# CONTROL: a commit from before the generator existed ships its committed table and says nothing about a rebuild.
git -C "$S" rm -q tools/served-versions.sh && git -C "$S" commit -q -m "no generator"
OLD="$(git -C "$S" rev-parse HEAD)"
man2="$(site_deploy_export "$S" "$T/out2" "$OLD" 2>&1)"
cmp -s "$T/out2/api/_servedversions.js" <(git -C "$S" show "$OLD:api/_servedversions.js") && ! printf '%s\n' "$man2" | grep -q "rebuilt api" \
  && ok "control: with no generator in the commit, the committed table ships unchanged" || bad "a commit with no generator was rebuilt or changed: $man2"

# A generator that fails: the deploy is not refused, it warns, and the committed table ships unchanged.
git -C "$S" checkout -q "$SHA" -- tools/served-versions.sh
printf '#!/bin/bash\nexit 3\n' > "$S/tools/served-versions.sh"
git -C "$S" add tools/served-versions.sh && git -C "$S" commit -q -m "a broken generator"
BAD="$(git -C "$S" rev-parse HEAD)"
site_deploy_export "$S" "$T/out3" "$BAD" >/dev/null 2>"$T/err3"; rc3=$?
[ "$rc3" = 0 ] && grep -q "served-versions table NOT rebuilt (the generator failed, exit 3: no message); the committed one ships" "$T/err3" \
  && cmp -s "$T/out3/api/_servedversions.js" <(git -C "$S" show "$BAD:api/_servedversions.js") \
  && ok "a failing generator warns, does not refuse the deploy, and the committed table ships" || bad "failing generator: rc=$rc3 $(cat "$T/err3")"

# Review 1: a generator that writes a WORSE table in place and then fails, or writes a SHORT one (a shallow clone's
# history) and succeeds: the committed table comes back either way, and the warning carries the generator's own words.
printf '#!/bin/bash\nprintf "export const SERVED = Object.freeze([\\n]);\\n" > "$(dirname "$0")/../api/_servedversions.js"\necho "fatal: boom from the generator" >&2\nexit 4\n' > "$S/tools/served-versions.sh"
git -C "$S" add tools/served-versions.sh && git -C "$S" commit -q -m "a generator that writes in place, then fails"
INPL="$(git -C "$S" rev-parse HEAD)"
site_deploy_export "$S" "$T/out4" "$INPL" >/dev/null 2>"$T/err4"; rc4=$?
[ "$rc4" = 0 ] && cmp -s "$T/out4/api/_servedversions.js" <(git -C "$S" show "$INPL:api/_servedversions.js") && grep -q "boom from the generator" "$T/err4" \
  && ok "a generator that overwrites in place then fails: the committed table comes back, its error is in the warning" || bad "in-place failure: rc=$rc4 $(cat "$T/err4")"
printf '#!/bin/bash\nprintf "export const SERVED = Object.freeze([\\n]);\\n" > "$(dirname "$0")/../api/_servedversions.js"\n' > "$S/tools/served-versions.sh"
git -C "$S" add tools/served-versions.sh && git -C "$S" commit -q -m "a generator that succeeds with a short table"
SHORT="$(git -C "$S" rev-parse HEAD)"
site_deploy_export "$S" "$T/out5" "$SHORT" >/dev/null 2>"$T/err5"; rc5=$?
[ "$rc5" = 0 ] && cmp -s "$T/out5/api/_servedversions.js" <(git -C "$S" show "$SHORT:api/_servedversions.js") && grep -q "it gave 0 rows, fewer than the commit's 1" "$T/err5" \
  && ok "a short table (fewer rows than the commit's) is not shipped; the committed one is, and the warning says why" || bad "short table: rc=$rc5 $(cat "$T/err5")"
# Review 3: a generator that exits 0 with a header but no closing line: an unparseable module never ships.
git -C "$S" checkout -q "$SHA" -- api/_servedversions.js 2>/dev/null || true
printf '#!/bin/bash\nprintf "export const SERVED = Object.freeze([\\n  [1],\\n  [2],\\n" > "$(dirname "$0")/../api/_servedversions.js"\n' > "$S/tools/served-versions.sh"
git -C "$S" add -A && git -C "$S" commit -q -m "a generator that writes half a module"
HALF="$(git -C "$S" rev-parse HEAD)"
man7="$(site_deploy_export "$S" "$T/out7" "$HALF" 2>"$T/err7")"; rc7=$?
[ "$rc7" = 0 ] && cmp -s "$T/out7/api/_servedversions.js" <(git -C "$S" show "$HALF:api/_servedversions.js") && grep -q "the generator wrote no whole table" "$T/err7" \
  && printf '%s\n' "$man7" | grep -q "pages:   commit $HALF\$" \
  && ok "half a module (no closing line) is not shipped, says why, and the pages line is the plain commit" || bad "half module: rc=$rc7 $(cat "$T/err7") | $man7"

# Review 4: a generator that exits 0 and writes NOTHING is not a rebuild: the committed table ships and the manifest
# says the plain commit.
git -C "$S" checkout -q "$SHA" -- api/_servedversions.js 2>/dev/null || true
printf '#!/bin/bash\nexit 0\n' > "$S/tools/served-versions.sh"
git -C "$S" add -A && git -C "$S" commit -q -m "a generator that writes nothing"
NONE="$(git -C "$S" rev-parse HEAD)"
man8="$(site_deploy_export "$S" "$T/out8" "$NONE" 2>"$T/err8")"; rc8=$?
[ "$rc8" = 0 ] && cmp -s "$T/out8/api/_servedversions.js" <(git -C "$S" show "$NONE:api/_servedversions.js") && grep -q "the generator wrote no whole table" "$T/err8" \
  && ! printf '%s\n' "$man8" | grep -q "rebuilt api" && printf '%s\n' "$man8" | grep -q "pages:   commit $NONE\$" \
  && ok "a generator that writes nothing is not called a rebuild; the committed table ships" || bad "silent generator: rc=$rc8 $(cat "$T/err8") | $man8"

# Review 5: as many rows as the commit's, but one committed row replaced (a cut-off history): not shipped.
git -C "$S" checkout -q "$SHA" -- api/_servedversions.js 2>/dev/null || true
printf '#!/bin/bash\nprintf "export const SERVED = Object.freeze([\\n  [%%s, %%s, %%s],\\n]);\\n" "'"'"'t'"'"'" "'"'"'latest-staging.json'"'"'" "'"'"'9.9.9'"'"'" > "$(dirname "$0")/../api/_servedversions.js"\n' > "$S/tools/served-versions.sh"
git -C "$S" add -A && git -C "$S" commit -q -m "a generator that swaps a row"
SWAP="$(git -C "$S" rev-parse HEAD)"
site_deploy_export "$S" "$T/out9" "$SWAP" >/dev/null 2>"$T/err9"; rc9=$?
[ "$rc9" = 0 ] && cmp -s "$T/out9/api/_servedversions.js" <(git -C "$S" show "$SWAP:api/_servedversions.js") && grep -q "1 of the commit's rows are missing from it" "$T/err9" \
  && ok "the same number of rows but a committed row missing is not shipped, and says so" || bad "row swap: rc=$rc9 $(cat "$T/err9") | $(cat "$T/out9/api/_servedversions.js")"

# Review 2: called BARE under `set -e` (no `||` to suspend errexit), in the case that used to abort: a commit with no
# table at all and a generator giving zero rows (grep -c counts 0 and exits 1).
git -C "$S" rm -q api/_servedversions.js && git -C "$S" commit -q -m "no table, short generator"
NOTAB="$(git -C "$S" rev-parse HEAD)"
mkdir -p "$T/out6" && git -C "$S" archive "$NOTAB" | tar -x -C "$T/out6"
( set -euo pipefail; _site_served_versions "$S" "$T/out6" "$NOTAB" 2>/dev/null; echo survived ) > "$T/bare6"
grep -qx survived "$T/bare6" && ok "called bare under set -e with no committed table and zero rows, it warns and returns" || bad "the function aborted under set -e"
ls "$T"/out*.served* >/dev/null 2>&1 && bad "the keep/err temp files were left beside an export" || ok "no temp file is left beside the exports"

echo "site-served-versions-6738: $FAILS failures"; [ "$FAILS" -eq 0 ]
