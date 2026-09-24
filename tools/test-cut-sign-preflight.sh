#!/usr/bin/env bash
# Test for tools/lib/cut-sign-preflight.sh (#3579): the cut proves it can sign
# before the gated steps, and a locked keychain stops it with the unlock commands.
# Stub codesigns (shell functions) drive each arm, so this runs on any box (CI included).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
. "$REPO/tools/lib/cut-sign-preflight.sh"

fails=0
passes=0
ok()  { echo "  PASS  $1"; passes=$((passes + 1)); }
bad() { echo "  FAIL  $1"; fails=$((fails + 1)); }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Stub codesigns are shell FUNCTIONS, not files: `command -v` finds a function and
# "$cs" calls it, so no freshly written executable is ever exec'd. (On a Mac whose
# exec-policy assessment of a NEW file stalls, a file stub hung this test for minutes
# before its first line ran; measured 2026-09-24.) Each records that it RAN, so a
# pass cannot come from a preflight that never called it.
cs_ok()      { echo ran >> "$WORK/cs-ok.ran"; return 0; }
cs_locked()  { echo "/tmp/x/probe: errSecInternalComponent" >&2; return 1; }
cs_locked2() { echo "User interaction is not allowed." >&2; return 1; }
cs_ambig()   { echo "Developer ID Application: X: ambiguous (matches A and B)" >&2; return 1; }
cs_noid()    { echo "Developer ID Application: X: no identity found" >&2; return 1; }
cs_odd()     { echo "something nobody has seen" >&2; return 3; }
cs_args()    { printf '%s\n' "$@" > "$WORK/cs-args.argv"; return 0; }

run() { KOSMOS_CODESIGN_BIN="$1" kosmos_sign_preflight 2>&1; }

# --- signs: passes, and the stub was actually invoked ---
out="$(run cs_ok)"; rc=$?
[ "$rc" = 0 ] && ok "a working codesign passes" || bad "a working codesign should pass (rc=$rc): $out"
[ -s "$WORK/cs-ok.ran" ] && ok "the pass came from a real call to codesign" || bad "codesign was never called; the pass is vacuous"

# --- locked keychain: refuses, and says how to unlock ---
out="$(run cs_locked)"; rc=$?
[ "$rc" = 1 ] && ok "a locked keychain refuses" || bad "a locked keychain should refuse (rc=$rc)"
case "$out" in *"login keychain is LOCKED"*) ok "it names the lock" ;; *) bad "it did not name the lock: $out" ;; esac
case "$out" in *"security unlock-keychain"*) ok "it prints the unlock command" ;; *) bad "no unlock command: $out" ;; esac
case "$out" in *"SAME session"*"did not reach a cut detached"*) ok "it says to unlock in the cut's own session" ;; *) bad "no same-session guidance: $out" ;; esac
case "$out" in *errSecInternalComponent*) ok "it shows codesign's own error" ;; *) bad "codesign's error was hidden: $out" ;; esac

# The other spelling of the same lock.
out="$(run cs_locked2)"; rc=$?
case "$rc:$out" in 1:*"login keychain is LOCKED"*) ok "'User interaction is not allowed' also reads as locked" ;; *) bad "second lock spelling missed (rc=$rc): $out" ;; esac

# --- identity missing: refuses, and does NOT claim a lock ---
out="$(run cs_noid)"; rc=$?
[ "$rc" = 1 ] && ok "a missing identity refuses" || bad "a missing identity should refuse (rc=$rc)"
case "$out" in *"No usable identity"*) ok "it names the missing identity" ;; *) bad "it did not name the missing identity: $out" ;; esac
case "$out" in *LOCKED*) bad "a missing identity was misread as a lock" ;; *) ok "a missing identity is not called a lock" ;; esac

# --- ambiguous identity: refuses, and says TOO MANY, not none ---
out="$(run cs_ambig)"; rc=$?
case "$rc:$out" in 1:*"More than one identity"*) ok "an ambiguous identity refuses and says more than one matches" ;; *) bad "ambiguous misdiagnosed (rc=$rc): $out" ;; esac
case "$out" in *"No usable identity"*) bad "an ambiguous identity was called missing" ;; *) ok "an ambiguous identity is not called missing" ;; esac

# --- unknown failure: still refuses (never a silent pass on an unrecognised error) ---
out="$(run cs_odd)"; rc=$?
[ "$rc" = 1 ] && ok "an unrecognised codesign failure still refuses" || bad "an unrecognised failure should refuse (rc=$rc)"
case "$out" in *"something nobody has seen"*) ok "it shows the unrecognised error verbatim" ;; *) bad "unrecognised error hidden: $out" ;; esac

# --- no codesign at all ---
out="$(KOSMOS_CODESIGN_BIN="no_such_codesign_$$" kosmos_sign_preflight 2>&1)"; rc=$?
[ "$rc" = 1 ] && ok "no codesign refuses" || bad "no codesign should refuse (rc=$rc)"
case "$out" in *"no codesign on this machine"*) ok "it says codesign is missing (not another refusal)" ;; *) bad "wrong refusal for no codesign: $out" ;; esac

# --- the REAL-probe success line: `codesign` itself shadowed by a function, seam unset ---
codesign() { echo ran >> "$WORK/real-cs.ran"; return 0; }
out="$(unset KOSMOS_CODESIGN_BIN; kosmos_sign_preflight 2>&1)"; rc=$?
case "$rc:$out" in 0:*"the key is reachable from this session"*) ok "an unseamed pass reports a real test-sign" ;; *) bad "unseamed pass wording/rc wrong (rc=$rc): $out" ;; esac
case "$out" in *"NOT codesign"*) bad "an unseamed pass was called a stub" ;; *) ok "an unseamed pass is not called a stub" ;; esac
[ -s "$WORK/real-cs.ran" ] && ok "the unseamed pass called codesign" || bad "the unseamed pass never called codesign"
unset -f codesign

# --- a seam left set in a real shell must not read as a real probe ---
out="$(run cs_ok)"
case "$out" in *"NOT codesign"*"not probed"*) ok "a KOSMOS_CODESIGN_BIN pass says the key was NOT probed" ;; *) bad "a stubbed pass reads like a real probe: $out" ;; esac

# --- the identity it probes is the identity step 4 signs with ---
# #3643: both read tools/lib/signing-identity.sh, so pin that step 4 signs with the shared default
# (not a literal of its own) and that the preflight probes the same value.
bundle_line="$(grep -E '^_codesign_id=' "$REPO/tools/build-kosmos-bundle.sh")"
if [ "$bundle_line" != '_codesign_id="${KOSMOS_CODESIGN_ID:-$KOSMOS_SIGN_APP_DEFAULT}"' ]; then
  bad "step 4 no longer signs with the shared default from lib/signing-identity.sh: $bundle_line"
elif [ -n "$KOSMOS_SIGN_APP_DEFAULT" ] && [ "$KOSMOS_SIGN_APP_DEFAULT" = "$KOSMOS_SIGN_PREFLIGHT_DEFAULT_ID" ]; then
  ok "the preflight's default identity is step 4's shared default ($KOSMOS_SIGN_APP_DEFAULT)"
else
  bad "identity drift: preflight probes [$KOSMOS_SIGN_PREFLIGHT_DEFAULT_ID], the shared default is [$KOSMOS_SIGN_APP_DEFAULT]"
fi
# And no other shell script names the team: one place, or a partial switch ships two teams (#3643).
_team_pat="$KOSMOS_SIGN_TEAM_ID|$KOSMOS_SIGN_TEAM_NAME|$KOSMOS_NOTARY_KEY_ID_DEFAULT|$KOSMOS_NOTARY_ISSUER_DEFAULT"
_team_all="$(grep -rlIE "$_team_pat" "$REPO/tools")"   # every text file under tools/, not only *.sh
if ! printf '%s\n' "$_team_all" | grep -q '/tools/lib/signing-identity.sh$'; then
  bad "CONTROL: the team sweep did not even find lib/signing-identity.sh, so it cannot see anything"
else
  _team_hits="$(printf '%s\n' "$_team_all" | grep -v '/tools/lib/signing-identity.sh$' | grep -v '/tools/test-' || true)"
  [ -z "$_team_hits" ] && ok "only lib/signing-identity.sh names the signing team or its notary key" || bad "the signing team or notary key is named outside lib/signing-identity.sh: $_team_hits"
fi
# And KOSMOS_CODESIGN_ID reaches the probe, as it reaches step 4.
KOSMOS_CODESIGN_ID="Some Other Identity" KOSMOS_CODESIGN_BIN=cs_args kosmos_sign_preflight >/dev/null 2>&1
grep -qx 'Some Other Identity' "$WORK/cs-args.argv" 2>/dev/null \
  && ok "KOSMOS_CODESIGN_ID is the identity probed" || bad "KOSMOS_CODESIGN_ID did not reach the probe"
grep -qx -- '--timestamp=none' "$WORK/cs-args.argv" 2>/dev/null \
  && ok "the probe stays off the network (--timestamp=none)" || bad "the probe asked for a network timestamp"

# --- wired: release.sh calls it after the versions-entry gate and BEFORE step 2's bump ---
# (so a machine-only refusal mutates nothing; kosmos#3579 review)
R="$REPO/tools/release.sh"
entry="$(grep -n '^kosmos_versions_entry_gate_or_pending ' "$R" | head -1 | cut -d: -f1)"
call="$(grep -n '^kosmos_sign_preflight || exit 1$' "$R" | head -1 | cut -d: -f1)"
bump="$(grep -n '^step "== 2. the version, in one place =="' "$R" | head -1 | cut -d: -f1)"
ncalls="$(grep -c '^kosmos_sign_preflight' "$R")"
if [ -n "$entry" ] && [ -n "$call" ] && [ -n "$bump" ] && [ "$entry" -lt "$call" ] && [ "$call" -lt "$bump" ]; then
  ok "release.sh runs the preflight after the versions gate ($entry) and before the bump ($bump), at line $call"
else
  bad "release.sh wiring: entry-gate=[$entry] preflight=[$call] bump=[$bump]; the preflight must sit between them"
fi
[ "$ncalls" = 1 ] && ok "release.sh calls the preflight exactly once" || bad "release.sh calls the preflight $ncalls times"
# The 1c label is what files a signing refusal under its own bucket in cut-suite-runs.log
# (cut_record_done writes $_STEP); without it they land in 1b's. Pinned like 1b's label
# in test-versions-entry-gate.sh.
nlbl="$(grep -c 'step "== 1c' "$R")"
lbl="$(grep -n 'step "== 1c' "$R" | head -1 | cut -d: -f1)"
[ "$nlbl" = 1 ] && ok "the 1c step label exists exactly once" || bad "the 1c label is missing or duplicated (found $nlbl)"
if [ -n "$lbl" ] && [ -n "$entry" ] && [ -n "$call" ] && [ "$entry" -lt "$lbl" ] && [ "$lbl" -lt "$call" ]; then
  ok "and it sits after the versions gate and before the preflight call ($entry < $lbl < $call)"
else bad "the 1c label is misplaced (entry-gate=$entry label=$lbl call=$call)"; fi

echo "cut-sign-preflight: $passes passed, $fails failed"
[ "$fails" = 0 ] && [ "$passes" -ge 28 ] || { echo "FAILED (or fewer arms ran than expected)"; exit 1; }
