#!/usr/bin/env bash
# post-release-notes.sh - kosmos#2159. On a PROD release, generate the release-notes social
# posts (X @installkosmos + LinkedIn company page) and, ONLY under a deliberate multi-gate
# enable, publish them. Called from the prod-release success paths: release.sh (a prod cut)
# and promote-channel.sh (a staging->prod pointer flip).
#
#   bash tools/post-release-notes.sh <version> [--publish]
#
# 🛑 PUBLIC-POST SAFETY - a bad or wrong note must NEVER auto-publish. Publishing to a live
# brand account requires ALL of:
#   1. a PROD release (this is prod-only; a staging cut never posts),
#   2. --publish passed by the caller,
#   3. KOSMOS_SOCIAL_AUTOPOST=1 explicitly set (a deliberate opt-in, off by default),
#   4. real creds for BOTH platforms present (resolved via the secrets map; absent -> no publish),
#   5. a one-time APPROVAL marker the operator creates AFTER reviewing a preview (the "first-run
#      confirm"): ~/.config/secrets/kosmos-social-autopost.approved . So the FIRST live post is
#      never automatic - somebody reads a real preview and opts in once.
# Missing ANY gate => DRY-RUN: write a preview, print why, exit 0. A prod cut/promote must NOT
# fail because social posting is in dry-run - a preview is a success, not an error.
#
# The HTTP POST is behind the KOSMOS_SOCIAL_POST_CMD seam (like the gate's KOSMOS_AOC_CURL) so
# the publish path is testable against a stub with no network and no real creds.
set -uo pipefail

V="${1:-}"
PUBLISH=0; [ "${2:-}" = "--publish" ] && PUBLISH=1
say() { printf '%s\n' "$*"; }
[ -n "$V" ] || { say "usage: post-release-notes.sh <version> [--publish]"; exit 2; }
case "$V" in ''|*[!0-9.]*) say "post-release-notes: '$V' is not a version - refusing"; exit 2 ;; esac

SITE="${KOSMOS_SITE:-$HOME/work/chaoskosmos-site}"
PAGE="${KOSMOS_VERSIONS_PAGE:-$SITE/versions.html}"
HOST="${KOSMOS_RELEASE_HOST:-https://installkosmos.com}"
LINKEDIN_URL="https://www.linkedin.com/company/kosmos-agent-manager/"
X_HANDLE="@installkosmos"
NODE="$(command -v node 2>/dev/null || true)"
PREVIEW_DIR="${KOSMOS_SOCIAL_PREVIEW_DIR:-${TMPDIR:-/tmp}}"
APPROVAL_MARKER="${KOSMOS_SOCIAL_APPROVAL_MARKER:-$HOME/.config/secrets/kosmos-social-autopost.approved}"

[ -n "$NODE" ] || { say "post-release-notes: no node to parse the versions page - preview only"; }

# --- pull the release note prose for $V out of the versions page ---
# The entry is <article ... id="v0-6-29"> ... <p>Version 0.6.29 ...</p> </article>. Extract the
# first <p> text, strip tags/whitespace. node does it; a missing page/entry yields empty (dry-run).
ANCHOR="v$(printf '%s' "$V" | tr . -)"
NOTE=""
if [ -n "$NODE" ] && [ -f "$PAGE" ]; then
  NOTE="$("$NODE" -e '
    const fs=require("fs");
    const html=fs.readFileSync(process.argv[1],"utf8");
    const id=process.argv[2];
    const a=html.indexOf("id=\""+id+"\"");
    if(a<0){process.exit(0)}
    const end=html.indexOf("</article>",a);
    const seg=html.slice(a, end<0?html.length:end);
    const m=seg.match(/<p>([\s\S]*?)<\/p>/i);
    if(!m){process.exit(0)}
    let t=m[1].replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
    process.stdout.write(t);
  ' "$PAGE" "$ANCHOR" 2>/dev/null || true)"
fi
if [ -z "$NOTE" ]; then
  NOTE="Kosmos $V is out. See the release notes."
  say "post-release-notes: no versions-page entry for $V (looked for $ANCHOR in $PAGE) - using a generic note."
fi

# --- compose the posts ---
# X: <= 280 chars, ends with the link. Trim the note to fit around the fixed suffix.
X_SUFFIX=" $HOST/versions.html"
X_PREFIX="Kosmos $V is out. "
_budget=$((280 - ${#X_PREFIX} - ${#X_SUFFIX}))
X_BODY="$NOTE"
if [ "${#X_BODY}" -gt "$_budget" ]; then
  X_BODY="$(printf '%s' "$X_BODY" | cut -c1-$((_budget-1)))…"
fi
X_POST="${X_PREFIX}${X_BODY}${X_SUFFIX}"
# LinkedIn: the full note + a link, no length pressure.
LI_POST="Kosmos $V is out.

$NOTE

Get it: $HOST"

# --- creds (resolved via the secrets map; absent -> no publish) ---
have_creds() {
  # Both platforms need a token. The secrets map targets (filed with /add-secret when Josh
  # provides them): x-installkosmos + linkedin-installkosmos. Absent -> return non-zero.
  # KOSMOS_SECRETS_MAP overrides the mapper path (used by the test to stub creds).
  local mapper="${KOSMOS_SECRETS_MAP:-$HOME/.claude/scripts/secrets-map.sh}"
  [ -x "$mapper" ] || mapper="$(command -v secrets-map.sh 2>/dev/null || true)"
  [ -n "$mapper" ] || return 1
  "$mapper" value x-installkosmos >/dev/null 2>&1 || return 1
  "$mapper" value linkedin-installkosmos >/dev/null 2>&1 || return 1
  return 0
}

# --- the publish seam (stubbable). Args: <platform> <text>. Real impl posts via curl. ---
POST_CMD="${KOSMOS_SOCIAL_POST_CMD:-}"
publish_one() {
  local platform="$1" text="$2"
  if [ -n "$POST_CMD" ]; then
    printf '%s' "$text" | $POST_CMD "$platform"
    return $?
  fi
  # No seam: the real posters would go here (X v2 tweets, LinkedIn ugcPosts), reading creds via
  # the secrets map and sending the token OFF argv. Deliberately not implemented until creds land
  # and the API shapes are pinned; until then a publish with no seam is a hard refusal, never a
  # silent no-op that reads as success.
  say "post-release-notes: no live poster wired for '$platform' yet (KOSMOS_SOCIAL_POST_CMD unset) - refusing to claim a post happened"
  return 3
}

# --- the safety gate: decide dry-run vs publish ---
is_prod="${KOSMOS_RELEASE_IS_PROD:-1}"   # callers on the prod path pass 1; a staging caller passes 0
write_preview() {
  local f="$PREVIEW_DIR/kosmos-release-notes-$V.preview.txt"
  { printf '=== X (%s) ===\n%s\n\n=== LinkedIn (%s) ===\n%s\n' "$X_HANDLE" "$X_POST" "$LINKEDIN_URL" "$LI_POST"; } > "$f" 2>/dev/null
  say "   preview written: $f"
}

say "post-release-notes: composing release-notes posts for $V"
say "   --- X ($X_HANDLE), ${#X_POST} chars ---"
say "   $X_POST"
say "   --- LinkedIn ($LINKEDIN_URL) ---"
printf '%s\n' "$LI_POST" | sed 's/^/   /'

# Gate 1: prod only.
if [ "$is_prod" != "1" ]; then
  say "DRY-RUN: not a prod release (KOSMOS_RELEASE_IS_PROD=$is_prod) - social posts are prod-only. Preview only."
  write_preview; exit 0
fi
# Gate 2/3: --publish + explicit autopost opt-in.
if [ "$PUBLISH" != "1" ] || [ "${KOSMOS_SOCIAL_AUTOPOST:-}" != "1" ]; then
  say "DRY-RUN: live auto-posting is OFF (need --publish AND KOSMOS_SOCIAL_AUTOPOST=1). Preview only - a bad note cannot auto-publish."
  write_preview; exit 0
fi
# Gate 4: creds present.
if ! have_creds; then
  say "DRY-RUN: no live creds for X + LinkedIn (file them with /add-secret as x-installkosmos + linkedin-installkosmos). Preview only."
  write_preview; exit 0
fi
# Gate 5: the one-time approval marker (the first-run confirm).
if [ ! -f "$APPROVAL_MARKER" ]; then
  say "HOLD: live auto-posting is armed but NOT yet approved. Review a preview, then create the approval marker to opt in ONCE:"
  say "   touch \"$APPROVAL_MARKER\""
  write_preview; exit 0
fi

# Gate 6: idempotency - PER PLATFORM, so a version is never announced twice on the same platform.
# The record keys are "$V:<platform>", written ONLY on a per-platform success. This is why it is
# per-platform and not per-version: if a first run posts X and then LinkedIn fails, a retry must
# re-post ONLY LinkedIn, never double-post X. A prod cut, a promote+deploy, and a re-deploy can
# each reach a live-post path; this makes each platform's post fire exactly once per version.
ANNOUNCED_RECORD="${KOSMOS_SOCIAL_ANNOUNCED_RECORD:-$HOME/.config/secrets/kosmos-announced-versions.log}"
already() { [ -f "$ANNOUNCED_RECORD" ] && grep -qxF "$V:$1" "$ANNOUNCED_RECORD" 2>/dev/null; }
mark()    { mkdir -p "$(dirname "$ANNOUNCED_RECORD")" 2>/dev/null; printf '%s:%s\n' "$V" "$1" >> "$ANNOUNCED_RECORD" 2>/dev/null; }
if already x && already linkedin; then
  say "post-release-notes: $V was already announced on X and LinkedIn (idempotent skip). Nothing published."
  exit 0
fi

# All gates passed: publish for real, per platform, skipping any already announced.
say "post-release-notes: all safety gates passed - publishing $V release notes."
rc=0
for _p in x linkedin; do
  if already "$_p"; then say "  [$_p] already announced $V - skipping"; continue; fi
  case "$_p" in x) _txt="$X_POST" ;; linkedin) _txt="$LI_POST" ;; esac
  if publish_one "$_p" "$_txt"; then say "  [$_p] published $V."; mark "$_p"
  else rc=1; say "  [$_p] publish FAILED - NOT recorded, so a retry re-attempts ONLY $_p (no double-post)."; fi
done
exit "$rc"
