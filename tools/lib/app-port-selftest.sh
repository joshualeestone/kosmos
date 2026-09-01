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
#
# THE PREMISE CHECK (installed-cli-can-predate-the-verb): prove the flag is REAL by
# contrast. A #910-aware bundle ANSWERS the real flag (a numeric port) and does NOT
# treat a flag we KNOW is fake the same way. A bundle predating #910 knows NEITHER
# flag, so it starts the app for both and they behave identically. If the real flag
# and a fake flag behave the same, the bundle is behind and the section cannot test
# what it claims -- so say so and move on rather than hanging on it.

# bounded_run <secs> <cmd...>: run <cmd...> in the background and kill it after <secs>
# seconds; print its stdout; return the command's exit status, or 124 if it had to be
# killed (macOS has no `timeout`, so this is the kill-after-N shape test-install.sh
# already uses for wait_for_file). Every branch removes the temp file.
bounded_run() {
  local secs="$1"; shift
  local tmp pid waited rc
  tmp="$(mktemp)"
  "$@" >"$tmp" 2>/dev/null &
  pid=$!
  waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$secs" ]; then
      kill "$pid" 2>/dev/null
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

# A flag no kosmos-app will ever implement, used as the fake arm of the premise check.
# Long and self-describing so a grep for it lands here.
KOSMOS_APP_FAKE_SELFTEST_FLAG='--kosmos-app-port-selftest-THIS-FLAG-IS-NOT-REAL-955'

# kosmos_app_selftest_current <app> <secs>: return 0 if <app> implements
# --kosmos-app-port-selftest (a #910-aware bundle), 1 if it predates the flag (behind).
# BEHIND when: the real flag hung (124); OR the real and fake flags produced the same
# exit status AND the same output (neither is really implemented); OR the real flag did
# not answer a plain numeric port. Otherwise CURRENT.
kosmos_app_selftest_current() {
  local app="$1" secs="$2" real real_rc fake fake_rc
  real="$(bounded_run "$secs" "$app" --kosmos-app-port-selftest 501)"; real_rc=$?
  [ "$real_rc" = 124 ] && return 1                                  # the real flag hung: behind
  fake="$(bounded_run "$secs" "$app" "$KOSMOS_APP_FAKE_SELFTEST_FLAG" 501)"; fake_rc=$?
  [ "$real_rc" = "$fake_rc" ] && [ "$real" = "$fake" ] && return 1  # real and fake identical: behind
  case "$real" in '' | *[!0-9]*) return 1 ;; esac                   # real did not answer a port: behind
  return 0
}
