#!/bin/bash
# Does the coordinator serving traffic carry every relay change the connector a cut bundles needs? (#5037)
#
# WHY. Some relay changes put the connector and the coordinator in an order: the coordinator must be
# deployed first, and never rolled back below the change. kosmos-relay#260 (#4869, 534f36980) is the
# first: a connector carrying it adopts a new account only from a statement the coordinator signs, so with
# an older coordinator a computer set up again admits nobody. Step 1d (#3884) makes the connector match
# relay main, so the cut would ship exactly that connector while the coordinator lagged, and nothing in
# the cut asked the coordinator anything.
#
# THE CHECK. tools/coordinator-floor lists those relay commits. For each one the connector's relay commit
# (its .commit sidecar, connector-provenance.sh) may carry, the coordinator's /v1/meta "build" must contain
# it too. "May carry" is everything but PROVABLY OLDER (review 1): the connector's commit a strict ancestor
# of the floor commit. kosmos-relay squash-merges, so a connector built from the pre-squash branch carries the
# change without descending from the floor commit; it is asked about, not waved through. By ANCESTRY in the relay checkout: the coordinator is deployed from a relay commit and reports
# it; a build that cannot be resolved there, or that is not a descendant, is refused.
#
# FAILS CLOSED. A /v1/meta that cannot be read, has no build, or names a commit the relay checkout does
# not have, is refused, not waved on. So is a floor line naming a commit the checkout does not have.
#
# OVERRIDE. KOSMOS_ALLOW_COORDINATOR_BEHIND=1 ships anyway, says what it skips, and returns 0.
#
# Usage: source (after connector-provenance.sh), then
#   coordinator_floor_check <connector-bin> <relay-checkout> <floor-file>
# Env: KOSMOS_COORDINATOR_URL (default https://login.kosmosplus.com, engine/remote.js DEFAULT_COORDINATOR,
# the address installs talk to). Returns 0 or says why, 1.
# The relay checkout must already be fetched (connector_currency_check, step 1d, does that).

coordinator_floor_check() {
  local bin="${1:?coordinator_floor_check needs the connector path}"
  local relay="${2:?coordinator_floor_check needs the kosmos-relay checkout}"
  local floor="${3:?coordinator_floor_check needs the floor file}"
  local url="${KOSMOS_COORDINATOR_URL:-https://login.kosmosplus.com}"
  local built line sha why meta build build_full needed="" behind=""
  [ -r "$floor" ] || { echo "coordinator_floor: cannot read $floor; refused." >&2; return 1; }
  _connector_provenance_check "$bin" || return 1
  built="$CONNECTOR_COMMIT"
  git -C "$relay" cat-file -e "${built}^{commit}" 2>/dev/null \
    || { echo "coordinator_floor: the connector's commit $built is not in $relay; refused." >&2; return 1; }
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    sha="${line%% *}"; why="${line#* }"; [ "$why" = "$line" ] && why=""
    git -C "$relay" cat-file -e "${sha}^{commit}" 2>/dev/null \
      || { echo "coordinator_floor: the floor names $sha, which is not in $relay (fetch it); refused." >&2; return 1; }
    # Provably older (a strict ancestor of the floor commit, on the same line) is the only case not asked about.
    if [ "$(git -C "$relay" rev-parse "${built}^{commit}")" != "$(git -C "$relay" rev-parse "${sha}^{commit}")" ] \
       && git -C "$relay" merge-base --is-ancestor "$built" "$sha" 2>/dev/null; then
      continue
    fi
    needed="${needed}${sha} ${why}"$'\n'
  done < "$floor"
  [ -n "$needed" ] || return 0   # the connector carries no floor change: nothing to ask the coordinator
  meta="$(curl -fsS -m 15 "$url/v1/meta" 2>/dev/null)" \
    || { echo "coordinator_floor: could not read $url/v1/meta, so whether the coordinator carries what this connector needs is UNKNOWN; refused." >&2; return 1; }
  build="$(printf '%s' "$meta" | sed -n 's/.*"build":[[:space:]]*"\([0-9a-f]\{7,40\}\(-dirty\)\{0,1\}\)".*/\1/p')"
  [ -n "$build" ] || { echo "coordinator_floor: $url/v1/meta names no build; refused." >&2; return 1; }
  case "$build" in *-dirty) echo "coordinator_floor: the coordinator reports a DIRTY build ($build), so what it carries is unknown; redeploy it from a clean relay main at or above the floor. Refused." >&2; return 1 ;; esac
  build_full="$(git -C "$relay" rev-parse -q --verify "${build}^{commit}" 2>/dev/null)" \
    || { echo "coordinator_floor: the coordinator reports build $build, which is not in $relay: deployed from a branch (before a squash merge) or an unpushed commit. Redeploy it from relay main at or above the floor. Refused." >&2; return 1; }
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    sha="${line%% *}"
    git -C "$relay" merge-base --is-ancestor "$sha" "$build_full" 2>/dev/null || behind="${behind}  ${line}"$'\n'
  done <<EOF_NEEDED
$needed
EOF_NEEDED
  [ -n "$behind" ] || return 0
  if [ "${KOSMOS_ALLOW_COORDINATOR_BEHIND:-}" = 1 ]; then
    echo "coordinator_floor: KOSMOS_ALLOW_COORDINATOR_BEHIND=1, so shipping a connector built from ${built:0:12} ON PURPOSE while the coordinator ($build) lacks:" >&2
    printf '%s' "$behind" >&2
    return 0
  fi
  {
    echo "coordinator_floor: the connector (built from ${built:0:12}) needs the coordinator to carry these, and the coordinator serving traffic ($url, build $build) does not:"
    printf '%s' "$behind"
    echo "Deploy the coordinator at or above them first and check $url/v1/meta, then cut. Never roll it back below them afterwards."
    echo "To ship anyway, rerun with KOSMOS_ALLOW_COORDINATOR_BEHIND=1."
  } >&2
  return 1
}
