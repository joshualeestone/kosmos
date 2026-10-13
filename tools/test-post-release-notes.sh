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
    <article class="rel" id="v0-9-6">
      <div class="rel-h"><h2 class="rel-v"><a href="#v0-9-6"><span class="num">0.9.6</span></a></h2>
        <span class="rel-d">September 1, 2026, 1:00 PM CDT</span></div>
      <p>Onewordsentencethatistoolongtofitanywhereatallbecauseithasnospaces and then a great many ordinary words that keep this single sentence going far past the budget for any post on X without ever reaching a full stop or any other sentence end at all, which is the case where nothing whole fits so the post must be cut at a word instead</p>
    </article>
    <article class="rel" id="v0-9-4">
      <div class="rel-h"><h2 class="rel-v"><a href="#v0-9-4"><span class="num">0.9.4</span></a></h2>
        <span class="rel-d">August 30, 2026, 1:00 PM CDT</span></div>
      <p>Version 0.7.46 on installkosmos.com fixes the sign in, so a person who left it half done can finish it later from Settings without starting again from the beginning of the setup. It also adds a second long sentence here that cannot fit beside the first one in a post.</p>
    </article>
    <article class="rel" id="v0-9-3">
      <div class="rel-h"><h2 class="rel-v"><a href="#v0-9-3"><span class="num">0.9.3</span></a></h2>
        <span class="rel-d">August 29, 2026, 1:00 PM CDT</span></div>
      <p>It’s the agent’s window, the board’s list, the person’s room, the team’s plan, the day’s work, the week’s notes, the month’s view, the year’s end, it’s all here, it’s fine, it’s done, it’s whole and it’s short enough.</p>
    </article>
    <article class="rel" id="v0-9-2">
      <div class="rel-h"><h2 class="rel-v"><a href="#v0-9-2"><span class="num">0.9.2</span></a></h2>
        <span class="rel-d">August 28, 2026, 1:00 PM CDT</span></div>
      <p>Use the menu, e.g. Settings, Advanced, to change the long thing that this release note describes at great length, on and on through many clauses and many more words, so that this one sentence alone is longer than the whole budget for a post on X and must be cut at a word. Then a second sentence follows.</p>
    </article>
    <article class="rel" id="v0-9-1">
      <div class="rel-h"><h2 class="rel-v"><a href="#v0-9-1"><span class="num">0.9.1</span></a></h2>
        <span class="rel-d">August 27, 2026, 1:00 PM CDT</span></div>
      <p>--version Leading-dash-note-that-is-one-unbroken-token-far-longer-than-any-budget-for-a-post-on-x-so-it-must-be-cut-inside-the-token-with-an-ellipsis-because-there-is-no-space-anywhere-in-it-at-all-not-one-and-it-keeps-going-and-going-past-the-end-of-the-budget-for-sure-now</p>
    </article>
    <article class="rel" id="v0-9-5">
      <div class="rel-h"><h2 class="rel-v"><a href="#v0-9-5"><span class="num">0.9.5</span></a></h2>
        <span class="rel-d">August 31, 2026, 1:00 PM CDT</span></div>
      <p>Settings, Advanced has Save diagnostics: it saves one file on this computer for you to give the people who build Kosmos, with keys, email addresses and user folders taken out. If you left a Sign in again unfinished on a Grok account you added, you can now remove it instead of waiting for it to time out.</p>
    </article>
    <article class="rel" id="v0-9-7">
      <div class="rel-h"><h2 class="rel-v"><a href="#v0-9-7"><span class="num">0.9.7</span></a></h2>
        <span class="rel-d">September 2, 2026, 1:00 PM CDT</span></div>
      <p>Answer it in the agent&#39;s window &amp; the board&#8217;s &quot;Allow&quot; stays yours.</p>
      <p>Named &rsquo;s and &lsquo;x&rsquo; and &apos;y&#x27; and &#x2019;z and &ldquo;q&rdquo; and &#x201C;r&#x201D;.</p>
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

# 7b. truncation: a LONG note (0.9.8 fixture) forces the trim path - result <=280, link kept. #6082: it keeps
# whole sentences, so it ends on a full stop, not an ellipsis mid-word.
xpost() { local o; o="$(env KOSMOS_VERSIONS_PAGE="$PAGE" KOSMOS_SOCIAL_PREVIEW_DIR="$PREVIEW" bash "$SCRIPT" "$1" 2>&1 | awk -v v="$1" 'index($0, "   Kosmos " v " is out.") == 1 {print; exit}')"; printf '%s' "${o#   }"; }
XOUT="$(xpost 0.9.8)"
# Count CHARACTERS, not bytes: X's 280 is characters, and the appended U+2026 ellipsis is 3 bytes,
# so ${#XOUT} (bytes under a C locale) would spuriously read 282. node counts code points, so the
# arm is locale-independent (a C-locale launchd/cron test:shell would otherwise false-fail here).
XN="$(node -e 'process.stdout.write(String([...process.argv[1]].length))' "$XOUT" 2>/dev/null)"
{ [ -n "$XN" ] && [ "$XN" -le 280 ] && ! has "$XOUT" "…" && has "$XOUT" "truncation path runs. https://installkosmos.com/versions.html"; } \
  && pass "truncation: long note trimmed to whole sentences, <=280 chars, link kept ($XN)" \
  || bad "truncation: wrong (len=$XN): $XOUT"
# 7c. #6082: the 0.7.46 note (two sentences, over the budget) keeps its first whole sentence and drops the second whole.
X5="$(xpost 0.9.5)"
{ has "$X5" "user folders taken out. https://installkosmos.com/versions.html" && ! has "$X5" "Grok" && ! has "$X5" "…"; } \
  && pass "#6082: an over-budget note keeps whole sentences only, no ellipsis" || bad "#6082: cut mid-sentence: $X5"
# 7d. #6082: no whole sentence fits -> cut at a word, with an ellipsis, <=280.
X6="$(xpost 0.9.6)"
X6N="$(node -e 'process.stdout.write(String([...process.argv[1]].length))' "$X6" 2>/dev/null)"
W6="$(printf '%s' "$X6" | sed 's/… https.*//' | awk '{print $NF}')"
NOTE6="$(sed -n '/id="v0-9-6"/,/<\/article>/p' "$PAGE" | sed -n 's/.*<p>\(.*\)<\/p>.*/\1/p')"
{ has "$X6" "… https://installkosmos.com/versions.html" && [ -n "$X6N" ] && [ "$X6N" -le 280 ] && [ -n "$W6" ] && has " $NOTE6 " " $W6 "; } \
  && pass "#6082: no whole sentence fits -> cut at a whole word with an ellipsis ($X6N)" || bad "#6082: word cut wrong (last word '$W6', len=$X6N): $X6"

# 7e. #6082 review 1: a dotted token (a version, a domain) before the first full stop loses nothing.
X4="$(xpost 0.9.4)"
{ has "$X4" "Kosmos 0.9.4 is out. Version 0.7.46 on installkosmos.com fixes the sign in," && has "$X4" "setup. https://installkosmos.com/versions.html"; } \
  && pass "#6082: a version number before the first sentence end keeps the sentence whole" || bad "#6082: dotted token dropped text: $X4"
# 7f. #6082 review 1: a note that fits in characters but not in bytes (curly apostrophes) under a C locale is unchanged.
X3="$(env LC_ALL=C KOSMOS_VERSIONS_PAGE="$PAGE" KOSMOS_SOCIAL_PREVIEW_DIR="$PREVIEW" bash "$SCRIPT" 0.9.3 2>&1 | awk 'index($0, "   Kosmos 0.9.3 is out.") == 1 {print; exit}')"
{ has "$X3" "short enough. https://installkosmos.com/versions.html" && has "$X3" "It’s the agent’s window"; } \
  && pass "#6082: a fitting note with multi-byte characters is not trimmed under a C locale" || bad "#6082: multi-byte note trimmed: $X3"

# 7g. #6082 review 2: "e.g." does not end a sentence, so the post never stops on it.
X2="$(xpost 0.9.2)"
{ has "$X2" "Use the menu, e.g. Settings, Advanced, to change the long thing" && has "$X2" "… https://installkosmos.com/versions.html" && ! has "$X2" "e.g. https" && ! has "$X2" "Then a second"; } \
  && pass "#6082: an abbreviation does not end a sentence" || bad "#6082: stopped at an abbreviation: $X2"
# 7h. #6082 review 2: a note starting with a dash (here --version, which node would answer with its own version) reaches
# the trimmer as text; the unbroken token after it is cut back to the last space, with an ellipsis, <=280.
X1="$(xpost 0.9.1)"
X1N="$(node -e 'process.stdout.write(String([...process.argv[1]].length))' "$X1" 2>/dev/null)"
{ has "$X1" "Kosmos 0.9.1 is out. --version… https://installkosmos.com/versions.html" && [ -n "$X1N" ] && [ "$X1N" -le 280 ]; } \
  && pass "#6082: a leading-dash single token is cut with an ellipsis ($X1N)" || bad "#6082: leading dash or token cut wrong (len=$X1N): $X1"

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

# 8c. apostrophes decode (the 0.7.37 preview garble). The decoder runs inside a single-quoted
#     `node -e '...'`, so a literal ' in its source ends the shell quote and node gets a broken
#     replacement: "agent&#39;s" became "agent).replace(/&#821[67];/g,s". The whole sentence must
#     come through exactly, so any change to how the decoder reaches node is caught here.
APOS="$(env KOSMOS_VERSIONS_PAGE="$PAGE" KOSMOS_SOCIAL_PREVIEW_DIR="$PREVIEW" bash "$SCRIPT" 0.9.7 2>&1)"
WANT="Answer it in the agent's window & the board's \"Allow\" stays yours."
has "$APOS" "$WANT" && pass "entities: &#39; &#8217; &amp; &quot; decode to the exact sentence" \
  || bad "entities: sentence garbled | $(printf '%s' "$APOS" | grep -m1 'Answer it' | tr -d '\n' | tail -c 200)"
# The note is only the FIRST <p>, so the named/hex forms go through a second fixture page.
PAGE2="$T/versions2.html"; sed 's#<p>Answer it[^<]*</p>##' "$PAGE" > "$PAGE2"
NAMED="$(env KOSMOS_VERSIONS_PAGE="$PAGE2" KOSMOS_SOCIAL_PREVIEW_DIR="$PREVIEW" bash "$SCRIPT" 0.9.7 2>&1)"
WANT2="Named 's and 'x' and 'y' and 'z and \"q\" and \"r\"."
has "$NAMED" "$WANT2" && pass "entities: named and hex quote forms (&rsquo; &lsquo; &apos; &#x27; &#x2019; &ldquo; &rdquo; &#x201C;) decode" \
  || bad "entities: named/hex forms garbled | $(printf '%s' "$NAMED" | grep -m1 'Named' | tr -d '\n' | tail -c 200)"

# 9. a non-numeric version is refused
env bash "$SCRIPT" "not-a-version" >/dev/null 2>&1; [ $? = 2 ] && pass "non-numeric version -> refuse (exit 2)" || bad "non-numeric version not refused"

if [ "$fail" = 0 ]; then echo "test-post-release-notes: all arms passed"; exit 0; fi
echo "test-post-release-notes: FAILURES above"; exit 1
