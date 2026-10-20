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
printf '%s\n' "$man" | grep -q "rebuilt api/_servedversions.js from the history of $(printf '%.8s' "$SHA") (2 rows)" \
  && ok "the export says it rebuilt the table, from which commit, and how many rows" || bad "no rebuild line: $man"
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
[ "$rc3" = 0 ] && grep -q "served-versions table NOT rebuilt (the generator failed); the committed one ships" "$T/err3" \
  && cmp -s "$T/out3/api/_servedversions.js" <(git -C "$S" show "$BAD:api/_servedversions.js") \
  && ok "a failing generator warns, does not refuse the deploy, and the committed table ships" || bad "failing generator: rc=$rc3 $(cat "$T/err3")"

echo "site-served-versions-6738: $FAILS failures"; [ "$FAILS" -eq 0 ]
