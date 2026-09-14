# shellcheck shell=sh
# win-approval.sh -- the ONE place a Windows release approval (Josh's go) is recorded.
#
# Sourced by tools/promote-channel.sh (--family win) and tools/publish-kosmos-windows.sh (the
# break-glass prod publish), so both write one log, with one reference rule. POSIX sh:
# publish-kosmos-windows.sh is #!/bin/sh.
#
# An approval records a HUMAN decision; it is not a check. The approval reference points each
# logged approval back to Josh's message (a Slack message ts or permalink). The log never names
# who typed the command.

# Where approvals are logged: one line per approval (and per promote outcome).
WIN_APPROVAL_LOG="${KOSMOS_WIN_PROMOTE_LOG:-$HOME/.claude/logs/win-promote-approvals.log}"

# win_approval_ref_ok <ref>: true for a plausible Slack message ts (1789228393.821399) or
# permalink (https://x.slack.com/archives/C0/p1789228393821399?thread_ts=...&cid=C0). No spaces,
# quotes or other shell-significant characters, so the log line stays one parseable line.
win_approval_ref_ok() {
  case "$1" in
    ''|*[!A-Za-z0-9._:/?=\&%#+-]*) return 1 ;;
  esac
  return 0
}

# win_append_approval_line <line>: append one line to the approval log. Non-zero when the line
# cannot be recorded; callers REFUSE then, because an approval that is not logged was not given.
win_append_approval_line() {
  { mkdir -p "$(dirname "$WIN_APPROVAL_LOG")" && printf '%s\n' "$1" >> "$WIN_APPROVAL_LOG"; } 2>/dev/null
}
