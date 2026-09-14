#!/bin/bash
# test-kosmos-addr-reclaim-3079.sh -- kosmos#3079: on "address already in use",
# reclaim (kill + relaunch over) the port ONLY when the listener is the user's OWN
# stale Kosmos build; keep the guard for another account's process or a same-uid
# non-Kosmos app.
#
# Two layers, both PURE-ish and CI-safe (no board start, no real kill of anything we
# did not spawn ourselves):
#   1. The safety-critical DECISION _kosmos_reclaim_decision(luid, myuid, iskos):
#      own-uid + Kosmos -> reclaim; every other combination -> keep. The FOREIGN-uid
#      control is the load-bearing one (a wrong "reclaim" there kills another account's
#      session) -- prove-a-check-can-fail: it MUST read "keep".
#   2. The owner-resolution port_listener_owner against a REAL listener we spawn on a
#      test port as the current user: a Kosmos-shaped command line reads is_kosmos=1,
#      a non-Kosmos one reads 0, and the uid is our own. Skips (does not fail) if no
#      listener tool (node) is available.
#
# Sources install/kosmos via its #3079 sourced-guard (BASH_SOURCE != $0 -> defines the
# functions, does NOT run a verb). Exit 0 all passed; 1 >=1 failed.

set -u
cd "$(dirname "$0")/.." || exit 1
K="install/kosmos"

# A dead, unlikely-used high test port. Set BEFORE sourcing so the CLI's PORT derives
# from it, and KOSMOS_HOME to a scratch dir so sourcing touches no real install state.
TEST_PORT=17629
export KOSMOS_PORT="$TEST_PORT"
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/kosmos-3079.XXXXXX")"
export KOSMOS_HOME="$SANDBOX/home"
mkdir -p "$KOSMOS_HOME"

PASSED=0; FAILED=0; FAILED_NAMES=()
pass() { PASSED=$((PASSED + 1)); echo "  PASS: $1"; }
fail() { FAILED=$((FAILED + 1)); FAILED_NAMES+=("$1"); echo "  FAIL: $1" >&2; }

# shellcheck source=/dev/null
source "$K"
set +e +u   # the CLI sets -euo pipefail; relax so an assertion failure does not abort

MYUID="$(id -u)"

echo "== the safety-critical reclaim DECISION =="
r="$(_kosmos_reclaim_decision "$MYUID" "$MYUID" 1)"
[ "$r" = reclaim ] && pass "own uid + Kosmos -> reclaim" || fail "own uid + Kosmos: got '$r', want reclaim"
# THE control that protects another account: a Kosmos process owned by a DIFFERENT uid
# must NEVER be reclaimed (killing it takes down that person's session).
FOREIGN=$(( MYUID + 1 ))
r="$(_kosmos_reclaim_decision "$FOREIGN" "$MYUID" 1)"
[ "$r" = keep ] && pass "FOREIGN uid + Kosmos -> keep (do not kill another account)" || fail "FOREIGN uid + Kosmos: got '$r', want keep"
r="$(_kosmos_reclaim_decision "$MYUID" "$MYUID" 0)"
[ "$r" = keep ] && pass "own uid + NON-Kosmos -> keep (do not kill an unrelated app)" || fail "own uid + non-Kosmos: got '$r', want keep"
r="$(_kosmos_reclaim_decision "" "$MYUID" 1)"
[ "$r" = keep ] && pass "unresolved uid -> keep (fail safe)" || fail "empty uid: got '$r', want keep"
r="$(_kosmos_reclaim_decision "$MYUID" "" 1)"
[ "$r" = keep ] && pass "unresolved own uid -> keep (fail safe)" || fail "empty myuid: got '$r', want keep"

echo "== owner resolution against a real spawned listener =="
if command -v node >/dev/null 2>&1; then
  # A listener whose script path makes ps show "...Kosmos/app/server.js" (is_kosmos=1)
  # vs one that does not (is_kosmos=0). node runs the file at the path we choose; the
  # is_kosmos test greps the COMMAND string, so the path is what it keys on.
  spawn_listener() { # $1 = script path (created); echoes the pid
    local sp="$1"; mkdir -p "$(dirname "$sp")"
    cat > "$sp" <<JS
require('net').createServer(function(){}).listen($TEST_PORT, '127.0.0.1');
setTimeout(function(){}, 60000);
JS
    node "$sp" >/dev/null 2>&1 &
    echo "$!"
  }
  wait_listening() { local i; for i in $(seq 1 20); do port_has_listener && return 0; sleep 0.2; done; return 1; }

  KPID="$(spawn_listener "$SANDBOX/Kosmos/app/server.js")"
  if wait_listening; then
    own="$(port_listener_owner)"; rc=$?
    kpid_got="$(printf '%s' "$own" | awk '{print $1}')"
    uid_got="$(printf '%s' "$own" | awk '{print $2}')"
    kos_got="$(printf '%s' "$own" | awk '{print $3}')"
    [ "$rc" -eq 0 ] && [ "$uid_got" = "$MYUID" ] && pass "owner uid is our own ($uid_got)" || fail "owner uid: got '$uid_got' rc=$rc, want $MYUID"
    [ "$kos_got" = 1 ] && pass "a Kosmos-shaped listener reads is_kosmos=1" || fail "kosmos listener: is_kosmos='$kos_got', want 1"
    [ "$kpid_got" = "$KPID" ] && pass "owner pid matches the spawned listener ($KPID)" || fail "owner pid: got '$kpid_got', want $KPID"
    # end to end: our own Kosmos listener -> the decision says reclaim.
    r="$(_kosmos_reclaim_decision "$uid_got" "$MYUID" "$kos_got")"
    [ "$r" = reclaim ] && pass "own Kosmos listener -> decision reclaim" || fail "own Kosmos listener decision: got '$r', want reclaim"
  else
    fail "spawned Kosmos listener never bound 127.0.0.1:$TEST_PORT"
  fi
  kill "$KPID" 2>/dev/null; wait "$KPID" 2>/dev/null
  # give the port a moment to free before the second listener
  for i in $(seq 1 20); do port_has_listener || break; sleep 0.2; done

  # Arm 1: command is NOT server.js (holder.js). is_kosmos must be 0 because the command
  # is not the board entry -- NOT because of the path (SANDBOX is a mktemp "kosmos-3079.*"
  # dir, so this path DOES contain "kosmos"; the label must not claim otherwise).
  NPID="$(spawn_listener "$SANDBOX/plainapp/holder.js")"
  if wait_listening; then
    own="$(port_listener_owner)"
    kos_got="$(printf '%s' "$own" | awk '{print $3}')"
    [ "$kos_got" = 0 ] && pass "a listener whose command is not server.js reads is_kosmos=0" || fail "holder.js listener: is_kosmos='$kos_got', want 0"
    r="$(_kosmos_reclaim_decision "$MYUID" "$MYUID" "$kos_got")"
    [ "$r" = keep ] && pass "own non-server.js listener -> decision keep" || fail "own non-server.js decision: got '$r', want keep"
  else
    fail "spawned holder.js listener never bound 127.0.0.1:$TEST_PORT"
  fi
  kill "$NPID" 2>/dev/null; wait "$NPID" 2>/dev/null
  for i in $(seq 1 20); do port_has_listener || break; sleep 0.2; done

  # Arm 2: ISOLATE the Kosmos-token requirement -- a real server.js command under a path
  # with NO "kosmos" token must read is_kosmos=0. A bug that matched server.js alone
  # (ignoring the Kosmos token) would make this 1 and fail here (prove-a-check-can-fail).
  # Use a neutral temp dir; skip only if the temp root itself happens to contain "kosmos".
  NEUTRAL="$(mktemp -d "${TMPDIR:-/tmp}/plain3079.XXXXXX")"
  case "$NEUTRAL" in
    *[Kk][Oo][Ss][Mm][Oo][Ss]*) echo "  SKIP: temp root contains 'kosmos', cannot isolate the token arm" ;;
    *)
      TPID="$(spawn_listener "$NEUTRAL/app/server.js")"
      if wait_listening; then
        own="$(port_listener_owner)"
        kos_got="$(printf '%s' "$own" | awk '{print $3}')"
        [ "$kos_got" = 0 ] && pass "a server.js listener under a NON-Kosmos path reads is_kosmos=0 (token isolated)" || fail "non-kosmos-path server.js: is_kosmos='$kos_got', want 0"
      else
        fail "spawned neutral server.js listener never bound 127.0.0.1:$TEST_PORT"
      fi
      kill "$TPID" 2>/dev/null; wait "$TPID" 2>/dev/null ;;
  esac
  rm -rf "$NEUTRAL" 2>/dev/null
else
  echo "  SKIP: node not on PATH -- owner-resolution arm skipped (the pure decision above still ran)"
fi

rm -rf "$SANDBOX" 2>/dev/null

echo ""
echo "test-kosmos-addr-reclaim-3079: $PASSED passed, $FAILED failed"
if [ "$FAILED" -gt 0 ]; then
  printf 'FAILED: %s\n' "${FAILED_NAMES[*]}" >&2
  exit 1
fi
exit 0
