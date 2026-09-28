#!/bin/bash
# tunnel-handshake-gate.sh - kosmos#4270: a REAL tunnel handshake with the SHIPPED connector.
#
# Why: the Mac cut checks that kosmos-tunnel is current with kosmos-relay main and that it is
# signed; browser checks use fakes. So a build whose remote access is broken (ticket, dial,
# AUTH or serve) passed every gate. On 2026-09-27 Josh's remote board dropped during the
# 0.7.05 update and no tool could say whether the build was at fault. This gate runs the
# connector FROM THE BUILD against the live relay, as a Mac would, with one reserved identity.
#
#   tools/tunnel-handshake-gate.sh --tarball <staged kosmos-<v>-arm64.tar.gz> [--control-tarball <served one>]
#   tools/tunnel-handshake-gate.sh --tunnel <a kosmos-tunnel> [--control-tunnel <a known-good one>]
#
# The identity: the reserved release-gate account (release-gate@gate.invalid), enrolled ONCE
# into --state-dir (default ~/.config/kosmos-release-gate/state). Its code comes from
# `kosmos-coordinator gate-setup-code` on the coordinator box, not from email; see
# kosmos-relay deploy/release-gate.md. It is reused on every run, never piled up.
#
# One ATTEMPT, each step named on failure:
#   ticket     the connector fetches a relay ticket from the coordinator
#   dial-auth  it dials the relay, completes TLS and AUTH ("tunnel up")
#   serve      a visitor reaches https://<the gate's address>/ through the relay and gets the
#              connector's own session page (HTTP 200, the Kosmos+ page title), over TLS with the
#              gate's own certificate. Reaching the board BEHIND the page needs an admitted device
#              session and is NOT covered here.
#
# WHO IS AT FAULT is decided by a CONTROL, not by reading log sentences. A failed attempt alone
# cannot tell a broken build from a coordinator mid-deploy (its Caddy answers 502), a relay
# restart the connector's backoff has not yet retried past, a dropped network, or an identity the
# coordinator no longer knows. So when the candidate fails:
#   1. the CONTROL connector (the build users are served now) runs the same attempt with the same
#      identity. If it fails too, the environment or the identity is at fault: CANNOT TELL (2).
#   2. if the control passes, the candidate runs again. Passing now means the first failure was
#      the environment: PASS. Failing again, with the environment proven good between its two
#      attempts, is the build: FAIL (1).
# With no control connector a candidate failure is CANNOT TELL (2): nothing separates the causes.
#
# Exit: 0 pass; 1 FAIL (the build is broken: never forceable); 2 CANNOT TELL (hold; forceable
# only after a hand check). Same convention as the #2063 experience gate in promote-channel.sh.
# A staged tarball WITHOUT a connector is the build's defect (every Mac on it would lose remote
# access), so it is FAIL; a tarball that does not exist is a wrong invocation, CANNOT TELL.
#
# Overrides (for a local proof against a dev relay and coordinator; defaults are the live ones):
#   --state-dir DIR --coordinator URL --relay HOST:PORT --relay-ca FILE
#   --visit-resolve HOST:PORT:IP (curl --resolve) --visitor-ca FILE --timeout SECS (per attempt)
set -u

TUNNEL=""; TARBALL=""; CTUNNEL=""; CTARBALL=""
STATE="${KOSMOS_RELEASE_GATE_STATE:-$HOME/.config/kosmos-release-gate/state}"
COORD="https://login.kosmosplus.com"
RELAY="relay.kosmosplus.com:8443"
RELAY_CA=""; RESOLVE=""; VISITOR_CA=""; TIMEOUT=45

while [ $# -gt 0 ]; do
  case "$1" in
    --tunnel) TUNNEL="${2:-}"; shift 2 ;;
    --tarball) TARBALL="${2:-}"; shift 2 ;;
    --control-tunnel) CTUNNEL="${2:-}"; shift 2 ;;
    --control-tarball) CTARBALL="${2:-}"; shift 2 ;;
    --state-dir) STATE="${2:-}"; shift 2 ;;
    --coordinator) COORD="${2:-}"; shift 2 ;;
    --relay) RELAY="${2:-}"; shift 2 ;;
    --relay-ca) RELAY_CA="${2:-}"; shift 2 ;;
    --visit-resolve) RESOLVE="${2:-}"; shift 2 ;;
    --visitor-ca) VISITOR_CA="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT="${2:-}"; shift 2 ;;
    *) echo "tunnel-gate: unknown argument: $1" >&2; exit 2 ;;
  esac
done

say() { echo "tunnel-gate: $*"; }
cannot() { say "CANNOT TELL: $*"; exit 2; }
fail() { say "FAIL at $1: $2"; exit 1; }

[ -n "$TUNNEL" ] || [ -n "$TARBALL" ] || cannot "no --tarball or --tunnel (pass the staged build)"
[ -n "$TUNNEL" ] && [ -n "$TARBALL" ] && cannot "pass --tarball OR --tunnel, not both"
[ -n "$CTUNNEL" ] && [ -n "$CTARBALL" ] && cannot "pass --control-tarball OR --control-tunnel, not both"
STATE="${STATE%/}"
for f in mac_id mac_key address tls.crt tls.key coordinator_pubkey; do
  [ -s "$STATE/$f" ] || cannot "no enrolled gate identity in $STATE (missing $f). Enrol it once: kosmos-relay deploy/release-gate.md"
done
ADDRESS="$(tr -d ' \n' < "$STATE/address")"
case "$ADDRESS" in *[!A-Za-z0-9.-]*|'') cannot "the gate's address is not a hostname: '$ADDRESS'" ;; esac
case "$TIMEOUT" in *[!0-9]*|'') cannot "--timeout is not a number of seconds: $TIMEOUT" ;; esac
if [ -n "$RESOLVE" ]; then
  # HOST:PORT:IP -> https://HOST:PORT/ (a local proof); the HOST must be the gate's own address.
  rhost="${RESOLVE%%:*}"; rport="$(printf '%s' "$RESOLVE" | cut -d: -f2)"
  [ "$rhost" = "$ADDRESS" ] || cannot "--visit-resolve names $rhost, but the gate's address is $ADDRESS"
  URL="https://$rhost:$rport/"
else
  URL="https://$ADDRESS/"
fi

# One gate at a time per identity. mkdir is atomic, so two gates started together cannot both
# pass (a pgrep alone is check-then-act). A lock whose owner is dead (a SIGKILLed run) is taken over.
LOCK="$STATE.gate-lock"
OWN_LOCK=0
if ! mkdir "$LOCK" 2>/dev/null; then
  holder="$(cat "$LOCK/pid" 2>/dev/null)"
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then
    cannot "another gate run holds this identity (pid $holder, lock $LOCK)"
  fi
  rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null || cannot "could not take the lock $LOCK"
fi
echo $$ > "$LOCK/pid"; OWN_LOCK=1

WORK=""; PID=""
stop_connector() {
  [ -n "$PID" ] || return 0
  # In one redirected block: bash reports a signalled background job ("Terminated: 15")
  # on stderr, which is noise here, not a finding. Bounded: TERM, 5 s, KILL.
  {
    kill "$PID"
    i=0; while kill -0 "$PID" && [ "$i" -lt 10 ]; do sleep 0.5; i=$((i + 1)); done
    kill -0 "$PID" && kill -9 "$PID"
    wait "$PID"
  } 2>/dev/null
  PID=""
}
cleanup() {
  stop_connector
  [ -n "$WORK" ] && rm -rf "$WORK"
  [ "$OWN_LOCK" = 1 ] && rm -rf "$LOCK"
}
trap cleanup EXIT

# Another connector already running with the gate's identity would take the address back on its
# next reconnect and could answer the visit for THIS build: a false PASS. Two shapes: a connector
# left by a SIGKILLed earlier gate (its copy under a tunnel-gate.* temp dir), and one started by
# hand on the enrolled state dir itself. The state path is escaped for the regex.
state_re="$(printf '%s' "$STATE" | sed 's/[][\.*^$+?(){}|]/\\&/g')"
stale="$(pgrep -f "run --state-dir ([^ ]*/tunnel-gate\\.[A-Za-z0-9]+/|$state_re/?( |\$))" 2>/dev/null | tr '\n' ' ')"
[ -n "$stale" ] && cannot "another connector with the gate's identity is still running (pid ${stale% }); stop it first"

# A fast hold when the coordinator or relay is plainly down. The coordinator counts only on a 2xx
# from /v1/meta: its Caddy answers 502 while the coordinator is down or mid-deploy. (-k: this asks
# only whether it ANSWERS; the connector does the trusted TLS itself.) The control, not this
# probe, is what decides fault; this only saves a run that could not tell anything.
code="$(curl -s -k -o /dev/null -w '%{http_code}' --max-time 10 "$COORD/v1/meta" 2>/dev/null)"
case "$code" in 2??) ;; *) cannot "the coordinator ($COORD) is not answering (/v1/meta gave '${code:-nothing}'), so this run says nothing about the build" ;; esac
nc -z -G 5 -w 5 "${RELAY%:*}" "${RELAY##*:}" >/dev/null 2>&1 \
  || cannot "the relay ($RELAY) is not reachable from here, so this run says nothing about the build"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/tunnel-gate.XXXXXX")" || cannot "no temp dir"

# Only the connector, into the gate's own temp dir: the bytes being judged, nothing else.
# Prints the path; returns 1 when the file does not exist, 3 when it has no connector.
from_tarball() {
  [ -f "$1" ] || return 1
  mkdir -p "$WORK/$2"
  tar -xzf "$1" -C "$WORK/$2" app/bin/kosmos-tunnel 2>/dev/null || true
  [ -x "$WORK/$2/app/bin/kosmos-tunnel" ] || return 3
  printf '%s' "$WORK/$2/app/bin/kosmos-tunnel"
}
if [ -n "$TARBALL" ]; then
  TUNNEL="$(from_tarball "$TARBALL" cand)"; rc=$?
  [ "$rc" = 1 ] && cannot "no such tarball: $TARBALL"
  [ "$rc" = 3 ] && fail build "$TARBALL has no executable app/bin/kosmos-tunnel: every Mac on this build would have no remote access"
fi
[ -x "$TUNNEL" ] || cannot "the connector is not an executable file: $TUNNEL"
CONTROL_NOTE=""
if [ -n "$CTARBALL" ]; then
  CTUNNEL="$(from_tarball "$CTARBALL" ctl)" || { CONTROL_NOTE="the control tarball $CTARBALL gave no connector"; CTUNNEL=""; }
elif [ -n "$CTUNNEL" ] && [ ! -x "$CTUNNEL" ]; then
  CONTROL_NOTE="the control connector is not an executable file: $CTUNNEL"; CTUNNEL=""
fi

# attempt <connector> <label>: one ticket, dial-auth, serve. Sets STEP and WHY on failure; returns
# 0 pass, 1 fail. Each attempt gets its OWN copy of the state dir (a run rewrites files in it:
# mac_last_signed, a renewed tls.crt/tls.key) and its connector is stopped before it returns.
N=0; STEP=""; WHY=""; LAST_LOG=""; LAST_STATE=""
attempt() {
  N=$((N + 1))
  local st="$WORK/a$N/state" log="$WORK/a$N/connector.log"
  mkdir -p "$WORK/a$N"
  cp -R "$STATE" "$st" || { STEP=setup; WHY="could not copy the state dir"; return 1; }
  chmod 700 "$st"
  LAST_LOG="$log"; LAST_STATE="$st"
  local args=(run --state-dir "$st" --coordinator "$COORD" --relay "$RELAY" --local 127.0.0.1:9)
  [ -n "$RELAY_CA" ] && args+=(--tunnel-ca "$RELAY_CA")
  say "attempt $N ($2): connector $(shasum -a 256 "$1" | cut -c1-12) -> coordinator $COORD, relay $RELAY, as $ADDRESS"
  "$1" "${args[@]}" > "$log" 2>&1 &
  PID=$!
  local deadline=$(( $(date +%s) + TIMEOUT )) plain ended
  while :; do
    plain="$(sed 's/\x1b\[[0-9;]*m//g' "$log" 2>/dev/null)"
    printf '%s' "$plain" | grep -q 'tunnel up' && break
    if ! kill -0 "$PID" 2>/dev/null; then
      STEP=dial-auth; WHY="the connector exited before the tunnel came up"; stop_connector; return 1
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      # The connector retries on its own backoff; the LAST ended session names the step.
      ended="$(printf '%s\n' "$plain" | grep 'session ended' | tail -1)"
      case "$ended" in
        '') STEP=dial-auth; WHY="no \"tunnel up\" within ${TIMEOUT}s" ;;
        *relay-ticket*) STEP=ticket; WHY="no relay ticket within ${TIMEOUT}s: ${ended#*session ended: }" ;;
        *) STEP=dial-auth; WHY="the relay session did not come up within ${TIMEOUT}s: ${ended#*session ended: }" ;;
      esac
      stop_connector; return 1
    fi
    sleep 1
  done
  say "  ok  ticket and dial-auth (tunnel up)"
  local curl_args=(-s --max-time 20 -o "$WORK/a$N/visit.html" -w '%{http_code}') vcode crc
  [ -n "$RESOLVE" ] && curl_args+=(--resolve "$RESOLVE")
  [ -n "$VISITOR_CA" ] && curl_args+=(--cacert "$VISITOR_CA")
  vcode="$(curl "${curl_args[@]}" "$URL" 2>/dev/null)"; crc=$?
  stop_connector
  if [ "$crc" -ne 0 ]; then STEP=serve; WHY="a visitor could not reach $URL (curl exit $crc)"; return 1; fi
  if [ "$vcode" != 200 ]; then STEP=serve; WHY="a visitor got HTTP $vcode from $URL, not 200"; return 1; fi
  if ! grep -q '<title>Kosmos+</title>' "$WORK/a$N/visit.html"; then
    STEP=serve; WHY="the page at $URL is not the connector's session page"; return 1
  fi
  say "  ok  serve ($URL: 200, the connector's session page)"
  return 0
}
show_log() {
  [ -f "$LAST_LOG" ] || return 0
  say "  the connector's last lines:"
  sed 's/\x1b\[[0-9;]*m//g' "$LAST_LOG" | tail -8 | sed 's/^/      /'
}

# The connector renews its certificate into its state copy when it is near expiry. Carry the pair
# back ONLY from an attempt that PASSED: the visit then proved the new pair serves (renewal runs
# before the acceptor is built, session.rs). A failed attempt's pair may be the broken build's,
# or a partial write, and must never become every later run's identity. Renamed in, key first;
# the pair is always carried together (a renewal makes a new key, setup.rs).
keep_renewed_cert() {
  local st="$LAST_STATE"
  [ -s "$st/tls.crt" ] && [ -s "$st/tls.key" ] || return 0
  cmp -s "$st/tls.crt" "$STATE/tls.crt" && return 0
  cp "$st/tls.key" "$STATE/.tls.key.gate-new" && cp "$st/tls.crt" "$STATE/.tls.crt.gate-new" \
    && chmod 600 "$STATE/.tls.key.gate-new" \
    && mv "$STATE/.tls.key.gate-new" "$STATE/tls.key" && mv "$STATE/.tls.crt.gate-new" "$STATE/tls.crt" \
    && say "kept the connector's renewed certificate in $STATE"
}
pass() { keep_renewed_cert; say "PASS${1:+ ($1)}"; exit 0; }

attempt "$TUNNEL" candidate && pass
say "  the candidate failed at $STEP: $WHY"; show_log
if [ -z "$CTUNNEL" ]; then
  cannot "the candidate failed at $STEP and there is no control connector to tell a broken build from the environment${CONTROL_NOTE:+ ($CONTROL_NOTE)}"
fi
if ! attempt "$CTUNNEL" control; then
  show_log
  cannot "the served build's connector fails too (at $STEP: $WHY), so the environment or the gate identity is at fault, not this build"
fi
keep_renewed_cert
attempt "$TUNNEL" "candidate again" && pass "on its second attempt; the first failure was the environment"
show_log
fail "$STEP" "$WHY (it failed twice, and the served build's connector passed between the two)"
