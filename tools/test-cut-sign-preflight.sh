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

# #3647 seams for the Installer identity and the notary key, as functions (no fresh executables).
printf 'key\n' > "$WORK/notary.p8"
# The sec_* stubs answer only 'find-identity -v', so dropping -v (which lets expired
# identities through) turns every pass arm red.
_secv()    { [ "$#" = 2 ] && [ "$1" = find-identity ] && [ "$2" = -v ] || { echo "stub: wanted 'find-identity -v', got '$*'" >&2; return 2; }; }
sec_ok()   { _secv "$@" || return; echo "  1) ABCDEF0123 \"$KOSMOS_SIGN_APP_DEFAULT\""; echo "  2) 0123ABCDEF \"$KOSMOS_SIGN_INSTALLER_DEFAULT\""; }
sec_noinst() { _secv "$@" || return; echo "  1) ABCDEF0123 \"$KOSMOS_SIGN_APP_DEFAULT\""; }
sm_ok()    { [ "$1" = path ] && [ "$2" = "$KOSMOS_NOTARY_SECRET_TARGET" ] && echo "$WORK/notary.p8"; }
sm_none()  { echo "secrets-map: no credential for target" >&2; return 1; }
sec_hashonly() { _secv "$@" || return; echo "  1) 0123ABCDEF (identity listed by hash only)"; }
sec_broken() { echo "security: SecKeychainSearchCopyNext: boom" >&2; return 1; }
sm_dir()   { echo "$WORK"; }
sm_badpath() { echo "$WORK/no-such-notary.p8"; }
export KOSMOS_SECURITY_BIN=sec_ok KOSMOS_SECRETS_MAP_BIN=sm_ok
unset KOSMOS_INSTALLER_CERT KOSMOS_CODESIGN_ID   # an operator's exported override must not change what these arms test
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
# Fixed strings (-F): a team name like "Inc." or with parentheses must not be read as a regex.
# The whole repo (not only tools/), minus git internals, dependencies, plans and tests.
_team_all="$(grep -rlIF --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.claude -e "$KOSMOS_SIGN_TEAM_ID" -e "$KOSMOS_SIGN_TEAM_NAME" -e "$KOSMOS_NOTARY_KEY_ID_DEFAULT" -e "$KOSMOS_NOTARY_ISSUER_DEFAULT" "$REPO")"
if ! printf '%s\n' "$_team_all" | grep -q '/tools/lib/signing-identity.sh$'; then
  bad "CONTROL: the team sweep did not even find lib/signing-identity.sh, so it cannot see anything"
else
  _team_hits="$(printf '%s\n' "$_team_all" | grep -v '/tools/lib/signing-identity.sh$' | grep -v '/tools/test-' | grep -v '\.test\.js$' || true)"
  [ -z "$_team_hits" ] && ok "only lib/signing-identity.sh names the signing team or its notary key" || bad "the signing team or notary key is named outside lib/signing-identity.sh: $_team_hits"
fi
# The sweep above looks for the CURRENT values, so right after a team switch it would be blind to a
# leftover of the OLD team. Pin the Stone Syndicate team id (built from fragments so this file does
# not match itself) everywhere, tests included: only the lib may carry it.
# Only whole-line comments are unhashed in the pkg input, so a value line must not carry an inline one.
_inline="$(grep -nE '^[[:space:]]*[A-Z_]+=.*[[:space:]]#' "$REPO/tools/lib/signing-identity.sh" || true)"
[ -z "$_inline" ] && ok "no value line in lib/signing-identity.sh carries an inline comment (it would be hashed)" || bad "an inline comment on a value line in lib/signing-identity.sh would force a pkg rebuild: $_inline"
_retired="864QZ""69GF2"; _retired_name="Stone Syndicate"" LLC"; _retired_key="43F2HU""5BT8"; _retired_iss="69a6de7f-a03e-47e3-""e053-5b8c7c11a4d1"
_ret_hits="$(grep -rlIF --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.claude -e "$_retired" -e "$_retired_name" -e "$_retired_key" -e "$_retired_iss" "$REPO" | grep -v '/tools/lib/signing-identity.sh$' || true)"
[ -z "$_ret_hits" ] && ok "the Stone Syndicate team id, name and notary key appear nowhere but the lib, tests included" || bad "the Stone Syndicate team id is named outside lib/signing-identity.sh: $_ret_hits"
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

# --- #3647: the Installer identity and the notary key are probed after a good app test-sign ---
out="$(KOSMOS_SECURITY_BIN=sec_noinst run cs_ok)"; rc=$?
case "$rc:$out" in 1:*"Developer ID Installer identity"*"NOT in this session"*) ok "#3647: a box without the Installer identity refuses at 1c" ;; *) bad "#3647: a missing Installer identity did not refuse (rc=$rc): $out" ;; esac
out="$(KOSMOS_SECRETS_MAP_BIN=sm_none run cs_ok)"; rc=$?
case "$rc:$out" in 1:*"notary key"*"does not resolve"*) ok "#3647: a box without the notary key refuses at 1c" ;; *) bad "#3647: a missing notary key did not refuse (rc=$rc): $out" ;; esac
out="$(run cs_ok)"; rc=$?
case "$rc:$out" in 0:*"Installer identity PASSED THROUGH KOSMOS_SECURITY_BIN"*"not probed"*"notary key PASSED THROUGH KOSMOS_SECRETS_MAP_BIN"*"not probed"*) ok "#3647 CONTROL: with both present it passes, and says the seams did NOT probe anything real" ;; *) bad "#3647 control: both present did not pass with the not-probed wording (rc=$rc): $out" ;; esac
# The override is what is probed: with the identity listed by HASH ONLY (no name), the matching
# SHA-1 passes and a wrong one refuses, so neither result can come from the default name.
out="$(KOSMOS_SECURITY_BIN=sec_hashonly KOSMOS_INSTALLER_CERT=0123ABCDEF run cs_ok)"; rc=$?
[ "$rc" = 0 ] && ok "#3647: KOSMOS_INSTALLER_CERT (a SHA-1) is the Installer identity probed" || bad "#3647: a SHA-1 KOSMOS_INSTALLER_CERT was not honoured (rc=$rc): $out"
out="$(KOSMOS_SECURITY_BIN=sec_hashonly KOSMOS_INSTALLER_CERT=FFFFFFFFFF run cs_ok)"; rc=$?
[ "$rc" = 1 ] && ok "#3647 CONTROL: a wrong SHA-1 override refuses (the default name is not what matched)" || bad "#3647: a wrong KOSMOS_INSTALLER_CERT passed (rc=$rc): $out"
# The notary path must be a READABLE file, not just any string the accessor prints.
out="$(KOSMOS_SECRETS_MAP_BIN=sm_badpath run cs_ok)"; rc=$?
case "$rc:$out" in 1:*"does not resolve to a readable file"*"no-such-notary.p8"*) ok "#3647: a notary path that is not a readable file refuses" ;; *) bad "#3647: an unreadable notary path passed (rc=$rc): $out" ;; esac
out="$(KOSMOS_SECRETS_MAP_BIN=sm_dir run cs_ok)"; rc=$?
case "$rc:$out" in 1:*"does not resolve to a readable file"*) ok "#3647: a notary path that is a directory refuses" ;; *) bad "#3647: a directory passed as the notary key (rc=$rc): $out" ;; esac
out="$(KOSMOS_SECURITY_BIN=sec_noinst KOSMOS_SECRETS_MAP_BIN=sm_none run cs_ok)"; rc=$?
case "$rc:$out" in 1:*"Installer identity"*"NOT in this session"*"notary key"*"does not resolve"*"no credential for target"*) ok "#3647: a box missing both is told about both, with the accessor's own words" ;; *) bad "#3647: missing both did not report both (rc=$rc): $out" ;; esac
out="$(KOSMOS_SECURITY_BIN=sec_broken run cs_ok)"; rc=$?
case "$rc:$out" in 1:*"find-identity -v' FAILED (rc=1)"*"boom"*) ok "#3647: a failing security command is reported as a failure, with its own error" ;; *) bad "#3647: a failing security command was misreported (rc=$rc): $out" ;; esac
case "$out" in *"NOT in this session"*) bad "#3647: a failing security command claimed the identity is absent: $out" ;; *) ok "#3647: a failing security command does not claim the identity is absent" ;; esac

echo "cut-sign-preflight: $passes passed, $fails failed"
[ "$fails" = 0 ] && [ "$passes" -ge 38 ] || { echo "FAILED (or fewer arms ran than expected)"; exit 1; }
