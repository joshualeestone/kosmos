#!/bin/bash
# Is the Plus connector a cut is about to bundle CURRENT with kosmos-relay main? (#3884)
#
# WHY. A Mac cut bundles the PREBUILT kosmos-tunnel sitting in the relay checkout's
# dist/, and nothing asked whether it was built before a tunnel fix merged. 0.6.95
# shipped a tunnel built at 19:00 from e2d5fbd; relay #145 (the #3832 HSTS half, in
# crates/tunnel) merged at 21:06 and did not ship. Every relay-side tunnel fix missed
# the next release unless somebody remembered to rebuild.
#
# THE CHECK. The connector's own .commit sidecar (connector-provenance.sh, #621) names
# the relay commit its bytes came from. This compares that commit with kosmos-relay
# origin/main over the tunnel's BUILD INPUTS:
#   crates/tunnel   the tunnel itself
#   crates/proto    its path dependency
#   Cargo.toml      the workspace manifest (shared dependency versions)
#   Cargo.lock      resolved versions. A coordinator-only dependency bump also changes
#                   it and so also asks for a rebuild; that is the conservative side,
#                   and the override below covers a deliberate exception.
#   tools/build-tunnel-release.sh   the build itself (targets, lipo, cargo flags).
# Tests under crates/tunnel/tests and crates/proto/tests are EXCLUDED: they do not reach
# the binary, and a tests-only change must not force a rebuild.
# By CONTENT (`git diff`), not ancestry: a connector built from a branch, or a relay
# main that was rebased or squash-merged, would read wrong by ancestry.
#
# FAILS CLOSED. If origin/main cannot be fetched or the connector's commit is not in
# the relay checkout, the answer is unknown, and an unknown is refused, not waved on.
#
# OVERRIDE. KOSMOS_ALLOW_STALE_TUNNEL=1 ships the older connector on purpose. It says
# what it is skipping and returns 0.
#
# Usage: source, then `connector_currency_check <connector-bin> <relay-checkout>`.
# Returns 0 when current (or overridden); otherwise says why on stderr, returns 1.
# Needs connector-provenance.sh sourced first (it reads the sidecar through it).

CONNECTOR_TUNNEL_INPUTS="crates/tunnel crates/proto Cargo.toml Cargo.lock tools/build-tunnel-release.sh :(exclude)crates/tunnel/tests :(exclude)crates/proto/tests"

connector_currency_check() {
  local bin="${1:?connector_currency_check needs the connector path}"
  local relay="${2:?connector_currency_check needs the kosmos-relay checkout}"
  local built out rc missing
  _connector_provenance_check "$bin" || return 1
  built="$CONNECTOR_COMMIT"
  git -C "$relay" rev-parse --git-dir >/dev/null 2>&1 || {
    echo "connector_currency: $relay is not a git checkout, so there is nothing to compare the connector with. Set KOSMOS_RELAY_REPO to the kosmos-relay checkout." >&2; return 1; }
  # An EXPLICIT refspec: a clone whose fetch refspec does not cover main (single-branch, or
  # narrowed by hand) would otherwise update only FETCH_HEAD and leave a stale origin/main,
  # a false green (review 1). No terminal prompt: a box without credentials must fail, not hang.
  rc=0; out=$(GIT_TERMINAL_PROMPT=0 git -C "$relay" fetch --quiet origin +refs/heads/main:refs/remotes/origin/main 2>&1) || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "connector_currency: could not fetch kosmos-relay origin/main in $relay, so whether the connector is current is UNKNOWN (refused, not assumed):" >&2
    printf '%s\n' "$out" >&2
    return 1
  fi
  git -C "$relay" cat-file -e "${built}^{commit}" 2>/dev/null || {
    if [ "$(git -C "$relay" rev-parse --is-shallow-repository 2>/dev/null)" = true ]; then
      echo "connector_currency: $relay is a SHALLOW clone and does not reach $built, the commit the connector says it was built from. Unshallow it (git -C $relay fetch --unshallow origin) and retry." >&2
    else
      echo "connector_currency: the connector says it was built from $built, which is not in $relay (built from an unpushed commit, or another clone). Rebuild it from kosmos-relay main." >&2
    fi
    return 1; }
  # shellcheck disable=SC2086  # the input list is word-split on purpose
  rc=0; git -C "$relay" diff --quiet "$built" origin/main -- $CONNECTOR_TUNNEL_INPUTS || rc=$?
  [ "$rc" -eq 0 ] && return 0
  [ "$rc" -eq 1 ] || { echo "connector_currency: git diff failed in $relay (rc=$rc); refused." >&2; return 1; }
  # shellcheck disable=SC2086
  missing=$(git -C "$relay" log --no-merges --format='  %h %s' "$built..origin/main" -- $CONNECTOR_TUNNEL_INPUTS 2>/dev/null)
  [ -n "$missing" ] || missing="  (the difference is not on a line of history from $built; compare with: git -C $relay diff --stat $built origin/main -- $CONNECTOR_TUNNEL_INPUTS)"
  if [ "${KOSMOS_ALLOW_STALE_TUNNEL:-}" = 1 ]; then
    echo "connector_currency: KOSMOS_ALLOW_STALE_TUNNEL=1, so shipping the connector built from ${built:0:12} ON PURPOSE, without these tunnel changes on kosmos-relay main:" >&2
    printf '%s\n' "$missing" >&2
    return 0
  fi
  {
    echo "connector_currency: the Plus connector is STALE. It was built from ${built:0:12}, and kosmos-relay main has changed its build inputs ($CONNECTOR_TUNNEL_INPUTS) since:"
    printf '%s\n' "$missing"
    echo "Rebuild it before cutting: in kosmos-relay on main, run tools/build-tunnel-release.sh on a box with both rustup targets, and copy dist/kosmos-tunnel with its .commit and .sha256 to this box's $bin."
    echo "To ship the older connector deliberately, rerun with KOSMOS_ALLOW_STALE_TUNNEL=1."
  } >&2
  return 1
}
