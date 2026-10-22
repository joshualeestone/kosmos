#!/bin/sh
# sh, on purpose: deploy-site.sh (#!/bin/sh) sources this, so no bashisms beyond `local` (which dash and macOS's
# bash-as-sh both accept; a strictly POSIX shell would not). test:shell's `sh -n` is a weak
# guard (macOS /bin/sh is bash in POSIX mode, and -n sees syntax only): check edits with dash too, run as well as parsed.
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
#   pointer_freeze_git <secs> <site> ...  a git network call that cannot hang (prompts off, timeouts, a hard limit)
#   pointer_freeze_fetch <site>           fetch origin/main through it, with one retry
POINTER_FREEZE_FILE=dist/POINTER_FROZEN

# The marker's value for <key>, from origin/main first (the freeze every machine sees), then HEAD, then the working tree.
pointer_freeze_value() {
  { git -C "$1" show "origin/main:$POINTER_FREEZE_FILE" 2>/dev/null || git -C "$1" show "HEAD:$POINTER_FREEZE_FILE" 2>/dev/null \
      || cat "$1/$POINTER_FREEZE_FILE" 2>/dev/null; } | sed -n "s/^$2=//p" | head -1
}

# Every git call the freeze makes over the network goes through this, so none can hang: no credential prompt, ssh in
# batch mode with a connect timeout (keeping a configured core.sshCommand), a stalled https transfer gives up, and a
# hard limit of <secs> covers what git itself does not time out (an https connect to a black hole). The limit sends
# SIGTERM to git's whole process group (its https helper too, which would otherwise hold the output open for the OS's
# own connect timeout), which git cleans up after (its ref locks), not SIGALRM, which it does not. git runs in its own
# process group, so an operator's Ctrl-C would not reach it: an INT or TERM to the wrapper is passed on the same way. Returns git's status (143 when
# the limit hit).
pointer_freeze_git() {  # <secs> <site> <git args...>
  local secs="$1" site="$2" sshc; shift 2
  # Whatever ssh the operator set is kept, in git's own order (GIT_SSH_COMMAND, core.sshCommand, GIT_SSH), with the
  # batch options added: setting GIT_SSH_COMMAND alone would silently replace a GIT_SSH wrapper.
  sshc="${GIT_SSH_COMMAND:-$(git -C "$site" config core.sshCommand 2>/dev/null || echo "${GIT_SSH:-ssh}")}"
  # The batch options are OpenSSH's: a wrapper of another kind (plink, say) would reject -o, so it is passed as set.
  case "${sshc%% *}" in ssh|*/ssh) sshc="$sshc -o BatchMode=yes -o ConnectTimeout=15" ;; esac
  GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="$sshc" \
    perl -e 'my $s = shift; my $p = fork; defined $p or exit 127; if (!$p) { setpgrp(0, 0); exec @ARGV or exit 127 }
             local $SIG{ALRM} = sub { kill "TERM", -$p }; local $SIG{INT} = $SIG{TERM} = sub { kill "TERM", -$p };
             alarm $s; waitpid $p, 0;
             exit($? & 127 ? 128 + ($? & 127) : $? >> 8)' "$secs" \
    git -C "$site" -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 "$@"
}

# A fetch of the site's origin/main through pointer_freeze_git, tried twice (two tools fetching at once in a shared
# checkout can collide on the ref lock).
pointer_freeze_fetch() {
  pointer_freeze_git 60 "$1" fetch -q origin main 2>/dev/null || { sleep 2; pointer_freeze_git 60 "$1" fetch -q origin main 2>/dev/null; }
}

# Frozen when the marker is in the working tree, committed at HEAD (a marker deleted by hand and not committed still
# freezes, because the commit is what a deploy publishes), or on origin/main as last fetched (a freeze pushed from
# another machine reaches a checkout that has not pulled).
pointer_freeze_on() {
  # Silent probes (>/dev/null too): they answer by exit status alone, and print nothing into a caller's output.
  [ -e "$1/$POINTER_FREEZE_FILE" ] || git -C "$1" cat-file -e "HEAD:$POINTER_FREEZE_FILE" >/dev/null 2>&1 \
    || git -C "$1" cat-file -e "origin/main:$POINTER_FREEZE_FILE" >/dev/null 2>&1
}

# pointer_freeze_moved <site> <freeze source> <tree>: prints the release files (every release pointer, the Windows ones
# too, and the installer pair the freeze pins) that <tree> changes since the commit in <freeze source> that froze the
# pointers: the one that ADDED the marker (`on` only ever adds it, `off` removes it), so a later commit that merely
# edits the marker cannot become the anchor and hide what moved before it. Fails (status 1, nothing printed) when
# that commit or the diff cannot be read: the caller refuses.
POINTER_FREEZE_HELD="dist/latest*.json setup setup.sha256 setup-staging setup-staging.sha256"   # pathspecs; a glob for git

# pointer_freeze_commit <site> <freeze source>: prints the commit that ADDED the marker there, or fails.
pointer_freeze_commit() {
  local fc
  fc="$(git -C "$1" log -1 --diff-filter=A --format=%H "$2" -- "$POINTER_FREEZE_FILE" 2>/dev/null)" && [ -n "$fc" ] || return 1
  printf '%s\n' "$fc"
}

pointer_freeze_moved() {
  local fc out
  fc="$(pointer_freeze_commit "$1" "$2")" || return 1
  # shellcheck disable=SC2086 # the held paths are separate pathspecs, and git expands the glob itself
  out="$(set -f; git -C "$1" diff --name-only "$fc" "$3" -- $POINTER_FREEZE_HELD 2>/dev/null)" || return 1
  [ -z "$out" ] || printf '%s\n' "$out"
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
  printf '%s: the release pointers are FROZEN at %s (%s), so the release tools may not move them and nothing was changed. To release again, an operator runs tools/pointer-freeze.sh off first; if it was lifted already, pull the site checkout (kosmos#6620).\n' \
    "$tool" "${mac:-an unreadable marker}" "${because:-no reason recorded}" >&2
  return 1
}
