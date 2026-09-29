#!/bin/bash
# kosmos#4641: the install checks that read only files in this repo (install/setup.sh, install/kosmos,
# install/pkg-scripts/postinstall) and need no install, sandbox, port or network. Sourced by
# tools/test-install.sh, which calls each group where its checks sit in the install story (so the cut
# still runs them, step 4b), and by tools/test-install-static.sh, which runs them all in the shell suite
# on every PR (so a merge that breaks one goes red at the merge, not at the next cut: the 0.7.11 cut
# failed on a stale grep of setup.sh that no PR had run).
# The caller defines chk (label, expression) and sets HERE (the repo) and SETUP (install/setup.sh).

# #910: the per-account port formula, the hand-written copy the checks compare against.
_kosmos_expected_port() { # $1 = uid
  if [ "$1" = 501 ]; then printf '16180'; else printf '%s' "$((16180 + 1 + ($1 % 3999)))"; fi
}

# ⚠️ WHAT THIS SECTION CANNOT PROVE, NAMED RATHER THAN LEFT IMPLICIT: none of
# the port checks (install_static_port_checks, below) exercise install/kosmos's or install/setup.sh's OWN
# embedded formula against a non-primary uid -- both call `/usr/bin/id -u`
# by absolute path (deliberately, matching this repo's own style for
# security-sensitive system binaries), which cannot be safely stubbed via a
# PATH trick, and no harness here has a second real macOS account to run as.
# `_kosmos_expected_port` above is a SEPARATE, hand-written copy of the
# formula, so a bug in the real code that also happened to make its way
# into that copy would not be caught by it. What CAN be verified without a
# second real account: the two shell copies stay byte-identical to each
# other (a copy-paste drift between them would be silent otherwise, since
# every scenario in tools/test-install.sh sets KOSMOS_PORT explicitly and
# never actually reaches either fallback).
# Located by its own distinctive first line, not a hardcoded line number --
# either file gaining or losing lines elsewhere would silently point a
# line-number-based extraction at the wrong content.
_kosmos_formula_from() { # $1 = file, reads from the anchor line through PORT=
  awk '/^_kosmos_uid="\$\(\/usr\/bin\/id -u\)"$/{f=1} f{print} f&&/^PORT="\$\{KOSMOS_PORT:-\$_kosmos_default_port\}"$/{exit}' "$1"
}


# 🔑 postinstall's KOSMOS_PORT guard, EXECUTED not just diffed: unlike the
# two shell files above (byte-identical to each other so a text diff is
# meaningful), postinstall names its own variables and can't run through
# setup.sh's own `sh < "$SETUP"` pipe (it needs CONSOLE_UID resolved and a
# real console session before it would ever reach this block). Extracted
# by its own distinctive anchors and actually sourced in a subshell with
# CONSOLE_UID/KOSMOS_PORT set, so a regression in the REAL code is caught,
# not a hand-copied duplicate of it.
_postinstall_port_block() {
  awk '/^_kosmos_port_ok=0$/{f=1} f{print} f&&/^fi$/{c++; if(c==2) exit}' "$HERE/install/pkg-scripts/postinstall"
}
_postinstall_page_port() { # $1 = CONSOLE_UID, $2 = KOSMOS_PORT (may be unset/empty)
  ( CONSOLE_UID="$1"; KOSMOS_PORT="${2:-}"; eval "$(_postinstall_port_block)"; printf '%s' "$_KOSMOS_PAGE_PORT" )
}

install_static_port_checks() {
  chk "uid 501 is pinned to the literal, unchanged default" "[ \"\$(_kosmos_expected_port 501)\" = 16180 ]"
  chk "uid 1000 and uid 4999 wrap the same modulo to the identical port (1000 % 3999 = 4999 % 3999)" "[ \"\$(_kosmos_expected_port 1000)\" = \"\$(_kosmos_expected_port 4999)\" ]"
  chk "the derived alternate never lands back on the pinned primary port" "[ \"\$(_kosmos_expected_port 502)\" != 16180 ]"
  chk "install/kosmos's derivation block was found (or this check is vacuous)" "[ -n \"\$(_kosmos_formula_from \"$HERE/install/kosmos\")\" ]"
  chk "install/setup.sh's derivation block was found (or this check is vacuous)" "[ -n \"\$(_kosmos_formula_from \"$SETUP\")\" ]"
  chk "install/kosmos and install/setup.sh carry the byte-identical derivation" \
    "diff <(_kosmos_formula_from \"$HERE/install/kosmos\") <(_kosmos_formula_from \"$SETUP\") >/dev/null"
  chk "postinstall's KOSMOS_PORT guard block was found (or this check is vacuous)" "[ -n \"\$(_postinstall_port_block)\" ]"
  chk "a valid KOSMOS_PORT override is used as-is" "[ \"\$(_postinstall_page_port 502 8080)\" = 8080 ]"
  chk "the boundary value 65535 is accepted" "[ \"\$(_postinstall_page_port 502 65535)\" = 65535 ]"
  chk "an empty KOSMOS_PORT falls back to the derived default, not an error" "[ \"\$(_postinstall_page_port 502 '')\" = \"\$(_kosmos_expected_port 502)\" ]"
  chk "a non-numeric KOSMOS_PORT falls back to the derived default (best-effort, never exits)" "[ \"\$(_postinstall_page_port 502 abc)\" = \"\$(_kosmos_expected_port 502)\" ]"
  chk "a leading-zero KOSMOS_PORT falls back to the derived default" "[ \"\$(_postinstall_page_port 502 0070)\" = \"\$(_kosmos_expected_port 502)\" ]"
  chk "an over-65535 KOSMOS_PORT falls back to the derived default" "[ \"\$(_postinstall_page_port 502 70000)\" = \"\$(_kosmos_expected_port 502)\" ]"
  chk "an unset KOSMOS_PORT for uid 501 still pins the literal 16180" "[ \"\$(_postinstall_page_port 501)\" = 16180 ]"
}

install_static_update_checks() {
  chk "a connect computer's pause leaves another install's board on the port alone instead of refusing" "grep -v '^[[:space:]]*#' \"$SETUP\" | grep -B1 'it is not this install.s, and this install does not start a board here now, so it is left alone' | grep -q 'if _kosmos_mode_keeps_board_off; then'"
  chk "an update of a set-up install from before #4356 records run, so it is never asked (source; the run-it arm is below)" "sed -n '/^if \\[ \"\$FRESH_INSTALL\" = no \\] && \\[ ! -e \"\$KOSMOS_HOME\/mode\" \\]/,/^fi\$/p' \"$SETUP\" | grep -q \"printf 'run\\\\\\\\n' > \\\"\\\$KOSMOS_HOME/mode.new\""
  chk "the login-item line is held by the same decision (the sandbox never prints it)" "grep -q 'elif \\[ \"\$_kosmos_board_off\" = yes \\]; then' \"$SETUP\" && grep -q 'Kosmos will not start itself at login \$(_kosmos_off_why)' \"$SETUP\""
}

install_static_board_off_checks() {
  chk "a run that declines to start writes board.stopped itself" "grep -q ': > \"\$KOSMOS_HOME/board.stopped\" 2>/dev/null || true' \"$SETUP\""
  # #4466 added --force to this restart (an install run from an agent's pane is not the agent restarting
  # the board), so the pattern takes it as optional; the check is still that the decide comes first.
  chk "the launchd bootstrap's restart reads the choice again first" "grep -v '^[[:space:]]*#' \"$SETUP\" | grep -E -B1 'restart( --force)? >/dev/null 2>&1 [|][|] true' | grep -q '_kosmos_board_decide'"
  chk "and the restart itself is held by the board-off decision (the sandbox never reaches it)" "grep -q '\\[ \"\$_kosmos_board_off\" = yes \\] || \"\$KOSMOS_HOME/bin/kosmos\" restart' \"$SETUP\""
  chk "a marker this run wrote goes if the choice became run or both during it" "grep -v '^[[:space:]]*#' \"$SETUP\" | grep -A1 '^elif \\[ \"\$_kosmos_board_off\" = no \\] && \\[ \"\$_kosmos_wrote_marker\" = yes \\]; then' | grep -q 'rm -f \"\$KOSMOS_HOME/board.stopped\"'"
  chk "and the run ends by stopping a board that became connect during it" "grep -v '^[[:space:]]*#' \"$SETUP\" | grep -A1 '^if \\[ \"\$_kosmos_mode_word\" = connect \\] && \\[ \"\$BOARD_OURS\" = yes \\]; then' | grep -q 'kosmos\" stop'"
}

install_static_open_checks() {
  # Every observing pass substitutes the recording stub, and command -v
  # silently no-ops on an unresolvable value, so a typo in the default
  # would disable the branch's headline behavior on every real install
  # while the suite stayed green. Pin the literal and the binary.
  chk "the served file defaults to /usr/bin/open" "grep -q 'KOSMOS_OPEN_CMD:-/usr/bin/open' \"$SETUP\""
}

install_static_all() {
  install_static_port_checks
  install_static_update_checks
  install_static_board_off_checks
  install_static_open_checks
}
