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

  # candidate 1: the owner of the running GUI Installer -- who actually invoked
  # this install. Only when it is unambiguous (exactly one non-root owner) AND
  # that user has a real Aqua session. This is what beats /dev/console and closes
  # the silent-misinstall arm: even if the console holder is someone else, we
  # install for whoever is driving Installer.
  if [ "$_riu_owner_count" = 1 ]; then
    _riu_u="$_riu_owners"
    _riu_id="$(_riu_uid_for "$_riu_u")"
    if [ -n "$_riu_id" ] && _riu_has_gui_session "$_riu_id"; then
      INSTALL_USER="$_riu_u"; INSTALL_UID="$_riu_id"; return 0
    fi
  fi

  # candidate 2 (fallback): the physical console user -- but ONLY when there is NO
  # Installer-owner signal at all (count 0), and it is a real user with a real
  # Aqua session. If we DID detect an Installer owner and it did not resolve via
  # candidate 1 (it failed the session gate, count 1; or it was ambiguous,
  # count > 1), we have a contradictory invoker signal, so we refuse and name it
  # rather than silently redirect the install to the console holder -- who may not
  # be who invoked it. Redirecting there is the very #1880 class this fixes,
  # reached through the session-gate route instead of console divergence.
  if [ "$_riu_owner_count" -eq 0 ]; then
    case "$_riu_console" in
      ''|root|loginwindow) : ;;
      *)
        _riu_id="$(_riu_uid_for "$_riu_console")"
        if [ -n "$_riu_id" ] && _riu_has_gui_session "$_riu_id"; then
          INSTALL_USER="$_riu_console"; INSTALL_UID="$_riu_id"; return 0
        fi
        ;;
    esac
  fi

  # could not tell -- say WHICH check failed and the best guess, never the flat
  # "no one is signed in".
  case "$_riu_console" in
    ''|root|loginwindow)
      _riu_console_desc="the physical console user is '${_riu_console:-<none>}' (no one is signed in at the screen)" ;;
    *)
      # Say the ACCURATE reason. This branch is reached both when the console
      # user has no session (the count==0 fallback that failed its gate) AND when
      # it DOES have a session but is simply not who invoked the install (count>=1
      # refusals, where candidate 2 never ran). Claiming "no session" in the
      # latter would tell a signed-in operator they are not signed in -- exactly
      # the wrong thing to tell the #1880 machine owner. So check the session.
      _riu_cid="$(_riu_uid_for "$_riu_console")"
      if [ -n "$_riu_cid" ] && _riu_has_gui_session "$_riu_cid"; then
        _riu_console_desc="the physical console user is '$_riu_console', but that is not the account driving this install"
      else
        _riu_console_desc="the physical console user is '$_riu_console', which has no active window session to install into"
      fi ;;
  esac
  if [ "$_riu_owner_count" -gt 1 ]; then
    _riu_own_desc="more than one account is running Installer ($(printf '%s' "$_riu_owners" | /usr/bin/paste -sd, -)), so it is ambiguous who to install for"
  elif [ "$_riu_owner_count" = 1 ]; then
    _riu_own_desc="a GUI Installer is running as '$_riu_owners', but that account has no active window session to install into"
  else
    _riu_own_desc="no GUI Installer process was found to attribute the install to"
  fi
  RIU_REASON="Kosmos: could not tell which signed-in user to install for.
  - $_riu_console_desc
  - $_riu_own_desc
Sign in to the Mac at its own screen (a full login, not only Screen Sharing or the login window), then open this installer again."
  return 1
}
