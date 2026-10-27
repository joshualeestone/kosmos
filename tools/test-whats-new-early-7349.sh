#!/bin/bash
# kosmos#7349: release.sh runs step 1b-ii's What's New checks BEFORE it marks the cut, claims the machine or waits, so a
# pool left behind by a prod promote stops the cut in seconds with nothing claimed. Runs a copy of release.sh in a folder
# that is not a git repo, with stand-ins for the two node tools (the tools themselves are tested in
# tools.whats-new-pool-sync-5713.test.js and the whats-new-check tests); this tests release.sh's wiring only.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/test-whats-new-early-7349.XXXXXX")"
trap 'rm -rf "$T"' EXIT
fail=0
pass() { echo "ok    $1"; }
bad() { echo "FAIL  $1"; fail=1; }
has() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }

# The site: a git checkout with a bare origin and no freeze marker, so pointer_freeze_refuse lets the cut through.
S="$T/site"; mkdir -p "$S/dist"; git init -q --initial-branch=main "$S"
git -C "$S" config user.email t@t; git -C "$S" config user.name t
printf '{}\n' > "$S/dist/latest.json"; git -C "$S" add -A; git -C "$S" commit -q -m site
git init -q --bare "$T/site-origin.git"; git -C "$S" remote add origin "$T/site-origin.git"; git -C "$S" push -q origin main

RS="$T/release-sandbox"; mkdir -p "$RS/tools/lib"
cp "$HERE/release.sh" "$RS/tools/"; cp "$HERE"/lib/*.sh "$RS/tools/lib/"; cp "$HERE/../package.json" "$RS/"
git -C "$RS" rev-parse --git-dir >/dev/null 2>&1 && { echo "FAIL  the release sandbox is inside a git repo; refusing to run release.sh"; exit 1; }
# Stand-ins. Each records its first word and how many run markers exist at the moment it is called, so the order
# (before kosmos_mark_run) is read from the run itself, not from line numbers.
for tool in whats-new-check whats-new-pool; do
  cat > "$RS/tools/$tool.js" <<EOF
const fs = require('fs');
const dir = process.env.KOSMOS_RUN_MARKER_DIR;
let n = 0; try { n = fs.readdirSync(dir).length; } catch {}
fs.appendFileSync(process.env.STUB_LOG, '$tool ' + process.argv[2] + ' markers=' + n + '\n');
const rc = Number(process.env['STUB_RC_' + '$tool'.replace(/-/g, '_')] || 0);
if (rc) process.stderr.write('$tool stand-in refuses (' + rc + ')\n');
else { process.stdout.write('$tool stand-in: 2 highlight(s) passing line\n'); process.stderr.write('$tool stand-in pass-time note\n'); }   // as the real tools can on a pass
process.exit(rc);
EOF
done
CURV="$(sed -n 's/.*"version":[[:space:]]*"\([0-9.]*\)".*/\1/p' "$HERE/../package.json" | head -1)"
_p=$(( 10#${CURV##*.} + 1 )); NEXTV="${CURV%.*}.$(printf '%02d' "$_p")"   # the next patch: past the version-jump guard

run() {  # <check rc> <pool rc> [env...] : sets RC, OUT, LOG; each run gets a fresh HOME, TMPDIR and marker dir
  local crc="$1" prc="$2"; shift 2
  local sb="$T/run.$RANDOM$RANDOM"; mkdir -p "$sb/home" "$sb/tmp"
  : > "$sb/stub.log"
  # KOSMOS_HARNESS_IGNORE_CUT=1: inside a real cut (step 3 runs this file) the sandboxed release.sh would otherwise
  # refuse as "a second cut" before reaching what is under test here.
  env HOME="$sb/home" TMPDIR="$sb/tmp" KOSMOS_SITE="$S" KOSMOS_HARNESS_IGNORE_CUT=1 \
    KOSMOS_RUN_MARKER_DIR="$sb/markers" STUB_LOG="$sb/stub.log" \
    STUB_RC_whats_new_check="$crc" STUB_RC_whats_new_pool="$prc" "$@" \
    bash "$RS/tools/release.sh" "$NEXTV" > "$sb/out" 2>&1
  RC=$?; OUT="$(cat "$sb/out")"; LOG="$(cat "$sb/stub.log")"; SB="$sb"
}
marked() { [ -n "$(ls -A "$SB/markers" 2>/dev/null)" ]; }
home_made() { [ -d "$SB/tmp/kosmos-cut-home" ]; }
STOP="stopped before marking the cut or claiming the machine (kosmos#7349)"

# prod is newer than the pool records (prod-check exits 3): stopped early, nothing marked, no cut home.
run 0 3
{ [ "$RC" != 0 ] && has "$OUT" "$STOP" && has "$OUT" "whats-new-pool.js build $NEXTV" && has "$OUT" "whats-new-pool stand-in refuses (3)" \
  && has "$LOG" "whats-new-pool prod-check markers=0" \
  && ! marked && ! home_made; } \
  && pass "a pool behind prod stops the cut before it marks itself: no marker, no claim, no cut home" \
  || bad "pool behind prod (rc=$RC): log=[$LOG] marked=$(marked && echo y || echo n) out=$(printf '%s' "$OUT" | tail -3)"

# the highlights file is not for this version (whats-new-check refuses): stopped early too, prod-check never asked.
run 1 0
{ [ "$RC" != 0 ] && has "$OUT" "$STOP" && has "$OUT" "whats-new-check stand-in refuses (1)" && has "$OUT" "Otherwise fix what it names" \
  && has "$LOG" "whats-new-check $NEXTV markers=0" && ! has "$LOG" "prod-check" && ! marked && ! home_made; } \
  && pass "highlights not for this version: stopped before the marker, prod not asked" \
  || bad "highlights refusal (rc=$RC): log=[$LOG] out=$(printf '%s' "$OUT" | tail -3)"

# a broken pool or tool (any other exit) refuses, as at 1b-ii.
run 0 2
{ [ "$RC" != 0 ] && has "$OUT" "$STOP" && ! marked; } && pass "a broken pool or tool (exit 2) stops the cut early" \
  || bad "broken pool (rc=$RC): out=$(printf '%s' "$OUT" | tail -3)"

# CONTROL: both pass. The early check lets the cut on: it marks itself and makes its cut home (and dies later, at
# step 1, because the sandbox is not a git checkout).
run 0 0
{ ! has "$OUT" "$STOP" && has "$LOG" "whats-new-pool prod-check markers=0" && home_made; } \
  && pass "CONTROL: a current pool goes on past the early check (asked before the marker, then the cut home is made)" \
  || bad "CONTROL current pool (rc=$RC): log=[$LOG] home=$(home_made && echo y || echo n) out=$(printf '%s' "$OUT" | tail -3)"
{ has "$OUT" "highlight(s) passing line" || has "$OUT" "pass-time note"; } && bad "the early check printed the tools' passing output (1b-ii prints it)" \
  || pass "the early check is quiet when it passes, stdout and a pass-time stderr note alike"

# prod could not be read (exit 4): goes on, as at 1b-ii, and the early run does not print 1b-ii's NOTE.
run 0 4
{ ! has "$OUT" "$STOP" && home_made && ! has "$OUT" "could not read what prod serves" && ! has "$OUT" "stand-in refuses (4)"; } \
  && pass "prod unreadable (exit 4): the cut goes on, its reason and the NOTE left to step 1b-ii" \
  || bad "prod unreadable (rc=$RC): out=$(printf '%s' "$OUT" | tail -3)"

# the hotfix opt-out skips it, as it skips 1b-ii: neither tool is run.
run 1 3 KOSMOS_CUT_NO_WHATS_NEW=1
{ ! has "$OUT" "$STOP" && [ -z "$LOG" ] && home_made; } && pass "KOSMOS_CUT_NO_WHATS_NEW=1 skips the early check (neither tool run)" \
  || bad "opt-out (rc=$RC): log=[$LOG] out=$(printf '%s' "$OUT" | tail -3)"

# Step 1b-ii cannot be reached without a real cut, so its wiring is pinned structurally: it runs the same function.
awk '/step "== 1b-ii\. the What/{s=1} /step "== 1c\./{exit} s&&/whats_new_gate note \|\| exit 1/{print "wired"; exit}' "$HERE/release.sh" | grep -q wired \
  && pass "step 1b-ii runs whats_new_gate (the same checks), refusing on it" || bad "step 1b-ii no longer runs whats_new_gate note || exit 1"

# The promote's hint (kosmos#7349): said on a Mac prod promote, pinned structurally (a promote needs a full fixture,
# tools/test-staging-channel-2036.sh): inside the non-Windows branch, after the PROMOTED line.
awk '/promote-channel: PROMOTED \$V to prod/{p=1} p&&/whats-new-pool\.js build/{print "hint"; exit} p&&/^fi$/{exit}' "$HERE/promote-channel.sh" | grep -q hint \
  && pass "promote-channel.sh names the pool build after a Mac prod promote" || bad "promote-channel.sh: the pool-build hint is missing from the Mac branch"

# A prod cut moves prod as a promote does, so it names the build too: inside its final prod block.
awk '/^if \[ "\$CUT_CHANNEL" = prod \]; then$/{p=1; h=0} p&&/whats-new-pool\.js build/{h=1} p&&/bash "\$MAIN_REPO\/tools\/post-release-notes\.sh"/{if(h)print "hint"; exit}' "$HERE/release.sh" | grep -q hint \
  && pass "a prod cut names the pool build at its end, before the release notes" || bad "release.sh: the prod cut's pool-build hint is missing"

if [ "$fail" = 0 ]; then echo "test-whats-new-early-7349: ALL PASS"; else echo "test-whats-new-early-7349: FAILURES above"; exit 1; fi
