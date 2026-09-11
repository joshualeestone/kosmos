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

ln() { grep -nF "$1" "$SRC" 2>/dev/null | head -1 | cut -d: -f1; }

# The cache dir is operator-overridable, so a cut box (or a test) picks its own.
grep -qF 'NODE_CACHE="${KOSMOS_NODE_CACHE:-' "$SRC" \
  && ok "cache dir honours KOSMOS_NODE_CACHE" \
  || no "cache dir is not overridable via KOSMOS_NODE_CACHE"

S="$(ln 'SHASUMS256.txt')"                       # the authoritative checksums are fetched
W="$(ln 'WANT="$(grep')"                         # WANT extracted from them
H="$(ln 'using cached')"                          # the cache-hit path copies the cached tarball
V="$(ln 'checksum mismatch on $TARBALL')"         # the final verify's abort message
G="$(ln '= "$WANT" ] \')"                         # the populate's checksum gate
P="$(ln 'cp "$TMP/$TARBALL" "$NODE_CACHE')"       # the cache write

# WANT must be resolved from the freshly-fetched SHASUMS before the cache decision.
{ [ -n "$S" ] && [ -n "$W" ] && [ -n "$H" ] && [ "$W" -gt "$S" ] && [ "$H" -gt "$W" ]; } \
  && ok "SHASUMS + WANT are resolved before the cache-hit decision" \
  || no "the checksum is not resolved before the cache decision (S=$S W=$W H=$H)"

# THE INVARIANT: the final checksum verify (whose failure aborts the cut) sits AFTER the
# cache-hit copy, so a cached tarball is verified exactly like a downloaded one.
{ [ -n "$H" ] && [ -n "$V" ] && [ "$V" -gt "$H" ]; } \
  && ok "the cached-or-downloaded bytes are verified before use (final verify after the cache-hit)" \
  || no "the final checksum verify does not cover the cache-hit path: a cached tarball could bypass it (H=$H V=$V)"

# The cache is POPULATED only after a checksum match, so a bad download never poisons it.
{ [ -n "$G" ] && [ -n "$P" ] && [ "$P" -gt "$G" ]; } \
  && ok "the cache is written only with checksum-verified bytes" \
  || no "the cache-populate is not gated on a checksum match (G=$G P=$P)"

echo "node-runtime cache: $fails failures"
exit $((fails > 0))
