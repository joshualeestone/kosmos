#!/bin/bash
# The versions-page gate shown red and green on both of its axes (#1453).
#
# ⚠️ THE ARM THAT EARNS ITS KEEP IS "a publication stamp read at step 1".
# Running this gate early was nearly abandoned on an asserted-but-unmeasured
# claim that it would refuse correct entries, because an entry stamped for
# publication sits about fifteen minutes in the FUTURE when step 1 reads it.
# The window is symmetric (|off| <= 20), so it passes. That arm is here so the
# claim is measured on every run instead of re-argued.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/lib/versions-entry.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
F="$T/versions.html"
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

# $1 = minutes from now, positive = the past
#
# ⚠️ THIS IS A THIRD PRODUCER OF THE rel-d FORMAT, AGAINST ONE PARSER. The others
# are `versions_entry()` in tools.release-gate.test.js and the real writer,
# tools/insert-release-entry.js. If the page's stamp format ever changes, both
# fixtures keep passing while the real page fails -- the two-derivations habit
# this repo warns about, in test-only clothing. Kept because a fixture that
# imported the real writer would drag its file I/O into a unit test; noted so the
# next person changing the format knows there are three places, not one.
stamp_at() {
  node -e "
    const off = Number(process.argv[1]);
    const t = new Date(Date.now() - off*60000);
    const months='January February March April May June July August September October November December'.split(' ');
    let h=t.getHours(), ap=h>=12?'PM':'AM'; h=h%12; if(h===0)h=12;
    const mm=String(t.getMinutes()).padStart(2,'0');
    process.stdout.write(months[t.getMonth()]+' '+t.getDate()+', '+t.getFullYear()+', '+h+':'+mm+' '+ap+' CDT');
  " -- "$1"
}
entry() { printf '<article id="v0-6-06"><span class="rel-d">%s</span></article>\n' "$1" > "$F"; }

# default runs use the LATE bounds (+/-20); the step 1 arms pass the tighter one.
run()       { kosmos_versions_entry_gate 0.6.06 "$F" "cost sentence." "stamp hint." "$KOSMOS_LATE_PAST_BOUND" 2>&1; }
run_early() { kosmos_versions_entry_gate 0.6.06 "$F" "cost sentence." "stamp hint." "$KOSMOS_STEP1_PAST_BOUND" 2>&1; }

# --- presence axis ---
printf '<article id="v0-6-05"><span class="rel-d">%s</span></article>\n' "$(stamp_at 0)" > "$F"
out="$(run)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "has no entry"; then pass "refuses when the entry is absent"; else fail "refuses when absent (rc=$rc): $out"; fi
# and the control that makes that refusal mean something: the same file, the version it DOES carry
out="$(kosmos_versions_entry_gate 0.6.05 "$F" "cost." "hint." "$KOSMOS_LATE_PAST_BOUND" 2>&1)"; rc=$?
if [ "$rc" -eq 0 ]; then pass "and accepts the version that file does carry (control)"; else fail "control: 0.6.05 should pass (rc=$rc): $out"; fi

# --- stamp axis ---
entry "$(stamp_at 0)"
out="$(run)"; rc=$?
if [ "$rc" -eq 0 ] && has "$out" "agrees with the clock"; then pass "accepts a stamp written now"; else fail "accepts now (rc=$rc): $out"; fi

entry "$(stamp_at -15)"
out="$(run)"; rc=$?
if [ "$rc" -eq 0 ]; then pass "accepts a publication stamp 15 min ahead, read at step 1"; else fail "publication stamp must pass early (rc=$rc): $out"; fi

st="$(stamp_at 25)"; entry "$st"
out="$(run)"; rc=$?
# ⚠️ the SAME stamp string, not a second stamp_at call. Calling it twice reads the
# clock again seconds later, so a failure message could print a minute the fixture
# never carried -- a diagnostic that disagrees with the thing under test.
off="$(kosmos_versions_entry_stamp_off "$st")"
# ⚠️ the count is asserted as a RANGE, not as 25: the stamp has minute
# granularity, so a fixture built 40 seconds past the minute reads 26. An exact
# assertion here fails once an hour for a reason that has nothing to do with
# the gate.
if [ "$rc" -eq 1 ] && has "$out" "minutes in the past" && [ "$off" -ge 24 ] 2>/dev/null; then pass "refuses a stale stamp, and says by how much ($off min)"; else fail "refuses stale (rc=$rc, off=$off): $out"; fi

st="$(stamp_at -25)"; entry "$st"
out="$(run)"; rc=$?
off="$(kosmos_versions_entry_stamp_off "$st")"
# the SIGN is the thing under test here, and it is what separates this arm from
# the unparseable one below: an empty fixture also refuses, for a different reason.
if [ "$rc" -eq 1 ] && has "$out" "minutes in the FUTURE" && [ "$off" -le -24 ] 2>/dev/null; then pass "refuses a stamp in the future (a guess cannot satisfy the clock) ($off min)"; else fail "refuses future (rc=$rc, off=$off): $out"; fi

entry "sometime tuesday"
out="$(run)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "refuses an unparseable stamp"; else fail "refuses unparseable (rc=$rc): $out"; fi


# --- THE ASYMMETRY: step 1 is stricter on the PAST side, and that is the point ---
# 🛑 A stamp 12 minutes old passes a symmetric +/-20 at step 1 and then dies at
# step 7, because the cut adds its own ~15 minutes on the way there. Step 1 can
# see that it is doomed; refusing it early is the entire value of the move.
st="$(stamp_at 12)"; entry "$st"
out="$(run)"; rc=$?
if [ "$rc" -eq 0 ]; then pass "12 minutes old passes the LATE gate, as it must"; else fail "late gate refused 12 min old (rc=$rc): $out"; fi
out="$(run_early)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "minutes in the past"; then pass "and the EARLY gate refuses it, because the cut will age it past 20"; else fail "early gate accepted a doomed 12-min-old stamp (rc=$rc): $out"; fi

# and the early gate must NOT refuse a correctly forward-stamped entry
st="$(stamp_at -15)"; entry "$st"
out="$(run_early)"; rc=$?
if [ "$rc" -eq 0 ]; then pass "the EARLY gate still accepts a publication stamp 15 min ahead"; else fail "early gate refused a correct publication stamp (rc=$rc): $out"; fi

# the future side is NOT widened at either call site
st="$(stamp_at -25)"; entry "$st"
out="$(run_early)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "FUTURE"; then pass "the EARLY gate still refuses a 25-min forward guess (future side not widened)"; else fail "early gate accepted a forward guess (rc=$rc): $out"; fi

# --- an unreadable file is not an absent entry ---
out="$(kosmos_versions_entry_gate 0.6.06 "$T/nope.html" "cost." "hint." "$KOSMOS_LATE_PAST_BOUND" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "cannot read"; then pass "an unreadable file says so, instead of 'write the entry'"; else fail "unreadable file (rc=$rc): $out"; fi

# --- a version that is not digits and dots never reaches the sed address ---
entry "$(stamp_at 0)"
out="$(kosmos_versions_entry_gate '0.6.*' "$F" "cost." "hint." "$KOSMOS_LATE_PAST_BOUND" 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "not digits and dots"; then pass "refuses a version carrying a regex metacharacter"; else fail "metacharacter version (rc=$rc): $out"; fi


# --- FAIL-OPEN ARMS. Both of these were live regressions, not hypotheticals. ---
# 🛑 A guard that errors must refuse, not pass. `[ NaN -gt 5 ]` ERRORS rather than
# evaluating false, so before this arm existed the gate fell through both
# comparisons into "its timestamp agrees with the clock" and returned 0.
entry "August 28, 999999, 1:00 AM CDT"
out="$(run)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "a stamp whose offset is not a number REFUSES (fail closed)"; else fail "FAIL-OPEN: NaN offset passed the gate (rc=$rc): $out"; fi

# 🛑 THE SECOND DEFENCE, TESTED SEPARATELY BECAUSE THE FIRST ONE MASKS IT.
# There are two guards against a non-numeric offset: node prints `unparseable`
# when the value is not finite, and the shell refuses anything that is not an
# integer. A mutation test removing the SHELL guard stayed green, because the
# node guard still caught the NaN -- so the shell guard was protecting a case
# nothing exercised. This arm exercises it: with `node` unavailable the offset
# is EMPTY, which no node-side check can catch, and empty must still refuse.
entry "$(stamp_at 0)"
stub="$T/stub"; mkdir -p "$stub"
printf '#!/bin/sh\nexit 127\n' > "$stub/node"; chmod +x "$stub/node"
out="$(PATH="$stub:$PATH" run)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "an offset that cannot be computed at all REFUSES (node absent)"; else fail "FAIL-OPEN: unusable node passed the gate (rc=$rc): $out"; fi

# 🛑 An article with no rel-d must not borrow the NEXT article's stamp. Entries are
# newest-first, so on a same-session re-cut the neighbour's stamp is plausibly
# inside the window and would green-light an entry carrying no timestamp at all.
cat > "$F" <<'HTML'
<article class="rel" id="v0-6-06">
  <h2>0.6.06</h2>
</article>
<article class="rel" id="v0-6-05">
  <span class="rel-d">PLACEHOLDER</span>
</article>
HTML
sed -i '' "s/PLACEHOLDER/$(stamp_at 0)/" "$F"
got="$(kosmos_versions_entry_stamp 0.6.06 "$F")"
if [ -z "$got" ]; then pass "an entry with no rel-d reads empty, not the neighbour's stamp"; else fail "FAIL-OPEN: borrowed a neighbour's stamp: '$got'"; fi
got="$(kosmos_versions_entry_stamp 0.6.05 "$F")"
if [ -n "$got" ]; then pass "CONTROL: the neighbour's own stamp is still readable"; else fail "control empty, the reader is dead and the arm above proves nothing"; fi
out="$(run)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "and the gate refuses the entry that has no timestamp"; else fail "FAIL-OPEN: no-timestamp entry passed (rc=$rc): $out"; fi

# --- the two call sites give DIFFERENT stamp advice, and early must not say "now" ---
# 🛑 THE ARM THAT PINS THE ACTUAL BUG: telling the operator at step 1 to stamp NOW
# guarantees a second failure at step 7, because the entry ages by the length of the
# cut in between. Early must say PUBLISH.
# ⚠️ Take each call site as a WHOLE continued command rather than assuming a
# fixed line count: awk joins lines while the previous one ends in a backslash,
# so re-wrapping either call cannot silently make this read the wrong lines.
# Each joined call is printed on ONE line, so line N is call N.
joined="$T/calls.txt"
awk '/^kosmos_versions_entry_gate /{c=$0; while (c ~ /\\$/) {sub(/\\$/,"",c); if ((getline nx) <= 0) break; c=c nx} print c}' \
  "$HERE/release.sh" > "$joined"
ncalls="$(wc -l < "$joined" | tr -d ' ')"
if [ "$ncalls" -eq 2 ]; then pass "found exactly two whole call sites to compare"; else fail "expected 2 call sites, parsed $ncalls -- the extraction, not the code, may be stale"; fi
early="$(sed -n 1p "$joined")"
late="$(sed -n 2p "$joined")"
if [ -n "$early" ] && [ -n "$late" ]; then pass "both call sites extracted non-empty"; else fail "extraction empty: early='$early' late='$late'"; fi
if has "$early" "PUBLISH"; then pass "the step 1 call tells the operator to stamp for publication"; else fail "step 1 stamp advice: $early"; fi
if has "$late" "Paste the clock line"; then pass "the step 7 call tells the operator to stamp now"; else fail "step 7 stamp advice: $late"; fi
if [ "$early" = "$late" ]; then fail "both call sites give the same stamp advice; step 1 must not say 'now'"; else pass "the two call sites do not share one remediation sentence"; fi

# --- the gate is actually wired at BOTH call sites, in the right ORDER ---
# ⚠️ counting occurrences is not enough: a comment naming the function inflates it,
# and two calls both sitting in step 7 would still count 2. Assert the CALL shape
# (line-anchored) and that one of them precedes the step 2 banner.
n="$(grep -c '^kosmos_versions_entry_gate ' "$HERE/release.sh")"
if [ "$n" -eq 2 ]; then pass "release.sh calls the gate exactly twice"; else fail "release.sh should call the gate twice, found $n"; fi
first_call="$(grep -n '^kosmos_versions_entry_gate ' "$HERE/release.sh" | head -1 | cut -d: -f1)"
last_call="$(grep -n '^kosmos_versions_entry_gate ' "$HERE/release.sh" | tail -1 | cut -d: -f1)"
step2="$(grep -n 'step "== 2\. ' "$HERE/release.sh" | head -1 | cut -d: -f1)"
if [ -n "$step2" ] && [ "$first_call" -lt "$step2" ]; then pass "one call runs BEFORE step 2, which is the whole point of the change"; else fail "no call before step 2 (first=$first_call step2=$step2)"; fi
if [ -n "$step2" ] && [ "$last_call" -gt "$step2" ]; then pass "and the late call is still there, after step 2"; else fail "late call missing (last=$last_call step2=$step2)"; fi

[ "$fails" -eq 0 ] || { echo "$fails failed"; exit 1; }
echo "all versions-entry gate arms behaved"
