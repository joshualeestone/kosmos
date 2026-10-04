#!/bin/bash
# Bash only (substring expansion, here-docs into a read loop): sourced by release.sh (#!/bin/bash).
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
# of the floor commit. kosmos-relay squash-, rebase- and merge-merges, so a connector built from the branch
# before it landed carries the change without descending from the floor commit; it is asked about, not
# waved through.
#
# WHICH COMMIT A LINE NAMES. A line does two jobs: a connector older than it is exempt, and the coordinator must
# contain it. So name the EARLIEST commit carrying the connector-side half (on main for a squash or rebase merge;
# the BRANCH commit for a merge commit, never the merge itself, which every branch commit precedes), AND, when the
# coordinator-side half landed in a LATER commit (a rebase merge can split them), add a second line for that one.
# tools/coordinator-floor says the same.
#
# THE COORDINATOR SIDE is decided by ANCESTRY in the relay checkout: the coordinator is deployed from a relay
# commit and reports it; a build that cannot be resolved there, or that does not contain a line, is refused.
#
# FAILS CLOSED. A /v1/meta that cannot be read, has no build, or names a commit the relay checkout does
# not have, is refused, not waved on. So is a floor line naming a commit the checkout does not have.
#
# OVERRIDE. KOSMOS_ALLOW_COORDINATOR_BEHIND=1 ships anyway past a coordinator KNOWN to be behind, says what
# it skips, and returns 0. It deliberately does NOT cover an UNKNOWN coordinator (meta unreadable, no build,
# dirty, a build the checkout lacks): for a coordinator-first change, "we could not look" must not ship.
# A connector off the floor's line that is older (a stale-tunnel override, an odd checkout) is also asked
# about and can be refused while the coordinator is below the floor: a false refusal, intended, because the
# alternative is guessing what an unrelated commit carries.
# /v1/meta is parsed as JSON; its top-level "build" must be 7 to 40 hex, optionally "-dirty", or "unknown".
#
# Usage: source (after connector-provenance.sh), then
#   coordinator_floor_check <connector-bin> <relay-checkout> <floor-file>
# Env: KOSMOS_COORDINATOR_URL (deliberately not an install's AGENT_WORKFORCE_TUNNEL_COORDINATOR override: the cut asks the
# coordinator installs use by default; default https://login.kosmosplus.com, engine/remote.js DEFAULT_COORDINATOR,
# the address installs talk to). Returns 0 or says why, 1.
# The relay checkout must already be fetched (connector_currency_check, step 1d, does that).

coordinator_floor_check() {
  local bin="${1:?coordinator_floor_check needs the connector path}"
  local relay="${2:?coordinator_floor_check needs the kosmos-relay checkout}"
  local floor="${3:?coordinator_floor_check needs the floor file}"
  local url="${KOSMOS_COORDINATOR_URL:-https://login.kosmosplus.com}"
  url="${url%/}"
  local built line sha why meta build build_full anc _why needed="" behind=""
  [ -r "$floor" ] || { echo "coordinator_floor: cannot read $floor; refused." >&2; return 1; }
  _connector_provenance_check "$bin" || return 1
  built="$CONNECTOR_COMMIT"
  git -C "$relay" cat-file -e "${built}^{commit}" 2>/dev/null \
    || { echo "coordinator_floor: the connector's commit $built is not in $relay; refused." >&2; return 1; }
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"; line="${line#"${line%%[![:space:]]*}"}"   # a CRLF, leading blanks
    case "$line" in ''|'#'*) continue ;; esac
    line="${line//$'\t'/ }"
    sha="${line%% *}"; why="${line#* }"; [ "$why" = "$line" ] && why=""
    git -C "$relay" cat-file -e "${sha}^{commit}" 2>/dev/null \
      || { echo "coordinator_floor: the floor names $sha, which is not in $relay (fetch it); refused." >&2; return 1; }
    # Provably older (a strict ancestor of the floor commit, on the same line) is the only case not asked about.
    if [ "$(git -C "$relay" rev-parse "${built}^{commit}")" != "$(git -C "$relay" rev-parse "${sha}^{commit}")" ] \
       && { git -C "$relay" merge-base --is-ancestor "$built" "$sha" 2>/dev/null; anc=$?; [ "$anc" -le 1 ] \
            || echo "coordinator_floor: git could not compare the connector with $sha (exit $anc); asking the coordinator" >&2; [ "$anc" = 0 ]; }; then
      continue
    fi
    needed="${needed}${sha} ${why}"$'\n'
  done < "$floor"
  if [ -z "$needed" ]; then
    echo "coordinator_floor: the connector (${built:0:12}) is older than every floor line; the coordinator was not asked" >&2
    return 0
  fi
  # Two retries of ANY failure (DNS and refused connections included, which plain --retry skips): one network
  # blip must not refuse a cut the override cannot rescue. curl 7.71+ (both cut Macs: 8.7.1).
  # KOSMOS_COORDINATOR_RETRIES (default 2) exists for the tests, whose file:// "unreadable" arms would otherwise sleep.
  case "${KOSMOS_COORDINATOR_RETRIES:-2}" in ''|*[!0-9]*) echo "coordinator_floor: KOSMOS_COORDINATOR_RETRIES must be a number (got '${KOSMOS_COORDINATOR_RETRIES}'); refused." >&2; return 1 ;; esac
  command -v node >/dev/null 2>&1 || { echo "coordinator_floor: node is not on PATH, so /v1/meta cannot be parsed; refused (release.sh needs node anyway)." >&2; return 1; }
  local curl_err; curl_err="$(mktemp "${TMPDIR:-/tmp}/coordfloor-curl.XXXXXX")" || curl_err=/dev/null
  meta="$(curl -fsS -m 15 --retry "${KOSMOS_COORDINATOR_RETRIES:-2}" --retry-delay 2 --retry-all-errors "$url/v1/meta" 2>"$curl_err")" || {
    _why="$(tail -1 "$curl_err" 2>/dev/null)"
    echo "coordinator_floor: could not read $url/v1/meta${_why:+ ($_why)}, so whether the coordinator carries what this connector needs is UNKNOWN; refused. Retry; if it persists, check $url/v1/meta by hand (the override does not cover this)." >&2
    [ "$curl_err" = /dev/null ] || rm -f "$curl_err"; return 1; }
  [ "$curl_err" = /dev/null ] || rm -f "$curl_err"
  # Parsed as JSON (node, which release.sh already needs), the top-level "build" only; then held to its shapes.
  build="$(printf '%s' "$meta" | node -e 'try{const j=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(typeof j.build==="string"?j.build:"")}catch{}' 2>/dev/null)"
  # The WHOLE value held to the shape (a bash match, not a line-wise grep: a value with a newline in it fails).
  if [ -n "$build" ] && [ "$build" != unknown ] && ! [[ "$build" =~ ^[0-9a-f]{7,40}(-dirty)?$ ]]; then
    echo "coordinator_floor: $url/v1/meta names a build that is not a commit id ('$build'); refused." >&2; return 1
  fi
  if [ -z "$build" ] || [ "$build" = unknown ]; then
    case "$build" in unknown) echo "coordinator_floor: the coordinator reports an UNSTAMPED build (\"unknown\"), so what it carries is unknown; redeploy it with deploy/deploy-coordinator.sh, which stamps it. Refused." >&2 ;;
      *) if printf '%s' "$meta" | node -e 'try{JSON.parse(require("fs").readFileSync(0,"utf8"))}catch{process.exit(1)}' 2>/dev/null; then
           echo "coordinator_floor: $url/v1/meta names no build; refused." >&2
         else
           echo "coordinator_floor: $url/v1/meta answered, but not with JSON (a proxy or error page?); refused." >&2
         fi ;; esac
    return 1
  fi
  case "$build" in *-dirty) echo "coordinator_floor: the coordinator reports a DIRTY build ($build), so what it carries is unknown; redeploy it from a clean relay main at or above the floor. Refused." >&2; return 1 ;; esac
  # A shallow relay checkout can answer "not an ancestor" for history it does not hold: an unknown, not "behind".
  [ "$(git -C "$relay" rev-parse --is-shallow-repository 2>/dev/null)" != true ] \
    || { echo "coordinator_floor: $relay is a SHALLOW clone, so ancestry against the coordinator's build is unknown; unshallow it (git -C $relay fetch --unshallow origin) and retry. Refused." >&2; return 1; }
  build_full="$(git -C "$relay" rev-parse -q --verify "${build}^{commit}" 2>/dev/null)" && case "$build_full" in "$build"*) ;; *) build_full="" ;; esac
  [ -n "$build_full" ] || {
    if [ "$(git -C "$relay" rev-parse --disambiguate="$build" 2>/dev/null | wc -l | tr -d ' ')" -gt 1 ]; then
      echo "coordinator_floor: the coordinator's build $build is an AMBIGUOUS short id in $relay; refused (look it up by hand)." >&2
    else
      echo "coordinator_floor: the coordinator reports build $build, which is not in $relay: deployed from a branch (deploy-coordinator.sh allows a ref ahead of main) or an unpushed commit. Fetch that branch into $relay so the build resolves and rerun (then a coordinator behind the floor can be overridden), or redeploy from relay main at or above the floor. Refused." >&2
    fi
    return 1; }
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    sha="${line%% *}"
    # Only exit 1 means "not contained" (known behind, which the override can waive). A git error (128) is an
    # unknown, refused outright, like every other unknown.
    git -C "$relay" merge-base --is-ancestor "$sha" "$build_full" 2>/dev/null; anc=$?
    case "$anc" in
      0) ;;
      1) behind="${behind}  ${line}"$'\n' ;;
      *) echo "coordinator_floor: could not tell whether build $build contains $sha (git exit $anc); refused." >&2; return 1 ;;
    esac
  done <<EOF_NEEDED
$needed
EOF_NEEDED
  if [ -z "$behind" ]; then
    echo "coordinator_floor: the coordinator ($url, build $build) carries what the connector (${built:0:12}) needs" >&2
    return 0
  fi
  if [ "${KOSMOS_ALLOW_COORDINATOR_BEHIND:-}" = 1 ]; then
    echo "coordinator_floor: KOSMOS_ALLOW_COORDINATOR_BEHIND=1, so shipping a connector built from ${built:0:12} ON PURPOSE while the coordinator ($build) lacks:" >&2
    printf '%s' "$behind" >&2
    return 0
  fi
  {
    echo "coordinator_floor: the connector (built from ${built:0:12}, not provably older than these: only a strict ancestor of a floor commit is) needs the coordinator to carry these, and the coordinator serving traffic ($url, build $build) does not:"
    printf '%s' "$behind"
    echo "Deploy the coordinator at or above them first and check $url/v1/meta, then cut. Never roll it back below them afterwards."
    echo "To ship anyway, rerun with KOSMOS_ALLOW_COORDINATOR_BEHIND=1 (it covers a coordinator known to be behind, never an unknown one)."
  } >&2
  return 1
}
