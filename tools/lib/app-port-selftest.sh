#!/bin/bash
# kosmos#955: bound the #910 port selftest so a stale bundle FAILS instead of hanging.
#
# THE HANG IT FIXES: test-install.sh's #910 section calls
# `kosmos-app --kosmos-app-port-selftest <uid>` and reads its stdout. A bundle that
# PREDATES that flag does not know it, starts the app normally, and the app just sits
# there -- so the command substitution never returns and the whole gate hangs (12
# minutes, seen 2026-08-26), with no FAIL, no timeout, and the log's last line a
# section header that reads like progress. A stale dist/ (copied, not rebuilt) is the
# normal state of a worktree, so it recurs. A gate that hangs is worse than one that
# fails.

# bounded_run <secs> <cmd...>: run <cmd...> in the background and, if it is still alive
# after <secs>, kill it (macOS has no `timeout`, so this is the kill-after-N shape
# test-install.sh already uses for wait_for_file). Print the command's stdout; return
# its exit status, or 124 if it had to be killed.
#
# 🔑 IT KILLS THE PROCESS GROUP, NOT JUST THE LAUNCHER. `kosmos-app` on an unknown flag
# starts the app, which may fork; killing only the backgrounded pid would leave that
# child reparented to init and holding port 16180 (measured: a naive `kill $pid` orphaned
# a `sleep` for its full lifetime). `perl setpgrp` (macOS has no `setsid`) makes the child
# a group leader, so `kill -- -$pid` takes the whole tree with it.
#
# 🛑 BUT THE GROUP EXISTS ONLY ONCE PERL HAS RUN setpgrp (kosmos#3859). If the bound
# expires before that (a short bound on a loaded box), `kill -- -$pid` finds no group
# and does nothing, and a bare `wait` then blocks while perl carries on, calls setpgrp
# and execs a bundle that never exits: the #955 hang again. So the kill is three steps:
#   1. the group        - the normal case, takes every child;
#   2. the leader       - if there was no group yet, perl has forked nothing, so this
#                          is enough;
#   3. the group again  - covers perl reaching setpgrp and forking BETWEEN steps 1 and
#                          2: those children are in the group, and step 3 kills them.
# KOSMOS_BOUNDED_RUN_SETPGRP_DELAY (seconds) is a TEST SEAM that widens that window so
# the self-test can hit it on purpose; unset, it costs nothing.
bounded_run() {
  local secs="$1"; shift
  local tmp pid waited rc _g
  tmp="$(mktemp)"
  perl -e 'select(undef, undef, undef, $ENV{KOSMOS_BOUNDED_RUN_SETPGRP_DELAY}) if $ENV{KOSMOS_BOUNDED_RUN_SETPGRP_DELAY}; setpgrp(0,0); exec @ARGV or exit 127' "$@" >"$tmp" 2>/dev/null &
  pid=$!
  waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$secs" ]; then
      kill -- -"$pid" 2>/dev/null   # 1. the group (pgid == pid, the leader) -- takes children too
      kill "$pid" 2>/dev/null       # 2. the leader, in case setpgrp had not run yet
      kill -- -"$pid" 2>/dev/null   # 3. the group again: children forked between 1 and 2
      # 4. a bundle that traps or ignores TERM would still hang the wait below, the same
      #    #955 shape by another route (review of #3859). Give TERM a grace (10 x sleep 0.2,
      #    measured about 3.3s with the cost of each sleep), then KILL
      #    the group and the leader, which nothing can trap. The GROUP is what is
      #    watched, not the leader: a leader that dies on TERM can leave a child that
      #    ignores it, still holding the port (review 2). A pgid is not reused while
      #    any member lives, so `kill -0 -- -$pid` cannot reach a stranger's group.
      _g=0
      while { kill -0 -- -"$pid" || kill -0 "$pid"; } 2>/dev/null && [ "$_g" -lt 10 ]; do
        sleep 0.2; _g=$((_g + 1))
      done 2>/dev/null
      if { kill -0 -- -"$pid" || kill -0 "$pid"; } 2>/dev/null; then
        kill -KILL -- -"$pid" 2>/dev/null
        kill -KILL "$pid" 2>/dev/null
      fi
      wait "$pid" 2>/dev/null
      rm -f "$tmp"
      return 124
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$pid" 2>/dev/null; rc=$?
  cat "$tmp"
  rm -f "$tmp"
  return "$rc"
}

# kosmos_app_selftest_current <app> <expected-port-for-uid-501> <secs>: return 0 if <app>
# implements --kosmos-app-port-selftest (a #910-aware bundle), 1 if it predates the flag.
# CURRENT only if the flag returned FAST (exit 0, not the 124 timeout) AND answered the
# EXACT expected port for uid 501. A bundle predating the flag starts the app (hangs ->
# 124, group-killed) or exits without that value; either way it is not this answer.
#
# ⚠️ WHY NOT A FAKE-FLAG CONTRAST (installed-cli-can-predate-the-verb's usual shape):
# kosmos-app treats an UNKNOWN flag as "just run the app", so a flag known to be fake
# would START the app on a CURRENT bundle on every run -- paying the full timeout and
# orphaning a started app that holds port 16180. There is no cheap fake-flag arm for a
# binary that runs-the-app-on-unknown-flags. Verifying the KNOWN pinned answer is the
# cheaper, non-perturbing premise check, and it is strictly stronger: it proves the flag
# returns the RIGHT value, not merely that it behaves differently from a fake one.
kosmos_app_selftest_current() {
  local app="$1" want="$2" secs="$3" got rc
  got="$(bounded_run "$secs" "$app" --kosmos-app-port-selftest 501)"; rc=$?
  [ "$rc" = 0 ] && [ "$got" = "$want" ] && return 0
  return 1
}
