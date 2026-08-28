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

run() { kosmos_versions_entry_gate 0.6.06 "$F" "cost sentence." 2>&1; }

# --- presence axis ---
printf '<article id="v0-6-05"><span class="rel-d">%s</span></article>\n' "$(stamp_at 0)" > "$F"
out="$(run)"; rc=$?
if [ "$rc" -eq 1 ] && has "$out" "has no entry"; then pass "refuses when the entry is absent"; else fail "refuses when absent (rc=$rc): $out"; fi
# and the control that makes that refusal mean something: the same file, the version it DOES carry
out="$(kosmos_versions_entry_gate 0.6.05 "$F" "cost." 2>&1)"; rc=$?
if [ "$rc" -eq 0 ]; then pass "and accepts the version that file does carry (control)"; else fail "control: 0.6.05 should pass (rc=$rc): $out"; fi

# --- stamp axis ---
entry "$(stamp_at 0)"
out="$(run)"; rc=$?
if [ "$rc" -eq 0 ] && has "$out" "agrees with the clock"; then pass "accepts a stamp written now"; else fail "accepts now (rc=$rc): $out"; fi

entry "$(stamp_at -15)"
out="$(run)"; rc=$?
if [ "$rc" -eq 0 ]; then pass "accepts a publication stamp 15 min ahead, read at step 1"; else fail "publication stamp must pass early (rc=$rc): $out"; fi

entry "$(stamp_at 25)"
out="$(run)"; rc=$?
off="$(kosmos_versions_entry_stamp_off "$(stamp_at 25)")"
# ⚠️ the count is asserted as a RANGE, not as 25: the stamp has minute
# granularity, so a fixture built 40 seconds past the minute reads 26. An exact
# assertion here fails once an hour for a reason that has nothing to do with
# the gate.
if [ "$rc" -eq 1 ] && has "$out" "off by 2" && [ "$off" -ge 24 ] 2>/dev/null; then pass "refuses a stale stamp, and says by how much ($off min)"; else fail "refuses stale (rc=$rc, off=$off): $out"; fi

entry "$(stamp_at -25)"
out="$(run)"; rc=$?
off="$(kosmos_versions_entry_stamp_off "$(stamp_at -25)")"
# the SIGN is the thing under test here, and it is what separates this arm from
# the unparseable one below: an empty fixture also refuses, for a different reason.
if [ "$rc" -eq 1 ] && has "$out" "off by -2" && [ "$off" -le -24 ] 2>/dev/null; then pass "refuses a stamp in the future (a guess cannot satisfy the clock) ($off min)"; else fail "refuses future (rc=$rc, off=$off): $out"; fi

entry "sometime tuesday"
out="$(run)"; rc=$?
if [ "$rc" -eq 1 ]; then pass "refuses an unparseable stamp"; else fail "refuses unparseable (rc=$rc): $out"; fi

# --- the gate is actually wired at BOTH call sites, not just defined ---
n="$(grep -c 'kosmos_versions_entry_gate' "$HERE/release.sh")"
if [ "$n" -eq 2 ]; then pass "release.sh calls the gate exactly twice (step 1 and step 7)"; else fail "release.sh should call the gate twice, found $n"; fi

[ "$fails" -eq 0 ] || { echo "$fails failed"; exit 1; }
echo "all versions-entry gate arms behaved"
