#!/bin/bash
# The Plus connector's provenance, as a property of the BINARY and never of
# the checkout it sits in (#621).
#
# ⚠️ WHY. build-kosmos-bundle.sh logged the connector's origin as `git
# describe` run in the directory the binary sat in: the checkout's HEAD, not
# the commit the bytes were compiled from. Build at X, check out Y, and the
# bundle logged Y while shipping X, which is #597's served-vs-source
# confusion one input upstream, in the one input served == built cannot see
# because it is not a tree file. kosmos-relay's tools/build-tunnel-release.sh
# now writes two sidecars beside the binary on every build (and `--stamp`
# writes them for a binary already in dist/):
#   <bin>.commit   the sha the tree was at when the binary was written,
#                  "-dirty" appended when that tree had uncommitted changes
#   <bin>.sha256   the sha256 of the binary as written
# This reads them and REFUSES rather than guessing: no sidecar, a checksum
# that does not match the bytes beside it (a stale or half-copied pair, the
# 0.5.13 wedge shape one repo over), a dirty commit (the bytes came from no
# commit anyone can name), or a malformed one.
#
# Usage: source, then `connector_provenance <bin>` prints the commit (40 hex)
# on stdout and returns 0, or prints why on stderr and returns 1.
connector_provenance() {
  local bin="${1:?connector_provenance needs the connector path}" cfile sfile commit want got
  cfile="$bin.commit"; sfile="$bin.sha256"
  [ -f "$bin" ] || { echo "connector_provenance: no connector at $bin" >&2; return 1; }
  [ -f "$cfile" ] || { echo "connector_provenance: no $cfile beside the connector. kosmos-relay's tools/build-tunnel-release.sh writes it on every build; \`--stamp\` writes it for the binary already in dist/. Without it the bundle cannot say which commit the connector came from." >&2; return 1; }
  [ -f "$sfile" ] || { echo "connector_provenance: no $sfile beside the connector (same remedy: build-tunnel-release.sh, or --stamp)." >&2; return 1; }
  want="$(awk '{print $1}' < "$sfile" | head -1)"
  got="$(shasum -a 256 "$bin" | awk '{print $1}')"
  [ -n "$want" ] && [ "$want" = "$got" ] || { echo "connector_provenance: $sfile names other bytes (${want:-<empty>}) than the connector beside it ($got): a stale or half-copied pair. Rebuild the connector, or re-stamp the one you mean." >&2; return 1; }
  commit="$(head -1 "$cfile" | tr -d '[:space:]')"
  case "$commit" in
    *-dirty) echo "connector_provenance: the connector was built from a DIRTY tree ($commit): its bytes came from no commit anyone can name. Commit in kosmos-relay and rebuild (or re-stamp a clean tree)." >&2; return 1 ;;
  esac
  case "$commit" in
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;;
    *) echo "connector_provenance: $cfile does not hold a 40-hex commit (\"$commit\")." >&2; return 1 ;;
  esac
  printf '%s\n' "$commit"
  return 0
}
