#!/bin/bash
# tools/insert-release-entry.js, shown doing each thing it claims (#1455).
#
# The tool is the cure for the stamp-drift class that killed cuts: it stamps the
# entry with the minute it actually goes out (offset zero by construction) rather
# than a hand-written time predicted at launch. It was committed and referenced by
# NOTHING, so nothing proved it works. This does, both directions: it inserts and
# stamps, and it refuses the three shapes it must refuse. A tool wired into a cut
# on somebody's word is worse than one that is tested first.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
TOOL="$REPO/tools/insert-release-entry.js"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails + 1)); }

# A versions page with one existing entry that carries a comment above it, so the
# "insert above the comment too" behaviour has something to land above.
seed_page() {
  cat > "$T/versions.html" <<'HTML'
<main>
  <div class="shell">
    <!-- the newest entry's own comment -->
    <article class="rel" id="v0-6-00">
      <div class="rel-h"><h2 class="rel-v">0.6.00</h2><span class="rel-d">old</span></div>
      <p>an existing release.</p>
    </article>
  </div>
</main>
HTML
}
entry_good() {
  cat > "$T/entry.html" <<'HTML'
    <article class="rel" id="v9-9-99">
      <div class="rel-h"><h2 class="rel-v">9.9.99</h2><span class="rel-d">TIMESTAMP</span></div>
      <p>a new release.</p>
    </article>
HTML
}

# --- arm 1: it stamps a real Central time and inserts ABOVE the newest entry ---
seed_page; entry_good
out="$(node "$TOOL" "$T/entry.html" --site "$T" 2>&1)"; rc=$?
page="$(cat "$T/versions.html")"
[ "$rc" -eq 0 ] && pass "insert exits 0" || fail "insert exit was $rc: $out"
echo "$page" | grep -q 'id="v9-9-99"' && pass "the new entry landed on the page" || fail "the new entry is not on the page"
# stamped: the literal placeholder is gone and a real Central time is in its place.
echo "$page" | grep -q 'TIMESTAMP' && fail "TIMESTAMP placeholder survived, the entry went out undated" || pass "the TIMESTAMP placeholder was replaced"
echo "$page" | grep -Eq '(CDT|CST)' && pass "the stamp carries a Central timezone label" || fail "no CDT/CST label in the stamp: $page"
echo "$page" | grep -Eq '[A-Z][a-z]+ [0-9]+, 20[0-9][0-9]' && pass "the stamp is a real date, not the placeholder" || fail "no real date in the stamp"
# placement: new above old, and above old's comment (the comment belongs to old).
n_new="$(grep -n 'id="v9-9-99"' "$T/versions.html" | head -1 | cut -d: -f1)"
n_cmt="$(grep -n "the newest entry's own comment" "$T/versions.html" | head -1 | cut -d: -f1)"
n_old="$(grep -n 'id="v0-6-00"' "$T/versions.html" | head -1 | cut -d: -f1)"
{ [ "$n_new" -lt "$n_cmt" ] && [ "$n_cmt" -lt "$n_old" ]; } \
  && pass "inserted above the newest entry AND above its comment ($n_new < $n_cmt < $n_old)" \
  || fail "placement wrong: new=$n_new comment=$n_cmt old=$n_old"

# --- arm 2: a re-run with a version already on the page rewrites nothing --------
before="$(cat "$T/versions.html")"
out="$(node "$TOOL" "$T/entry.html" --site "$T" 2>&1)"; rc=$?
after="$(cat "$T/versions.html")"
[ "$rc" -eq 0 ] && [ "$before" = "$after" ] \
  && pass "a version already on the page is refused and nothing is rewritten" \
  || fail "re-run changed the page or errored (rc=$rc)"
[ "$(grep -c 'id="v9-9-99"' "$T/versions.html")" -eq 1 ] && pass "no duplicate entry after re-run" || fail "the entry was inserted twice"

# --- arm 3: an entry with no TIMESTAMP is refused (would go out undated) --------
seed_page
printf '%s\n' '    <article class="rel" id="v8-8-88"><p>no stamp here.</p></article>' > "$T/no-ts.html"
out="$(node "$TOOL" "$T/no-ts.html" --site "$T" 2>&1)"; rc=$?
{ [ "$rc" -ne 0 ] && ! grep -q 'id="v8-8-88"' "$T/versions.html"; } \
  && pass "an entry with no TIMESTAMP is refused and not inserted (rc=$rc)" \
  || fail "an undated entry was accepted (rc=$rc)"

# --- arm 4: an entry with no version id is refused -----------------------------
seed_page
printf '%s\n' '    <article class="rel"><span class="rel-d">TIMESTAMP</span><p>no id.</p></article>' > "$T/no-id.html"
out="$(node "$TOOL" "$T/no-id.html" --site "$T" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && pass "an entry with no id anchor is refused (rc=$rc)" || fail "an id-less entry was accepted (rc=$rc)"

# --- arm 5: no args at all is a usage error, distinct from a refusal -----------
# No arguments: entryFile is undefined and the tool exits 2 at its usage guard,
# before it reads any page, so this cannot touch the default site. (Passing only
# --site would make the site PATH the entry file, since it is the first non-flag
# arg; that is the tool's arg shape, not the usage error under test here.)
out="$(node "$TOOL" 2>&1)"; rc=$?
[ "$rc" -eq 2 ] && pass "no entry file is a usage error (exit 2)" || fail "missing entry file did not exit 2 (rc=$rc)"

[ "$fails" -eq 0 ] && { echo "all insert-release-entry arms behaved"; exit 0; } || { echo "$fails arm(s) failed"; exit 1; }
