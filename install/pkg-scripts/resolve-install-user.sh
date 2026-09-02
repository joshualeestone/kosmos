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
_riu_ps() { /bin/ps -axo user=,comm= 2>/dev/null; }

# Distinct owners (one per line) of any running GUI Installer process, matched by
# the executable basename so both the full CoreServices path and a bare
# "Installer" count. The CLI `installer` binary runs as root under sudo and is
# filtered out by the resolver; the GUI Installer.app runs as the person who
# double-clicked.
_riu_installer_owners() {
  _riu_ps | /usr/bin/awk '
    {
      user = $1
      path = $2
      for (i = 3; i <= NF; i++) path = path " " $i
      n = split(path, parts, "/")
      if (parts[n] == "Installer") print user
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
  _riu_owner_count=$(printf '%s\n' "$_riu_owners" | /usr/bin/grep -c .)

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

  # candidate 2 (fallback): the physical console user, but ONLY when it is a real
  # user with a real Aqua session AND the Installer owner was not AMBIGUOUS. When
  # two accounts are BOTH running Installer we genuinely cannot tell who is
  # driving THIS install, and picking the console holder there would reintroduce
  # exactly the #1880 class -- the console holder may just have a stale Installer
  # window open while the OTHER account is the real double-clicker. So on
  # ambiguity we refuse and name both candidates, rather than guess.
  if [ "$_riu_owner_count" -le 1 ]; then
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
      _riu_console_desc="the physical console user is '$_riu_console', which has no active window session to install into" ;;
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
