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
# The CONTROL proves the Aqua-session gate actually gates -- without it, those
# arms would pass vacuously.
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
has "$RIU_REASON" "no GUI Installer process was found" && pass "  and names the installer check" \
  || fail "  and names the installer check: $RIU_REASON"
has "$RIU_REASON" "no one is signed in to install for." && fail "  must NOT use the old flat message" \
  || pass "  and does not use the old flat 'no one is signed in to install for.'"

# --- ARM 6: ambiguous -- two accounts running Installer, no console tiebreak -
STUB_CONSOLE="loginwindow"; STUB_OWNERS=$'bob\ncarol'; STUB_SESSIONS="502 503"
run; r="$RUN_RESULT"
[ "$r" = "<refused>" ] && pass "ambiguous: refuses when two accounts drive Installer and no console tiebreak" \
  || fail "ambiguous: expected refusal, got '$r'"
has "$RIU_REASON" "more than one account is running Installer" && pass "  and says it is ambiguous" \
  || fail "  and says it is ambiguous: $RIU_REASON"
{ has "$RIU_REASON" "bob" && has "$RIU_REASON" "carol"; } && pass "  and names both candidates" \
  || fail "  and names both candidates: $RIU_REASON"

# --- ARM 6b: ambiguous, and the console holder being one of them does NOT
# tiebreak. Two Installer processes is genuinely ambiguous, so it refuses rather
# than guess -- picking the console holder here would reintroduce the #1880 class
# (the console holder may just have a stale Installer window open). #1880 review.
STUB_CONSOLE="bob"; STUB_OWNERS=$'bob\ncarol'; STUB_SESSIONS="502 503"
run; r="$RUN_RESULT"
[ "$r" = "<refused>" ] \
  && pass "ambiguous: even when the console holder (bob) is one of two Installer owners, it refuses rather than guess" \
  || fail "ambiguous+console: expected refusal (no tiebreak), got '$r'"
has "$RIU_REASON" "more than one account is running Installer" \
  && pass "  and still says it is ambiguous" \
  || fail "  and still says it is ambiguous: $RIU_REASON"

# --- ARM 7: Installer owner has NO session -> fall through to console -------
STUB_CONSOLE="alice"; STUB_OWNERS="bob"; STUB_SESSIONS="501"   # bob(502) has no session
run; r="$RUN_RESULT"
[ "$r" = "alice" ] \
  && pass "gui-gate: an Installer owner without an Aqua session is rejected, console (alice) used" \
  || fail "gui-gate: expected alice, got '$r'"

# --- ARM 8: root Installer owner is filtered out ---------------------------
# The CLI `installer` runs as root; only the GUI Installer.app owner should count.
STUB_CONSOLE="loginwindow"; STUB_OWNERS=$'root\nbob'; STUB_SESSIONS="502"
run; r="$RUN_RESULT"
[ "$r" = "bob" ] && pass "root-filter: a root Installer owner is ignored, bob is used" \
  || fail "root-filter: expected bob, got '$r'"

# --- CONTROL: the Aqua-session gate really gates ---------------------------
# Same as ARM 2/3 inputs but NO uid has a session. If resolution still succeeds,
# the gate is not gating and every session-dependent arm above is vacuous.
STUB_CONSOLE="alice"; STUB_OWNERS="bob"; STUB_SESSIONS=""
run; r="$RUN_RESULT"
[ "$r" = "<refused>" ] \
  && pass "CONTROL: with no Aqua session anywhere, resolution refuses -- the gate gates" \
  || fail "CONTROL: expected refusal with no sessions, got '$r' (gate is not gating; session arms are vacuous)"

# --- owner-parse coverage: the real awk parse of `ps` output ---------------
# Arms above override _riu_installer_owners; this arm exercises the SHIPPED parse
# by overriding only the raw `ps` sensor, so the awk that reads real ps lines is
# actually run.
unset -f _riu_installer_owners 2>/dev/null
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

if [ "$fails" -ne 0 ]; then echo "$fails check(s) failed"; exit 1; fi
echo "all checks passed"
