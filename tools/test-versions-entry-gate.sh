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
out="$(kosmos_versions_entry_gate 0.6.05 "$F" "cost." "hint." 20 2>&1)"; rc=$?
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
out="$(kosmos_versions_entry_gate 0.6.06 "$T/nope.html" "cost." "hint." 20 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "cannot read"; then pass "an unreadable file says so, instead of 'write the entry'"; else fail "unreadable file (rc=$rc): $out"; fi

# --- a version that is not digits and dots never reaches the sed address ---
entry "$(stamp_at 0)"
out="$(kosmos_versions_entry_gate '0.6.*' "$F" "cost." "hint." 20 2>&1)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "not digits and dots"; then pass "refuses a version carrying a regex metacharacter"; else fail "metacharacter version (rc=$rc): $out"; fi

# --- the two call sites give DIFFERENT stamp advice, and early must not say "now" ---
# 🛑 THE ARM THAT PINS THE ACTUAL BUG: telling the operator at step 1 to stamp NOW
# guarantees a second failure at step 7, because the entry ages by the length of the
# cut in between. Early must say PUBLISH.
early="$(sed -n '/^kosmos_versions_entry_gate/,+1p' "$HERE/release.sh" | head -2)"
late="$(sed -n '/^kosmos_versions_entry_gate/,+1p' "$HERE/release.sh" | tail -2)"
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
