#!/bin/sh
# resolve-install-user.sh -- decide WHICH signed-in user to install Kosmos for.
# Sourced by install/pkg-scripts/postinstall. kosmos#1880.
#
# THE BUG THIS REPLACES. The postinstall used
#     stat -f '%Su' /dev/console
# which answers "who holds the PHYSICAL console session", NOT "who invoked this
# install". Those two diverge the moment a Mac has more than one account with a
# session -- fast user switching, a second admin account, or Screen Sharing into
# a virtual session (Josh's actual machine, kosmos#1880):
#   - the physical-console user and the installing user are different, so the old
#     guard either REFUSED a real install ("no one is signed in") or, the more
#     dangerous arm, resolved to the OTHER logged-in user and dropped privileges
#     into the wrong home folder -- a silent misinstall.
#
# WHAT ACTUALLY ANSWERS "WHO INVOKED THIS INSTALL". macOS runs package scripts as
# root under installd, DETACHED from Installer.app, so this script's own process
# ancestry walks up to installd (root), never to the person -- a literal
# walk-up-from-the-script does not reach them. The person who double-clicked is
# the owner of the running GUI *Installer* process, which stays alive (its
# progress bar) for the whole install while these scripts run. That owner,
# confirmed to hold a real Aqua GUI session, is who to install for. The console
# user is kept only as a last-resort fallback.
#
# The sensing steps are separate functions so tools/test-resolve-install-user.sh
# can override them and drive every arm -- including the two dangerous ones --
# without a real .pkg install. The thing that ships is the thing under test.

# --- sensors (overridable by the test) -------------------------------------

# Username holding the physical console session. '' / 'root' / 'loginwindow' all
# mean "no usable GUI console user".
_riu_console_user() { /usr/bin/stat -f '%Su' /dev/console 2>/dev/null; }

# Raw `ps` lines: "<user> <command-path>", one process per line. Split out as a
# sensor so the owner parse below can be exercised on canned input.
#
# `comm=` is the LAST column with its header suppressed, so BSD `ps` runs it to
# end-of-line and does not width-truncate it -- and the Installer exec path below
# is ~63 chars, far short of any width limit regardless. If a future macOS ever
# did truncate it, the anchor would simply miss, owner_count would fall to 0, and
# resolution degrades to the console fallback rather than to a wrong user; the
# plan's recommended real-multi-account install smoke is the closing check for
# this (it is the one assumption a bot session cannot exercise end-to-end).
_riu_ps() { /bin/ps -axo user=,comm= 2>/dev/null; }

# Distinct owners (one per line) of the running Apple GUI Installer. The match is
# the EXACT CoreServices Installer.app executable path
# (/System/Library/CoreServices/Installer.app/Contents/MacOS/Installer), not a
# bare basename and not a loose suffix: /System/Library/CoreServices is a
# SIP-protected system location, so a third-party or rogue binary merely NAMED
# "Installer" -- whether at /Applications/Installer.app or a user-writable
# .../CoreServices/... path -- cannot occupy it and be mistaken for the real one.
# The CLI `installer` binary runs as root under sudo and is filtered out by the
# resolver anyway; the GUI Installer.app runs as the person who double-clicked.
_riu_installer_owners() {
  _riu_ps | /usr/bin/awk '
    {
      user = $1
      path = $2
      for (i = 3; i <= NF; i++) path = path " " $i
      if (path ~ /^\/System\/Library\/CoreServices\/Installer\.app\/Contents\/MacOS\/Installer$/) print user
    }' | /usr/bin/sort -u
}

# uid for a username, or '' if unknown.
_riu_uid_for() { /usr/bin/id -u "$1" 2>/dev/null; }

# Succeeds iff the given uid has a live Aqua GUI session -- i.e. the exact
# precondition for the `launchctl asuser`/`bootstrap gui/<uid>` this postinstall
# performs downstream. This is the card's "confirm that uid really has an Aqua
# session before dropping into it".
# 🛑 #2511: NO LONGER A GATE -- advisory / tests only. resolve_install_user
# stopped hard-gating on this: `launchctl print gui/<uid>` FALSE-NEGATIVES from
# the installd/root context (it raced a freshly-logged-in user's Aqua-session
# registration and refused valid installs). A running GUI Installer owner is
# proof of a session on its own. Do NOT re-introduce this as a hard gate.
_riu_has_gui_session() { /bin/launchctl print "gui/$1" >/dev/null 2>&1; }

# --- resolver --------------------------------------------------------------
# On success: sets INSTALL_USER + INSTALL_UID, returns 0.
# On failure: sets RIU_REASON to a specific, user-facing explanation naming which
#             check failed and the best guess if any, returns 1.
#
# RESERVED NAMES: because the postinstall SOURCES this file, the names it exports
# into the caller's scope are reserved -- INSTALL_USER, INSTALL_UID, RIU_REASON,
# and every _riu_* working variable/function. There is no `local` in POSIX sh, so
# a postinstall that reuses one of these after the source would be silently
# clobbered. (No collision today; postinstall uses different names.)
resolve_install_user() {
  INSTALL_USER=""; INSTALL_UID=""; RIU_REASON=""

  _riu_console="$(_riu_console_user)"
  _riu_owners="$(_riu_installer_owners | /usr/bin/grep -v -e '^root$' -e '^$')"
  # `grep -c` exits 1 when the count is 0; the trailing `|| true` keeps that
  # normal no-owner path from aborting under a future `set -e` (today only `set
  # -u` is in force here and in the sourcing postinstall). The "0" is still
  # printed and captured either way.
  _riu_owner_count=$(printf '%s\n' "$_riu_owners" | /usr/bin/grep -c . || true)

  # candidate 1 (PREFERRED INVOKER): exactly one GUI Installer owner is the person
  # who double-clicked. Install for them -- this beats /dev/console and closes the
  # #1880 silent-misinstall arm (install for whoever DRIVES Installer, not the
  # console holder), which is owner detection and is UNCHANGED.
  #
  # 🛑 NO HARD Aqua-session GATE HERE (kosmos#2511). A running GUI Installer.app
  # owned by this user IS a live Aqua session -- you cannot double-click a .pkg
  # without one -- so the owner signal already proves the session. The old
  # `_riu_has_gui_session` gate used `launchctl print gui/<uid>`, which
  # FALSE-NEGATIVES from the installd/root context this script runs in: it refused
  # a VALID install on a FRESH single-user account installing directly at the
  # console (Josh, 2026-09-15) -- i.e. universally, not just the multi-account case
  # #1880 targeted. The downstream `launchctl asuser`/`bootstrap gui/<uid>` the
  # postinstall then performs still works; only the PRINT probe was unreliable, so
  # it is no longer a gate.
  if [ "$_riu_owner_count" -eq 1 ]; then
    _riu_u="$_riu_owners"
    _riu_id="$(_riu_uid_for "$_riu_u")"
    if [ -n "$_riu_id" ]; then
      INSTALL_USER="$_riu_u"; INSTALL_UID="$_riu_id"; return 0
    fi
  fi

  # #3111: REFUSE on a genuine multi-account ambiguity (more than one account
  # running Installer at the SAME instant) rather than falling back to the console
  # holder below. #2511's P0 relaxed candidate 2 to fall back even on count>1 so an
  # install never refuses ("investors MUST install" -- a reversible product call).
  # That fallback is safe for count==0 (nobody invoked, so the console user is the
  # only signal) but NOT for count>1: when several accounts each drive an Installer,
  # the physical-console holder may not be the one who invoked THIS install, so
  # falling back there silently installs for the WRONG user -- the exact #1880 class
  # this resolver exists to prevent, reached through console divergence. A silent
  # wrong-user install (agents in the wrong home) is worse than an honest refusal
  # with a clear next step, so on count>1 we refuse and name it.
  #
  # This does NOT reintroduce the #1880 refusal for the case Josh's ruling protects:
  # a single investor installing on their own Mac is count==1 and still resolves via
  # candidate 1 above (no session gate), and count==0 still falls back to console
  # below. count>1 requires more than one account running Installer at the same
  # instant (fast user switching, a second Screen-Sharing session) -- rare. Reverses
  # the count>1 half of #2511's console fallback (itself marked reversible);
  # count==0/count==1 unchanged.
  #
  # KNOWN EDGE (recoverable, not a lockout): _riu_installer_owners counts any process
  # on the Installer.app path, so a STALE / hung Installer left running in ANOTHER
  # account can push the count above 1 and refuse an otherwise-unambiguous single
  # investor install -- so count>1 is not ALWAYS a genuine simultaneous ambiguity. A
  # robust liveness filter is not cleanly available here: the root-context
  # `launchctl print gui/<uid>` session probe is exactly what #2511 removed as
  # unreliable. This is accepted because the refusal is RECOVERABLE (not a lockout):
  # the message tells the user to quit the other Installer -- or, if that account is
  # not reachable (a stale Installer in an account this person cannot log into), to
  # RESTART the Mac, which closes every account's Installer -- after which count==1
  # resolves. That always-available remedy is the load-bearing one: it is what makes
  # this recoverable even when the person has no access to the other account. Beats a
  # silent possibly-wrong install. A process-age filter is a future mitigation if
  # stale Installers prove common (see the plan).
  if [ "$_riu_owner_count" -gt 1 ]; then
    RIU_REASON="Kosmos: more than one account is running the installer ($(printf '%s' "$_riu_owners" | /usr/bin/paste -sd, - | /usr/bin/sed 's/,/, /g')), so Kosmos cannot tell which one to install for.
Installing for the wrong account would put your agents in the wrong account's home folder, so Kosmos did not guess.
Quit the installer in the other account(s) and open this installer again. If you cannot reach those accounts, restart the Mac -- that closes every account's installer -- then open this installer again as just the account you want."
    return 1
  fi

  # candidate 2 (FALLBACK): the physical console user, when candidate 1 did NOT
  # resolve and the ambiguity above did not refuse -- i.e. no Installer owner
  # (count 0), or the single owner (count 1) whose username did not resolve to a
  # uid. #1880 restricted this to count==0 AND hard-gated it on an unreliable
  # session print, turning a fallback into a HARD REFUSAL. Per Josh's standing
  # priority "investors MUST be able to install" (Splinter, 2026-09-15 -- a
  # reversible product call), FALL BACK rather than refuse in THESE cases, without
  # the session print. (The count>1 ambiguity is handled above, not here.)
  #
  # ACCEPTED RESIDUAL (documented, reversible): with no Installer owner at all
  # (count 0) this resolves to the console holder, which in a Screen-Sharing session
  # may not be the remote invoker. That is accepted because with no owner signal the
  # console user is the ONLY signal, and a REFUSED install is the worse failure. The
  # single-owner invoker PREFERENCE above still wins whenever it resolves.
  case "$_riu_console" in
    ''|root|loginwindow) : ;;
    *)
      _riu_id="$(_riu_uid_for "$_riu_console")"
      if [ -n "$_riu_id" ]; then
        INSTALL_USER="$_riu_console"; INSTALL_UID="$_riu_id"; return 0
      fi ;;
  esac

  # Refuse ONLY when there is genuinely nobody to install for: candidate 1 did not
  # resolve AND the console user is not a usable account. Describe WHICH accurately:
  # a login-window / no-console state is "no one is signed in", but a real console
  # NAME that merely failed its uid lookup must NOT be told "no one is signed in"
  # (it contradicts the name we just printed).
  case "$_riu_console" in
    ''|root|loginwindow)
      _riu_console_desc="the physical console user is '${_riu_console:-<none>}' (no one is signed in at the screen)" ;;
    *)
      _riu_console_desc="the physical console user is '$_riu_console', which could not be resolved to a usable account" ;;
  esac
  # #3111: count>1 refuses earlier (the multi-account ambiguity block above), so it
  # cannot reach here; only count==1 (owner whose uid did not resolve) and count==0
  # (no owner at all) fall through to this final refuse.
  if [ "$_riu_owner_count" -eq 1 ]; then
    _riu_own_desc="a GUI Installer is running as '$_riu_owners' but that username did not resolve to a uid, and there is no usable console user to fall back to"
  else
    _riu_own_desc="no GUI Installer owner was found, and there is no usable console user to fall back to"
  fi
  RIU_REASON="Kosmos: could not tell which signed-in user to install for.
  - $_riu_console_desc
  - $_riu_own_desc
Sign in to the Mac at its own screen (a full login, not only Screen Sharing or the login window), then open this installer again."
  return 1
}
