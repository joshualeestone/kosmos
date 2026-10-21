#!/bin/bash
# kosmos#6620 (security hardening O04-5, incident playbook e step 1): the release pointer freeze, as every tool that
# moves a release pointer reads it.
#
# While dist/POINTER_FROZEN exists in the site checkout, no tool may move a release pointer (latest.json,
# latest-staging.json, latest-win.json, latest-win-staging.json), and deploy-site.sh publishes only the frozen
# version. tools/pointer-freeze.sh writes and removes it. The file is TRACKED in the site repo, so every machine that
# cuts from a synced site checkout sees it, and its history says who froze, when and why.
#
# Fails closed: the marker existing is the freeze, whatever it holds; an unreadable marker still freezes.
#
# Usage: source this file, then
#   pointer_freeze_refuse <site> <tool>   prints why on stderr and returns 1 while frozen; returns 0 when not
#   pointer_freeze_value <site> <key>     the marker's value for mac / because / at (empty when absent)
POINTER_FREEZE_FILE=dist/POINTER_FROZEN

pointer_freeze_value() {
  sed -n "s/^$2=//p" "$1/$POINTER_FREEZE_FILE" 2>/dev/null | head -1
}

pointer_freeze_refuse() {
  local site="$1" tool="$2" mac because
  [ -e "$site/$POINTER_FREEZE_FILE" ] || return 0
  mac="$(pointer_freeze_value "$site" mac)"; because="$(pointer_freeze_value "$site" because)"
  printf '%s: the release pointers are FROZEN at %s (%s), so no pointer may move and nothing was changed. To release again, an operator runs tools/pointer-freeze.sh off first (kosmos#6620).\n' \
    "$tool" "${mac:-an unreadable marker}" "${because:-no reason recorded}" >&2
  return 1
}
