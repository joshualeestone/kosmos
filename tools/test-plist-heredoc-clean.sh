#!/bin/bash
# Two plist heredocs in setup.sh are UNQUOTED (they need $(_xmlq ...) or $ver
# expanded while written), so ANY backtick pair or bare $word in a COMMENT there
# command-substitutes / expands WHILE THE PLIST IS WRITTEN. A backtick in a
# comment ran `kosmos start` on every update, mid-swap, and spliced its output
# into the plist (#666); on a fresh Mac it printed "command not found" (#667).
# This guards the whole class for BOTH heredocs: the board login-job plist, and
# the app bundle Info.plist (which #2810 added a comment to). A heredoc body may
# contain ONLY the intended $(_xmlq ...) / $ver expansions inside <string>, never
# a backtick, and never a $ or backtick in a comment.
set -u
cd "$(dirname "$0")/.." || exit 1
f=install/setup.sh
fails=0

# Check one heredoc body for the two hazards. Sets `fails=1` on any problem.
check_heredoc() {
  local label="$1" body="$2"
  if [ -z "$body" ]; then
    echo "FAIL  could not find the $label plist heredoc in $f"; fails=1; return
  fi
  if printf '%s' "$body" | grep -q '`'; then
    echo "FAIL  the $label plist heredoc body contains a backtick -- it will command-substitute while writing the plist (#666/#667)"
    printf '%s\n' "$body" | grep -n '`' | sed 's/^/      /'
    fails=1
  else
    echo "PASS  the $label plist heredoc body has no backticks"
  fi
  # A bare $word in a COMMENT would also expand (an XML comment carrying "$HOME");
  # the intended expansions all live in <string>...</string>, never in comments.
  # Extract every comment line (multi-line <!-- ... --> handled) and flag any $.
  local _c
  _c="$(printf '%s' "$body" | awk '/<!--/{c=1} c{print} /-->/{c=0}' | grep '\$' || true)"
  if [ -n "$_c" ]; then
    echo "FAIL  a $label plist heredoc COMMENT carries a \$ that will expand:"
    printf '%s\n' "$_c" | sed 's/^/      /'
    fails=1
  else
    echo "PASS  no \$ in a $label plist heredoc comment"
  fi
}

# The board login-job plist heredoc.
board_body="$(awk '/cat > "\$_board_plist.new" <<PLIST/{p=1;next} p&&/^PLIST$/{exit} p' "$f")"
check_heredoc board "$board_body"

# The app bundle Info.plist heredoc (#2810 added the NSAppleEventsUsageDescription
# comment here; it is unquoted the same way, so it needs the same guard).
app_body="$(awk '/cat > "\$target\/Info.plist" <<PLIST/{p=1;next} p&&/^PLIST$/{exit} p' "$f")"
check_heredoc app "$app_body"

# #2955: the board watchdog login-job plist heredoc. Unquoted the same way (it
# needs $(_xmlq ...) expanded while written), so it is in the same class and gets
# the same guard.
watchdog_body="$(awk '/cat > "\$_wd_plist.new" <<PLIST/{p=1;next} p&&/^PLIST$/{exit} p' "$f")"
check_heredoc watchdog "$watchdog_body"

echo "plist-heredoc-clean: $fails failures"; [ "$fails" -eq 0 ]
