#!/bin/bash
# #1605 -- dist/ retention. The site's dist/ accumulates one versioned tarball
# triple per release (kosmos-<V>-arm64.tar.gz + .tar.gz.sha256 + .manifest.json)
# and nothing prunes them. This tool REPORTS what would be retained/pruned and,
# only behind an explicit --prune --yes, deletes the old versioned triples.
#
# 🛑 DELETING A PUBLISHED RELEASE TARBALL IS IRREVERSIBLE. There is no off-disk
# copy (no GH release, untracked in the site repo). By the reversibility test the
# DECISION to prune is Josh's, not a worker's -- so --prune requires --yes and
# prints that it is his call. The DEFAULT is a dry run that deletes nothing.
#
# Deletion is a WHITELIST of prunable versioned triples, never a blacklist of
# protected names: the tool only ever removes a file it positively recognises as
# a member of a prunable versioned triple. Anything it does not recognise -- an
# alias, the pkg, a win zip, a stray, a future artifact shape -- is LEFT ALONE.
#
# Usage:
#   tools/dist-retention.sh --dist <DIR> [--keep N] [--prune] [--yes] [--json]
#     --dist <DIR>  REQUIRED. A dist directory containing latest.json.
#     --keep N      keep the N most-recent versioned triples (default 12).
#     --prune       actually delete prune candidates (needs --yes).
#     --yes         confirm an irreversible prune.
#     --json        emit a machine-readable summary instead of the human report.
set -euo pipefail

DIST=""
KEEP=12
DO_PRUNE=0
CONFIRM=0
JSON=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dist) [ $# -ge 2 ] || { echo "dist-retention: --dist needs a directory value" >&2; exit 1; }; DIST="$2"; shift 2 ;;
    --dist=*) DIST="${1#--dist=}"; shift ;;
    --keep) [ $# -ge 2 ] || { echo "dist-retention: --keep needs an integer value" >&2; exit 1; }; KEEP="$2"; shift 2 ;;
    --keep=*) KEEP="${1#--keep=}"; shift ;;
    --prune) DO_PRUNE=1; shift ;;
    --yes) CONFIRM=1; shift ;;
    --json) JSON=1; shift ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "dist-retention: unknown argument '$1'" >&2; exit 1 ;;
  esac
done

[ -n "$DIST" ] || { echo "dist-retention: --dist <DIR> is required (a dist directory containing latest.json)" >&2; exit 1; }
[ -d "$DIST" ] || { echo "dist-retention: --dist '$DIST' is not a directory" >&2; exit 1; }
[ -f "$DIST/latest.json" ] || { echo "dist-retention: '$DIST' has no latest.json -- refusing to treat it as a dist directory" >&2; exit 1; }
case "$KEEP" in
  ''|*[!0-9]*) echo "dist-retention: --keep must be a non-negative integer, got '$KEEP'" >&2; exit 1 ;;
esac

# The served version: latest.json's "version" field. This is the version the
# download button serves; its triple is protected even if it falls outside the
# keep window, so parsing it correctly is the single most safety-critical read in
# the tool. Use a FIRST-match, key-anchored parse: grep the "version":"..." pair
# and take the first one. A greedy sed (.*"version":) would match the LAST such
# key on a line, so a future nested/second "version" key would make the tool
# protect the wrong release and put the actually-served triple up for deletion.
# Tolerant of optional whitespace (a pretty-printed latest.json).
SERVED_VERSION="$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$DIST/latest.json" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"
[ -n "$SERVED_VERSION" ] || { echo "dist-retention: latest.json names no version -- refusing (cannot identify the served release to protect)" >&2; exit 1; }

# Enumerate versioned triples by their tar.gz. The [0-9] after 'kosmos-' means
# the unversioned alias kosmos-arm64.tar.gz can NEVER match (it has 'a', not a
# digit, in that position), so the alias is structurally excluded from the
# prunable set rather than by a name blacklist.
shopt -s nullglob
ALL_VERSIONS=()
for f in "$DIST"/kosmos-[0-9]*-arm64.tar.gz; do
  b="$(basename "$f")"
  v="${b#kosmos-}"; v="${v%-arm64.tar.gz}"
  # Defence in depth: a version is interpolated into paths below, so reject
  # anything that is not a plausible version token (guards against a crafted name).
  case "$v" in
    ''|*[!0-9A-Za-z.+_-]*) continue ;;
  esac
  ALL_VERSIONS+=("$v")
done
shopt -u nullglob

# Sort versions ascending, numeric-aware (sort -V: 0.6.9 < 0.6.10), de-duplicated.
SORTED_ASC=()
if [ "${#ALL_VERSIONS[@]}" -gt 0 ]; then
  while IFS= read -r v; do
    [ -n "$v" ] && SORTED_ASC+=("$v")
  done < <(printf '%s\n' "${ALL_VERSIONS[@]}" | sort -V -u)
fi
NVER="${#SORTED_ASC[@]}"

# Kept = the newest KEEP versions, plus the served version (always). macOS ships
# bash 3.2 (no associative arrays), so the keep set is a space-delimited string
# " v1 v2 ... ". Version tokens are validated above to contain no spaces or glob
# characters, so string membership is exact and word-splitting is safe.
KEEP_LIST=" "
in_keep(){ case "$KEEP_LIST" in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
if [ "$NVER" -gt 0 ]; then
  start=$(( NVER - KEEP ))
  [ "$start" -lt 0 ] && start=0
  idx=0
  for v in "${SORTED_ASC[@]}"; do
    if [ "$idx" -ge "$start" ]; then KEEP_LIST="${KEEP_LIST}${v} "; fi
    idx=$(( idx + 1 ))
  done
fi
# The served version is protected unconditionally, even outside the keep window.
in_keep "$SERVED_VERSION" || KEEP_LIST="${KEEP_LIST}${SERVED_VERSION} "
RETAINED=$(printf '%s' "$KEEP_LIST" | tr ' ' '\n' | grep -c . || true)

# Prune candidates = discovered versions not in the keep set. The ":-" guards the
# empty-array-under-set-u crash on bash 3.2 when the dist has a valid latest.json
# but zero versioned triples; the [ -n ] skips the single empty element it yields.
PRUNE_VERSIONS=()
for v in "${SORTED_ASC[@]:-}"; do
  [ -n "$v" ] || continue
  in_keep "$v" || PRUNE_VERSIONS+=("$v")
done

triple_files() {
  # Echo the (existing) files of a versioned triple, one per line.
  local v="$1" fn
  for fn in "kosmos-${v}-arm64.tar.gz" "kosmos-${v}-arm64.tar.gz.sha256" "kosmos-${v}-arm64.manifest.json"; do
    [ -e "$DIST/$fn" ] && printf '%s\n' "$DIST/$fn"
  done
}

# Reclaim bytes across all prune candidates (portable stat: try GNU then BSD).
file_size() {
  stat -c%s "$1" 2>/dev/null || stat -f%z "$1" 2>/dev/null || echo 0
}
RECLAIM=0
PRUNE_FILE_COUNT=0
for v in "${PRUNE_VERSIONS[@]:-}"; do
  [ -n "$v" ] || continue
  while IFS= read -r pf; do
    [ -n "$pf" ] || continue
    RECLAIM=$(( RECLAIM + $(file_size "$pf") ))
    PRUNE_FILE_COUNT=$(( PRUNE_FILE_COUNT + 1 ))
  done < <(triple_files "$v")
done

human_report() {
  echo "dist-retention: $DIST"
  echo "  served version (protected): $SERVED_VERSION"
  echo "  versioned triples found:    $NVER"
  echo "  keep window (--keep):       $KEEP"
  echo "  retained versions:          $RETAINED"
  echo "  prune candidates:           ${#PRUNE_VERSIONS[@]} version(s), $PRUNE_FILE_COUNT file(s), $(( RECLAIM / 1024 / 1024 )) MiB"
  if [ "${#PRUNE_VERSIONS[@]}" -gt 0 ]; then
    echo "  would prune:"
    for v in "${PRUNE_VERSIONS[@]}"; do echo "    - kosmos-${v}-arm64.{tar.gz,tar.gz.sha256,manifest.json}"; done
  fi
}

json_report() {
  printf '{"dist":"%s","served_version":"%s","found":%d,"keep":%d,"retained":%d,"prune_versions":[' \
    "$DIST" "$SERVED_VERSION" "$NVER" "$KEEP" "$RETAINED"
  local first=1
  for v in "${PRUNE_VERSIONS[@]:-}"; do
    [ -n "$v" ] || continue
    [ "$first" -eq 1 ] || printf ','; first=0
    printf '"%s"' "$v"
  done
  printf '],"prune_files":%d,"reclaim_bytes":%d,"pruned":%s}\n' \
    "$PRUNE_FILE_COUNT" "$RECLAIM" "$([ "$DO_PRUNE" -eq 1 ] && [ "$CONFIRM" -eq 1 ] && echo true || echo false)"
}

# --- DRY RUN (default) -------------------------------------------------------
if [ "$DO_PRUNE" -eq 0 ]; then
  [ "$JSON" -eq 1 ] && json_report || human_report
  [ "$JSON" -eq 1 ] || echo "  (dry run -- nothing deleted; pass --prune --yes to delete)"
  exit 0
fi

# --- PRUNE requested ---------------------------------------------------------
if [ "$CONFIRM" -eq 0 ]; then
  echo "dist-retention: REFUSING to prune without --yes." >&2
  echo "  Deleting a published release tarball is IRREVERSIBLE -- there is no off-disk copy." >&2
  echo "  Per #1605 that is Josh's call. Re-run with --prune --yes only on his authorisation." >&2
  [ "$JSON" -eq 1 ] && json_report >&2 || human_report >&2
  exit 2
fi

# Confirmed prune. Delete ONLY the whitelisted prunable-triple files.
DELETED=0
for v in "${PRUNE_VERSIONS[@]:-}"; do
  [ -n "$v" ] || continue
  while IFS= read -r pf; do
    [ -n "$pf" ] || continue
    rm -f -- "$pf"
    DELETED=$(( DELETED + 1 ))
  done < <(triple_files "$v")
done

# Post-prune BACKSTOP (not a full invariant re-check). Safety is primarily
# structural: the whitelist above only ever constructs delete paths for prunable
# versioned triples, so an alias, the pkg, latest*.json and any kept version's
# files are never reachable by rm. This backstop catches a logic bug in that model
# by re-asserting the two things a bug would most likely break -- latest.json is
# still present, and no KEPT version lost its .sha256 sidecar. It deliberately does
# NOT re-list every protected name (a fixture or partial dist may legitimately lack
# some); refuse (non-zero) and say so loudly if the backstop trips.
fail=0
assert_present() {
  if [ ! -e "$DIST/$1" ]; then echo "dist-retention: POST-CHECK FAILED -- $1 is missing after prune" >&2; fail=1; fi
}
# The served pointer. The served version is always in KEEP_SET, so its triple is
# never a prune candidate; the orphan check below covers it along with every other
# kept version (a kept tar.gz must keep its .sha256).
assert_present "latest.json"
# No kept version may be orphaned: a kept tar.gz must keep its .sha256. Iterate the
# discovered versions and check membership (a served version with no on-disk triple
# has nothing to orphan, so iterating SORTED_ASC is sufficient).
for v in "${SORTED_ASC[@]:-}"; do
  [ -n "$v" ] || continue
  in_keep "$v" || continue
  if [ -e "$DIST/kosmos-${v}-arm64.tar.gz" ] && [ ! -e "$DIST/kosmos-${v}-arm64.tar.gz.sha256" ]; then
    echo "dist-retention: POST-CHECK FAILED -- kept version $v lost its .sha256 sidecar" >&2; fail=1
  fi
done
if [ "$fail" -ne 0 ]; then
  echo "dist-retention: an invariant broke during prune -- see above. This is a bug; report it." >&2
  exit 3
fi

if [ "$JSON" -eq 1 ]; then
  json_report
else
  echo "dist-retention: pruned ${#PRUNE_VERSIONS[@]} version(s), $DELETED file(s), reclaimed $(( RECLAIM / 1024 / 1024 )) MiB from $DIST"
  echo "  invariants intact: latest.json present, no kept version orphaned."
fi
