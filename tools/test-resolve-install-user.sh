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

# --- ARM 6: ambiguous -- >1 accounts running Installer AND no usable console --
# count>1 now falls back to the console user (ARM 6b), but here console=loginwindow
# (no real console user), so it refuses -- the one genuine refusal in the
# ambiguous case.
STUB_CONSOLE="loginwindow"; STUB_OWNERS=$'bob\ncarol'; STUB_SESSIONS="502 503"
run; r="$RUN_RESULT"
[ "$r" = "<refused>" ] && pass "ambiguous+no-console: refuses when >1 accounts drive Installer and there is no usable console user" \
  || fail "ambiguous+no-console: expected refusal, got '$r'"
has "$RIU_REASON" "accounts are running Installer" && pass "  and says it is ambiguous" \
  || fail "  and says it is ambiguous: $RIU_REASON"
{ has "$RIU_REASON" "bob" && has "$RIU_REASON" "carol"; } && pass "  and names both candidates" \
  || fail "  and names both candidates: $RIU_REASON"

# --- ARM 6b: ambiguous, but a real console user is present -> FALL BACK to it.
# Splinter product call (2026-09-15): fall back rather than refuse, even on this
# arm-A ambiguity -- a refused investor install is the worse failure. With two
# Installer owners and no clean single invoker, candidate 2 resolves to the
# physical console user (bob). ACCEPTED, reversible residual (#2511): this can
# install for the console holder rather than a specific non-console invoker.
STUB_CONSOLE="bob"; STUB_OWNERS=$'bob\ncarol'; STUB_SESSIONS="502 503"
run; r="$RUN_RESULT"
[ "$r" = "bob" ] && [ "$INSTALL_UID" = 502 ] \
  && pass "ambiguous+console: >1 Installer owners falls back to the real console user (bob), not refuse" \
  || fail "ambiguous+console: expected bob/502, got '$r'/'${INSTALL_UID:-}'"

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

# --- #3108 GUARD: owner_count>1 does NOT prefer a session-backed owner -------
# kosmos#3108 asked whether, in the multi-account (owner_count>1) case, the
# resolver should prefer a specific non-console invoker (an owner with an "active
# session") over the console fallback. Decided WON'T-FIX (won't-fix analysis on
# the #3108 card): the package script runs as root under installd DETACHED from
# Installer.app, so there is no reliable root-context signal for which owner
# invoked THIS install. The only non-console signal (_riu_has_gui_session /
# launchctl print gui/<uid>) FALSE-NEGATIVES from that context (#2511), and as a
# PICKER that asymmetry can install into a bystander owner's home (reopening the
# #1880 silent-misinstall) or convert an honest refuse into a wrong-home install.
# So the safe behavior is: owner_count>1 IGNORES sessions and falls back to the
# console user (or refuses when there is no usable console).
#
# These arms are the CONTROL THAT RETURNS THE DANGEROUS ANSWER. Arms (1) and (3)
# are the sharp discriminators: each goes RED if a future edit re-adds "signal
# (b)" (prefer the lone session-backed owner over the console fallback), because
# each has exactly one session-backed owner for signal (b) to wrongly pick. Arm
# (2) has TWO session-backed owners, so signal (b) itself would still fall back to
# console there; arm (2) instead guards a cruder reintroduction that guesses among
# multiple session-backed owners. They touch NO resolver logic -- only the same
# stubbed sensors every arm above uses -- so this guard is additive and off the P0
# install path.

# (1) owner_count>1, exactly ONE non-console owner has a session, console usable.
# Must fall back to the console user (alice), NOT prefer the lone session-owner
# (bob). This is the sharp discriminator: signal (b) would pick bob here.
STUB_CONSOLE="alice"; STUB_OWNERS=$'bob\ncarol'; STUB_SESSIONS="502"
run; r="$RUN_RESULT"
[ "$r" = "alice" ] && [ "$INSTALL_UID" = 501 ] \
  && pass "#3108 guard: owner_count>1 with ONE session-backed non-console owner still falls back to the console user (alice), never prefers the session-owner (bob)" \
  || fail "#3108 guard: expected alice/501 (console fallback, no signal-b), got '$r'/'${INSTALL_UID:-}'"

# (2) owner_count>1, BOTH owners have sessions, console usable. Must fall back to
# the console user, never guess between two session-backed owners.
STUB_CONSOLE="alice"; STUB_OWNERS=$'bob\ncarol'; STUB_SESSIONS="502 503"
run; r="$RUN_RESULT"
[ "$r" = "alice" ] && [ "$INSTALL_UID" = 501 ] \
  && pass "#3108 guard: owner_count>1 with TWO session-backed owners still falls back to the console user (alice), never guesses one" \
  || fail "#3108 guard: expected alice/501, got '$r'/'${INSTALL_UID:-}'"

# (3) owner_count>1, ONE session-backed non-console owner, console=loginwindow
# (no usable console). Must REFUSE -- must NOT convert the refuse into a
# session-owner pick (that wrong-home install is the exact #1880 reopen).
STUB_CONSOLE="loginwindow"; STUB_OWNERS=$'bob\ncarol'; STUB_SESSIONS="502"
run; r="$RUN_RESULT"
[ "$r" = "<refused>" ] \
  && pass "#3108 guard: owner_count>1 + session-backed owner + no usable console still REFUSES, never picks the session-owner (no refuse-to-wrong-home conversion)" \
  || fail "#3108 guard: expected refusal, got '$r'"
# self-contained: assert the refuse REASON is the ambiguous-multi-owner one, so this
# arm does not rely on the pre-existing Arm 6 to cover the message shape.
has "$RIU_REASON" "accounts are running Installer" \
  && pass "#3108 guard: the refusal names the ambiguous multi-owner reason" \
  || fail "#3108 guard: expected the ambiguous-multi-owner refuse reason, got: $RIU_REASON"

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
