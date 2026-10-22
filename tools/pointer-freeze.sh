#!/usr/bin/env bash
# pointer-freeze.sh - kosmos#6620 (security hardening O04-5), incident playbook e step 1: "stop the pointer".
#
#   tools/pointer-freeze.sh on --mac <version> --because "<why>" [--sha256 <sha>]   pin the Mac pointers and freeze
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
#   4. writes the tracked marker dist/POINTER_FROZEN (mac=, sha256= of the pinned pointer, because=, at= UTC), which
#      every pointer writer honours
#      (tools/lib/pointer-freeze.sh): release.sh, promote-channel.sh, publish-staging-pointer.sh,
#      publish-kosmos-windows.sh refuse, and deploy-site.sh publishes only the frozen version;
#   5. builds that change in a TEMPORARY index on the freshly fetched origin/main and pushes it (this checkout's own
#      index and working tree are never written until it fast-forwards afterwards, which a dirty tree refuses; a cut
#      already running on this box is refused at its own site push either way). IT DOES NOT DEPLOY: it prints the
#      command that does (deploy-site.sh --promote, or --publish when prod already serves the pinned version).
#
# WHAT A PIN DOES TO BOARDS (engine/update.js available(), engine/manifest-verify.js): a board BELOW the pinned
# version updates to it; a board between it and the bad version, or ON the bad version, sees nothing newer and stays
# (the verifier refuses a downgrade), so they need a newer clean release; a fresh install through /setup gets the
# pinned build (Kosmos.pkg does not: see below).
#
# NOT COVERED: Windows prod is served from R2, which this tool does not touch. tools/windows/publish-r2.ps1 -Promote
# moves it only onto the staged build (Josh's approval, a passing staging check, a signed manifest), so pinning an
# older good build means re-staging it first. Nor the site's Kosmos.pkg (a deploy carries the live one): replace it by hand. The --because
# line is committed to the site repo, so keep it to what that repo's readers may see. Vercel Instant Rollback bypasses
# every check. And a freeze does not stop an attacker who controls the release Mac itself (they control this
# checkout): it stops the operator's own tools and the fleet's release automation from moving the pointer during an
# incident, which is how a hand pin is realistically lost.
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

# Build a commit on the freshly fetched origin/main in a TEMPORARY index from blob entries ("mode,blob,path"), push it,
# and print its sha. Nothing here writes the shared checkout's working tree, its index or local main (as
# tools/lib/site-push.sh), so a cut or promote running on the same box never reads a half-made pin. A push rejected
# because origin/main moved is rebuilt on the new tip, up to 3 times, and the freeze is re-checked on every tip: `on`
# never overwrites a freeze someone else pushed meanwhile, and `off` never lifts one that is already gone.
publish_on_origin() {  # <msg> <on|off> <mode,blob,path ...>
  local msg="$1" mode="$2" attempt=1 base d tree sha err entry; shift 2
  while :; do
    pointer_freeze_fetch "$SITE" || { echo "pointer-freeze: could not fetch origin/main; nothing was pushed" >&2; return 1; }
    base="$(git -C "$SITE" rev-parse origin/main)" || return 1
    if [ "$mode" = on ] && git -C "$SITE" cat-file -e "$base:$POINTER_FREEZE_FILE" 2>/dev/null; then
      echo "pointer-freeze: origin/main was frozen by someone else meanwhile; nothing was pushed (run status)" >&2; return 1
    fi
    if [ "$mode" = off ] && ! git -C "$SITE" cat-file -e "$base:$POINTER_FREEZE_FILE" 2>/dev/null; then
      echo "pointer-freeze: origin/main is no longer frozen; nothing was pushed" >&2; return 1
    fi
    d="$(mktemp -d "${TMPDIR:-/tmp}/pointer-freeze-index.XXXXXX")" || return 1
    if ! GIT_INDEX_FILE="$d/index" git -C "$SITE" read-tree "$base"; then rm -rf "$d"; echo "pointer-freeze: could not read origin/main; nothing was pushed" >&2; return 1; fi
    for entry in "$@"; do
      GIT_INDEX_FILE="$d/index" git -C "$SITE" update-index --add --cacheinfo "$entry" \
        || { rm -rf "$d"; echo "pointer-freeze: could not stage $entry; nothing was pushed" >&2; return 1; }
    done
    if [ "$mode" = off ] && ! GIT_INDEX_FILE="$d/index" git -C "$SITE" update-index --force-remove -- "$POINTER_FREEZE_FILE"; then
      rm -rf "$d"; echo "pointer-freeze: could not remove the marker; nothing was pushed" >&2; return 1
    fi
    tree="$(GIT_INDEX_FILE="$d/index" git -C "$SITE" write-tree)"; rm -rf "$d"
    [ -n "$tree" ] && sha="$(git -C "$SITE" commit-tree "$tree" -p "$base" -m "$msg")" && [ -n "$sha" ] \
      || { echo "pointer-freeze: could not write the commit; nothing was pushed" >&2; return 1; }
    err="$(LC_ALL=C pointer_freeze_git 120 "$SITE" push -q origin "$sha:refs/heads/main" 2>&1)" && { printf '%s\n' "$sha"; return 0; }
    if ! printf '%s' "$err" | grep -qiE 'fetch first|non-fast-forward|\[rejected\]|cannot lock ref'; then
      echo "pointer-freeze: the push did not confirm and was not retried (a push stopped by the time limit may still have landed). git said: $err" >&2; return 1
    fi
    [ "$attempt" -ge 3 ] && { echo "pointer-freeze: origin/main kept moving; nothing was pushed after 3 tries" >&2; return 1; }
    attempt=$((attempt + 1))
  done
}

# "mode,blob,<as-path>" for <path> in <commit>, for update-index --cacheinfo (keeps the file's mode, e.g. an executable).
entry_of() {  # <commit> <path> <as-path>
  local line; line="$(git -C "$SITE" ls-tree "$1" -- "$2")" || return 1
  [ -n "$line" ] || return 1
  printf '%s,%s,%s\n' "$(printf '%s' "$line" | awk '{print $1}')" "$(printf '%s' "$line" | awk '{print $3}')" "$3"
}

# After a push: fast-forward the checkout to it, so it shows what origin/main has. A checkout not on main, or one that
# cannot move forward (a colleague's change in the way), is left as it is and said so; origin/main has the change.
FOLLOWED=0
follow_local() {  # <sha> ; sets FOLLOWED=1 when this checkout now is the pushed commit
  [ "$(git -C "$SITE" symbolic-ref --quiet --short HEAD 2>/dev/null)" = main ] || { say "(the site checkout is not on main, so it was not moved; origin/main has the change)"; return 0; }
  local ffout
  if ffout="$(git -C "$SITE" merge -q --ff-only "$1" 2>&1)"; then FOLLOWED=1
  else say "(the site checkout could not fast-forward to ${1:0:12}; origin/main has the change. git said: $(printf '%s' "$ffout" | tr '\n' ' ')see git -C $SITE status before moving it)"; fi
}

git -C "$SITE" rev-parse --verify HEAD >/dev/null 2>&1 || die "$SITE is not a git checkout with a HEAD (set KOSMOS_SITE)"

cmd_status() {
  local committed live
  committed="$(field "$(cat "$SITE/dist/latest.json" 2>/dev/null)" version)"
  live="$(field "$("$CURL_CMD" --connect-timeout 15 --max-time 30 -fsSL -H 'Cache-Control: no-cache' "$HOST/dist/latest.json" 2>/dev/null)" version)"
  local m
  pointer_freeze_fetch "$SITE" || say "(could not fetch origin/main: this says what this checkout last saw)"
  if m="$(git -C "$SITE" show "origin/main:$POINTER_FREEZE_FILE" 2>/dev/null)"; then
    say "FROZEN at $(printf '%s\n' "$m" | sed -n 's/^mac=//p') since $(printf '%s\n' "$m" | sed -n 's/^at=//p'): $(printf '%s\n' "$m" | sed -n 's/^because=//p')"
  else
    say "not frozen on origin/main"
  fi
  pointer_freeze_on "$SITE" && ! git -C "$SITE" cat-file -e "origin/main:$POINTER_FREEZE_FILE" 2>/dev/null && say "(but this checkout still has a marker: it is behind origin/main or holds an uncommitted one)" || true
  say "this checkout's dist/latest.json: ${committed:-unreadable}; origin/main's: $(field "$(git -C "$SITE" show origin/main:dist/latest.json 2>/dev/null)" version); live at $HOST: ${live:-could not read}"
}

cmd_on() {
  # --sha256: the known-good build's sha256 from somewhere OTHER than the site repo (the release record, a colleague's
  # note): the site's history is part of what an incident may have tainted, so when given, the pointer must match it.
  local v="" because="" want_sha="" c json found="" art sha tmp got f
  while [ $# -gt 0 ]; do
    case "$1" in
      --mac|--because|--sha256) [ $# -ge 2 ] || die "$1 needs a value"
        case "$1" in --mac) v="$2" ;; --because) because="$2" ;; --sha256) want_sha="$2" ;; esac; shift 2 ;;
      *) die "unknown option: $1 (usage: on --mac <version> --because \"<why>\" [--sha256 <known-good sha256>])" ;;
    esac
  done
  printf '%s' "$v" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || die "--mac needs a version like 0.7.60 (got '${v}')"
  [ -n "$because" ] || die "--because is required: the marker is the incident record of why the pointer is frozen"
  case "$because" in *"
"*) die "--because must be one line" ;; esac
  pointer_freeze_fetch "$SITE" || die "could not fetch origin/main (the freeze must reach every machine through it); nothing was changed"
  if git -C "$SITE" cat-file -e "origin/main:$POINTER_FREEZE_FILE" 2>/dev/null; then
    local at; at="$(git -C "$SITE" show "origin/main:$POINTER_FREEZE_FILE" 2>/dev/null | sed -n 's/^mac=//p' | head -1)"
    if [ "$at" = "$v" ]; then
      # Frozen at this version already: say so only if origin/main still holds the pin (a pointer pushed on top of a
      # freeze by hand is caught here, not reported as fine).
      local fz_sha p; fz_sha="$(git -C "$SITE" show "origin/main:$POINTER_FREEZE_FILE" 2>/dev/null | sed -n 's/^sha256=//p' | head -1)"
      for p in $PTRS; do
        [ "$(field "$(git -C "$SITE" show "origin/main:$p" 2>/dev/null)" version)" = "$v" ] \
          && { [ -z "$fz_sha" ] || [ "$(field "$(git -C "$SITE" show "origin/main:$p" 2>/dev/null)" sha256)" = "$fz_sha" ]; } \
          || die "origin/main is frozen at $v but its $p no longer names that build: put it back as the freeze commit has it (a new commit), or as a last resort off, then on (every release tool may move the pointers between the two)"
      done
      local moved; moved="$(pointer_freeze_moved "$SITE" origin/main origin/main)" \
        || die "could not compare origin/main with the commit that froze it; nothing was changed"
      [ -z "$moved" ] || die "origin/main is frozen at $v but $(printf '%s' "$moved" | tr '\n' ' ')changed since the freeze commit, so a deploy would refuse it: put them back as the freeze commit has them (a new commit)"
      say "already frozen at $v on origin/main, and its Mac pointers still name that build; nothing changed"; return 0
    fi
    die "origin/main is already frozen at ${at:-an unreadable marker}; run off first to move the freeze"
  fi
  # No refusal for uncommitted pointer files in this checkout: the pin is built in a temporary index and never touches
  # them, and a cut dying (or still running) here leaves exactly such files, at the moment a freeze is most needed.
  for c in $(git -C "$SITE" log --format=%H origin/main -- dist/latest.json); do
    json="$(git -C "$SITE" show "${c}:dist/latest.json" 2>/dev/null)" || continue
    [ "$(field "$json" version)" = "$v" ] && { found="$c"; break; }
  done
  [ -n "$found" ] || die "no commit on origin/main has a dist/latest.json naming $v; nothing was changed"
  kosmos_setup_floor_pointer_ok "pointer-freeze" "$json" || die "$v is below the setup floor; nothing was changed"
  art="$(field "$json" artifact)"; sha="$(field "$json" sha256)"
  [ -n "$art" ] && [ -n "$sha" ] || die "the pointer for $v (commit ${found:0:12}) names no artifact or sha256; nothing was changed"
  [ -z "$want_sha" ] || [ "$sha" = "$want_sha" ] \
    || die "the newest site pointer for $v names sha256 $sha, not the --sha256 given ($want_sha): its history may have been re-cut; nothing was changed"
  tmp="$(mktemp "${TMPDIR:-/tmp}/pointer-freeze.XXXXXX")" || die "could not make a temp file; nothing was changed"
  if ! "$CURL_CMD" --connect-timeout 15 --max-time 900 -fsSL -o "$tmp" "$HOST/dist/$art"; then rm -f "$tmp"; die "$HOST does not serve $art, so a pin to $v could not deploy; nothing was changed"; fi
  got="$(sha_of "$tmp")"; rm -f "$tmp"
  [ "$got" = "$sha" ] || die "$HOST serves $art with sha256 $got, not the pointer's $sha; nothing was changed"
  # The installer that stood with this pointer must be there and, when the pointer names it (#5032), be those bytes:
  # deploy-site.sh refuses otherwise, and a pin it then refuses would leave the site frozen and undeployable.
  { git -C "$SITE" cat-file -e "${found}:setup" 2>/dev/null && git -C "$SITE" cat-file -e "${found}:setup.sha256" 2>/dev/null; } \
    || die "site commit ${found:0:12} does not have both setup and setup.sha256 committed with that pointer (the bad release's installer would stay, or be served without its checksum); nothing was changed"
  # The signed manifest the boards verify the pinned build against (engine/manifest-verify.js): served, with its .sig,
  # and not empty. deploy-site.sh does not look at manifests, so without this a pin could deploy that no board accepts.
  local man mf; man="$(field "$json" manifest)"
  [ -n "$man" ] || die "the pointer for $v names no manifest; nothing was changed"
  for mf in "$man" "$man.sig"; do
    # In the tree that deploys (origin/main: a deploy ships the committed tree whole), and served now.
    git -C "$SITE" cat-file -e "origin/main:dist/$mf" 2>/dev/null \
      || die "origin/main does not carry dist/$mf, so a pin deploy would remove it and boards could not verify $v; nothing was changed"
    tmp="$(mktemp "${TMPDIR:-/tmp}/pointer-freeze.XXXXXX")" || die "could not make a temp file; nothing was changed"
    if ! "$CURL_CMD" --connect-timeout 15 --max-time 60 -fsSL -o "$tmp" "$HOST/dist/$mf" || [ ! -s "$tmp" ]; then rm -f "$tmp"; die "$HOST does not serve $mf (or serves it empty), so boards could not verify a pin to $v; nothing was changed"; fi
    rm -f "$tmp"
  done
  # The installer's bytes must be what something names: the pointer's setup_sha256 (#5032) when it has one, and always
  # the pair's own setup.sha256, so a setup from another release cannot ride along unchecked.
  local want_setup got_setup pair_sha; want_setup="$(field "$json" setup_sha256)"
  got_setup="$(git -C "$SITE" show "${found}:setup" | shasum -a 256 | awk '{print $1}')"
  pair_sha="$(git -C "$SITE" show "${found}:setup.sha256" | awk '{print $1; exit}')"
  [ -z "$want_setup" ] || [ "$got_setup" = "$want_setup" ] \
    || die "the setup committed with $v (commit ${found:0:12}) is not the installer its pointer names (setup_sha256); nothing was changed"
  [ "$got_setup" = "$pair_sha" ] \
    || die "the setup committed with $v (commit ${found:0:12}) does not match its own setup.sha256; nothing was changed"

  # The pin, as blob entries from the found commit itself (the pointer to prod and staging; the installer pair to both
  # names), and the marker: built in the temporary index, so nothing in this checkout changes until the fast-forward.
  local e entries="" marker_blob pushed live_v
  for e in "dist/latest.json dist/latest.json" "dist/latest.json dist/latest-staging.json" "setup setup" "setup setup-staging" \
           "setup.sha256 setup.sha256" "setup.sha256 setup-staging.sha256"; do
    # shellcheck disable=SC2086 # two words: the path in the found commit, and the path it is written to
    entries="$entries $(entry_of "$found" $e)" || die "could not read ${e%% *} from site commit ${found:0:12}; nothing was changed"
  done
  marker_blob="$(printf 'mac=%s\nsha256=%s\nbecause=%s\nat=%s\n' "$v" "$sha" "$because" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | git -C "$SITE" hash-object -w --stdin)" \
    && [ -n "$marker_blob" ] || die "could not write the marker; nothing was changed"
  # shellcheck disable=SC2086 # each entry is one word (mode,blob,path)
  pushed="$(publish_on_origin "pointer-freeze: Mac pointers pinned and frozen at $v (kosmos#6620): $because" on $entries "100644,$marker_blob,$POINTER_FREEZE_FILE")" \
    || die "the push did not confirm (see above), so whether origin/main is frozen is not known: run status; this checkout is unchanged, and on can safely run again"
  follow_local "$pushed"
  say "frozen at $v (from site commit ${found:0:12}): both Mac pointers, the installer pair and $POINTER_FREEZE_FILE pushed to origin/main (${pushed:0:12})."
  # Which deploy works is decided by BYTES, as deploy-site.sh decides it: --promote refuses a committed prod pointer
  # equal to live ("nothing to promote"), and --publish refuses one that differs. So: live byte-identical to the pin
  # (only staging was bad) is --publish; anything else (an older or newer build, or a re-cut under this version) is
  # --promote. A live pointer that cannot be read is said, not guessed.
  local live_json
  [ "$FOLLOWED" = 1 ] || say "This checkout is not yet at the pushed commit (see above): bring it there first, or the deploy below runs on the old tree and is refused."
  if ! live_json="$("$CURL_CMD" --connect-timeout 15 --max-time 30 -fsSL -H 'Cache-Control: no-cache' "$HOST/dist/latest.json" 2>/dev/null)" || [ -z "$live_json" ]; then
    say "NOT deployed yet. The live pointer could not be read: use --promote, unless prod already serves exactly this pointer (then --publish):"
    say "  KOSMOS_SITE=$SITE KOSMOS_STAGING_ROLLBACK=$v tools/deploy-site.sh --promote"
  elif [ "$live_json" = "$json" ]; then
    say "NOT deployed yet. Prod already serves exactly this pointer, so deploy the pinned staging pointer with:"
    say "  KOSMOS_SITE=$SITE KOSMOS_STAGING_ROLLBACK=$v tools/deploy-site.sh --publish"
  else
    say "NOT deployed yet. Deploy it:"
    say "  KOSMOS_SITE=$SITE KOSMOS_STAGING_ROLLBACK=$v tools/deploy-site.sh --promote"
  fi
  say "Not pinned by this, each by hand: the Windows pointers (prod is on R2: tools/windows/publish-r2.ps1 -Promote moves"
  say "prod only onto the STAGED build, with Josh's approval and a passing staging check, so an older good build must be"
  say "re-staged first) and the site's Kosmos.pkg (a deploy carries the live one). The site's latest-win*.json are HELD"
  say "as they stood at this freeze: a change committed after it is refused by every deploy, so to point them at another"
  say "build, commit that before on (after off, before on again)."
}

cmd_off() {
  pointer_freeze_fetch "$SITE" || die "could not fetch origin/main; nothing was changed"
  git -C "$SITE" cat-file -e "origin/main:$POINTER_FREEZE_FILE" 2>/dev/null || { say "origin/main is not frozen; nothing changed"; return 0; }
  local was sha; was="$(git -C "$SITE" show "origin/main:$POINTER_FREEZE_FILE" 2>/dev/null | sed -n 's/^mac=//p' | head -1)"
  sha="$(publish_on_origin "pointer-freeze: freeze at ${was:-?} lifted (kosmos#6620)" off)" || die "the lift did not confirm (see above): run status to see whether it is lifted; off can safely run again"
  follow_local "$sha"
  say "freeze at ${was:-?} lifted and pushed (${sha:0:12}); the pointers stay where they are until the next release moves them."
  say "Another checkout that still has the marker at its HEAD keeps refusing until it pulls (git -C <site> pull --ff-only)."
}

case "${1:-}" in
  on) shift; cmd_on "$@" ;;
  off) cmd_off ;;
  status) cmd_status ;;
  *) say "usage: $0 on --mac <version> --because \"<why>\" [--sha256 <known-good sha256>] | off | status"; exit 64 ;;
esac
