#!/bin/bash
# tunnel-handshake-gate.sh - kosmos#4270: a REAL tunnel handshake with the SHIPPED connector.
#
# Why: the Mac cut checks that kosmos-tunnel is current with kosmos-relay main and that it is
# signed; browser checks use fakes. So a build whose remote access is broken (ticket, dial,
# AUTH or serve) passed every gate. On 2026-09-27 Josh's remote board dropped during the
# 0.7.05 update and no tool could say whether the build was at fault. This gate runs the
# connector FROM THE BUILD against the live relay, as a Mac would, with one reserved identity.
#
#   tools/tunnel-handshake-gate.sh --tarball <the staged kosmos-<v>-arm64.tar.gz>   (promote-channel.sh)
#   tools/tunnel-handshake-gate.sh --tunnel <an app/bin/kosmos-tunnel already extracted>
#
# The identity: the reserved release-gate account (release-gate@gate.invalid), enrolled ONCE
# into --state-dir (default ~/.config/kosmos-release-gate/state). Its code comes from
# `kosmos-coordinator gate-setup-code` on the coordinator box, not from email; see
# kosmos-relay deploy/release-gate.md. It is reused on every run, never piled up.
#
# Steps, each named on failure:
#   ticket     the connector fetches a relay ticket from the coordinator
#   dial-auth  it dials the relay, completes TLS and AUTH ("tunnel up")
#   serve      a visitor reaches https://<the gate's address>/ through the relay and gets the
#              connector's own session page (HTTP 200, the Kosmos+ page title), over TLS with the
#              gate's own certificate. Reaching the board BEHIND the page needs an admitted device
#              session and is NOT covered here.
#
# Exit: 0 pass; 1 FAIL (a step broke: a refusal, never forceable); 2 CANNOT TELL (no connector,
# no enrolled identity, or no network to the coordinator at all). Same convention as the #2063
# experience gate that promote-channel.sh runs.
#
# Overrides (for a local proof against a dev relay and coordinator; defaults are the live ones):
#   --state-dir DIR --coordinator URL --relay HOST:PORT --relay-ca FILE
#   --visit-resolve HOST:PORT:IP (curl --resolve) --visitor-ca FILE --timeout SECS
set -u

TUNNEL=""
TARBALL=""
STATE="${KOSMOS_RELEASE_GATE_STATE:-$HOME/.config/kosmos-release-gate/state}"
COORD="https://login.kosmosplus.com"
RELAY="relay.kosmosplus.com:8443"
RELAY_CA=""
RESOLVE=""
VISITOR_CA=""
TIMEOUT=45

while [ $# -gt 0 ]; do
  case "$1" in
    --tunnel) TUNNEL="${2:-}"; shift 2 ;;
    --tarball) TARBALL="${2:-}"; shift 2 ;;
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
fail() { say "FAIL at $1: $2"; [ -n "${LOG:-}" ] && [ -f "$LOG" ] && { say "the connector's last lines:"; sed 's/\x1b\[[0-9;]*m//g' "$LOG" | tail -8 | sed 's/^/    /'; }; exit 1; }

[ -n "$TUNNEL" ] || [ -n "$TARBALL" ] || cannot "no --tarball or --tunnel (pass the staged build)"
[ -n "$TUNNEL" ] && [ -n "$TARBALL" ] && cannot "pass --tarball OR --tunnel, not both"
for f in mac_id mac_key address tls.crt tls.key coordinator_pubkey; do
  [ -s "$STATE/$f" ] || cannot "no enrolled gate identity in $STATE (missing $f). Enrol it once: kosmos-relay deploy/release-gate.md"
done
ADDRESS="$(tr -d ' \n' < "$STATE/address")"
case "$ADDRESS" in *[!A-Za-z0-9.-]*|'') cannot "the gate's address is not a hostname: '$ADDRESS'" ;; esac
case "$TIMEOUT" in *[!0-9]*|'') cannot "--timeout is not a number of seconds: $TIMEOUT" ;; esac

WORK="$(mktemp -d "${TMPDIR:-/tmp}/tunnel-gate.XXXXXX")" || cannot "no temp dir"
if [ -n "$TARBALL" ]; then
  [ -f "$TARBALL" ] || { rm -rf "$WORK"; cannot "no such tarball: $TARBALL"; }
  # Only the connector, into the gate's own temp dir: the bytes being promoted, nothing else.
  tar -xzf "$TARBALL" -C "$WORK" app/bin/kosmos-tunnel 2>/dev/null || true
  TUNNEL="$WORK/app/bin/kosmos-tunnel"
  [ -x "$TUNNEL" ] || { rm -rf "$WORK"; cannot "$TARBALL has no app/bin/kosmos-tunnel"; }
fi
[ -x "$TUNNEL" ] || { rm -rf "$WORK"; cannot "the connector is not an executable file: $TUNNEL"; }
LOG="$WORK/connector.log"
PID=""
# Bounded stop (TERM, 5 s, KILL), then the temp dir. Kill only a PID that is set.
cleanup() {
  if [ -n "$PID" ]; then
    # In one redirected block: bash reports a signalled background job ("Terminated: 15")
    # on stderr, which is noise here, not a finding.
    {
      kill "$PID"
      i=0; while kill -0 "$PID" && [ "$i" -lt 10 ]; do sleep 0.5; i=$((i + 1)); done
      kill -0 "$PID" && kill -9 "$PID"
      wait "$PID"
    } 2>/dev/null
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

# The connector gets a COPY of the state dir: a run may rewrite files in it (mac_last_signed),
# and two gates at once must not share one.
cp -R "$STATE" "$WORK/state" || cannot "could not copy the state dir"
chmod 700 "$WORK/state"

args=(run --state-dir "$WORK/state" --coordinator "$COORD" --relay "$RELAY" --local 127.0.0.1:9)
[ -n "$RELAY_CA" ] && args+=(--tunnel-ca "$RELAY_CA")
say "connector $(shasum -a 256 "$TUNNEL" | cut -c1-12) -> coordinator $COORD, relay $RELAY, as $ADDRESS"
"$TUNNEL" "${args[@]}" > "$LOG" 2>&1 &
PID=$!

# Steps ticket and dial-auth: wait for "tunnel up", or classify the first session that ended.
deadline=$(( $(date +%s) + TIMEOUT ))
while :; do
  plain="$(sed 's/\x1b\[[0-9;]*m//g' "$LOG" 2>/dev/null)"
  printf '%s' "$plain" | grep -q 'tunnel up' && break
  ended="$(printf '%s\n' "$plain" | grep -m1 'session ended' || true)"
  if [ -n "$ended" ]; then
    case "$ended" in
      *relay-ticket*) fail ticket "the coordinator did not issue a relay ticket: ${ended#*session ended: }" ;;
      *) fail dial-auth "the relay session did not come up: ${ended#*session ended: }" ;;
    esac
  fi
  kill -0 "$PID" 2>/dev/null || fail dial-auth "the connector exited before the tunnel came up"
  [ "$(date +%s)" -ge "$deadline" ] && fail dial-auth "no \"tunnel up\" within ${TIMEOUT}s"
  sleep 1
done
say "ok  ticket and dial-auth (tunnel up)"

# Step serve: a visitor, through the relay, to the gate's own address.
curl_args=(-s --max-time 20 -o "$WORK/visit.html" -w '%{http_code}')
[ -n "$RESOLVE" ] && curl_args+=(--resolve "$RESOLVE")
[ -n "$VISITOR_CA" ] && curl_args+=(--cacert "$VISITOR_CA")
if [ -n "$RESOLVE" ]; then
  # HOST:PORT:IP -> https://HOST:PORT/ (a local proof); the HOST must be the gate's own address.
  rhost="${RESOLVE%%:*}"; rport="$(printf '%s' "$RESOLVE" | cut -d: -f2)"
  [ "$rhost" = "$ADDRESS" ] || cannot "--visit-resolve names $rhost, but the gate's address is $ADDRESS"
  url="https://$rhost:$rport/"
else
  url="https://$ADDRESS/"
fi
code="$(curl "${curl_args[@]}" "$url" 2>/dev/null)"; crc=$?
[ "$crc" -eq 0 ] || fail serve "a visitor could not reach $url (curl exit $crc)"
[ "$code" = 200 ] || fail serve "a visitor got HTTP $code from $url, not 200"
grep -q '<title>Kosmos+</title>' "$WORK/visit.html" || fail serve "the page at $url is not the connector's session page"
say "ok  serve ($url: 200, the connector's session page)"
say "PASS"
exit 0
