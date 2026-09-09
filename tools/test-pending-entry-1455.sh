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

# 🛑 SHAPE, not substrings. Everything downstream needs the 4-space-indented
# <article class="rel"> with a matching closer: insert-release-entry.js anchors on it
# and reinsert-versions-entry.js (#2286 robust-7b) refuses without it. A fragment that
# passes a substring check at step 1 kills the cut at 7b, after the whole build.
printf '  <article class="rel" id="v0-6-41">\n    <p class="rel-d">TIMESTAMP</p>\n  </article>\n' > "$T/indent2.html"
kosmos_versions_entry_pending_ok "0.6.41" "$T/indent2.html" \
  && bad "a 2-space-indented entry was accepted; reinsert-versions-entry.js would refuse it at 7b" \
  || ok "a wrongly-indented entry is refused at step 1, not after the build"

printf '    <article id="v0-6-41">\n      <p class="rel-d">TIMESTAMP</p>\n    </article>\n' > "$T/noclass.html"
kosmos_versions_entry_pending_ok "0.6.41" "$T/noclass.html" \
  && bad "an entry without class=\"rel\" was accepted" \
  || ok "an entry without class=\"rel\" is refused"

printf '    <article class="rel" id="v0-6-41">\n      <p class="rel-d">TIMESTAMP</p>\n' > "$T/noclose.html"
kosmos_versions_entry_pending_ok "0.6.41" "$T/noclose.html" \
  && bad "an entry with no closing </article> was accepted" \
  || ok "an entry with no 4-space closing </article> is refused"

# 🛑 THE MIXED CASE: a hand-written rel-d date AND a stray TIMESTAMP elsewhere. The
# easy already-stamped arm above (no TIMESTAMP at all) does not reach this.
printf '    <article class="rel" id="v0-6-41">\n      <p class="rel-d">September 1, 2026, 9:00 AM CDT</p>\n      <p>see TIMESTAMP notes</p>\n    </article>\n' > "$T/mixed.html"
kosmos_versions_entry_pending_ok "0.6.41" "$T/mixed.html" \
  && bad "a file whose rel-d is ALREADY STAMPED was accepted because TIMESTAMP appeared elsewhere" \
  || ok "the placeholder must be the rel-d field itself, not the word appearing somewhere"

# CONTROL: the well-formed fixture the arms above are contrasted against is accepted.
pending "v0-6-41"
kosmos_versions_entry_pending_ok "0.6.41" "$T/entry.html" \
  && ok "CONTROL: the well-formed entry these four are contrasted against IS accepted" \
  || bad "the control fixture is rejected, so the four refusals above prove nothing"

# 🛑 A VERSION THAT IS NOT DIGITS AND DOTS IS REFUSED HERE TOO, because this path
# returns without ever reaching the gate that refuses it by name. The id is interpolated
# into a `grep -qE`, so metacharacters surviving `tr . -` change what is searched for.
pending "v0-6-41"
kosmos_versions_entry_pending_ok '0.6.9|0-6-41' "$T/entry.html" \
  && bad "an ALTERNATION in the version matched an entry naming a DIFFERENT release" \
  || ok "a version carrying a regex metacharacter is refused, as the gate refuses it"
kosmos_versions_entry_pending_ok '0.6.*' "$T/entry.html" \
  && bad "a glob in the version was accepted" || ok "a version carrying a glob is refused"
kosmos_versions_entry_pending_ok '0.6.41' "$T/entry.html" \
  && ok "CONTROL: the same file with a well-formed version IS accepted" \
  || bad "the well-formed control is rejected, so the two refusals above prove nothing"

# A FIFO is readable and would hang grep, and the cut, for ever.
# 🛑 THIS ARM'S MUTATION MANIFESTS AS A HANG, NOT A RED, AND THAT IS WORTH KNOWING
# BEFORE YOU MEET IT. Measured: with the `-f` half of the guard removed, `grep -qE`
# blocks on the named pipe indefinitely (2m15s before I killed it), so the suite does
# not fail, it stops. In CI that is a runner timeout wearing the clothes of an
# infrastructure problem rather than of a deleted guard.
# ⇒ If you are here because the suite hung, look at the `-f` check in
# kosmos_versions_entry_pending_ok first. That asymmetry is exactly why the guard is
# cheaper than the alternative of letting grep decide.
if mkfifo "$T/fifo.html" 2>/dev/null; then
  kosmos_versions_entry_pending_ok "0.6.41" "$T/fifo.html" \
    && bad "a FIFO was accepted as a pending entry; grep would block the cut" \
    || ok "a FIFO is refused, so the cut cannot hang on a named pipe"
else
  ok "SKIP: mkfifo unavailable, FIFO arm not run"
fi

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
# ⚠️ ASSERT THE INSERT SUCCEEDED, AND READ **THIS ENTRY'S** STAMP. An earlier version
# discarded the tool's status and grepped the FIRST rel-d on the page -- which is the
# seed entry, already stamped CDT by the fixture. So a tool that failed outright still
# printed "the stamp is CENTRAL": the arm passed on the fixture's own data.
if TZ=Australia/Sydney node tools/insert-release-entry.js "$T/entry.html" --site "$T" >/dev/null 2>&1; then
  ok "the tool ran under a non-Central TZ"
else
  bad "the tool failed under TZ=Australia/Sydney, so the stamp assertion below proves nothing"
fi
tzstamp="$(awk '/id="v0-6-42"/{f=1} f&&match($0,/rel-d">[^<]*</){print substr($0,RSTART+7,RLENGTH-8); exit}' "$T/versions.html")"
case "$tzstamp" in
  *CDT|*CST) ok "the stamp on THIS entry is CENTRAL even when the cutting box is not: $tzstamp" ;;
  '')        bad "no stamp found on the entry the tool just inserted" ;;
  *)         bad "the stamp took the machine's timezone: $tzstamp" ;;
esac

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
# ⚠️ COUNT INSIDE **THIS** ENTRY. Counting C[DS]T across the whole page passes on the
# pre-fix `.replace` too, because the seed entry supplies a second match: the arm was
# decoration wearing the guard's name. Measured before the fix.
two_stamps="$(awk '/id="v0-6-43"/{f=1} f&&/<\/article>/{exit} f' "$T/versions.html" | grep -c 'C[DS]T')"
[ "$two_stamps" -eq 2 ] \
  && ok "and BOTH placeholders inside that entry carry a real Central stamp" \
  || bad "that entry has $two_stamps stamps, expected 2: the second placeholder was not replaced"

# An operator who wrote a pending file must learn it was SEEN and rejected, not just
# that the page has no entry: the old refusal describes the page and never their file.
page
printf '    <article class="rel" id="v0-6-99">\n      <p class="rel-d">TIMESTAMP</p>\n    </article>\n' > "$T/wrongid.html"
out="$(kosmos_versions_entry_gate_or_pending "0.6.41" "$T/versions.html" "cost." "fix." 4 "$T/wrongid.html" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && ok "a pending file for the WRONG version still refuses" || bad "a wrong-version pending file was accepted"
printf '%s' "$out" | grep -q 'is not usable for' \
  && ok "and the refusal SAYS the pending file was found and turned down" \
  || bad "the operator is not told their pending file was even looked at: $out"

# An UNREADABLE pending file must be diagnosed as unreadable, not as malformed content:
# telling someone to fix the markup in a file they cannot open sends them nowhere.
page; pending "v0-6-41"; cp "$T/entry.html" "$T/locked.html"; chmod 000 "$T/locked.html"
out="$(kosmos_versions_entry_gate_or_pending "0.6.41" "$T/versions.html" "cost." "fix." 4 "$T/locked.html" 2>&1)"
chmod 644 "$T/locked.html"
printf '%s' "$out" | grep -q 'cannot be read as a file' \
  && ok "an unreadable pending file is diagnosed as unreadable, not as malformed" \
  || bad "an unreadable pending file was misdiagnosed: $out"

# ---- an UNREADABLE PAGE is not something a pending file can excuse ---------------

# 🛑 THE BLOCKER ARM. A pending entry says nothing about whether the page it must be
# inserted INTO is reachable. Accepting one at step 1 let the cut spend the suite, the
# browser gate, the install gate and the build, then die at 7a on a raw node ENOENT.
# ⚠️ RE-SEED THE PENDING FILE FOR **THIS** VERSION FIRST. An earlier draft reused
# $T/entry.html as the arms above had left it, carrying a v0-6-42 id, so this arm
# refused on the id mismatch and not on the unreadable page: it passed with the guard
# it names DELETED. Caught by mutating the guard away, which is the only thing that
# would have shown it.
pending "v0-6-41"
out="$(kosmos_versions_entry_gate_or_pending "0.6.41" "$T/no-such-page.html" "cost." "fix." 4 "$T/entry.html" 2>&1)"; rc=$?
[ "$rc" -ne 0 ] && ok "an UNREADABLE page refuses at step 1 even with a valid pending file beside it" \
  || bad "a pending file excused an unreadable versions page, and the cut would die at 7a"
printf '%s' "$out" | grep -q 'cannot read' \
  && ok "and it refuses with the gate's own unreadable-page diagnosis, not a missing-entry one" \
  || bad "the refusal did not come from the gate's unreadable-page branch: $out"

page; pending "v0-6-41"
kosmos_versions_entry_gate_or_pending "0.6.41" "$T/versions.html" "cost." "fix." 4 "$T/entry.html" >/dev/null 2>&1 \
  && ok "CONTROL: with the page READABLE the same pending file is accepted (the arm above refused for the page, not the file)" \
  || bad "the readable-page control failed, so the unreadable-page arm proves nothing"

# The hand-stamped flow must stay QUIET. The pending path is probed on every cut and
# usually does not exist; without the readability short-circuit /usr/bin/grep prints
# "No such file or directory" right after the step 7 banner, on the flow this change
# promises to leave untouched.
err="$(kosmos_versions_entry_gate_or_pending "0.6.41" "$T/versions.html" "cost." "fix." 4 "$T/definitely-absent.html" 2>&1 >/dev/null)"
printf '%s' "$err" | grep -q '^grep:' \
  && bad "a hand-stamped cut emits a stray grep diagnostic: $err" \
  || ok "a cut with no pending file emits no stray grep diagnostic"

# 🛑 ONE BLOCK, not three sightings. A file with TWO article blocks would have every
# required piece present: insert-release-entry.js inserts both, and at 7b
# reinsert-versions-entry.js extracts only through the FIRST 4-space closer, so the
# served page carries one entry and the working tree two.
printf '    <article class="rel" id="v0-6-41">\n      <p class="rel-d">TIMESTAMP</p>\n    </article>\n    <article class="rel" id="v0-6-40">\n      <p class="rel-d">TIMESTAMP</p>\n    </article>\n' > "$T/twoblocks.html"
kosmos_versions_entry_pending_ok "0.6.41" "$T/twoblocks.html" \
  && bad "a pending file holding TWO entries was accepted; 7b would serve one and leave two" \
  || ok "a pending file must hold exactly ONE entry block"

# ⚠️ AND THE OPEN COUNT NEEDS ITS OWN FIXTURE. The two-block file above has two CLOSERS
# too, so the closer count alone refuses it and the open count reds nothing: measured,
# the arm above passed with the open check deleted. Two opens and ONE closer is the
# shape that separates them.
printf '    <article class="rel" id="v0-6-41">\n      <p class="rel-d">TIMESTAMP</p>\n    <article class="rel" id="v0-6-40">\n      <p class="rel-d">x</p>\n    </article>\n' > "$T/twoopens.html"
kosmos_versions_entry_pending_ok "0.6.41" "$T/twoopens.html" \
  && bad "a file with TWO opening article tags and one closer was accepted" \
  || ok "two opening tags with a single closer is refused too, so the open count earns its place"

# The leftover a cut that died at or after 7a leaves behind: the entry is on the page
# AND the pending file is still there. The refusal is the gate's, but the operator has
# to be told which thing to remove, because step 1's advice is what they already did.
cat > "$T/versions.html" <<'HTML'
<main>
    <article class="rel" id="v0-6-41">
      <p class="rel-d">January 1, 2020, 9:00 AM CST</p>
    </article>
</main>
HTML
pending "v0-6-41"
out="$(kosmos_versions_entry_gate_or_pending "0.6.41" "$T/versions.html" "cost." "fix." 4 "$T/entry.html" 2>&1)"
printf '%s' "$out" | grep -q 'BOTH on the page and pending as a file' \
  && ok "a 7a leftover is NAMED, so the operator learns which copy to remove" \
  || bad "the leftover case gives only the stale-stamp refusal, whose advice cannot re-engage: $out"
printf '%s' "$out" | grep -q 'minutes in the past' \
  && ok "and the refusal itself is still the ORIGINAL gate's, unchanged" \
  || bad "the leftover note replaced the gate's refusal instead of adding to it"

# ---- WIRING: the cure must be CALLED, which is this card's entire subject -------

grep -q 'kosmos_versions_entry_gate_or_pending "\$V"' tools/release.sh \
  && ok "WIRING: release.sh step 1 uses the pending-aware gate" \
  || bad "WIRING: step 1 does not use the pending-aware gate"
grep -q 'node "\$REPO/tools/insert-release-entry.js" "\$KOSMOS_ENTRY_FILE" --site "\$SITE"' tools/release.sh \
  && ok "WIRING: release.sh INVOKES the tool" \
  || bad "WIRING: nothing in release.sh invokes the tool, which is exactly kosmos#1455"
# 🛑 Placement, not just presence: stamping at step 1 produces the aged stamp the
# gate exists to reject, which is the tool's own header's rule.
# 🛑 AND THE POSITION IS PINNED TO THE STEP 7 BANNERS, not merely "before the gate".
# `ins < gate` alone is satisfied by putting the insert at step 1b, which is the exact
# placement the comment above says it prevents: I built a synthetic release.sh with the
# node call at step 1b and this arm PASSED. "Before something later" is not a position.
# ⚠️ BOTH PATTERNS ARE ANCHORED TO THE CALL SHAPE, not to the bare filename. An
# unanchored /insert-release-entry.js/ also matches the COMMENT above the call, so the
# assertion would have been measuring whichever mention came last -- the same "a comment
# naming the function inflates the count" failure tools/test-versions-entry-gate.sh
# guards against by line-anchoring its own patterns.
awk '/^step "== 7\. /{s7=NR} /^step "== 7b\. /{s7b=NR} /^ *node "\$REPO\/tools\/insert-release-entry\.js"/{ins=NR} /^kosmos_versions_entry_gate "\$V"/{gate=NR} END{exit !(ins>s7 && s7>0 && ins<gate && gate<s7b)}' tools/release.sh \
  && ok "WIRING: the insert runs BEFORE the step 7 gate, so the gate still judges what shipped" \
  || bad "WIRING: the insert is not positioned before the deploy gate"

# 🛑 THE STEP LABEL IS PUT BACK AFTER 7a. `step` overwrites $_STEP and the EXIT trap
# records the LAST value, so without the restore a step 7 GATE refusal is filed in
# cut-suite-runs.log under 7a -- corrupting the one bucket that counted versions-entry
# deaths, which is also where this change's own effect would be read from.
grep -q '_step_before_7a="\$_STEP"' tools/release.sh \
  && ok "WIRING: release.sh saves the step label before the 7a banner" \
  || bad "WIRING: nothing saves \$_STEP before step 7a"
awk '/_step_before_7a="\$_STEP"/{save=NR} /^ *_STEP="\$_step_before_7a"/{restore=NR} /^kosmos_versions_entry_gate "\$V"/{gate=NR} END{exit !(save>0 && restore>save && gate>restore)}' tools/release.sh \
  && ok "WIRING: and restores it BEFORE the step 7 gate can refuse" \
  || bad "WIRING: the label is not restored before the gate, so a refusal files under 7a"

[ "$FAILS" -eq 0 ] && echo "pending entry (#1455): all arms passed" || { echo "pending entry (#1455): $FAILS failed"; exit 1; }
