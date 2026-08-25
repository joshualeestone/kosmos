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
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
curl -fsSL "$BASE/kosmos-$V-arm64.manifest.json" -o "$T/m.json" || { echo "no manifest served for $V at $BASE (releases before #776 have none)"; exit 2; }
curl -fsSL "$BASE/kosmos-$V-arm64.tar.gz" -o "$T/a.tar.gz"
NODE="${KOSMOS_NODE:-node}"
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
