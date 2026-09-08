#!/bin/bash
# kosmos#1455: the pending-entry path, arm by arm, with the controls that make each
# arm mean something.
#
# 🛑 WHAT THIS IS DEFENDING. The cure for stamp drift (tools/insert-release-entry.js)
# was committed and invoked by nothing for eleven days. The failure this file has to
# make impossible is that happening AGAIN through a different door: a wrapper that is
# correct, tested, and called by no step of the cut. So the last two arms read
# tools/release.sh itself and assert the call sites exist.
#
# ⚠️ AND THE WRAPPER MUST ONLY EVER **ADD** AN ACCEPTED STATE. Every arm below that
# asserts a refusal is paired with the un-pending control that produces the same
# refusal today, so a reader can see the wrapper did not soften anything.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tools/lib/versions-entry.sh

FAILS=0; ok(){ echo "PASS  $1"; }; bad(){ echo "FAIL  $1"; FAILS=$((FAILS+1)); }
T="$(mktemp -d "${TMPDIR:-/tmp}/pending-1455.XXXXXX")"; trap 'rm -rf "$T"' EXIT

# A versions page with one existing entry, which is what the tool inserts above.
page() {
  cat > "$T/versions.html" <<'HTML'
<main>
    <article class="rel" id="v0-6-40">
      <p class="rel-d">September 1, 2026, 9:00 AM CDT</p>
    </article>
</main>
HTML
}
# A pending entry file for a version, carrying the placeholder.
pending() { printf '    <article class="rel" id="%s">\n      <p class="rel-d">TIMESTAMP</p>\n    </article>\n' "$1" > "$T/entry.html"; }

# ---- kosmos_versions_entry_pending_ok ------------------------------------------

page; pending "v0-6-41"
kosmos_versions_entry_pending_ok "0.6.41" "$T/entry.html" \
  && ok "a well-formed pending entry is accepted" \
  || bad "a well-formed pending entry was rejected"

kosmos_versions_entry_pending_ok "0.6.99" "$T/entry.html" \
  && bad "a pending entry for ANOTHER version was accepted" \
  || ok "CONTROL: the id must match the version being cut, or the same file is rejected"

kosmos_versions_entry_pending_ok "0.6.41" "$T/no-such-file.html" \
  && bad "a missing pending file was accepted" \
  || ok "a missing pending file is not a pending entry"

kosmos_versions_entry_pending_ok "0.6.41" "" \
  && bad "an empty path was accepted" \
  || ok "an empty path is not a pending entry"

# 🛑 The arm the whole placeholder rule exists for.
printf '    <article class="rel" id="v0-6-41">\n      <p class="rel-d">September 1, 2026, 9:00 AM CDT</p>\n    </article>\n' > "$T/stamped.html"
kosmos_versions_entry_pending_ok "0.6.41" "$T/stamped.html" \
  && bad "an ALREADY-STAMPED file was accepted as pending (that is the drift, through the new door)" \
  || ok "an already-stamped file is refused: its minute was written in advance, which is the defect"

# ---- kosmos_versions_entry_gate_or_pending -------------------------------------

page; pending "v0-6-41"
out="$(kosmos_versions_entry_gate_or_pending "0.6.41" "$T/versions.html" "cost." "fix." 4 "$T/entry.html" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "step 1 ACCEPTS a version whose entry is pending as a file" \
  || bad "step 1 refused a pending entry (rc=$rc): $out"
printf '%s' "$out" | grep -q 'pending as an entry file' \
  && ok "and it says so, naming the file" \
  || bad "the acceptance does not tell the operator why it passed"

# CONTROL: the SAME call with no pending file must refuse exactly as today.
out="$(kosmos_versions_entry_gate_or_pending "0.6.41" "$T/versions.html" "cost." "fix." 4 "$T/nothing.html" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && ok "CONTROL: with no pending file the same version still REFUSES (the wrapper adds a state, it does not soften one)" \
  || bad "the wrapper accepted a version with neither a page entry nor a pending file"
printf '%s' "$out" | grep -q 'has no entry in' \
  && ok "CONTROL: and the refusal is the ORIGINAL gate's, unchanged" \
  || bad "the refusal did not come from the original gate: $out"

# An entry already ON the page takes the original gate, stamp window and all.
cat > "$T/versions.html" <<'HTML'
<main>
    <article class="rel" id="v0-6-41">
      <p class="rel-d">January 1, 2020, 9:00 AM CST</p>
    </article>
    <article class="rel" id="v0-6-40">
      <p class="rel-d">September 1, 2026, 9:00 AM CDT</p>
    </article>
</main>
HTML
pending "v0-6-41"
out="$(kosmos_versions_entry_gate_or_pending "0.6.41" "$T/versions.html" "cost." "fix." 4 "$T/entry.html" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && ok "a WILDLY stale entry already on the page still refuses, even with a pending file beside it" \
  || bad "the pending file let a years-old stamp through: the page must win"
printf '%s' "$out" | grep -q 'minutes in the past' \
  && ok "and it refuses through the original stamp-window check" \
  || bad "the stale-stamp refusal did not fire: $out"

# ---- the tool, driven end to end ------------------------------------------------

page; pending "v0-6-41"
node tools/insert-release-entry.js "$T/entry.html" --site "$T" >/dev/null 2>&1 \
  && ok "the tool inserts the pending entry" || bad "the tool refused a good pending entry"
grep -q 'id="v0-6-41"' "$T/versions.html" \
  && ok "the entry is on the page" || bad "the entry is not on the page"
grep -q 'TIMESTAMP' "$T/versions.html" \
  && bad "the placeholder shipped: the entry went out undated" \
  || ok "the placeholder is gone, replaced by a real stamp"
# The stamp it wrote must satisfy the very gate that guards the deploy.
kosmos_versions_entry_gate "0.6.41" "$T/versions.html" "cost." "fix." 20 >/dev/null 2>&1 \
  && ok "END TO END: the stamp the tool writes PASSES the step 7 gate" \
  || bad "the tool wrote a stamp its own deploy gate rejects"

# Idempotence is what makes wiring it safe on the hand-stamped flow.
out="$(node tools/insert-release-entry.js "$T/entry.html" --site "$T" 2>&1)"; rc=$?
[ "$rc" -eq 0 ] && ok "re-running it is exit 0, so the wired call is a no-op on an entry already on the page" \
  || bad "re-running it failed (rc=$rc), which would break every hand-stamped cut: $out"
[ "$(grep -c 'id="v0-6-41"' "$T/versions.html")" -eq 1 ] \
  && ok "and it did not insert a second copy" || bad "the entry was inserted twice"

# 🛑 THE STAMP MUST BE CENTRAL WHATEVER CLOCK THE CUTTER'S BOX IS ON. The tool's own
# header says a page that lies about which clock it used "cost the afternoon this card
# is named for". This arm forces a non-Central TZ, which is the only way to tell the
# guard from the accident: every machine on this fleet is already Central, so without
# TZ= the assertion passes with the timeZone option DELETED (measured).
page; pending "v0-6-42"
TZ=Australia/Sydney node tools/insert-release-entry.js "$T/entry.html" --site "$T" >/dev/null 2>&1
if grep -o 'rel-d">[^<]*<' "$T/versions.html" | head -1 | grep -qE 'C[DS]T'; then
  ok "the stamp is CENTRAL even when the cutting box is not"
else
  bad "the stamp took the machine's timezone: $(grep -o 'rel-d">[^<]*<' "$T/versions.html" | head -1)"
fi

# 🛑 EVERY placeholder, not just the first. A `String.replace` with a string pattern
# replaces once, so an entry carrying TIMESTAMP twice used to go out with a literal
# TIMESTAMP on the public page. Harmless while nothing called the tool; this card is
# what makes the path live.
page
printf '    <article class="rel" id="v0-6-43">\n      <p class="rel-d">TIMESTAMP</p>\n      <p class="rel-x">TIMESTAMP</p>\n    </article>\n' > "$T/two.html"
node tools/insert-release-entry.js "$T/two.html" --site "$T" >/dev/null 2>&1
if grep -q 'TIMESTAMP' "$T/versions.html"; then
  bad "an entry with two placeholders shipped a literal TIMESTAMP to the page"
else
  ok "an entry with TWO placeholders has both stamped, so nothing literal ships"
fi
[ "$(grep -c 'C[DS]T' "$T/versions.html")" -ge 2 ] \
  && ok "and both carry a real Central stamp" || bad "the second placeholder was not stamped"

# An operator who wrote a pending file must learn it was SEEN and rejected, not just
# that the page has no entry: the old refusal describes the page and never their file.
page
printf '    <article class="rel" id="v0-6-99">\n      <p class="rel-d">TIMESTAMP</p>\n    </article>\n' > "$T/wrongid.html"
out="$(kosmos_versions_entry_gate_or_pending "0.6.41" "$T/versions.html" "cost." "fix." 4 "$T/wrongid.html" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && ok "a pending file for the WRONG version still refuses" || bad "a wrong-version pending file was accepted"
printf '%s' "$out" | grep -q 'is not usable for' \
  && ok "and the refusal SAYS the pending file was found and turned down" \
  || bad "the operator is not told their pending file was even looked at: $out"

# ---- WIRING: the cure must be CALLED, which is this card's entire subject -------

grep -q 'kosmos_versions_entry_gate_or_pending "\$V"' tools/release.sh \
  && ok "WIRING: release.sh step 1 uses the pending-aware gate" \
  || bad "WIRING: step 1 does not use the pending-aware gate"
grep -q 'node "\$REPO/tools/insert-release-entry.js" "\$KOSMOS_ENTRY_FILE" --site "\$SITE"' tools/release.sh \
  && ok "WIRING: release.sh INVOKES the tool" \
  || bad "WIRING: nothing in release.sh invokes the tool, which is exactly kosmos#1455"
# 🛑 Placement, not just presence: stamping at step 1 produces the aged stamp the
# gate exists to reject, which is the tool's own header's rule.
# ⚠️ BOTH PATTERNS ARE ANCHORED TO THE CALL SHAPE, not to the bare filename. An
# unanchored /insert-release-entry.js/ also matches the COMMENT above the call, so the
# assertion would have been measuring whichever mention came last -- the same "a comment
# naming the function inflates the count" failure tools/test-versions-entry-gate.sh
# guards against by line-anchoring its own patterns.
awk '/^ *node "\$REPO\/tools\/insert-release-entry\.js"/{ins=NR} /^kosmos_versions_entry_gate "\$V"/{gate=NR} END{exit !(ins>0 && gate>0 && ins<gate)}' tools/release.sh \
  && ok "WIRING: the insert runs BEFORE the step 7 gate, so the gate still judges what shipped" \
  || bad "WIRING: the insert is not positioned before the deploy gate"

[ "$FAILS" -eq 0 ] && echo "pending entry (#1455): all arms passed" || { echo "pending entry (#1455): $FAILS failed"; exit 1; }
