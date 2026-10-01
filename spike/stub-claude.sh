#!/bin/bash
# #4904 spike: a stand-in for the Claude Code CLI, so an agent can be created and answer with no login on CI.
for a in "$@"; do
  case "$a" in
    --version|-v) echo "2.1.0 (Claude Code)"; exit 0 ;;
    -p|--print) echo "ok"; exit 0 ;;
  esac
done
echo "STUB-CLAUDE ready (args: $*)"
while IFS= read -r line; do
  [ -n "$line" ] && echo "STUB-REPLY: got [$line]"
done
