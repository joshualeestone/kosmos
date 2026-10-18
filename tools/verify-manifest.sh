#!/usr/bin/env bash
# Given the SERVED bytes of a release, say what produced them, and check they
# are the bytes the manifest describes (#776).
#
#   bash tools/verify-manifest.sh 0.5.24            # against installkosmos.com
#   KOSMOS_BASE=https://host/dist bash tools/verify-manifest.sh 0.5.24
#
# Reads dist/kosmos-<V>-arm64.manifest.json from the site (the tracked one),
# downloads the versioned tarball, compares the whole-artifact sha, then every
# file's sha inside it. Exit 0 iff both agree. It never rebuilds anything:
# the manifest answers "what produced this", the check answers "is this it".
set -euo pipefail
V="${1:?usage: verify-manifest.sh <version>}"
BASE="${KOSMOS_BASE:-https://installkosmos.com/dist}"
NODE="${KOSMOS_NODE:-node}"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
curl -fsSL "$BASE/kosmos-$V-arm64.manifest.json" -o "$T/m.json" || { echo "no manifest served for $V at $BASE (releases before #776 have none)"; exit 2; }
# #6468 ask 2: the signature beside it. Required when KOSMOS_REQUIRE_SIG=1 (the release's own served check: every
# release from signing on has one, and installs refuse an update without it); otherwise checked when served.
if curl -fsSL "$BASE/kosmos-$V-arm64.manifest.json.sig" -o "$T/m.sig" 2>/dev/null; then
  "$NODE" "$(dirname "${BASH_SOURCE[0]}")/lib/manifest-sign.js" verify "$T/m.json" "$T/m.sig" || { echo "SIGNATURE: the served .sig does not verify under a pinned key"; exit 1; }
  echo "  signature verifies under a pinned key"
elif [ "${KOSMOS_REQUIRE_SIG:-}" = 1 ]; then
  echo "SIGNATURE: no kosmos-$V-arm64.manifest.json.sig served at $BASE; every checking install would refuse this update"; exit 1
else
  echo "  (no signature served; releases before #6468 have none)"
fi
curl -fsSL "$BASE/kosmos-$V-arm64.tar.gz" -o "$T/a.tar.gz"
want="$("$NODE" -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).sha256' "$T/m.json")"
got="$(shasum -a 256 "$T/a.tar.gz" | awk '{print $1}')"
"$NODE" -e '
const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
console.log(`${m.version} (${m.arch}) ${m.artifact}`);
console.log(`  app       ${m.app.commit}${m.app.dirty ? " DIRTY" : " clean"}`);
console.log(`  node      ${m.node.version}  download sha ${m.node.download_sha256}`);
console.log(`  connector ${m.connector.commit}  signed ${m.connector.signed_sha256.slice(0,12)}  input ${m.connector.input_sha256.slice(0,12)}`);
console.log(`  built     ${m.built.at} on ${m.built.host} (macOS ${m.built.macos})${m.reconstructed ? "  [RECONSTRUCTED after the fact: " + m.reconstructed + "]" : ""}`);
console.log(`  files     ${m.files.length}`);
' "$T/m.json"
if [ "$want" != "$got" ]; then echo "MISMATCH: manifest says $want, served bytes are $got"; exit 1; fi
echo "  artifact  sha256 matches the served bytes"
mkdir -p "$T/x" && tar -xzf "$T/a.tar.gz" -C "$T/x"
( cd "$T/x" && find bin app runtime VERSION -type f | LC_ALL=C sort | while read -r f; do printf '%s  %s\n' "$(shasum -a 256 "$f" | awk '{print $1}')" "$f"; done ) > "$T/got.txt"
"$NODE" -e '
const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
process.stdout.write(m.files.map((f) => `${f.sha256}  ${f.path}`).join("\n") + "\n");
' "$T/m.json" > "$T/want.txt"
if diff -q "$T/want.txt" "$T/got.txt" >/dev/null; then echo "  files     every file matches the manifest"; else echo "FILE MISMATCH:"; diff "$T/want.txt" "$T/got.txt" | head -20; exit 1; fi
