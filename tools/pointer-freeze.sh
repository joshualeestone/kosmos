#!/usr/bin/env bash
# pointer-freeze.sh - kosmos#6620 (security hardening O04-5), incident playbook e step 1: "stop the pointer".
#
#   tools/pointer-freeze.sh on --mac <version> --because "<why>"   pin the Mac pointers to a known-good version, freeze
#   tools/pointer-freeze.sh off                                    lift the freeze
#   tools/pointer-freeze.sh status                                 frozen or not, and the committed and live versions
#
# WHAT `on` DOES, in the site checkout (KOSMOS_SITE, default ~/work/chaoskosmos-site):
#   1. finds the newest site commit whose dist/latest.json names <version>;
#   2. refuses, before writing anything, a version below the setup floor (tools/lib/setup-floor.sh) or one whose
#      artifact the host no longer serves with that pointer's sha256 (the refusals deploy-site.sh would give later);
#   3. writes that pointer as dist/latest.json AND dist/latest-staging.json (staging subscribers older than a bad
#      build would otherwise still be offered it), and the installer pair that stood with it (setup, setup.sha256, and
#      the same bytes as setup-staging, setup-staging.sha256, #5032);
#   4. writes the tracked marker dist/POINTER_FROZEN (mac=, because=, at= UTC), which every pointer writer honours
#      (tools/lib/pointer-freeze.sh): release.sh, promote-channel.sh, publish-staging-pointer.sh,
#      publish-kosmos-windows.sh refuse, and deploy-site.sh publishes only the frozen version;
#   5. commits those files (pathspec only, the checkout is shared). IT DOES NOT DEPLOY: it prints the command that
#      does (deploy-site.sh --promote, the sanctioned pointer move, which allows an older version).
#
# WHAT A PIN DOES TO BOARDS (engine/update.js available(), engine/manifest-verify.js): a board BELOW the pinned
# version updates to it; a board between it and the bad version, or ON the bad version, sees nothing newer and stays
# (the verifier refuses a downgrade), so they need a newer clean release; a fresh install gets the pinned build.
#
# NOT COVERED: Windows prod is served from R2 (tools/windows/publish-r2.ps1 -Promote), which this tool does not touch;
# pin it there by hand. Vercel Instant Rollback bypasses every check. And a freeze does not stop an attacker who
# controls the release Mac itself (they control this checkout): it stops the operator's own tools and the fleet's
# release automation from moving the pointer during an incident, which is how a hand pin is realistically lost.
#
# Seams for tools/test-pointer-freeze.sh: KOSMOS_SITE, KOSMOS_SITE_URL, POINTER_FREEZE_CURL_CMD (stands in for curl).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib/pointer-freeze.sh" || { echo "pointer-freeze: cannot load tools/lib/pointer-freeze.sh" >&2; exit 1; }
. "$HERE/lib/setup-floor.sh" || { echo "pointer-freeze: cannot load tools/lib/setup-floor.sh" >&2; exit 1; }

SITE="${KOSMOS_SITE:-$HOME/work/chaoskosmos-site}"
HOST="${KOSMOS_SITE_URL:-https://installkosmos.com}"
CURL_CMD="${POINTER_FREEZE_CURL_CMD:-curl}"
PTRS="dist/latest.json dist/latest-staging.json"
SETUPS="setup setup.sha256 setup-staging setup-staging.sha256"

say() { printf '%s\n' "$*"; }
die() { printf 'pointer-freeze: %s\n' "$*" >&2; exit 1; }
field() { printf '%s' "$1" | sed -n "s/.*\"$2\":[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p"; }
sha_of() { shasum -a 256 "$1" | awk '{print $1}'; }

# Commit <paths> (read from the working tree) and/or the removal of <rm-path> onto the freshly fetched origin/main, in a
# TEMPORARY index (the shared checkout's own index and local main are never touched, as tools/lib/site-push.sh), and
# push it; a push rejected because origin/main moved is rebuilt on the new tip, up to 3 times. Prints the new sha.
publish_on_origin() {  # <msg> <rm-path or ""> <paths...>
  local msg="$1" rmp="$2" attempt=1 base d tree sha err; shift 2
  while :; do
    git -C "$SITE" fetch -q origin main 2>/dev/null || { echo "pointer-freeze: could not fetch origin/main; nothing was pushed" >&2; return 1; }
    base="$(git -C "$SITE" rev-parse origin/main)" || return 1
    d="$(mktemp -d "${TMPDIR:-/tmp}/pointer-freeze-index.XXXXXX")" || return 1
    if ! GIT_INDEX_FILE="$d/index" git -C "$SITE" read-tree "$base" \
      || { [ $# -gt 0 ] && ! GIT_INDEX_FILE="$d/index" git -C "$SITE" add -- "$@"; } \
      || { [ -n "$rmp" ] && ! GIT_INDEX_FILE="$d/index" git -C "$SITE" update-index --force-remove -- "$rmp"; }; then
      rm -rf "$d"; echo "pointer-freeze: could not build the commit on origin/main; nothing was pushed" >&2; return 1
    fi
    tree="$(GIT_INDEX_FILE="$d/index" git -C "$SITE" write-tree)"; rm -rf "$d"
    [ -n "$tree" ] && sha="$(git -C "$SITE" commit-tree "$tree" -p "$base" -m "$msg")" && [ -n "$sha" ] \
      || { echo "pointer-freeze: could not write the commit; nothing was pushed" >&2; return 1; }
    err="$(LC_ALL=C git -C "$SITE" push -q origin "$sha:refs/heads/main" 2>&1)" && { printf '%s\n' "$sha"; return 0; }
    if ! printf '%s' "$err" | grep -qiE 'fetch first|non-fast-forward|\[rejected\]|cannot lock ref'; then
      echo "pointer-freeze: the push failed and was not retried; nothing was pushed. git said: $err" >&2; return 1
    fi
    [ "$attempt" -ge 3 ] && { echo "pointer-freeze: origin/main kept moving; nothing was pushed after 3 tries" >&2; return 1; }
    attempt=$((attempt + 1))
  done
}

# After a push: put the files this run wrote back as they were and fast-forward the checkout to the pushed commit, so
# it shows what origin/main has. A checkout not on main, or one that cannot move forward, is left as it is and said so.
follow_local() {  # <sha> <paths written...>
  local sha="$1"; shift
  [ "$(git -C "$SITE" symbolic-ref --quiet --short HEAD 2>/dev/null)" = main ] || { say "(the site checkout is not on main, so it was not moved; origin/main has the change)"; return 0; }
  put_back "$@"
  git -C "$SITE" merge -q --ff-only "$sha" 2>/dev/null || say "(the site checkout could not fast-forward to ${sha:0:12}; origin/main has the change: git -C $SITE pull --ff-only)"
}

# The files this run wrote, back as HEAD has them (a file HEAD does not have is removed). They were clean before it ran.
put_back() {  # <paths...>
  local f
  for f in "$@"; do
    if git -C "$SITE" cat-file -e "HEAD:$f" 2>/dev/null; then git -C "$SITE" checkout -q HEAD -- "$f" 2>/dev/null; else rm -f "$SITE/$f"; fi
  done
}

git -C "$SITE" rev-parse --verify HEAD >/dev/null 2>&1 || die "$SITE is not a git checkout with a HEAD (set KOSMOS_SITE)"

cmd_status() {
  local committed live
  committed="$(field "$(cat "$SITE/dist/latest.json" 2>/dev/null)" version)"
  live="$(field "$("$CURL_CMD" -fsSL -H 'Cache-Control: no-cache' "$HOST/dist/latest.json" 2>/dev/null)" version)"
  local m
  git -C "$SITE" fetch -q origin main 2>/dev/null || say "(could not fetch origin/main: this says what this checkout last saw)"
  if m="$(git -C "$SITE" show "origin/main:$POINTER_FREEZE_FILE" 2>/dev/null)"; then
    say "FROZEN at $(printf '%s\n' "$m" | sed -n 's/^mac=//p') since $(printf '%s\n' "$m" | sed -n 's/^at=//p'): $(printf '%s\n' "$m" | sed -n 's/^because=//p')"
  else
    say "not frozen on origin/main"
  fi
  pointer_freeze_on "$SITE" && ! git -C "$SITE" cat-file -e "origin/main:$POINTER_FREEZE_FILE" 2>/dev/null && say "(but this checkout still has a marker: it is behind origin/main or holds an uncommitted one)" || true
  say "committed dist/latest.json: ${committed:-unreadable}; live at $HOST: ${live:-could not read}"
}

cmd_on() {
  local v="" because="" c json found="" art sha tmp got f
  while [ $# -gt 0 ]; do
    case "$1" in
      --mac) v="${2:-}"; shift 2 ;;
      --because) because="${2:-}"; shift 2 ;;
      *) die "unknown option: $1 (usage: on --mac <version> --because \"<why>\")" ;;
    esac
  done
  printf '%s' "$v" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || die "--mac needs a version like 0.7.60 (got '${v}')"
  [ -n "$because" ] || die "--because is required: the marker is the incident record of why the pointer is frozen"
  case "$because" in *"
"*) die "--because must be one line" ;; esac
  git -C "$SITE" fetch -q origin main 2>/dev/null || die "could not fetch origin/main (the freeze must reach every machine through it); nothing was changed"
  if git -C "$SITE" cat-file -e "origin/main:$POINTER_FREEZE_FILE" 2>/dev/null; then
    local at; at="$(git -C "$SITE" show "origin/main:$POINTER_FREEZE_FILE" 2>/dev/null | sed -n 's/^mac=//p' | head -1)"
    [ "$at" = "$v" ] && { say "already frozen at $v on origin/main; nothing changed"; return 0; }
    die "origin/main is already frozen at ${at:-an unreadable marker}; run off first to move the freeze"
  fi
  for f in $PTRS $SETUPS "$POINTER_FREEZE_FILE"; do
    [ -z "$(git -C "$SITE" status --porcelain -- "$f")" ] || die "$f has uncommitted changes in $SITE; nothing was changed"
  done
  for c in $(git -C "$SITE" log --format=%H origin/main -- dist/latest.json); do
    json="$(git -C "$SITE" show "${c}:dist/latest.json" 2>/dev/null)" || continue
    [ "$(field "$json" version)" = "$v" ] && { found="$c"; break; }
  done
  [ -n "$found" ] || die "no commit on origin/main has a dist/latest.json naming $v; nothing was changed"
  kosmos_setup_floor_pointer_ok "pointer-freeze" "$json" || die "$v is below the setup floor; nothing was changed"
  art="$(field "$json" artifact)"; sha="$(field "$json" sha256)"
  [ -n "$art" ] && [ -n "$sha" ] || die "the pointer for $v (commit ${found:0:12}) names no artifact or sha256; nothing was changed"
  tmp="$(mktemp "${TMPDIR:-/tmp}/pointer-freeze.XXXXXX")" || die "could not make a temp file; nothing was changed"
  if ! "$CURL_CMD" -fsSL -o "$tmp" "$HOST/dist/$art"; then rm -f "$tmp"; die "$HOST does not serve $art, so a pin to $v could not deploy; nothing was changed"; fi
  got="$(sha_of "$tmp")"; rm -f "$tmp"
  [ "$got" = "$sha" ] || die "$HOST serves $art with sha256 $got, not the pointer's $sha; nothing was changed"
  # The installer that stood with this pointer must be there and, when the pointer names it (#5032), be those bytes:
  # deploy-site.sh refuses otherwise, and a pin it then refuses would leave the site frozen and undeployable.
  { git -C "$SITE" cat-file -e "${found}:setup" 2>/dev/null && git -C "$SITE" cat-file -e "${found}:setup.sha256" 2>/dev/null; } \
    || die "site commit ${found:0:12} does not have both setup and setup.sha256 committed with that pointer (the bad release's installer would stay, or be served without its checksum); nothing was changed"
  local want_setup; want_setup="$(field "$json" setup_sha256)"
  if [ -n "$want_setup" ]; then
    [ "$(git -C "$SITE" show "${found}:setup" | shasum -a 256 | awk '{print $1}')" = "$want_setup" ] \
      || die "the setup committed with $v (commit ${found:0:12}) is not the installer its pointer names (setup_sha256); nothing was changed"
  fi

  printf '%s\n' "$json" > "$SITE/dist/latest.json" || die "could not write dist/latest.json"
  printf '%s\n' "$json" > "$SITE/dist/latest-staging.json" || die "could not write dist/latest-staging.json"
  # The installer pair that stood with the pointer (both checked above), for prod and staging alike.
  local restored="setup setup-staging setup.sha256 setup-staging.sha256"
  # shellcheck disable=SC2086
  { git -C "$SITE" show "${found}:setup" > "$SITE/setup" && cp "$SITE/setup" "$SITE/setup-staging" \
    && git -C "$SITE" show "${found}:setup.sha256" > "$SITE/setup.sha256" && cp "$SITE/setup.sha256" "$SITE/setup-staging.sha256"; } \
    || { put_back $PTRS $restored; die "could not restore the installer pair; nothing was changed"; }
  printf 'mac=%s\nbecause=%s\nat=%s\n' "$v" "$because" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$SITE/$POINTER_FREEZE_FILE" || { put_back $PTRS $restored "$POINTER_FREEZE_FILE"; die "could not write the marker; nothing was changed"; }
  local sha
  # shellcheck disable=SC2086 # the lists are fixed words
  if ! sha="$(publish_on_origin "pointer-freeze: Mac pointers pinned and frozen at $v (kosmos#6620): $because" "" $PTRS $restored "$POINTER_FREEZE_FILE")"; then
    # shellcheck disable=SC2086
    put_back $PTRS $restored "$POINTER_FREEZE_FILE"
    die "NOT pushed, so nothing is frozen; the checkout is as it was. Fix the cause above and run on again"
  fi
  # shellcheck disable=SC2086
  follow_local "$sha" $PTRS $restored "$POINTER_FREEZE_FILE"
  say "frozen at $v (from site commit ${found:0:12}): dist/latest.json, dist/latest-staging.json${restored:+, $restored} and $POINTER_FREEZE_FILE pushed to origin/main (${sha:0:12})."
  say "NOT deployed yet. Deploy it:   KOSMOS_SITE=$SITE KOSMOS_STAGING_ROLLBACK=$v tools/deploy-site.sh --promote"
  say "Windows prod is served from R2: pin it there by hand (tools/windows/publish-r2.ps1 -Promote of a known-good build)."
}

cmd_off() {
  git -C "$SITE" fetch -q origin main 2>/dev/null || die "could not fetch origin/main; nothing was changed"
  git -C "$SITE" cat-file -e "origin/main:$POINTER_FREEZE_FILE" 2>/dev/null || { say "origin/main is not frozen; nothing changed"; return 0; }
  local was sha; was="$(git -C "$SITE" show "origin/main:$POINTER_FREEZE_FILE" 2>/dev/null | sed -n 's/^mac=//p' | head -1)"
  sha="$(publish_on_origin "pointer-freeze: freeze at ${was:-?} lifted (kosmos#6620)" "$POINTER_FREEZE_FILE")" || die "the freeze was NOT lifted (see above)"
  follow_local "$sha" "$POINTER_FREEZE_FILE"
  say "freeze at ${was:-?} lifted and pushed (${sha:0:12}); the pointers stay where they are until the next release moves them."
}

case "${1:-}" in
  on) shift; cmd_on "$@" ;;
  off) cmd_off ;;
  status) cmd_status ;;
  *) say "usage: $0 on --mac <version> --because \"<why>\" | off | status"; exit 64 ;;
esac
