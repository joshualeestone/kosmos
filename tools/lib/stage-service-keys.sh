# kosmos#6587 (S-7a slice 2a): stage the signed service key set beside the engine that checks it, and check it.
# Sourced by tools/build-kosmos-bundle.sh, tools/build-kosmos-windows.sh and deploy/install-board.sh, so the three
# staging lists cannot drift; tools.stage-service-keys-6587.test.js runs it.
#
#   kosmos_stage_service_keys <repo> <staged engine dir> [node]
#
# No set in the repo: nothing to do. One file without the other: refused. Both: copied, then checked with the STAGED
# verifier and the STAGED recovery keys (tools/check-service-keys.js). The build stops unless the answer is ok or off:
# a set that does not verify would ship to answer "refused" on every board, which the page never shows, so the
# check would be silently dead for that release.
kosmos_stage_service_keys() {
  _sk_repo="$1"; _sk_dest="$2"; _sk_node="${3:-}"
  _sk_set="$_sk_repo/engine/service-keys.json"; _sk_sig="$_sk_repo/engine/service-keys.json.sig"
  [ -f "$_sk_set" ] || [ -f "$_sk_sig" ] || return 0
  if ! { [ -f "$_sk_set" ] && [ -f "$_sk_sig" ]; }; then
    echo "FAIL: engine/service-keys.json and its .sig must ship together (#6587)" >&2; return 1
  fi
  cp "$_sk_set" "$_sk_dest/" || return 1
  cp "$_sk_sig" "$_sk_dest/" || return 1
  [ -n "$_sk_node" ] || _sk_node="$(command -v node 2>/dev/null || true)"
  if [ -z "$_sk_node" ]; then
    echo "FAIL: no node to check the staged service key set with (#6587)" >&2; return 1
  fi
  # Its answer goes to stderr: deploy/install-board.sh captures stage_app's stdout as the version.
  "$_sk_node" "$_sk_repo/tools/check-service-keys.js" "$_sk_dest" >&2 || {
    echo "FAIL: the staged service key set does not verify against the staged recovery keys (#6587)" >&2; return 1; }
  return 0
}
