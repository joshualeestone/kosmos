#!/bin/bash
# #1605 / #2112 -- dist/ retention. The site's dist/ accumulates one versioned
# triple per release, per platform, and nothing prunes them:
#   arm64:   kosmos-<V>-arm64.tar.gz + .tar.gz.sha256 + .manifest.json  (protected by latest.json)
#   win-x64: kosmos-<V>-win-x64.zip  + .zip.sha256    + .manifest.json  (protected by latest-win.json)
# This tool REPORTS what would be retained/pruned and, only behind an explicit
# --prune --yes, deletes the old versioned triples of BOTH families.
#
# 🛑 DELETING A PUBLISHED RELEASE TARBALL/ZIP IS IRREVERSIBLE. There is no off-disk
# copy (no GH release, untracked in the site repo). By the reversibility test the
# DECISION to prune is Josh's, not a worker's -- so --prune requires --yes and
# prints that it is his call. The DEFAULT is a dry run that deletes nothing.
#
# Deletion is a WHITELIST of prunable versioned triples, never a blacklist of
# protected names: the tool only ever removes a file it positively recognises as
# a member of a prunable versioned triple. Anything it does not recognise -- an
# alias, the pkg, the OTHER platform, a stray, a future artifact shape -- is LEFT
# ALONE.
#
# #2112: the per-family logic (enumerate -> keep-window -> protect-served -> prune)
# is a SHARED helper `process_family` parameterised by (arch, ext, sha_ext,
# pointer), NOT a copy. arm64 is processed exactly as #1605 shipped it (its output
# is byte-identical); the win-x64 family is processed only when versioned win
# triples actually exist, so a dist with no Windows releases behaves exactly as
# before.
#
# Usage:
#   tools/dist-retention.sh --dist <DIR> [--keep N] [--prune] [--yes] [--json]
#     --dist <DIR>  REQUIRED. A dist directory containing latest.json.
#     --keep N      keep the N most-recent versioned triples PER FAMILY (default 12).
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
    -h|--help) sed -n '2,37p' "$0"; exit 0 ;;
    *) echo "dist-retention: unknown argument '$1'" >&2; exit 1 ;;
  esac
done

[ -n "$DIST" ] || { echo "dist-retention: --dist <DIR> is required (a dist directory containing latest.json)" >&2; exit 1; }
[ -d "$DIST" ] || { echo "dist-retention: --dist '$DIST' is not a directory" >&2; exit 1; }
[ -f "$DIST/latest.json" ] || { echo "dist-retention: '$DIST' has no latest.json -- refusing to treat it as a dist directory" >&2; exit 1; }
case "$KEEP" in
  ''|*[!0-9]*) echo "dist-retention: --keep must be a non-negative integer, got '$KEEP'" >&2; exit 1 ;;
esac
# Cap an absurd --keep BEFORE base-10 normalization. A keep count larger than any
# plausible release history means "keep everything" anyway -- but a ~20-digit value
# would overflow bash's signed 64-bit $(( 10#$KEEP )) and WRAP to a small positive
# number (measured: 10#18446744073709551617 -> 1), producing a tiny keep window that
# PRUNES instead of keeping all. Any --keep beyond 7 digits (> 9,999,999) is clamped
# to 1000000, which is keep-all for any real dist and never wraps. Checked by string
# length so the comparison itself cannot overflow.
if [ "${#KEEP}" -gt 7 ]; then
  KEEP=1000000
else
  # Normalize to base 10. The dist's version scheme is zero-padded (0.6.08), so an
  # operator typing --keep 08 is natural -- but "08"/"09" are invalid OCTAL, and
  # bash arithmetic $(( NVER - KEEP )) would error under set -e WITHOUT aborting,
  # leaving the keep window empty. The 10# prefix forces base 10, so 08->8.
  KEEP=$((10#$KEEP))
fi

# Portable file size (try GNU then BSD).
file_size() {
  stat -c%s "$1" 2>/dev/null || stat -f%z "$1" 2>/dev/null || echo 0
}

# read_pointer_version <pointer-file> : echo the first "version" value, or empty.
# FIRST-match, key-anchored (a greedy sed would match a nested/second "version").
# The trailing "|| true" is load-bearing under set -e + pipefail: grep exits 1 when
# the key is absent, which would abort here before the caller's diagnostic.
read_pointer_version() {
  grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$1" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true
}
read_pointer_artifact() {
  grep -o '"artifact"[[:space:]]*:[[:space:]]*"[^"]*"' "$1" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true
}

# ---------------------------------------------------------------------------
# process_family <arch> <ext> <sha_ext> <pointer> <served_required> <skip_if_empty>
#
# Runs the whole retention decision for ONE platform family and, in JSON mode,
# sets FAMILY_JSON to its inner fields (no braces) for the caller to assemble.
# Returns 0 on success; sets FAMILY_SKIPPED=1 when there is nothing to report.
# On a prune post-check failure it sets ANY_FAIL=1 (never aborts mid-family).
#
#   served_required=1 : a missing/version-less pointer is a HARD refusal (arm64 --
#                       a dist without a real latest.json is malformed).
#   served_required=0 : a missing pointer with triples present is a SOFT refusal --
#                       report the win triples but do NOT prune them (we cannot
#                       identify the served win release to protect), and never
#                       abort the whole tool over the optional second family.
#   skip_if_empty=1   : emit nothing when the family has zero versioned triples
#                       (a dist with no Windows releases shows no win block).
# ---------------------------------------------------------------------------
FAMILY_SKIPPED=0
FAMILY_JSON=""
ANY_FAIL=0
process_family() {
  local ARCH="$1" EXT="$2" SHA_EXT="$3" POINTER="$4" SERVED_REQUIRED="$5" SKIP_IF_EMPTY="$6"
  local PFILE="$DIST/$POINTER"
  FAMILY_SKIPPED=0
  FAMILY_JSON=""

  # Enumerate versioned triples by their primary artifact. The [0-9] after
  # 'kosmos-' means the unversioned alias (kosmos-arm64.tar.gz / kosmos-win-x64.zip)
  # can NEVER match, so aliases are structurally excluded from the prunable set.
  local f b v
  local ALL_VERSIONS=()
  shopt -s nullglob
  for f in "$DIST"/kosmos-[0-9]*-"$ARCH"."$EXT"; do
    b="$(basename "$f")"
    v="${b#kosmos-}"; v="${v%-$ARCH.$EXT}"
    # Defence in depth: a version is interpolated into paths below, so reject
    # anything that is not a plausible version token (guards a crafted name).
    case "$v" in
      ''|*[!0-9A-Za-z.+_-]*) continue ;;
    esac
    ALL_VERSIONS+=("$v")
  done
  shopt -u nullglob

  local SORTED_ASC=()
  if [ "${#ALL_VERSIONS[@]}" -gt 0 ]; then
    while IFS= read -r v; do
      [ -n "$v" ] && SORTED_ASC+=("$v")
    done < <(printf '%s\n' "${ALL_VERSIONS[@]}" | sort -V -u)
  fi
  local NVER="${#SORTED_ASC[@]}"

  # A family with no versioned triples: skip silently for the optional win family
  # so a dist with no Windows releases behaves exactly as pre-#2112.
  if [ "$NVER" -eq 0 ] && [ "$SKIP_IF_EMPTY" -eq 1 ]; then
    FAMILY_SKIPPED=1
    return 0
  fi

  # The served version protects its triple even outside the keep window; parsing it
  # correctly is the single most safety-critical read in the tool.
  local SERVED_VERSION=""
  [ -f "$PFILE" ] && SERVED_VERSION="$(read_pointer_version "$PFILE")"

  # No served version identifiable.
  local PRUNE_ALLOWED=1
  if [ -z "$SERVED_VERSION" ]; then
    if [ "$SERVED_REQUIRED" -eq 1 ]; then
      echo "dist-retention: $POINTER names no version -- refusing (cannot identify the served $ARCH release to protect)" >&2
      exit 1
    fi
    # Soft: report but do not prune this family (protect-by-default when we cannot
    # tell what is served). Only meaningful when there ARE triples (else we skipped).
    PRUNE_ALLOWED=0
  fi

  # Kept = the newest KEEP versions, plus the served version (always). macOS ships
  # bash 3.2 (no associative arrays), so the keep set is a space-delimited string.
  # Version tokens are validated above to contain no spaces/globs, so membership is
  # exact and word-splitting is safe.
  local KEEP_LIST=" "
  local start idx
  if [ "$NVER" -gt 0 ]; then
    start=$(( NVER - KEEP ))
    [ "$start" -lt 0 ] && start=0
    idx=0
    for v in "${SORTED_ASC[@]}"; do
      if [ "$idx" -ge "$start" ]; then KEEP_LIST="${KEEP_LIST}${v} "; fi
      idx=$(( idx + 1 ))
    done
  fi
  in_keep() { case "$KEEP_LIST" in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

  # Protect the served version unconditionally (when we have one).
  if [ -n "$SERVED_VERSION" ]; then
    in_keep "$SERVED_VERSION" || KEEP_LIST="${KEEP_LIST}${SERVED_VERSION} "
    # ALSO protect the served release by the version in its ACTUAL artifact
    # filename, which the pointer names explicitly -- closes a version-format-skew
    # gap (pointer "0.6.5" while the file is kosmos-0.6.05-<arch>.<ext>).
    local SERVED_ARTIFACT av
    SERVED_ARTIFACT="$(read_pointer_artifact "$PFILE")"
    case "$SERVED_ARTIFACT" in
      kosmos-[0-9]*-"$ARCH"."$EXT")
        av="${SERVED_ARTIFACT#kosmos-}"; av="${av%-$ARCH.$EXT}"
        case "$av" in
          ''|*[!0-9A-Za-z.+_-]*) : ;;
          *) in_keep "$av" || KEEP_LIST="${KEEP_LIST}${av} " ;;
        esac
        ;;
    esac
  fi

  # Retained count: only DISCOVERED versions that are kept (a phantom served token
  # that matches no on-disk triple must not inflate the count).
  local RETAINED=0
  for v in "${SORTED_ASC[@]:-}"; do
    [ -n "$v" ] || continue
    in_keep "$v" && RETAINED=$(( RETAINED + 1 ))
  done

  # Prune candidates = discovered versions not in the keep set. When PRUNE_ALLOWED
  # is 0 (soft refusal) we still compute+report them, but never delete.
  local PRUNE_VERSIONS=()
  for v in "${SORTED_ASC[@]:-}"; do
    [ -n "$v" ] || continue
    in_keep "$v" || PRUNE_VERSIONS+=("$v")
  done

  triple_files() {
    local tv="$1" fn
    for fn in "kosmos-${tv}-${ARCH}.${EXT}" "kosmos-${tv}-${ARCH}.${SHA_EXT}" "kosmos-${tv}-${ARCH}.manifest.json"; do
      [ -e "$DIST/$fn" ] && printf '%s\n' "$DIST/$fn"
    done
  }

  local RECLAIM=0 PRUNE_FILE_COUNT=0 pf
  for v in "${PRUNE_VERSIONS[@]:-}"; do
    [ -n "$v" ] || continue
    while IFS= read -r pf; do
      [ -n "$pf" ] || continue
      RECLAIM=$(( RECLAIM + $(file_size "$pf") ))
      PRUNE_FILE_COUNT=$(( PRUNE_FILE_COUNT + 1 ))
    done < <(triple_files "$v")
  done

  # ---- report ----
  if [ "$JSON" -eq 1 ]; then
    local jfirst=1 jv
    FAMILY_JSON="$(printf '"dist":"%s","served_version":"%s","found":%d,"keep":%d,"retained":%d,"prune_versions":[' \
      "$DIST" "$SERVED_VERSION" "$NVER" "$KEEP" "$RETAINED")"
    for v in "${PRUNE_VERSIONS[@]:-}"; do
      [ -n "$v" ] || continue
      [ "$jfirst" -eq 1 ] || FAMILY_JSON="${FAMILY_JSON},"; jfirst=0
      FAMILY_JSON="${FAMILY_JSON}$(printf '"%s"' "$v")"
    done
    FAMILY_JSON="${FAMILY_JSON}$(printf '],"prune_files":%d,"reclaim_bytes":%d,"prune_allowed":%s,"pruned":%s' \
      "$PRUNE_FILE_COUNT" "$RECLAIM" \
      "$([ "$PRUNE_ALLOWED" -eq 1 ] && echo true || echo false)" \
      "$([ "$DO_PRUNE" -eq 1 ] && [ "$CONFIRM" -eq 1 ] && [ "$PRUNE_ALLOWED" -eq 1 ] && echo true || echo false)")"
  else
    echo "dist-retention [$ARCH]: $DIST"
    echo "  served version (protected): ${SERVED_VERSION:-<none: $POINTER absent or version-less>}"
    echo "  versioned triples found:    $NVER"
    echo "  keep window (--keep):       $KEEP"
    echo "  retained versions:          $RETAINED"
    echo "  prune candidates:           ${#PRUNE_VERSIONS[@]} version(s), $PRUNE_FILE_COUNT file(s), $(( RECLAIM / 1024 / 1024 )) MiB"
    if [ "$PRUNE_ALLOWED" -eq 0 ]; then
      echo "  🛑 NOT pruning $ARCH: $POINTER names no served release to protect, so the candidates are LEFT ALONE."
    elif [ "${#PRUNE_VERSIONS[@]}" -gt 0 ]; then
      echo "  would prune:"
      for v in "${PRUNE_VERSIONS[@]}"; do echo "    - kosmos-${v}-${ARCH}.{${EXT},${SHA_EXT},manifest.json}"; done
    fi
  fi

  # ---- dry run: stop here ----
  if [ "$DO_PRUNE" -eq 0 ]; then
    return 0
  fi
  # ---- prune requested but not allowed for this family: leave it ----
  if [ "$PRUNE_ALLOWED" -eq 0 ]; then
    return 0
  fi
  # ---- confirmed prune (the --yes / refuse-without-yes gate is enforced by the
  #      caller before any family runs, so reaching here means DO_PRUNE && CONFIRM) ----

  # Snapshot kept-version files that exist RIGHT NOW, before any deletion, so the
  # post-check can tell "the prune deleted a protected file" (a real bug) from
  # "this dist was already malformed" (a kept version missing a sidecar before).
  local KEPT_BEFORE="" ext_i
  for v in "${SORTED_ASC[@]:-}"; do
    [ -n "$v" ] || continue
    in_keep "$v" || continue
    for ext_i in "$EXT" "$SHA_EXT" manifest.json; do
      [ -e "$DIST/kosmos-${v}-${ARCH}.${ext_i}" ] && KEPT_BEFORE="${KEPT_BEFORE}kosmos-${v}-${ARCH}.${ext_i}"$'\n'
    done
  done

  # Delete ONLY the whitelisted prunable-triple files.
  for v in "${PRUNE_VERSIONS[@]:-}"; do
    [ -n "$v" ] || continue
    while IFS= read -r pf; do
      [ -n "$pf" ] || continue
      rm -f -- "$pf"
      # rm -f exits 0 even when it cannot unlink; count a removal only if the file
      # is actually gone -- a lingering file means the prune did not do what a
      # success line would claim.
      if [ -e "$pf" ]; then
        echo "dist-retention: FAILED to remove $pf (still present after rm)" >&2
        ANY_FAIL=1
      fi
    done < <(triple_files "$v")
  done

  # Post-prune BACKSTOP: safety is primarily structural (the whitelist only ever
  # constructs delete paths for prunable versioned triples). This re-asserts the
  # pointer is still present and that every kept-version file that EXISTED BEFORE
  # the prune still exists, comparing against the pre-prune snapshot so a
  # pre-existing malformed dist is not blamed on the prune.
  local kf
  [ -e "$PFILE" ] || { echo "dist-retention: POST-CHECK FAILED -- $POINTER is missing after prune (this is a bug)" >&2; ANY_FAIL=1; }
  while IFS= read -r kf; do
    [ -n "$kf" ] || continue
    [ -e "$DIST/$kf" ] || { echo "dist-retention: POST-CHECK FAILED -- $kf was present before the prune and is gone after (the prune removed a protected file -- this is a bug)" >&2; ANY_FAIL=1; }
  done <<< "$KEPT_BEFORE"
  return 0
}

# The families, in order. arm64 always runs (its pointer is required); win-x64 runs
# only when it has versioned triples (a dist with no Windows releases shows nothing).
#   process_family <arch> <ext> <sha_ext> <pointer> <served_required> <skip_if_empty>

# --- PRUNE gate: refuse before touching ANY family (one message, not per-family) --
if [ "$DO_PRUNE" -eq 1 ] && [ "$CONFIRM" -eq 0 ]; then
  echo "dist-retention: REFUSING to prune without --yes." >&2
  echo "  Deleting a published release tarball/zip is IRREVERSIBLE -- there is no off-disk copy." >&2
  echo "  Per #1605 that is Josh's call. Re-run with --prune --yes only on his authorisation." >&2
  # Show the dry-run report (both families) so the operator sees what --yes would do.
  DO_PRUNE=0
  {
    if [ "$JSON" -eq 1 ]; then
      process_family arm64 tar.gz tar.gz.sha256 latest.json 1 0; A_JSON="$FAMILY_JSON"
      process_family win-x64 zip zip.sha256 latest-win.json 0 1; W_SKIP="$FAMILY_SKIPPED"; W_JSON="$FAMILY_JSON"
      if [ "$W_SKIP" -eq 1 ]; then printf '{%s}\n' "$A_JSON"; else printf '{%s,"win_x64":{%s}}\n' "$A_JSON" "$W_JSON"; fi
    else
      process_family arm64 tar.gz tar.gz.sha256 latest.json 1 0
      process_family win-x64 zip zip.sha256 latest-win.json 0 1
    fi
  } >&2
  exit 2
fi

if [ "$JSON" -eq 1 ]; then
  process_family arm64 tar.gz tar.gz.sha256 latest.json 1 0; A_JSON="$FAMILY_JSON"
  process_family win-x64 zip zip.sha256 latest-win.json 0 1; W_SKIP="$FAMILY_SKIPPED"; W_JSON="$FAMILY_JSON"
  if [ "$W_SKIP" -eq 1 ]; then printf '{%s}\n' "$A_JSON"; else printf '{%s,"win_x64":{%s}}\n' "$A_JSON" "$W_JSON"; fi
else
  process_family arm64 tar.gz tar.gz.sha256 latest.json 1 0
  process_family win-x64 zip zip.sha256 latest-win.json 0 1
  if [ "$DO_PRUNE" -eq 0 ]; then
    echo "  (dry run -- nothing deleted; pass --prune --yes to delete)"
  fi
fi

[ "$ANY_FAIL" -eq 0 ] || exit 1
exit 0
