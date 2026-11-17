#!/bin/sh
# A tmux that answers READS from fixtures and swallows WRITES (#332).
#
# `/bin/echo` was the stub before, and it is a write stub only: it prints its
# arguments, which is what a test wants from `send-keys`, and it prints its
# arguments to `list-panes` too, which the parser rightly refuses. So every
# read went to the real tmux on the PATH and the suite measured the
# operator's live fleet. This answers the three reads engine/status.js and
# engine/chat.js make, from files a test can write, and behaves like echo for
# everything else so the write-side assertions keep their receipt. Four
# readers in all: status.js's list-panes, list-sessions and capture-pane, and
# the display-message that chat.js and messages.js ask.
#
#   AGENT_WORKFORCE_FAKE_PANES     file of `list-panes -a -F` lines (default: none, an empty board)
#   AGENT_WORKFORCE_FAKE_PANE_FOLDERS  file of `%id<TAB>session<TAB>folder` lines for the folder read (default: none)
#   AGENT_WORKFORCE_FAKE_SESSIONS  file of `list-sessions -F` lines (default: none)
#   AGENT_WORKFORCE_FAKE_SCREEN    file of `capture-pane` text (default: empty)
# `-u` (force UTF-8) is an option before the command, as status.js's folder read and machinecost.js send it.
[ "$1" = "-u" ] && shift
case "$1" in
  list-panes)
    # kosmos#8640: a read asking for pane_current_path gets its own file: status.js's folder read
    # (`#{pane_id}<TAB>#{session_name}<TAB>#{pane_current_path}`), and machinecost.js's PANE_LIST lands here too.
    case "$*" in
      *pane_current_path*) [ -n "$AGENT_WORKFORCE_FAKE_PANE_FOLDERS" ] && [ -f "$AGENT_WORKFORCE_FAKE_PANE_FOLDERS" ] && cat "$AGENT_WORKFORCE_FAKE_PANE_FOLDERS"; exit 0 ;;
    esac
    [ -n "$AGENT_WORKFORCE_FAKE_PANES" ] && [ -f "$AGENT_WORKFORCE_FAKE_PANES" ] && cat "$AGENT_WORKFORCE_FAKE_PANES"; exit 0 ;;
  list-sessions) [ -n "$AGENT_WORKFORCE_FAKE_SESSIONS" ] && [ -f "$AGENT_WORKFORCE_FAKE_SESSIONS" ] && cat "$AGENT_WORKFORCE_FAKE_SESSIONS"; exit 0 ;;
  capture-pane)  [ -n "$AGENT_WORKFORCE_FAKE_SCREEN" ] && [ -f "$AGENT_WORKFORCE_FAKE_SCREEN" ] && cat "$AGENT_WORKFORCE_FAKE_SCREEN"; exit 0 ;;
  display-message)
    # chat.js asks for command/claim/inMode (three fields) to verify a send;
    # messages.js asks `-p -t <pane> #{session_name}`. Answer each by its
    # format argument; anything else gets the three-field line.
    case "$*" in
      *'#{session_name}'*) printf 'fixture-discord\n' ;;
      *) printf '2.1.212\t\t0\n' ;;
    esac
    exit 0 ;;
  *) echo "$@"; exit 0 ;;
esac
