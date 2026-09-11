#!/bin/bash
# The node-runtime cache (get-cuts-out-faster #2760, lever 1, in
# tools/build-kosmos-bundle.sh) must stay a SPEED optimisation, never a trust
# shortcut. A cut re-downloads node's ~35 MB runtime every time though nodejs.org
# publishes each version's bytes immutably; caching the verified tarball across cuts
# skips the download. The invariant this guards: the bytes ACTUALLY USED -- cached OR
# freshly downloaded -- are checksum-verified against nodejs.org's SHASUMS256 BEFORE
# extraction, and the cache is populated only with verified bytes. If a future edit let
# a cached (possibly poisoned) tarball reach `tar -xzf` without that verify, this test
# reds. Behavioural hit/miss/poison correctness was proven by hand against real bytes;
# this file guards the STRUCTURE that keeps the guarantee, without a network download in
# the suite.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/build-kosmos-bundle.sh"
fails=0
ok() { echo "PASS  $1"; }
no() { echo "FAIL  $1"; fails=$((fails+1)); }

line_of() { grep -nF "$1" "$SRC" 2>/dev/null | head -1 | cut -d: -f1; }

# The cache dir is operator-overridable, so a cut box (or a test) picks its own.
grep -qF 'NODE_CACHE="${KOSMOS_NODE_CACHE:-' "$SRC" \
  && ok "cache dir honours KOSMOS_NODE_CACHE" \
  || no "cache dir is not overridable via KOSMOS_NODE_CACHE"

# THE LOAD-BEARING SOURCE PIN: the whole checksum defense rests on the download SOURCE being
# hardcoded to nodejs.org. An overridable base URL would let a caller serve BOTH a poisoned
# tarball AND a matching SHASUMS256, so the verify would pass on poisoned bytes. Only the cache
# DIR is overridable (checked above); BASE must not be. This reds if BASE is ever made env-driven.
{ grep -qE '^[[:space:]]*BASE="https://nodejs\.org/dist/' "$SRC" && ! grep -qE 'BASE="\$\{' "$SRC"; } \
  && ok "the node download source is hardcoded to nodejs.org (no overridable base URL)" \
  || no "the node download BASE is not a hardcoded nodejs.org URL, or was made overridable via an env var"

S="$(line_of 'curl -fsSL "$BASE/SHASUMS256.txt"')"          # the authoritative checksums are actually FETCHED (not a comment)
W="$(line_of 'WANT="$(grep')"                               # WANT extracted from them
C="$(line_of 'cp "$NODE_CACHE/$TARBALL" "$TMP/$TARBALL"')"  # the cache-hit copies INTO the same "$TMP/$TARBALL" the verify+extract use
V="$(line_of 'checksum mismatch on $TARBALL')"              # the final verify's abort message
T="$(line_of 'tar -xzf "$TMP/$TARBALL"')"                   # extraction of the (by now verified) bytes
G="$(line_of 'if [ "$(shasum -a 256 "$TMP/$TARBALL"')"      # the populate CHECKSUM gate: keeps the write coupled to the checksum-match (not merely to a mkdir), and is content-anchored so a reformat of the trailing line-continuation does not red it. Unique: the cache-hit gate hashes "$NODE_CACHE/$TARBALL" and the final verify is `GOT="$(...`, so head -1 lands on this populate gate.
P="$(line_of 'cp "$TMP/$TARBALL" "$NODE_CACHE')"            # the cache write

# WANT must be resolved from the freshly-fetched SHASUMS before any cache decision.
{ [ -n "$S" ] && [ -n "$W" ] && [ -n "$C" ] && [ "$W" -gt "$S" ] && [ "$C" -gt "$W" ]; } \
  && ok "SHASUMS + WANT are resolved before the cache-hit copy" \
  || no "the checksum is not resolved before the cache decision (S=$S W=$W C=$C)"

# THE INVARIANT, part 1: the cache-hit copies into "$TMP/$TARBALL" -- the SAME path the final
# verify and tar operate on -- and the verify sits AFTER that copy, so a cached tarball is
# verified exactly like a downloaded one and cannot slip in via an unverified destination.
{ [ -n "$C" ] && [ -n "$V" ] && [ "$V" -gt "$C" ]; } \
  && ok "the cache-hit copies to the verified path and is verified after it (V>C)" \
  || no "the cache-hit copy is not covered by the final verify: a cached tarball could bypass it (C=$C V=$V)"

# THE INVARIANT, part 2: extraction happens ONLY after the final verify. This guards the
# "verified BEFORE extraction" half -- an edit that moved tar -xzf ahead of the verify (or the
# verify after extraction) would let unverified bytes reach tar, and this assertion reds.
{ [ -n "$V" ] && [ -n "$T" ] && [ "$T" -gt "$V" ]; } \
  && ok "the bytes are extracted only after the checksum verify (tar after verify, T>V)" \
  || no "extraction is not gated behind the final verify: unverified bytes could reach tar (V=$V T=$T)"

# The cache is POPULATED only after a checksum match, so a bad download never poisons it.
{ [ -n "$G" ] && [ -n "$P" ] && [ "$P" -gt "$G" ]; } \
  && ok "the cache is written only with checksum-verified bytes" \
  || no "the cache-populate is not gated on a checksum match (G=$G P=$P)"

# AVAILABILITY INVARIANT (a cache must never fail a real cut). Two halves, both errexit-load-bearing:
# (1) the cache READ copy sits INSIDE the if-condition (`&& cp ... 2>/dev/null`), so a failed read is
#     a false branch that falls back to a download, not an errexit abort. If a future edit moved the
#     cp into the then-body (dropping the `&&`/`2>/dev/null` guard form), this anchor empties and reds.
grep -qF '&& cp "$NODE_CACHE/$TARBALL" "$TMP/$TARBALL" 2>/dev/null' "$SRC" \
  && ok "the cache-read copy is guarded inside the if-condition (a failed read falls back, never aborts the cut)" \
  || no "the cache-read cp is not in the if-condition: a copy failure could abort a real cut under errexit"
# (2) the cache WRITE cleanup ends in `|| :`, which swallows the non-zero exit an EXISTING but
#     unwritable cache dir produces (mkdir passes, cp/rm fail) before errexit turns it into a cut abort.
grep -qF 'rm -f "$NODE_CACHE/.$TARBALL.$$" 2>/dev/null || :' "$SRC" \
  && ok "the cache-write cleanup ends in || : (an unwritable cache dir never aborts the cut)" \
  || no "the cache-write cleanup lost its trailing || : ; an unwritable cache dir could abort a real cut"

echo "node-runtime cache: $fails failures"
exit $((fails > 0))
