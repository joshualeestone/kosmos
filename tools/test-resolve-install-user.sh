#!/bin/bash
# resolve_install_user (kosmos#1880) picks the user who INVOKED the install, not
# the physical-console holder, and refuses with a specific reason when it cannot
# tell. Every arm is driven by overriding the resolver's sensor functions, so
# the code under test is the code that ships (install/pkg-scripts/resolve-install-user.sh),
# not a rewrite.
#
# The two arms that matter most are the ones the old /dev/console guard got wrong:
#   - FALSE REFUSAL: console is loginwindow but someone drove Installer -> resolve.
#   - SILENT MISINSTALL: console holder A is signed in, but B drove Installer ->
#     the old guard installed for A; the fix installs for B.
# #2511: the hard Aqua-session gate was REMOVED (launchctl print gui/<uid>
# false-negatives from the installd/root context). So the CONTROL is now the
# genuine no-user case (no owner + console=loginwindow -> still refuses), proving
# the fix is not "always resolve"; STUB_SESSIONS is kept but no longer gates.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
LIB="$REPO/install/pkg-scripts/resolve-install-user.sh"
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
has()  { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

[ -f "$LIB" ] || { echo "FAIL  resolver not found at $LIB"; exit 1; }
# shellcheck disable=SC1090
. "$LIB"
pass "sourced the shipped resolver"

# --- stubbed sensors -------------------------------------------------------
# The test drives four inputs: the console user, the set of Installer-process
# owners, the uid map, and which uids have a live Aqua session.
STUB_CONSOLE=""
STUB_OWNERS=""      # newline-separated usernames
STUB_SESSIONS=""    # space-separated uids that "have a GUI session"

_riu_console_user()    { printf '%s\n' "$STUB_CONSOLE"; }
_riu_installer_owners() { printf '%s\n' "$STUB_OWNERS" | /usr/bin/grep -v '^$' | /usr/bin/sort -u; }
_riu_uid_for() {
  case "$1" in
    alice) echo 501;; bob) echo 502;; carol) echo 503;; josh) echo 504;;
    *) echo "";;
  esac
}
_riu_has_gui_session() { case " $STUB_SESSIONS " in *" $1 "*) return 0;; *) return 1;; esac; }

# helper: run the resolver IN THIS SHELL (not a subshell, so INSTALL_USER /
# INSTALL_UID / RIU_REASON propagate) and set RUN_RESULT to the user or "<refused>".
RUN_RESULT=""
run() {
  if resolve_install_user; then RUN_RESULT="$INSTALL_USER"; else RUN_RESULT="<refused>"; fi
}

# --- ARM 1: ordinary single-user Mac ---------------------------------------
STUB_CONSOLE="alice"; STUB_OWNERS="alice"; STUB_SESSIONS="501"
run; r="$RUN_RESULT"
[ "$r" = "alice" ] && [ "$INSTALL_UID" = 501 ] \
  && pass "single user: installs for the one who is signed in and driving" \
  || fail "single user: expected alice/501, got '$r'/'${INSTALL_UID:-}'"

# --- ARM 2: FALSE REFUSAL the old guard produced ---------------------------
# Console shows loginwindow (physical screen at login / screen-shared), but josh
# is driving Installer in his own session. Old guard: "no one is signed in".
STUB_CONSOLE="loginwindow"; STUB_OWNERS="josh"; STUB_SESSIONS="504"
run; r="$RUN_RESULT"
[ "$r" = "josh" ] && [ "$INSTALL_UID" = 504 ] \
  && pass "false-refusal arm: console=loginwindow but the Installer owner (josh) is used" \
  || fail "false-refusal arm: expected josh/504, got '$r'/'${INSTALL_UID:-}'"

# --- ARM 3: SILENT MISINSTALL the old guard risked -------------------------
# alice holds the physical console (session), but BOB double-clicked Installer
# from his own session. Old guard installed for alice; the fix installs for bob.
STUB_CONSOLE="alice"; STUB_OWNERS="bob"; STUB_SESSIONS="501 502"
run; r="$RUN_RESULT"
[ "$r" = "bob" ] && [ "$INSTALL_UID" = 502 ] \
  && pass "misinstall arm: installs for the Installer owner (bob), NOT the console holder (alice)" \
  || fail "misinstall arm: expected bob/502, got '$r'/'${INSTALL_UID:-}'"

# --- ARM 4: console fallback (no Installer process visible) -----------------
# e.g. the GUI process is not matchable; the console user is real and has a
# session, so fall back to it.
STUB_CONSOLE="alice"; STUB_OWNERS=""; STUB_SESSIONS="501"
run; r="$RUN_RESULT"
[ "$r" = "alice" ] && pass "fallback: no Installer owner -> the console user (with a session) is used" \
  || fail "fallback: expected alice, got '$r'"

# --- ARM 5: genuine nobody -------------------------------------------------
STUB_CONSOLE="loginwindow"; STUB_OWNERS=""; STUB_SESSIONS=""
run; r="$RUN_RESULT"
[ "$r" = "<refused>" ] && pass "nobody: refuses when no owner and no usable console user" \
  || fail "nobody: expected refusal, got '$r'"
has "$RIU_REASON" "no one is signed in at the screen" && pass "  and names the console check" \
  || fail "  and names the console check: $RIU_REASON"
has "$RIU_REASON" "no GUI Installer owner was found" && pass "  and names the installer check" \
  || fail "  and names the installer check: $RIU_REASON"
has "$RIU_REASON" "no one is signed in to install for." && fail "  must NOT use the old flat message" \
  || pass "  and does not use the old flat 'no one is signed in to install for.'"

# --- ARM 5b: a REAL console name that fails its uid lookup -> refuse, but the
# message must NOT say "no one is signed in at the screen" (a named console user
# is signed in; its uid just didn't resolve). #2511 review: the refuse-reason
# collapse must not produce a self-contradictory string.
STUB_CONSOLE="ghost"; STUB_OWNERS=""; STUB_SESSIONS=""   # "ghost" has no uid in the stub
run; r="$RUN_RESULT"
[ "$r" = "<refused>" ] && pass "uid-fail: refuses when the console name has no resolvable uid and no owner" \
  || fail "uid-fail: expected refusal, got '$r'"
has "$RIU_REASON" "could not be resolved to a usable account" \
  && pass "  and describes the named-but-unresolvable console user accurately" \
  || fail "  and describes it accurately: $RIU_REASON"
has "$RIU_REASON" "'ghost' (no one is signed in at the screen)" \
  && fail "  must NOT tell a named console user 'no one is signed in'" \
  || pass "  and does NOT contradict itself with 'no one is signed in'"

# --- ARM 6: #3111 -- >1 accounts running Installer (a genuine multi-account
# ambiguity) REFUSES rather than falling back to a console holder who may not be
# the invoker. Here there is no usable console user either (console=loginwindow).
STUB_CONSOLE="loginwindow"; STUB_OWNERS=$'bob\ncarol'; STUB_SESSIONS="502 503"
run; r="$RUN_RESULT"
[ "$r" = "<refused>" ] && pass "ambiguous+no-console (#3111): refuses when >1 accounts drive Installer" \
  || fail "ambiguous+no-console: expected refusal, got '$r'"
has "$RIU_REASON" "more than one account is running the installer" && pass "  and says it is ambiguous" \
  || fail "  and says it is ambiguous: $RIU_REASON"
{ has "$RIU_REASON" "bob" && has "$RIU_REASON" "carol"; } && pass "  and names both candidates" \
  || fail "  and names both candidates: $RIU_REASON"

# --- ARM 6b: #3111 KEY PROTECTION -- same count>1 ambiguity, but now a real
# console user (bob) IS present. #2511's P0 fell back to bob here (its accepted,
# reversible residual). #3111 REVERSES that half: on a genuine multi-account
# ambiguity we REFUSE rather than silently install for the console holder, who may
# not be who invoked THIS install (the #1880 wrong-user class). So this must refuse
# and must NOT resolve to bob -- proving count>1 refuses EVEN WHEN a console
# fallback was available. count==0 and count==1 "investors must install" behavior
# (ARMs 2, 4, 7) is unchanged.
STUB_CONSOLE="bob"; STUB_OWNERS=$'bob\ncarol'; STUB_SESSIONS="502 503"
run; r="$RUN_RESULT"
[ "$r" = "<refused>" ] \
  && pass "ambiguous+console (#3111): >1 Installer owners REFUSES even with a usable console user (no wrong-user install)" \
  || fail "ambiguous+console (#3111): expected refusal, got '$r'/'${INSTALL_UID:-}'"
{ [ -z "${INSTALL_USER:-}" ] || [ "$INSTALL_USER" != "bob" ]; } \
  && pass "  and did NOT fall back to the console holder bob" \
  || fail "  and DID fall back to the console holder: INSTALL_USER='${INSTALL_USER:-}'"

# --- ARM 6c: #3111 -- THREE competing owners, to exercise the ", "-join for >2
# owners (paste -sd, - | sed 's/,/, /g'). Still refuses, and names all three.
STUB_CONSOLE="bob"; STUB_OWNERS=$'bob\ncarol\ndave'; STUB_SESSIONS="502 503 504"
run; r="$RUN_RESULT"
[ "$r" = "<refused>" ] && pass "ambiguous 3-owner (#3111): refuses with three Installer owners" \
  || fail "ambiguous 3-owner: expected refusal, got '$r'"
{ has "$RIU_REASON" "bob" && has "$RIU_REASON" "carol" && has "$RIU_REASON" "dave"; } \
  && pass "  and names all three competing accounts (join handles >2 owners)" \
  || fail "  and names all three: $RIU_REASON"

# --- ARM 7: KOSMOS#2511 -- THE OBSERVED FAILURE, now fixed. A sole GUI Installer
# owner (bob) whose Aqua-session PRINT would fail (STUB_SESSIONS empty = the
# root-context `launchctl print gui/<uid>` false-negative on macOS 26). BEFORE
# #2511 this REFUSED (Josh's "installation failed" on a fresh single-user direct
# install); AFTER, a running GUI Installer owned by bob IS proof of a live
# session, so candidate 1 resolves to bob -- the invoker -- without the print.
STUB_CONSOLE="alice"; STUB_OWNERS="bob"; STUB_SESSIONS=""   # bob(502): the print would say "no session"
run; r="$RUN_RESULT"
[ "$r" = "bob" ] && [ "$INSTALL_UID" = 502 ] \
  && pass "arm-B (#2511): a sole Installer owner resolves even when the session PRINT fails (running Installer = proof of session), and still beats the console holder" \
  || fail "arm-B (#2511): expected bob/502 (was the observed refuse), got '$r'/'${INSTALL_UID:-}'"

# --- ARM 7b: KOSMOS#2511 single-user shape -- the EXACT case Josh hit. The one
# fresh user OWNS Installer AND is the console user (one uid), and the
# root-context session print fails. Must install for that user, not refuse.
STUB_CONSOLE="alice"; STUB_OWNERS="alice"; STUB_SESSIONS=""
run; r="$RUN_RESULT"
[ "$r" = "alice" ] && [ "$INSTALL_UID" = 501 ] \
  && pass "arm-B single-user: a fresh user at the physical console installs even when the root-context session print fails" \
  || fail "arm-B single-user: expected alice/501, got '$r'/'${INSTALL_UID:-}'"

# --- ARM 8: root Installer owner is filtered out ---------------------------
# The CLI `installer` runs as root; only the GUI Installer.app owner should count.
STUB_CONSOLE="loginwindow"; STUB_OWNERS=$'root\nbob'; STUB_SESSIONS="502"
run; r="$RUN_RESULT"
[ "$r" = "bob" ] && pass "root-filter: a root Installer owner is ignored, bob is used" \
  || fail "root-filter: expected bob, got '$r'"

# --- CONTROL: the fix is NOT "always resolve" ------------------------------
# The session print is no longer a gate (#2511), so the control is now the
# genuine no-user state: NO Installer owner AND console=loginwindow (headless /
# SSH / sitting at the login screen). It must STILL refuse -- proving we did not
# turn resolve_install_user into an unconditional resolve. Sessions are present
# in the stub but no longer consulted, which is the point.
STUB_CONSOLE="loginwindow"; STUB_OWNERS=""; STUB_SESSIONS="501 502 503"
run; r="$RUN_RESULT"
[ "$r" = "<refused>" ] \
  && pass "CONTROL: headless (no owner, console=loginwindow) still refuses even with sessions present -- the fix is not 'always resolve'" \
  || fail "CONTROL: expected refusal in the headless case, got '$r'"

# --- owner-parse coverage: the real awk parse of `ps` output ---------------
# Arms above override _riu_installer_owners; this arm exercises the SHIPPED parse
# by overriding only the raw `ps` sensor, so the awk that reads real ps lines is
# actually run.
unset -f _riu_installer_owners 2>/dev/null
# NOTE: this re-source restores ALL shipped sensors (_riu_console_user,
# _riu_uid_for, _riu_has_gui_session), not just _riu_installer_owners. The arms
# below drive ONLY _riu_installer_owners (via an overridden _riu_ps), so that is
# harmless. Do NOT add a full-resolver arm (one that calls resolve_install_user /
# run) after this line: it would run against the real system sensors. Keep
# whole-resolver arms above this point.
. "$LIB"   # restore the shipped _riu_installer_owners (and re-define the others)
# re-install the non-ps stubs the parse test does not need to touch
_riu_ps() { printf '%s\n' \
  'root /usr/libexec/installd' \
  'josh /System/Library/CoreServices/Installer.app/Contents/MacOS/Installer' \
  'alice /System/Applications/Notes.app/Contents/MacOS/Notes'; }
owners="$(_riu_installer_owners)"
[ "$owners" = "josh" ] \
  && pass "parse: real awk pulls 'josh' from a CoreServices Installer path and ignores installd/Notes" \
  || fail "parse: expected 'josh', got '$owners'"
_riu_ps() { printf '%s\n' 'alice /System/Applications/Notes.app/Contents/MacOS/Notes'; }
owners="$(_riu_installer_owners)"
[ -z "$owners" ] \
  && pass "parse: no Installer line -> no owners" \
  || fail "parse: expected empty, got '$owners'"
# a third-party or rogue binary NAMED Installer, a bare basename, or even a
# user-writable path that ends in .../CoreServices/Installer.app/... is NOT the
# exact /System/Library/CoreServices Installer.app exec path -> must not match.
_riu_ps() { printf '%s\n' \
  'mallory /Applications/Installer.app/Contents/MacOS/Installer' \
  'eve /tmp/Installer' \
  'trudy /Users/trudy/CoreServices/Installer.app/Contents/MacOS/Installer' \
  'josh /System/Library/CoreServices/Installer.app/Contents/MacOS/Installer'; }
owners="$(_riu_installer_owners)"
[ "$owners" = "josh" ] \
  && pass "parse: only the exact /System/Library/CoreServices path matches; a third-party Installer.app, a bare /tmp/Installer, and a user-writable .../CoreServices/... are all ignored" \
  || fail "parse: expected only 'josh', got '$owners'"

if [ "$fails" -ne 0 ]; then echo "$fails check(s) failed"; exit 1; fi
echo "all checks passed"
