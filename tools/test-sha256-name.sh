#!/bin/bash
# #930: a .sha256 published under a new name must name the file it is served
# beside, and prove it. Fixture: a build-local pair, published as a versioned
# pair the way release.sh does; the control is the exact defect (a plain copy),
# which `shasum -c` refuses.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tools/lib/sha256-name.sh
FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/sha256-name.XXXXXX")"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/build" "$T/site"
printf 'TARBALL BYTES\n' > "$T/build/kosmos-arm64.tar.gz"
( cd "$T/build" && shasum -a 256 kosmos-arm64.tar.gz > kosmos-arm64.tar.gz.sha256 )
cp "$T/build/kosmos-arm64.tar.gz" "$T/site/kosmos-1.2.3-arm64.tar.gz"

# CONTROL, the defect as shipped: a plain copy of the build's .sha256 under the versioned name
cp "$T/build/kosmos-arm64.tar.gz.sha256" "$T/site/kosmos-1.2.3-arm64.tar.gz.sha256"
if (cd "$T/site" && shasum -a 256 --status -c kosmos-1.2.3-arm64.tar.gz.sha256 2>/dev/null); then bad "CONTROL: shasum -c passed a copied .sha256 that names the build file (the defect would be invisible here)"
else ok "CONTROL: a plain copy of the build .sha256 fails shasum -c beside the versioned tarball (#930 as shipped)"; fi
rm -f "$T/site/kosmos-1.2.3-arm64.tar.gz.sha256"

# the fix
if sha256_publish_as "$T/build/kosmos-arm64.tar.gz.sha256" "$T/site/kosmos-1.2.3-arm64.tar.gz.sha256"; then ok "sha256_publish_as writes the versioned .sha256"; else bad "sha256_publish_as refused a good pair"; fi
[ "$(awk '{print $2}' "$T/site/kosmos-1.2.3-arm64.tar.gz.sha256")" = "kosmos-1.2.3-arm64.tar.gz" ] && ok "the filename field is the published name" || bad "the filename field is $(awk '{print $2}' "$T/site/kosmos-1.2.3-arm64.tar.gz.sha256")"
[ "$(awk '{print $1}' "$T/site/kosmos-1.2.3-arm64.tar.gz.sha256")" = "$(awk '{print $1}' "$T/build/kosmos-arm64.tar.gz.sha256")" ] && ok "the digest is unchanged" || bad "the digest changed"
(cd "$T/site" && shasum -a 256 --status -c kosmos-1.2.3-arm64.tar.gz.sha256) && ok "shasum -c passes on the published pair, the tester's command" || bad "shasum -c fails on the published pair"

# refusals: wrong bytes beside the name, and a source that is not a digest
printf 'OTHER BYTES\n' > "$T/site/kosmos-9.9.9-arm64.tar.gz"
if sha256_publish_as "$T/build/kosmos-arm64.tar.gz.sha256" "$T/site/kosmos-9.9.9-arm64.tar.gz.sha256" 2>/dev/null; then bad "published a .sha256 whose digest does not match the file beside it"
else [ ! -e "$T/site/kosmos-9.9.9-arm64.tar.gz.sha256" ] && ok "refuses and removes a .sha256 that does not verify against the file beside it" || bad "refused but left the bad .sha256 behind"; fi
printf 'not a digest  x\n' > "$T/build/bad.sha256"
sha256_publish_as "$T/build/bad.sha256" "$T/site/kosmos-1.2.3-arm64.tar.gz.sha256.new" 2>/dev/null && bad "accepted a source with no digest" || ok "refuses a source that does not start with a sha256 digest"

# the release script uses it, and no longer plain-copies
grep -q 'sha256_publish_as "$REPO/dist/kosmos-arm64.tar.gz.sha256" "$SITE/dist/kosmos-$V-arm64.tar.gz.sha256"' tools/release.sh && ok "release.sh publishes the versioned .sha256 through sha256_publish_as" || bad "release.sh does not use sha256_publish_as for the versioned .sha256"
grep -q 'cp "$REPO/dist/kosmos-arm64.tar.gz.sha256" "$SITE/dist/kosmos-$V' tools/release.sh && bad "release.sh still plain-copies the build .sha256 under the versioned name" || ok "release.sh no longer plain-copies the .sha256 under the versioned name"
grep -q 'vname' tools/verify-served.sh && ok "verify-served.sh checks the served .sha256's filename field" || bad "verify-served.sh does not check the served .sha256's filename field"

[ "$FAILS" -eq 0 ] && echo "sha256 names: all hold" || { echo "sha256 names: $FAILS failed"; exit 1; }
