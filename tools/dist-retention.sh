#!/bin/bash
# #1605 / #2112 -- dist/ retention. The site's dist/ accumulates one versioned
# triple per release, per platform, and nothing prunes them:
#   arm64:   kosmos-<V>-arm64.tar.gz + .tar.gz.sha256 + .manifest.json  (protected by latest.json and latest-staging.json)
#   win-x64: kosmos-<V>-win-x64.zip  + .zip.sha256    + .manifest.json  (protected by latest-win.json and latest-win-staging.json)
# The staging pointers name a build waiting for its promote, so it is protected like the served one.
# This tool REPORTS what would be retained/pruned and, only behind an explicit
# --prune --yes, deletes the old versioned triples of BOTH families.
#
# 🛑 DELETING A PUBLISHED RELEASE TARBALL/ZIP IS IRREVERSIBLE unless another copy
# exists. The tarballs are gitignored in the site repo and there is no GH release,
# and installkosmos.com/dist serves the arm64 tarballs FROM A DEPLOY OF THIS SAME
# DIRECTORY, so the served URL is not a second copy (measured 2026-09-26: Vercel
# serves them; only the Windows zips redirect to R2). --prune requires --yes, and
# it deletes a version ONLY after the SECOND-COPY GATE below proves a byte-identical
# copy of every file in its triple. The DEFAULT is a dry run that deletes nothing.
#
# #1605 keep rule (a version is KEPT if ANY of these hold; the rule only ever adds):
#   1. it is served: latest.json / latest-win.json names it;
#   2. it is staged: latest-staging.json / latest-win-staging.json names it;
#   3. it is one of the --prod-history N most recent PRIOR served versions, read
#      from the git history of the pointer (the site repo commits every promote).
#      If that history cannot be read, the family is NOT pruned (fail closed);
#      --prod-history 0 opts out of this rule explicitly;
#   4. any other top-level *.json in the dist (a rollback pointer, say) names it,
#      by "version" or by artifact filename;
#   5. a --referenced-by FILE names its artifact (defaults to ../versions.html
#      when present), so a download link on the site never dangles;
#   6. it is in the newest --keep N (default 12), the pre-#1605 rolling window.
#
# SECOND-COPY GATE (--copy-base URL, required by --prune): for each prune candidate,
# every file of its triple is fetched in full from <URL>/<name> and its sha256 is
# compared to the local file. Only an exact match on EVERY file lets the version go;
# a 404, a network error, an empty or different body REFUSES it and it is kept.
# A HEAD or a range request is never used (a 206 proves nothing). The base may not
# be installkosmos.com / chaoskosmos.com or this dist directory itself, because a
# copy that the prune removes is not a second copy. --check-copies runs the same
# gate in a dry run, so the report says what a real prune would actually delete.
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
#   tools/dist-retention.sh --dist <DIR> [--keep N] [--prod-history N]
#                           [--referenced-by FILE]... [--copy-base URL] [--check-copies]
#                           [--prune] [--yes] [--json]
#     --dist <DIR>        REQUIRED. A dist directory containing latest.json.
#     --keep N            keep the N most-recent versioned triples PER FAMILY (default 12).
#     --prod-history N    keep the N most recent prior served versions (default 3).
#     --referenced-by F   protect every artifact filename F mentions (repeatable).
#     --copy-base URL     where the second copy lives (the R2 public base). --prune needs it.
#     --check-copies      run the second-copy gate in a dry run too (downloads each candidate).
#     --prune             actually delete prune candidates (needs --yes and --copy-base).
#     --yes               confirm the prune.
#     --json              emit a machine-readable summary instead of the human report.
set -euo pipefail

DIST=""
KEEP=12
PROD_HISTORY=3
REFERENCED_BY=()
COPY_BASE=""
CHECK_COPIES=0
DO_PRUNE=0
CONFIRM=0
JSON=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dist) [ $# -ge 2 ] || { echo "dist-retention: --dist needs a directory value" >&2; exit 1; }; DIST="$2"; shift 2 ;;
    --dist=*) DIST="${1#--dist=}"; shift ;;
    --keep) [ $# -ge 2 ] || { echo "dist-retention: --keep needs an integer value" >&2; exit 1; }; KEEP="$2"; shift 2 ;;
    --keep=*) KEEP="${1#--keep=}"; shift ;;
    --prod-history) [ $# -ge 2 ] || { echo "dist-retention: --prod-history needs an integer value" >&2; exit 1; }; PROD_HISTORY="$2"; shift 2 ;;
    --prod-history=*) PROD_HISTORY="${1#--prod-history=}"; shift ;;
    --referenced-by) [ $# -ge 2 ] || { echo "dist-retention: --referenced-by needs a file" >&2; exit 1; }; REFERENCED_BY+=("$2"); shift 2 ;;
    --referenced-by=*) REFERENCED_BY+=("${1#--referenced-by=}"); shift ;;
    --copy-base) [ $# -ge 2 ] || { echo "dist-retention: --copy-base needs a URL" >&2; exit 1; }; COPY_BASE="$2"; shift 2 ;;
    --copy-base=*) COPY_BASE="${1#--copy-base=}"; shift ;;
    --check-copies) CHECK_COPIES=1; shift ;;
    --prune) DO_PRUNE=1; shift ;;
    --yes) CONFIRM=1; shift ;;
    --json) JSON=1; shift ;;
    -h|--help) sed -n '2,/^set -euo pipefail/p' "$0" | sed '$d'; exit 0 ;;
    *) echo "dist-retention: unknown argument '$1'" >&2; exit 1 ;;
  esac
done

[ -n "$DIST" ] || { echo "dist-retention: --dist <DIR> is required (a dist directory containing latest.json)" >&2; exit 1; }
[ -d "$DIST" ] || { echo "dist-retention: --dist '$DIST' is not a directory" >&2; exit 1; }
[ -f "$DIST/latest.json" ] || { echo "dist-retention: '$DIST' has no latest.json -- refusing to treat it as a dist directory" >&2; exit 1; }
case "$KEEP" in
  ''|*[!0-9]*) echo "dist-retention: --keep must be a non-negative integer, got '$KEEP'" >&2; exit 1 ;;
esac
case "$PROD_HISTORY" in
  ''|*[!0-9]*) echo "dist-retention: --prod-history must be a non-negative integer, got '$PROD_HISTORY'" >&2; exit 1 ;;
esac
# A history deeper than any real promote log is "all of it"; clamp before base-10
# normalization so a huge value cannot wrap (same reasoning as --keep below).
if [ "${#PROD_HISTORY}" -gt 7 ]; then PROD_HISTORY=1000000; else PROD_HISTORY=$((10#$PROD_HISTORY)); fi
for rf in "${REFERENCED_BY[@]:-}"; do
  if [ "${#REFERENCED_BY[@]}" -gt 0 ] && [ -z "$rf" ]; then
    echo "dist-retention: --referenced-by was given an empty path -- refusing (an empty reference list would protect nothing)" >&2; exit 1
  fi
  [ -z "$rf" ] || [ -f "$rf" ] || { echo "dist-retention: --referenced-by '$rf' is not a readable file -- refusing (a missing reference list would protect nothing)" >&2; exit 1; }
done
# The site page that links downloads sits beside dist/. Protect what it links by default.
[ -f "$DIST/../versions.html" ] && REFERENCED_BY+=("$DIST/../versions.html")

# --- second-copy base: validated up front, before any family runs ---------------
if [ -n "$COPY_BASE" ]; then
  COPY_BASE="${COPY_BASE%/}"
  case "$COPY_BASE" in
    https://*|file:///*) : ;;
    *) echo "dist-retention: --copy-base must be an https:// or file:/// URL, got '$COPY_BASE'" >&2; exit 1 ;;
  esac
  # Refuse spellings that let the string checks below see a different place than curl
  # fetches: curl URL-decodes %XX (file:///.../%64ist is .../dist), and a userinfo or
  # trailing-dot host is the same host to curl while the host match below misses it.
  case "$COPY_BASE" in
    *%*|*@*) echo "dist-retention: --copy-base '$COPY_BASE' contains '%' or '@' -- refusing (an encoded or userinfo spelling can name this dist or the site that serves it)" >&2; exit 1 ;;
  esac
  cb_host="${COPY_BASE#https://}"; cb_host="${cb_host%%/*}"; cb_host="${cb_host%%:*}"
  cb_host="$(printf '%s' "$cb_host" | tr '[:upper:]' '[:lower:]')"
  while [ "${cb_host%.}" != "$cb_host" ]; do cb_host="${cb_host%.}"; done
  case "$cb_host" in
    installkosmos.com|*.installkosmos.com|chaoskosmos.com|*.chaoskosmos.com)
      echo "dist-retention: --copy-base '$COPY_BASE' is the site that serves THIS dist -- it is not a second copy (deploying the prune removes it). Use the R2 bucket's own URL." >&2
      exit 1 ;;
  esac
  case "$COPY_BASE" in
    file:///*)
      cb_dir="${COPY_BASE#file://}"
      if [ -d "$cb_dir" ] && [ "$(cd "$cb_dir" && pwd -P)" = "$(cd "$DIST" && pwd -P)" ]; then
        echo "dist-retention: --copy-base is this dist directory itself -- a file cannot be its own second copy" >&2
        exit 1
      fi ;;
  esac
fi
if [ "$DO_PRUNE" -eq 1 ] && [ "$CONFIRM" -eq 1 ] && [ -z "$COPY_BASE" ]; then
  echo "dist-retention: REFUSING to prune without --copy-base: a version is deleted only when a byte-identical second copy is proven there." >&2
  exit 2
fi
if [ "$CHECK_COPIES" -eq 1 ] && [ -z "$COPY_BASE" ]; then
  echo "dist-retention: --check-copies needs --copy-base <URL>" >&2
  exit 1
fi
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
# The Windows pointers name the versioned zip in "versioned" ("artifact" is the alias).
read_pointer_versioned() {
  grep -o '"versioned"[[:space:]]*:[[:space:]]*"[^"]*"' "$1" 2>/dev/null | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true
}

# file_id <file>: "device:inode" after following symlinks, or non-zero status.
file_id() {
  stat -L -f '%d:%i' "$1" 2>/dev/null || stat -L -c '%d:%i' "$1" 2>/dev/null
}

# sha256_of <file>: the hex digest, or non-zero status. No pipe, so a failing
# hasher cannot be masked by a later stage.
sha256_of() {
  local out
  if command -v shasum >/dev/null 2>&1; then out="$(shasum -a 256 "$1")" || return 1
  else out="$(sha256sum "$1")" || return 1; fi
  printf '%s' "${out%% *}"
}

# The gate's scratch space: one download at a time, removed on exit.
GATE_TMP=""
cleanup_gate() { [ -z "$GATE_TMP" ] || rm -rf "$GATE_TMP"; }
trap cleanup_gate EXIT

# copy_proven <local-file>: 0 only when <COPY_BASE>/<basename> downloads IN FULL
# and its sha256 equals the local file's. Prints the refusal reason on stdout
# (the caller reports it) and returns 1 otherwise. A full GET, never HEAD or a
# range, because a 206 or a 200 header says nothing about the bytes.
copy_proven() {
  local f="$1" name tmp lh rh
  name="$(basename "$f")"
  # GATE_TMP is made in the main shell (this runs inside a command substitution,
  # so anything created here could not be cleaned up by the EXIT trap).
  [ -d "$GATE_TMP" ] || { echo "gate scratch directory missing"; return 1; }
  tmp="$GATE_TMP/copy"
  rm -f "$tmp"
  # A file:// source that IS the local file (a symlink or hardlink to it, or the dist
  # reached by another path) is not a second copy, whatever its hash says.
  case "$COPY_BASE" in
    file:///*)
      local src="${COPY_BASE#file://}/$name" li si
      if [ -e "$src" ]; then
        li="$(file_id "$f")" || { echo "could not identify local $name"; return 1; }
        si="$(file_id "$src")" || { echo "could not identify the copy of $name"; return 1; }
        [ "$li" != "$si" ] || { echo "copy of $name is the same file as the local one (link or same path), not a second copy"; return 1; }
      fi ;;
  esac
  # No redirects: a base that redirects could land on the site serving this dist,
  # which the host check above cannot see. A 3xx is saved as-is and fails the hash.
  if ! curl -fsS --max-redirs 0 --proto '=https,file' --max-time 1800 -o "$tmp" "$COPY_BASE/$name" </dev/null 2>/dev/null; then
    echo "no copy at $COPY_BASE/$name (fetch failed or not found)"; return 1
  fi
  [ -f "$tmp" ] || { echo "no copy at $COPY_BASE/$name (nothing downloaded)"; return 1; }
  lh="$(sha256_of "$f")" || { echo "could not hash local $name"; return 1; }
  rh="$(sha256_of "$tmp")" || { echo "could not hash the copy of $name"; return 1; }
  rm -f "$tmp"
  [ ${#lh} -eq 64 ] || { echo "local hash of $name is malformed"; return 1; }
  [ "$lh" = "$rh" ] || { echo "copy of $name DIFFERS (local ${lh:0:12}, copy ${rh:0:12})"; return 1; }
  return 0
}

# prior_served_versions <pointer> <served> <n>: the n most recent DISTINCT versions
# the pointer named before the served one, newest first, read from git history.
# Non-zero when the history cannot be read (not a git checkout, pointer never
# committed): the caller then refuses to prune that family rather than guess.
prior_served_versions() {
  local pointer="$1" served="$2" n="$3" shas sha content ver nm seen=" " got=0
  git -C "$DIST" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1
  # A shallow clone (CI and deploy checkouts often are) holds only the newest
  # promotes, so "found fewer prior versions" would read as "there were none".
  [ "$(git -C "$DIST" rev-parse --is-shallow-repository 2>/dev/null)" = "false" ] || return 1
  # A checkout BEHIND its upstream reads an older history as if it were current.
  # With no upstream (a detached or local-only checkout) this cannot be checked.
  local up
  if up="$(git -C "$DIST" rev-parse --verify --quiet '@{upstream}' 2>/dev/null)" && [ -n "$up" ]; then
    git -C "$DIST" merge-base --is-ancestor "$up" HEAD 2>/dev/null || return 1
  fi
  shas="$(git -C "$DIST" log --format=%H -- "$pointer" 2>/dev/null)" || return 1
  [ -n "$shas" ] || return 1
  [ "$n" -gt 0 ] || return 0
  for sha in $shas; do
    content="$(git -C "$DIST" show "${sha}:./${pointer}" 2>/dev/null)" || continue
    ver="$(printf '%s\n' "$content" | grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)"
    case "$ver" in ''|*[!0-9A-Za-z.+_-]*) continue ;; esac
    [ "$ver" = "$served" ] && continue
    case "$seen" in *" $ver "*) continue ;; esac
    # Also the artifact names the old pointer gave (version-format skew: "0.6.5"
    # naming kosmos-0.6.05-...). Emitted as "@<name>" lines; the caller protects them.
    for nm in "$(printf '%s\n' "$content" | grep -o '"artifact"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)" \
              "$(printf '%s\n' "$content" | grep -o '"versioned"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)"; do
      [ -z "$nm" ] || printf '@%s\n' "$nm"
    done
    seen="${seen}${ver} "
    printf '%s\n' "$ver"
    got=$(( got + 1 ))
    [ "$got" -ge "$n" ] && break
  done
  return 0
}

if [ -n "$COPY_BASE" ]; then GATE_TMP="$(mktemp -d)" || { echo "dist-retention: cannot create a scratch directory for the second-copy gate" >&2; exit 1; }; fi

# ---------------------------------------------------------------------------
# process_family <arch> <ext> <sha_ext> <pointer> <served_required> <skip_if_empty> [<staged_pointer>]
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

  # protect_named_artifact <filename>: keep the version in a versioned artifact
  # filename that a pointer names explicitly -- closes a version-format-skew gap
  # (pointer "0.6.5" while the file is kosmos-0.6.05-<arch>.<ext>). A name not
  # shaped like this family's versioned artifact (an alias, the other family,
  # empty) is ignored.
  protect_named_artifact() {
    local named="$1" av
    case "$named" in
      kosmos-[0-9]*-"$ARCH"."$EXT")
        av="${named#kosmos-}"; av="${av%-$ARCH.$EXT}"
        case "$av" in
          ''|*[!0-9A-Za-z.+_-]*) : ;;
          *) in_keep "$av" || KEEP_LIST="${KEEP_LIST}${av} " ;;
        esac
        ;;
    esac
  }

  # Protect the served version unconditionally (when we have one), by its version
  # string AND by the artifact filename its pointer names: `artifact` (arm64's
  # versioned tarball) and `versioned` (the Windows pointer, whose `artifact` is
  # the unversioned alias).
  if [ -n "$SERVED_VERSION" ]; then
    in_keep "$SERVED_VERSION" || KEEP_LIST="${KEEP_LIST}${SERVED_VERSION} "
    protect_named_artifact "$(read_pointer_artifact "$PFILE")"
    protect_named_artifact "$(read_pointer_versioned "$PFILE")"
  fi

  # Protect the STAGED version too (the staging channel: latest-staging.json for
  # arm64, latest-win-staging.json for win-x64). A staged build is waiting for its
  # promote, which copies a pointer that names it; pruning it would leave the
  # staging pointer -- and prod, after the promote -- naming bytes that are gone.
  # An absent staging pointer protects nothing extra (the pre-staging behaviour).
  local STAGED_POINTER="${7:-}" STAGED_VERSION=""
  if [ -n "$STAGED_POINTER" ] && [ -f "$DIST/$STAGED_POINTER" ]; then
    STAGED_VERSION="$(read_pointer_version "$DIST/$STAGED_POINTER")"
    case "$STAGED_VERSION" in
      ''|*[!0-9A-Za-z.+_-]*) : ;;
      *) in_keep "$STAGED_VERSION" || KEEP_LIST="${KEEP_LIST}${STAGED_VERSION} " ;;
    esac
    protect_named_artifact "$(read_pointer_artifact "$DIST/$STAGED_POINTER")"
    protect_named_artifact "$(read_pointer_versioned "$DIST/$STAGED_POINTER")"
  fi

  # #1605 rule 3: the N most recent PRIOR served versions, from the pointer's git
  # history. Unreadable history = do not prune this family (fail closed), unless
  # the operator opted out with --prod-history 0.
  local PRIOR_PROD="" pv HISTORY_OK=1
  if [ -n "$SERVED_VERSION" ] && [ "$NVER" -gt 0 ]; then
    if PRIOR_PROD="$(prior_served_versions "$POINTER" "$SERVED_VERSION" "$PROD_HISTORY")"; then
      for pv in $PRIOR_PROD; do
        case "$pv" in
          @*) protect_named_artifact "${pv#@}" ;;
          *) in_keep "$pv" || KEEP_LIST="${KEEP_LIST}${pv} " ;;
        esac
      done
      # Report versions only; the "@name" lines were for protection.
      PRIOR_PROD="$(printf '%s\n' $PRIOR_PROD | grep -v '^@' || true)"
    elif [ "$PROD_HISTORY" -gt 0 ]; then
      HISTORY_OK=0
      PRUNE_ALLOWED=0
    fi
  fi

  # #1605 rules 4 and 5: any other pointer-shaped json in the dist (a rollback
  # pointer), and any --referenced-by file, protects what it names. Over-protecting
  # (a win pointer's version also shielding the same arm64 version) is the safe side.
  local jf nm
  shopt -s nullglob
  for jf in "$DIST"/*.json; do
    case "$(basename "$jf")" in *.manifest.json) continue ;; esac
    pv="$(read_pointer_version "$jf")"
    case "$pv" in ''|*[!0-9A-Za-z.+_-]*) : ;; *) in_keep "$pv" || KEEP_LIST="${KEEP_LIST}${pv} " ;; esac
    while IFS= read -r nm; do protect_named_artifact "$nm"; done < <(grep -o "kosmos-[0-9][0-9A-Za-z.+_-]*-${ARCH}\.${EXT}" "$jf" 2>/dev/null || true)
  done
  shopt -u nullglob
  for jf in "${REFERENCED_BY[@]:-}"; do
    [ -n "$jf" ] || continue
    while IFS= read -r nm; do protect_named_artifact "$nm"; done < <(grep -o "kosmos-[0-9][0-9A-Za-z.+_-]*-${ARCH}\.${EXT}" "$jf" 2>/dev/null || true)
  done

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

  # ---- second-copy gate ----
  # Runs for a confirmed prune (always) or a dry run with --check-copies. A version
  # is PROVEN only when every file of its triple has a byte-identical copy.
  local GATE_RAN=0 PROVEN_VERSIONS=() REFUSED_VERSIONS=() REFUSED_LINES="" why ok
  if [ "$PRUNE_ALLOWED" -eq 1 ] && { { [ "$DO_PRUNE" -eq 1 ] && [ "$CONFIRM" -eq 1 ]; } || [ "$CHECK_COPIES" -eq 1 ]; }; then
    GATE_RAN=1
    for v in "${PRUNE_VERSIONS[@]:-}"; do
      [ -n "$v" ] || continue
      ok=1
      while IFS= read -r pf; do
        [ -n "$pf" ] || continue
        if ! why="$(copy_proven "$pf")"; then
          ok=0; REFUSED_LINES="${REFUSED_LINES}    - kosmos-${v}-${ARCH}: ${why}"$'\n'; break
        fi
      done < <(triple_files "$v")
      if [ "$ok" -eq 1 ]; then PROVEN_VERSIONS+=("$v"); else REFUSED_VERSIONS+=("$v"); fi
    done
  fi

  # ---- report ----
  if [ "$JSON" -eq 1 ]; then
    local jfirst=1 jv
    # "staged_version" appears only when the family HAS a staging pointer, so a dist without one
    # emits exactly the JSON it did before the staging channel existed.
    local STAGED_JSON=""
    if [ -n "$STAGED_POINTER" ] && [ -f "$DIST/$STAGED_POINTER" ]; then
      STAGED_JSON="$(printf '"staged_version":"%s",' "$STAGED_VERSION")"
    fi
    FAMILY_JSON="$(printf '"dist":"%s","served_version":"%s",%s"found":%d,"keep":%d,"retained":%d,"prune_versions":[' \
      "$DIST" "$SERVED_VERSION" "$STAGED_JSON" "$NVER" "$KEEP" "$RETAINED")"
    for v in "${PRUNE_VERSIONS[@]:-}"; do
      [ -n "$v" ] || continue
      [ "$jfirst" -eq 1 ] || FAMILY_JSON="${FAMILY_JSON},"; jfirst=0
      FAMILY_JSON="${FAMILY_JSON}$(printf '"%s"' "$v")"
    done
    FAMILY_JSON="${FAMILY_JSON}$(printf '],"prune_files":%d,"reclaim_bytes":%d,"prune_allowed":%s,"pruned":%s' \
      "$PRUNE_FILE_COUNT" "$RECLAIM" \
      "$([ "$PRUNE_ALLOWED" -eq 1 ] && echo true || echo false)" \
      "$([ "$DO_PRUNE" -eq 1 ] && [ "$CONFIRM" -eq 1 ] && [ "$PRUNE_ALLOWED" -eq 1 ] && [ -n "${PROVEN_VERSIONS[*]:-}" ] && echo true || echo false)")"
    FAMILY_JSON="${FAMILY_JSON}$(printf ',"prior_served":[')"
    jfirst=1
    for v in $PRIOR_PROD; do
      [ "$jfirst" -eq 1 ] || FAMILY_JSON="${FAMILY_JSON},"; jfirst=0
      FAMILY_JSON="${FAMILY_JSON}$(printf '"%s"' "$v")"
    done
    FAMILY_JSON="${FAMILY_JSON}$(printf '],"history_ok":%s,"copies_checked":%s' \
      "$([ "$HISTORY_OK" -eq 1 ] && echo true || echo false)" "$([ "$GATE_RAN" -eq 1 ] && echo true || echo false)")"
    if [ "$GATE_RAN" -eq 1 ]; then
      FAMILY_JSON="${FAMILY_JSON},\"copy_proven\":["; jfirst=1
      for v in "${PROVEN_VERSIONS[@]:-}"; do [ -n "$v" ] || continue; [ "$jfirst" -eq 1 ] || FAMILY_JSON="${FAMILY_JSON},"; jfirst=0; FAMILY_JSON="${FAMILY_JSON}\"$v\""; done
      FAMILY_JSON="${FAMILY_JSON}],\"copy_refused\":["; jfirst=1
      for v in "${REFUSED_VERSIONS[@]:-}"; do [ -n "$v" ] || continue; [ "$jfirst" -eq 1 ] || FAMILY_JSON="${FAMILY_JSON},"; jfirst=0; FAMILY_JSON="${FAMILY_JSON}\"$v\""; done
      FAMILY_JSON="${FAMILY_JSON}]"
    fi
  else
    echo "dist-retention [$ARCH]: $DIST"
    echo "  served version (protected): ${SERVED_VERSION:-<none: $POINTER absent or version-less>}"
    if [ -n "$STAGED_POINTER" ] && [ -f "$DIST/$STAGED_POINTER" ]; then
      echo "  staged version (protected): ${STAGED_VERSION:-<none: $STAGED_POINTER is version-less>}"
    fi
    echo "  versioned triples found:    $NVER"
    echo "  keep window (--keep):       $KEEP"
    if [ "$HISTORY_OK" -eq 0 ]; then
      echo "  prior served (protected):   <UNREADABLE: $POINTER has no git history here>"
    else
      echo "  prior served (protected):   ${PRIOR_PROD:+$(printf '%s ' $PRIOR_PROD)}${PRIOR_PROD:-<none> }(--prod-history $PROD_HISTORY)"
    fi
    echo "  retained versions:          $RETAINED"
    echo "  prune candidates:           ${#PRUNE_VERSIONS[@]} version(s), $PRUNE_FILE_COUNT file(s), $(( RECLAIM / 1024 / 1024 )) MiB"
    if [ "$HISTORY_OK" -eq 0 ]; then
      echo "  🛑 NOT pruning $ARCH: the prior served versions cannot be read from $POINTER's git history, so the candidates are LEFT ALONE (pass --prod-history 0 to opt out of that rule)."
    elif [ "$PRUNE_ALLOWED" -eq 0 ]; then
      echo "  🛑 NOT pruning $ARCH: $POINTER names no served release to protect, so the candidates are LEFT ALONE."
    elif [ "${#PRUNE_VERSIONS[@]}" -gt 0 ]; then
      echo "  would prune:"
      for v in "${PRUNE_VERSIONS[@]}"; do echo "    - kosmos-${v}-${ARCH}.{${EXT},${SHA_EXT},manifest.json}"; done
    fi
    if [ "$GATE_RAN" -eq 1 ]; then
      echo "  second copy proven at $COPY_BASE: ${#PROVEN_VERSIONS[@]} version(s) may go"
      if [ "${#REFUSED_VERSIONS[@]}" -gt 0 ]; then
        echo "  REFUSED, kept (no proven byte-identical copy): ${#REFUSED_VERSIONS[@]} version(s)"
        printf '%s' "$REFUSED_LINES"
      fi
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

  # Delete ONLY the whitelisted prunable-triple files, and only for versions the
  # second-copy gate PROVED. A refused version is never touched.
  for v in "${PROVEN_VERSIONS[@]:-}"; do
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
#   process_family <arch> <ext> <sha_ext> <pointer> <served_required> <skip_if_empty> <staged_pointer>

# --- PRUNE gate: refuse before touching ANY family (one message, not per-family) --
if [ "$DO_PRUNE" -eq 1 ] && [ "$CONFIRM" -eq 0 ]; then
  echo "dist-retention: REFUSING to prune without --yes." >&2
  echo "  Deleting a published release tarball/zip is IRREVERSIBLE on this disk; a version goes only when --copy-base proves a byte-identical second copy." >&2
  echo "  Per #1605 that is Josh's call. Re-run with --prune --yes only on his authorisation." >&2
  # Show the dry-run report (both families) so the operator sees what --yes would do.
  DO_PRUNE=0
  {
    if [ "$JSON" -eq 1 ]; then
      process_family arm64 tar.gz tar.gz.sha256 latest.json 1 0 latest-staging.json; A_JSON="$FAMILY_JSON"
      process_family win-x64 zip zip.sha256 latest-win.json 0 1 latest-win-staging.json; W_SKIP="$FAMILY_SKIPPED"; W_JSON="$FAMILY_JSON"
      if [ "$W_SKIP" -eq 1 ]; then printf '{%s}\n' "$A_JSON"; else printf '{%s,"win_x64":{%s}}\n' "$A_JSON" "$W_JSON"; fi
    else
      process_family arm64 tar.gz tar.gz.sha256 latest.json 1 0 latest-staging.json
      process_family win-x64 zip zip.sha256 latest-win.json 0 1 latest-win-staging.json
    fi
  } >&2
  exit 2
fi

if [ "$JSON" -eq 1 ]; then
  process_family arm64 tar.gz tar.gz.sha256 latest.json 1 0 latest-staging.json; A_JSON="$FAMILY_JSON"
  process_family win-x64 zip zip.sha256 latest-win.json 0 1 latest-win-staging.json; W_SKIP="$FAMILY_SKIPPED"; W_JSON="$FAMILY_JSON"
  if [ "$W_SKIP" -eq 1 ]; then printf '{%s}\n' "$A_JSON"; else printf '{%s,"win_x64":{%s}}\n' "$A_JSON" "$W_JSON"; fi
else
  process_family arm64 tar.gz tar.gz.sha256 latest.json 1 0 latest-staging.json
  process_family win-x64 zip zip.sha256 latest-win.json 0 1 latest-win-staging.json
  if [ "$DO_PRUNE" -eq 0 ]; then
    echo "  (dry run -- nothing deleted; pass --prune --yes to delete)"
  fi
fi

[ "$ANY_FAIL" -eq 0 ] || exit 1
exit 0
