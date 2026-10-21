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

git -C "$SITE" rev-parse --verify HEAD >/dev/null 2>&1 || die "$SITE is not a git checkout with a HEAD (set KOSMOS_SITE)"

cmd_status() {
  local committed live
  committed="$(field "$(cat "$SITE/dist/latest.json" 2>/dev/null)" version)"
  live="$(field "$("$CURL_CMD" -fsSL -H 'Cache-Control: no-cache' "$HOST/dist/latest.json" 2>/dev/null)" version)"
  if [ -e "$SITE/$POINTER_FREEZE_FILE" ]; then
    say "FROZEN at $(pointer_freeze_value "$SITE" mac) since $(pointer_freeze_value "$SITE" at): $(pointer_freeze_value "$SITE" because)"
  else
    say "not frozen"
  fi
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
  if [ -e "$SITE/$POINTER_FREEZE_FILE" ]; then
    [ "$(pointer_freeze_value "$SITE" mac)" = "$v" ] && { say "already frozen at $v; nothing changed"; return 0; }
    die "already frozen at $(pointer_freeze_value "$SITE" mac); run off first to move the freeze"
  fi
  for f in $PTRS $SETUPS "$POINTER_FREEZE_FILE"; do
    [ -z "$(git -C "$SITE" status --porcelain -- "$f")" ] || die "$f has uncommitted changes in $SITE; nothing was changed"
  done
  for c in $(git -C "$SITE" log --format=%H -- dist/latest.json); do
    json="$(git -C "$SITE" show "${c}:dist/latest.json" 2>/dev/null)" || continue
    [ "$(field "$json" version)" = "$v" ] && { found="$c"; break; }
  done
  [ -n "$found" ] || die "no commit in $SITE has a dist/latest.json naming $v; nothing was changed"
  kosmos_setup_floor_pointer_ok "pointer-freeze" "$json" || die "$v is below the setup floor; nothing was changed"
  art="$(field "$json" artifact)"; sha="$(field "$json" sha256)"
  [ -n "$art" ] && [ -n "$sha" ] || die "the pointer for $v (commit ${found:0:12}) names no artifact or sha256; nothing was changed"
  tmp="$(mktemp "${TMPDIR:-/tmp}/pointer-freeze.XXXXXX")" || die "could not make a temp file; nothing was changed"
  if ! "$CURL_CMD" -fsSL -o "$tmp" "$HOST/dist/$art"; then rm -f "$tmp"; die "$HOST does not serve $art, so a pin to $v could not deploy; nothing was changed"; fi
  got="$(sha_of "$tmp")"; rm -f "$tmp"
  [ "$got" = "$sha" ] || die "$HOST serves $art with sha256 $got, not the pointer's $sha; nothing was changed"

  printf '%s\n' "$json" > "$SITE/dist/latest.json" || die "could not write dist/latest.json"
  printf '%s\n' "$json" > "$SITE/dist/latest-staging.json" || die "could not write dist/latest-staging.json"
  local restored=""
  if git -C "$SITE" cat-file -e "${found}:setup" 2>/dev/null; then
    git -C "$SITE" show "${found}:setup" > "$SITE/setup" && cp "$SITE/setup" "$SITE/setup-staging" || die "could not restore setup"
    restored="setup setup-staging"
    if git -C "$SITE" cat-file -e "${found}:setup.sha256" 2>/dev/null; then
      git -C "$SITE" show "${found}:setup.sha256" > "$SITE/setup.sha256" && cp "$SITE/setup.sha256" "$SITE/setup-staging.sha256" || die "could not restore setup.sha256"
      restored="$restored setup.sha256 setup-staging.sha256"
    fi
  fi
  printf 'mac=%s\nbecause=%s\nat=%s\n' "$v" "$because" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$SITE/$POINTER_FREEZE_FILE" || die "could not write the marker"
  # shellcheck disable=SC2086 # the lists are fixed words
  git -C "$SITE" add -- $PTRS $restored "$POINTER_FREEZE_FILE" \
    && git -C "$SITE" commit -q -m "pointer-freeze: Mac pointers pinned and frozen at $v (kosmos#6620): $because" -- $PTRS $restored "$POINTER_FREEZE_FILE" \
    || die "the files are written but the commit failed: commit them by hand (git -C $SITE status)"
  say "frozen at $v (from site commit ${found:0:12}): dist/latest.json, dist/latest-staging.json${restored:+, $restored} and $POINTER_FREEZE_FILE committed."
  say "NOT deployed yet. Deploy it:   KOSMOS_SITE=$SITE KOSMOS_STAGING_ROLLBACK=$v tools/deploy-site.sh --promote"
  say "Windows prod is served from R2: pin it there by hand (tools/windows/publish-r2.ps1 -Promote of a known-good build)."
}

cmd_off() {
  [ -e "$SITE/$POINTER_FREEZE_FILE" ] || { say "not frozen; nothing changed"; return 0; }
  local was; was="$(pointer_freeze_value "$SITE" mac)"
  git -C "$SITE" rm -q -- "$POINTER_FREEZE_FILE" \
    && git -C "$SITE" commit -q -m "pointer-freeze: freeze at ${was:-?} lifted (kosmos#6620)" -- "$POINTER_FREEZE_FILE" \
    || die "could not remove and commit $POINTER_FREEZE_FILE"
  say "freeze at ${was:-?} lifted and committed; the pointers stay where they are until the next release moves them."
}

case "${1:-}" in
  on) shift; cmd_on "$@" ;;
  off) cmd_off ;;
  status) cmd_status ;;
  *) say "usage: $0 on --mac <version> --because \"<why>\" | off | status"; exit 64 ;;
esac
