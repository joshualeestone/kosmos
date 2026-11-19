#!/usr/bin/env bash
# kosmos#7116 step 2: release_bundle_matches_tree (tools/lib/release-freeze.sh) requires app/bin/kosmos-se, the Secure
# Enclave admin signer, in every SEALED bundle whose tree has native-se/main.swift, and checks it by its signature
# (identifier kosmos-se) and its executable bit. Baron's ask (11-19): a check that FAILS when it is absent, shown red.
#
# Only the kosmos-se lines are asserted: these fixtures are not whole bundles, so the comparator says other things
# about them too (no sealed app, files the fixture tree lacks), which this test does not judge.
#
#   bash tools/test-kosmos-se-bundle-7116.sh
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
. "$REPO/tools/lib/release-freeze.sh"
command -v codesign >/dev/null 2>&1 || { echo "SKIP: needs codesign (macOS)"; exit 0; }
T="$(mktemp -d "${TMPDIR:-/tmp}/kosmos-se-bundle.XXXXXX")"
trap 'rm -rf "$T"' EXIT
fails=0
ok() { echo "ok   $1"; }
no() { echo "FAIL $1"; fails=$((fails + 1)); }

# A minimal Kosmos tree (web/ and engine/, as the comparator demands) with the helper's source.
mk_tree() {
  local d="$1"; mkdir -p "$d/web" "$d/engine" "$d/native-se"
  printf '{ "version": "0.0.1" }\n' > "$d/package.json"
  printf '<html></html>\n' > "$d/web/index.html"
  printf 'module.exports = 1;\n' > "$d/engine/a.js"
  [ "${2:-with-se}" = with-se ] && printf '// kosmos-se\n' > "$d/native-se/main.swift"
  return 0
}
# A bundle tarball from a stage dir.
mk_tar() { ( cd "$1" && tar -czf "$2" app bin ); }
mk_stage() {
  local d="$1"; mkdir -p "$d/app/web" "$d/app/engine" "$d/app/bin" "$d/bin"
  cp "$TREE/web/index.html" "$d/app/web/index.html"; cp "$TREE/engine/a.js" "$d/app/engine/a.js"
  printf '#!/bin/sh\n' > "$d/bin/kosmos"; chmod +x "$d/bin/kosmos"
}
# A real executable to sign (any Mach-O will do; codesign needs one, and the comparator only checks the signature).
make_helper() { cp /usr/bin/true "$1"; chmod 755 "$1"; codesign --force -s - -i kosmos-se "$1" >/dev/null 2>&1; }
SAY='carries no Secure Enclave admin signer'
SIG='admin signer.s signature does not verify'
EXEC='admin signer is not executable'
run() { release_bundle_matches_tree "$1" "$2" "" "" "${3:-}" "" 2>&1 || true; }

TREE="$T/tree"; mk_tree "$TREE"

# 1. RED: a sealed bundle without kosmos-se, from a tree that has native-se/main.swift, is refused for it.
mk_stage "$T/s1"; mk_tar "$T/s1" "$T/b1.tgz"
out="$(run "$T/b1.tgz" "$TREE" sealed)"
case "$out" in *"$SAY"*) ok "a sealed bundle missing kosmos-se is refused, by name" ;; *) no "a sealed bundle missing kosmos-se passed: $out" ;; esac

# 2. CONTROL: the same bundle WITH a signed, executable kosmos-se has no kosmos-se complaint.
mk_stage "$T/s2"; make_helper "$T/s2/app/bin/kosmos-se"; mk_tar "$T/s2" "$T/b2.tgz"
out="$(run "$T/b2.tgz" "$TREE" sealed)"
case "$out" in *"$SAY"*|*"admin signer"*) no "a signed kosmos-se was complained about: $out" ;; *) ok "a signed, executable kosmos-se passes its check" ;; esac

# 3. An unsigned kosmos-se is refused by its signature.
mk_stage "$T/s3"; printf 'not a binary\n' > "$T/s3/app/bin/kosmos-se"; chmod 755 "$T/s3/app/bin/kosmos-se"; mk_tar "$T/s3" "$T/b3.tgz"
out="$(run "$T/b3.tgz" "$TREE" sealed)"
case "$out" in *"admin signer"*"signature does not verify"*) ok "an unsigned kosmos-se is refused by its signature" ;; *) no "an unsigned kosmos-se passed: $out" ;; esac

# 4. A signed but non-executable kosmos-se is refused for its mode.
mk_stage "$T/s4"; make_helper "$T/s4/app/bin/kosmos-se"; chmod 644 "$T/s4/app/bin/kosmos-se"; mk_tar "$T/s4" "$T/b4.tgz"
out="$(run "$T/b4.tgz" "$TREE" sealed)"
case "$out" in *"$EXEC"*) ok "a non-executable kosmos-se is refused" ;; *) no "a non-executable kosmos-se passed: $out" ;; esac

# 5. Not required where it cannot be: a bundle that is not sealed (a local or test build), or a tree with no helper
#    source (an older tree, a promote of a pre-kosmos-se release).
out="$(run "$T/b1.tgz" "$TREE" "")"
case "$out" in *"$SAY"*) no "an unsealed bundle was required to carry kosmos-se: $out" ;; *) ok "an unsealed bundle is not required to carry it" ;; esac
OLD="$T/old"; mk_tree "$OLD" without-se
out="$(run "$T/b1.tgz" "$OLD" sealed)"
case "$out" in *"$SAY"*) no "a tree with no native-se required kosmos-se: $out" ;; *) ok "a tree without native-se/main.swift does not require it" ;; esac

# 7. Another identifier is refused (the requirement names kosmos-se, review 1).
mk_stage "$T/s7"; cp /usr/bin/true "$T/s7/app/bin/kosmos-se"; chmod 755 "$T/s7/app/bin/kosmos-se"; codesign --force -s - -i com.example.other "$T/s7/app/bin/kosmos-se" >/dev/null 2>&1; mk_tar "$T/s7" "$T/b7.tgz"
out="$(run "$T/b7.tgz" "$TREE" sealed)"
case "$out" in *"admin signer"*"signature does not verify"*) ok "a kosmos-se signed under another identifier is refused" ;; *) no "another identifier passed: $out" ;; esac

# 6. Its signature must meet the cut's identity requirement too, when one is given (a real cut passes the team's).
out="$(release_bundle_matches_tree "$T/b2.tgz" "$TREE" "" "" sealed 'certificate leaf[subject.OU] = "NOSUCHTEAM0"' 2>&1 || true)"
case "$out" in *"admin signer"*"signature does not verify"*) ok "an ad-hoc kosmos-se fails a team requirement" ;; *) no "an ad-hoc kosmos-se met a team requirement: $out" ;; esac

[ "$fails" -eq 0 ] && echo "test-kosmos-se-bundle-7116: all passed" || { echo "test-kosmos-se-bundle-7116: $fails failed"; exit 1; }
