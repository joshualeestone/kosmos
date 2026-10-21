#!/bin/bash
# kosmos#6620 (security hardening O04-5, incident playbook e step 1): the release pointer freeze, as every tool that
# moves a release pointer reads it.
#
# While dist/POINTER_FROZEN exists in the site checkout, the release tools refuse to move a release pointer
# (release.sh, promote-channel.sh, publish-staging-pointer.sh, publish-kosmos-windows.sh), the site push refuses a
# frozen origin/main tip (tools/lib/site-push.sh), and deploy-site.sh publishes only the frozen Mac version. The
# Windows prod pointer is served from R2 and is pinned there by hand. tools/pointer-freeze.sh writes and removes the
# marker and pushes it: it is TRACKED in the site repo, so every machine that cuts sees it on origin/main, and its
# history says who froze, when and why.
#
# Fails closed: the marker existing is the freeze, whatever it holds (an unreadable marker still freezes), and a site
# origin that cannot be fetched refuses rather than passes (KOSMOS_POINTER_FREEZE_OFFLINE=1 decides on the checkout).
#
# Usage: source this file, then
#   pointer_freeze_refuse <site> <tool>   prints why on stderr and returns 1 while frozen; returns 0 when not
#   pointer_freeze_on <site>              0 while frozen (the marker here, at HEAD, or on origin/main as fetched)
#   pointer_freeze_value <site> <key>     the marker's value for mac / sha256 / because / at (empty when absent)
#   pointer_freeze_fetch <site>           fetch origin/main without hanging (no prompt, stall limit, one retry)
POINTER_FREEZE_FILE=dist/POINTER_FROZEN

# The marker's value for <key>, from origin/main first (the freeze every machine sees), then HEAD, then the working tree.
pointer_freeze_value() {
  { git -C "$1" show "origin/main:$POINTER_FREEZE_FILE" 2>/dev/null || git -C "$1" show "HEAD:$POINTER_FREEZE_FILE" 2>/dev/null \
      || cat "$1/$POINTER_FREEZE_FILE" 2>/dev/null; } | sed -n "s/^$2=//p" | head -1
}

# A fetch of the site's origin/main that cannot hang: no credential prompt, and a stalled transfer gives up. Tried twice
# (two tools fetching at once in a shared checkout can collide on the ref lock). Returns git's status.
pointer_freeze_fetch() {
  GIT_TERMINAL_PROMPT=0 git -C "$1" -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 fetch -q origin main 2>/dev/null \
    || { sleep 2; GIT_TERMINAL_PROMPT=0 git -C "$1" -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 fetch -q origin main 2>/dev/null; }
}

# Frozen when the marker is in the working tree, committed at HEAD (a marker deleted by hand and not committed still
# freezes, because the commit is what a deploy publishes), or on origin/main as last fetched (a freeze pushed from
# another machine reaches a checkout that has not pulled).
pointer_freeze_on() {
  [ -e "$1/$POINTER_FREEZE_FILE" ] || git -C "$1" cat-file -e "HEAD:$POINTER_FREEZE_FILE" 2>/dev/null \
    || git -C "$1" cat-file -e "origin/main:$POINTER_FREEZE_FILE" 2>/dev/null
}

pointer_freeze_refuse() {
  local site="$1" tool="$2" mac because
  # Ask origin first, so a freeze pushed from another machine stops this run before it does anything. FAILS CLOSED: a
  # site with an origin that cannot be reached is refused (nothing changed), unless the operator says to decide on
  # this checkout with KOSMOS_POINTER_FREEZE_OFFLINE=1.
  if git -C "$site" remote get-url origin >/dev/null 2>&1 && ! pointer_freeze_fetch "$site"; then
    if [ "${KOSMOS_POINTER_FREEZE_OFFLINE:-}" = 1 ]; then
      printf '%s: could not fetch the site origin; KOSMOS_POINTER_FREEZE_OFFLINE=1, so deciding on this checkout (kosmos#6620)\n' "$tool" >&2
    else
      printf '%s: could not fetch the site origin to check the pointer freeze (kosmos#6620), so nothing was changed. Try again; to decide on this checkout alone, set KOSMOS_POINTER_FREEZE_OFFLINE=1.\n' "$tool" >&2
      return 1
    fi
  fi
  pointer_freeze_on "$site" || return 0
  mac="$(pointer_freeze_value "$site" mac)"; because="$(pointer_freeze_value "$site" because)"
  printf '%s: the release pointers are FROZEN at %s (%s), so no pointer may move and nothing was changed. To release again, an operator runs tools/pointer-freeze.sh off first; if it was lifted already, pull the site checkout (kosmos#6620).\n' \
    "$tool" "${mac:-an unreadable marker}" "${because:-no reason recorded}" >&2
  return 1
}
