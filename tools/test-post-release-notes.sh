#!/usr/bin/env bash
# test-post-release-notes.sh - kosmos#2159. Hermetic, red-capable coverage of the release-notes
# social poster's SAFETY GATES and note generation. No network, no real creds: creds are a stubbed
# secrets-map, and the publish path is a recording stub via KOSMOS_SOCIAL_POST_CMD.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/post-release-notes.sh"
fail=0
pass() { printf 'PASS  %s\n' "$*"; }
bad()  { printf 'FAIL  %s\n' "$*"; fail=1; }
has()  { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

T="$(mktemp -d "${TMPDIR:-/tmp}/relnotes-test.XXXXXX")"
trap 'rm -rf "$T"' EXIT

# --- a versions-page fixture with a known 0.9.9 entry ---
PAGE="$T/versions.html"
cat > "$PAGE" <<'HTML'
<html><body>
    <article class="rel" id="v0-9-9">
      <div class="rel-h"><h2 class="rel-v"><a href="#v0-9-9"><span class="num">0.9.9</span></a></h2>
        <span class="rel-d">September 4, 2026, 1:00 PM CDT</span></div>
      <p>Version 0.9.9 does a specific memorable thing worth announcing to the world.</p>
    </article>
    <article class="rel" id="v0-9-8">
      <div class="rel-h"><h2 class="rel-v"><a href="#v0-9-8"><span class="num">0.9.8</span></a></h2>
        <span class="rel-d">September 3, 2026, 1:00 PM CDT</span></div>
      <p>Version 0.9.8 is a very long release note designed to exceed the X character budget so the truncation path runs. It goes on and on about many improvements and fixes and refinements across the whole product, far more than any single tweet could hold, which is exactly the point of this fixture, so keep reading because there is even more filler here to be certain the composed X post must be trimmed with an ellipsis before the link.</p>
    </article>
</body></html>
HTML

# --- a secrets-map stub: creds present (exit 0) or absent (exit 1) ---
MAP_OK="$T/map-ok.sh";  printf '#!/usr/bin/env bash\nexit 0\n' > "$MAP_OK";  chmod +x "$MAP_OK"
MAP_NO="$T/map-no.sh";  printf '#!/usr/bin/env bash\nexit 1\n' > "$MAP_NO";  chmod +x "$MAP_NO"

# --- a recording publish seam: appends "<platform>:<bytes>" per call ---
REC="$T/published.log"
POSTER="$T/poster.sh"
cat > "$POSTER" <<SH
#!/usr/bin/env bash
b="\$(cat)"
printf '%s:%s\n' "\$1" "\${#b}" >> "$REC"
SH
chmod +x "$POSTER"

PREVIEW="$T/preview"; mkdir -p "$PREVIEW"
MARKER="$T/approved"

# run <label> <expect-exit> [--publish] with a scenario env prefix carried in $ENVS
run() {
  local label="$1" exp="$2"; shift 2
  local pubarg="" ; if [ "${1:-}" = "--publish" ]; then pubarg="--publish"; shift; fi
  : > "$REC"
  local out rc
  out="$(env "$@" KOSMOS_VERSIONS_PAGE="$PAGE" KOSMOS_SOCIAL_PREVIEW_DIR="$PREVIEW" \
    KOSMOS_SOCIAL_APPROVAL_MARKER="$MARKER" KOSMOS_SOCIAL_POST_CMD="bash $POSTER" \
    KOSMOS_SOCIAL_ANNOUNCED_RECORD="$T/announced.log" \
    bash "$SCRIPT" 0.9.9 $pubarg 2>&1)"
  rc=$?
  LAST_OUT="$out"
  if [ "$rc" = "$exp" ]; then pass "$label (exit $rc)"; else bad "$label: expected exit $exp got $rc | $(printf '%s' "$out" | tr '\n' '~' | tail -c 200)"; fi
}
published() { [ -s "$REC" ]; }   # true if the seam was called at least once

# 1. dry-run default (prod, no --publish) -> exit 0, NO publish, preview written, note extracted
run "dry-run default" 0
published && bad "dry-run default: published when it must not" || pass "dry-run default: nothing published"
has "$LAST_OUT" "DRY-RUN" && pass "dry-run default: says DRY-RUN" || bad "dry-run default: no DRY-RUN notice"
has "$LAST_OUT" "does a specific memorable thing" && pass "note generation: pulled the entry text from the versions page" || bad "note generation: entry text missing"
[ -f "$PREVIEW/kosmos-release-notes-0.9.9.preview.txt" ] && pass "dry-run: preview file written" || bad "dry-run: no preview file"

# 2. staging (not prod) -> dry-run, no publish
run "staging release -> prod-only dry-run" 0 --publish KOSMOS_RELEASE_IS_PROD=0 KOSMOS_SOCIAL_AUTOPOST=1 KOSMOS_SECRETS_MAP="$MAP_OK"
published && bad "staging: published on a non-prod release" || pass "staging: prod-only, nothing published"
has "$LAST_OUT" "prod-only" && pass "staging: names the prod-only reason" || bad "staging: no prod-only reason"

# 3. --publish but AUTOPOST off -> dry-run
run "publish without autopost opt-in" 0 --publish KOSMOS_SECRETS_MAP="$MAP_OK"
published && bad "no-autopost: published without KOSMOS_SOCIAL_AUTOPOST=1" || pass "no-autopost: nothing published"
has "$LAST_OUT" "auto-posting is OFF" && pass "no-autopost: names the reason (red-capable for the autopost gate)" || bad "no-autopost: no reason string"

# 4. --publish + autopost but NO creds -> dry-run
run "publish + autopost, no creds" 0 --publish KOSMOS_SOCIAL_AUTOPOST=1 KOSMOS_SECRETS_MAP="$MAP_NO"
published && bad "no-creds: published without creds" || pass "no-creds: nothing published"
has "$LAST_OUT" "no live creds" && pass "no-creds: names the missing creds" || bad "no-creds: no creds notice"

# 5. --publish + autopost + creds but NO approval marker -> HOLD (dry-run)
rm -f "$MARKER"
run "armed but not approved -> HOLD" 0 --publish KOSMOS_SOCIAL_AUTOPOST=1 KOSMOS_SECRETS_MAP="$MAP_OK"
published && bad "unapproved: published before the first-run approval" || pass "unapproved: HOLD, nothing published"
has "$LAST_OUT" "yet approved" && pass "unapproved: names the approval gate" || bad "unapproved: no approval notice"

# 6. ALL gates pass -> publishes to BOTH platforms via the seam
touch "$MARKER"
run "all gates pass -> PUBLISH" 0 --publish KOSMOS_SOCIAL_AUTOPOST=1 KOSMOS_SECRETS_MAP="$MAP_OK"
if published && grep -q '^x:' "$REC" && grep -q '^linkedin:' "$REC"; then pass "publish: posted to BOTH x and linkedin via the seam"; else bad "publish: did not post to both ($(tr '\n' ',' < "$REC"))"; fi

# 6b. idempotency: a SECOND all-gates-pass run for the same version skips (already announced)
run "already-announced -> idempotent skip" 0 --publish KOSMOS_SOCIAL_AUTOPOST=1 KOSMOS_SECRETS_MAP="$MAP_OK"
published && bad "idempotent: re-posted an already-announced version" || pass "idempotent: skipped, nothing re-published"
has "$LAST_OUT" "already announced" && pass "idempotent: names the skip" || bad "idempotent: no skip notice"

# 6c. PER-PLATFORM retry: with only x already announced, a run posts ONLY linkedin (never re-posts x)
PREC="$T/partial.log"; printf '0.9.9:x\n' > "$PREC"; : > "$REC"
env KOSMOS_VERSIONS_PAGE="$PAGE" KOSMOS_SOCIAL_PREVIEW_DIR="$PREVIEW" KOSMOS_SOCIAL_APPROVAL_MARKER="$MARKER" \
  KOSMOS_SOCIAL_POST_CMD="bash $POSTER" KOSMOS_SOCIAL_ANNOUNCED_RECORD="$PREC" \
  KOSMOS_SOCIAL_AUTOPOST=1 KOSMOS_SECRETS_MAP="$MAP_OK" bash "$SCRIPT" 0.9.9 --publish >/dev/null 2>&1
{ grep -q '^linkedin:' "$REC" && ! grep -q '^x:' "$REC"; } && pass "per-platform retry: re-posts ONLY the un-announced platform (linkedin), never double-posts x" || bad "per-platform retry: wrong ($(tr '\n' ',' < "$REC"))"

# 7. the X post is <= 280 chars
XLEN="$(env KOSMOS_VERSIONS_PAGE="$PAGE" KOSMOS_SOCIAL_PREVIEW_DIR="$PREVIEW" bash "$SCRIPT" 0.9.9 2>&1 | awk -F', ' '/--- X \(/{gsub(/[^0-9]/,"",$2); print $2}')"
[ -n "$XLEN" ] && [ "$XLEN" -le 280 ] && pass "X post is <= 280 chars ($XLEN)" || bad "X post length wrong ($XLEN)"

# 7b. truncation: a LONG note (0.9.8 fixture) forces the trim path - result <=280, ends with an
# ellipsis before the link. Exercises post-release-notes.sh's cut+ellipsis branch, which the short
# 0.9.9 note never reaches.
XOUT="$(env KOSMOS_VERSIONS_PAGE="$PAGE" KOSMOS_SOCIAL_PREVIEW_DIR="$PREVIEW" bash "$SCRIPT" 0.9.8 2>&1 | awk '/^   Kosmos 0\.9\.8 is out\./{print; exit}')"
XOUT="${XOUT#   }"
# Count CHARACTERS, not bytes: X's 280 is characters, and the appended U+2026 ellipsis is 3 bytes,
# so ${#XOUT} (bytes under a C locale) would spuriously read 282. node counts code points, so the
# arm is locale-independent (a C-locale launchd/cron test:shell would otherwise false-fail here).
XN="$(node -e 'process.stdout.write(String([...process.argv[1]].length))' "$XOUT" 2>/dev/null)"
{ [ -n "$XN" ] && [ "$XN" -le 280 ] && has "$XOUT" "…" && has "$XOUT" "installkosmos.com/versions.html"; } \
  && pass "truncation: long note trimmed with an ellipsis, <=280 chars, link kept ($XN)" \
  || bad "truncation: wrong (len=$XN)"

# 8. a version with NO page entry -> generic note, still dry-run exit 0
run_missing() {
  local out rc
  out="$(env KOSMOS_VERSIONS_PAGE="$PAGE" KOSMOS_SOCIAL_PREVIEW_DIR="$PREVIEW" bash "$SCRIPT" 0.0.1 2>&1)"; rc=$?
  { [ "$rc" = 0 ] && has "$out" "no versions-page entry"; } && pass "missing entry -> generic note, dry-run exit 0" || bad "missing entry (rc=$rc)"
}
run_missing

# 8b. a FALLBACK note (no page entry) must NOT auto-publish even with ALL other gates armed
#     (--publish + autopost + creds + marker). Proves Gate 5b: a degraded generic note is exactly
#     the "bad note" the guarantee forbids from auto-publishing. Red-capable: without Gate 5b this
#     would publish to both platforms and REC would be non-empty.
: > "$REC"
env KOSMOS_VERSIONS_PAGE="$PAGE" KOSMOS_SOCIAL_PREVIEW_DIR="$PREVIEW" KOSMOS_SOCIAL_APPROVAL_MARKER="$MARKER" \
  KOSMOS_SOCIAL_POST_CMD="bash $POSTER" KOSMOS_SOCIAL_ANNOUNCED_RECORD="$T/fb.log" \
  KOSMOS_SOCIAL_AUTOPOST=1 KOSMOS_SECRETS_MAP="$MAP_OK" bash "$SCRIPT" 0.0.1 --publish > "$T/fbout" 2>&1
rcfb=$?
{ [ "$rcfb" = 0 ] && [ ! -s "$REC" ] && has "$(cat "$T/fbout")" "generic FALLBACK"; } \
  && pass "fallback note: HOLDS (no auto-publish) even with all gates armed" \
  || bad "fallback note: published or wrong (rc=$rcfb, published=$([ -s "$REC" ] && echo yes || echo no))"

# 9. a non-numeric version is refused
env bash "$SCRIPT" "not-a-version" >/dev/null 2>&1; [ $? = 2 ] && pass "non-numeric version -> refuse (exit 2)" || bad "non-numeric version not refused"

if [ "$fail" = 0 ]; then echo "test-post-release-notes: all arms passed"; exit 0; fi
echo "test-post-release-notes: FAILURES above"; exit 1
