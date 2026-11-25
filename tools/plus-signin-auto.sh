#!/usr/bin/env bash
# plus-signin-auto.sh - kosmos#9018: run the FIRST KOSMOS+ SIGN-IN release gate (#2036) in one command, unattended.
#
# tools/plus-signin-verified.sh gates the Mac promote on a record that tools/plus-signin-fresh.js writes after a real
# first sign-in on the staged build. Until this, nobody ran it: it needed a fresh board and a code read by hand. This
# does the whole run, against the pointer's OWN bytes:
#
#   1. the SEED GUARD, before anything else: the seed must be a plus-tag test address (local+tag@domain) listed in a
#      kosmosplus-test-*.meta header under $HOME/.config/secrets (the set tools' kosmos-signin-code serves). Anything
#      else is refused before any download, board or mail call. Sign-in only: nothing here signs up, pays or buys.
#   2. download the pointer's tarball (<base-url>/<artifact>, or --tarball <file>), check its sha256 against the
#      pointer, unpack it into a fresh work folder;
#   3. boot it as a FULLY SANDBOXED throwaway board (every AGENT_WORKFORCE_* data root and HOME in the work folder,
#      tmux on its own socket, auto-update off): it cannot read or type into the fleet's terminals or arm launchd, and it writes no
#      board.token, so plus-signin-fresh.js is told --board-kind sandboxed;
#   4. anchor the seed mailbox, `plus-signin-fresh.js start`, read the code AND where Gmail filed it with
#      `KOSMOS_SIGNIN_PLACEMENT=1 kosmos-signin-code code`, then `finish`;
#   5. ALWAYS stop the board and its tmux server, and remove the work folder (--keep leaves the folder).
#
# The record lands where plus-signin-fresh.js writes it (KOSMOS_PLUS_VERIFY_DIR, else
# ~/.local/state/kosmos/release-verify). The promote reads it on the cut box, so copy it there after a pass.
#
# Usage:
#   KOSMOS_SEED_TOTP=<base32 or otpauth:// URL> \
#   bash tools/plus-signin-auto.sh --pointer <latest-staging.json> --seed <local+tag@domain> [--seed <another> ...] \
#        [--port 16977] [--base-url https://installkosmos.com/dist] [--tarball <file>] [--keep]
#   kosmos#9026: --seed may be given more than once. Each run registers under the seed's own address and Let's Encrypt
#   issues at most 5 certificates for one name a week, so one seed runs the gate about five times a week. The run uses
#   the seed used least in the last week (tools/lib/plus-seed-ledger.js, a ledger beside the records), and with every
#   seed used up it says so before any download (exit 2, with when the next frees). Every seed given passes the guard.
#   Give only seeds that OWN a Kosmos+ address: one with none registers under a per-build name every such seed shares.
#   With KOSMOS_SEED_TOTP unset, the seed's meta names its secret and `secrets-map.sh value <target>` reads it.
#
# Exit: plus-signin-fresh.js's contract. 0 = the record says pass; 1 = it says fail (the gate refuses);
#       2 = nothing was recorded (a refused seed, a bad download, a board that did not come up or is not the
#       pointer's build, no code arrived). Seams for tests: KOSMOS_SIGNIN_CODE_BIN, KOSMOS_PLUS_FRESH_JS,
#       KOSMOS_PLUS_BOARD_UP_S (seconds to wait for the board, default 90), KOSMOS_PLUS_CODE_S (default 180).
set -uo pipefail

say() { printf 'plus-signin-auto: %s\n' "$*"; }
die() { say "$*"; exit 2; }

POINTER="" SEED="" SEEDS=() PORT=16977 BASE_URL="https://installkosmos.com/dist" TARBALL="" KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in --pointer|--seed|--port|--base-url|--tarball) [ $# -ge 2 ] || die "$1 needs a value" ;; esac
  case "$1" in
    --pointer) POINTER="${2:-}"; shift 2 ;;
    --seed) SEEDS+=("${2:-}"); shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --base-url) BASE_URL="${2:-}"; shift 2 ;;
    --tarball) TARBALL="${2:-}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    *) die "unknown argument $1 (see the usage at the top of this file)" ;;
  esac
done

# 1. THE SEED GUARD. Nothing above this line touches the network, a board or the mailbox; nothing below runs
#    unless every seed given passes it (kosmos#9026: a typo in a second seed is refused as loudly as in the first).
[ "${#SEEDS[@]}" -gt 0 ] || die "the seed (none) is not a test address: refused before any call"
guard_seed() {
SEED="$1"
SEED_LC="$(printf '%s' "$SEED" | tr '[:upper:]' '[:lower:]')"
case "$SEED_LC" in
  *[!a-z0-9.+@_-]*|'') die "the seed ${SEED:-(none)} is not a test address: refused before any call" ;;
esac
# Matched by bash itself, not a pipe into grep -q (an early reader under pipefail can fail the match, kosmos#8195).
SEED_RE='^[a-z0-9][a-z0-9._-]*[+][a-z0-9._-]+@[a-z0-9][a-z0-9.-]*[.][a-z]+$'
[[ "$SEED_LC" =~ $SEED_RE ]] \
  || die "the seed $SEED is not a plus-tag address (local+tag@domain): refused before any call"
META=""
for m in "$HOME"/.config/secrets/kosmosplus-test-*.meta; do
  [ -f "$m" ] || continue
  if sed -n 's/^targets:[[:space:]]*//p' "$m" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' \
       | tr '[:upper:]' '[:lower:]' | grep -cxF "$SEED_LC" >/dev/null; then META="$m"; break; fi
done
[ -n "$META" ] || die "the seed $SEED is not listed in any kosmosplus-test-*.meta under $HOME/.config/secrets: refused before any call"
}
for s_ in "${SEEDS[@]}"; do guard_seed "$s_"; done
# kosmos#9026: the seed this run uses, the one used least this week, from the ledger beside the records. The guard
# above has already checked it; its meta is found again below.
command -v node >/dev/null 2>&1 || die "node is required"
HERE="$(cd "$(dirname "$0")" && pwd)"
LEDGER="$(node -e 'process.stdout.write(require("node:path").join(require(process.argv[1]).recordDir(), "seed-certs.jsonl"))' "$HERE/lib/plus-signin-record.js")" \
  || die "could not find where the seed ledger lives"
PICKED="$(node "$HERE/lib/plus-seed-ledger.js" pick "$LEDGER" "${SEEDS[@]}")"; prc=$?
[ "$prc" = 0 ] || die "${PICKED:-the seed ledger could not be read}: nothing recorded"
guard_seed "$PICKED"
NSEEDS="$(printf '%s\n' "${SEEDS[@]}" | tr '[:upper:]' '[:lower:]' | sort -u | grep -c .)"
[ "$NSEEDS" -gt 1 ] && say "seed for this run: $PICKED (the least used this week of $NSEEDS)"

case "$PORT" in *[!0-9]*|'') die "port $PORT is not numeric" ;; esac
[ -n "$POINTER" ] && [ -f "$POINTER" ] || die "no staging pointer at ${POINTER:-(none)}"
FRESH="${KOSMOS_PLUS_FRESH_JS:-$HERE/plus-signin-fresh.js}"
SC="${KOSMOS_SIGNIN_CODE_BIN:-$(command -v kosmos-signin-code || true)}"
[ -f "$FRESH" ] || die "no plus-signin-fresh.js at $FRESH"
[ -n "$SC" ] && [ -x "$SC" ] || die "kosmos-signin-code is not installed (it reads the code from the seed inbox)"

# The authenticator secret: given, or read through the secrets map from the seed's own meta. An otpauth:// URL is
# reduced to its secret= value (plus-signin-fresh.js takes base32 only). Never printed.
if [ -z "${KOSMOS_SEED_TOTP:-}" ]; then
  command -v secrets-map.sh >/dev/null 2>&1 || die "KOSMOS_SEED_TOTP is unset and secrets-map.sh is not installed, so the seed's authenticator secret cannot be read"
  # The secret's own name, which is the target on the line that is not an address (an address resolves to nothing).
  TARGET="$(sed -n 's/^targets:[[:space:]]*//p' "$META" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '@' | head -1)"
  [ -n "$TARGET" ] || die "the meta for $SEED ($META) names no secret on its targets: line, only addresses"
  KOSMOS_SEED_TOTP="$(secrets-map.sh value "$TARGET" 2>/dev/null || true)"
fi
case "${KOSMOS_SEED_TOTP:-}" in
  otpauth://*) KOSMOS_SEED_TOTP="$(printf '%s' "$KOSMOS_SEED_TOTP" | sed -n 's/.*[?&]secret=\([A-Za-z2-7=]*\).*/\1/p')" ;;
esac
[ -n "${KOSMOS_SEED_TOTP:-}" ] || die "no authenticator secret for $SEED (set KOSMOS_SEED_TOTP, or file it with /add-secret)"
# Held unexported, and given to the one process that uses it (finish), so the download, the code reader and the
# board never carry it in their environment.
SEED_SECRET="$KOSMOS_SEED_TOTP"; unset KOSMOS_SEED_TOTP

field() { node -e 'try{process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]]||""))}catch{}' "$POINTER" "$1" 2>/dev/null; }
V="$(field version)"; SHA="$(field sha256)"; ART="$(field artifact)"
[ -n "$V" ] || die "$POINTER names no version"
[[ "$SHA" =~ ^[0-9a-f]{64}$ ]] || die "$POINTER names no sha256"
case "$ART" in */*|'') [ -n "$TARBALL" ] || die "$POINTER names no artifact file name" ;; esac
# One run per build at a time: two share this build's progress file, and the second would take over the first's.
node -e '
  const fs = require("node:fs");
  const f = require(process.argv[1]).recordPath(process.argv[2]).replace(/\.json$/, ".progress.json");
  let p; try { p = JSON.parse(fs.readFileSync(f, "utf8")); } catch { process.exit(0); }
  process.exit(Date.now() - Date.parse(p.startedAt) < 15 * 60 * 1000 ? 3 : 0);
' "$HERE/lib/plus-signin-record.js" "$SHA"; rc=$?
[ "$rc" = 0 ] || [ "$rc" = 3 ] || die "could not read the record spec $HERE/lib/plus-signin-record.js (exit $rc)"
[ "$rc" = 0 ] || die "a sign-in run for this build started under 15 minutes ago and has not finished (its progress file is beside the records): refused, so the two do not take over each other's progress"
if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then die "something already answers on port $PORT: pick another with --port"; fi

# 2. The pointer's own bytes, in a fresh work folder.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/kplusgate.XXXXXX")" || die "could not make a work folder"
# Canonical, because the sweep below matches it against command lines, and the board's children name their paths
# from node's realpath'd __dirname: on a Mac TMPDIR is /var/folders/.../T/ (a symlinked /var and a trailing slash),
# so the raw mktemp answer matched none of them.
CANON="$(cd "$WORK" && pwd -P)" || { rm -rf "${WORK:?}"; die "could not resolve the work folder"; }
WORK="$CANON"
SOCK="kplusgate-$$"
TMUX_REAL="$(command -v tmux || echo /usr/bin/false)"
BOARD_PID="" STARTED=0 START_MS=0
# A backstop for anything still running from inside $WORK (a fresh mktemp folder) once the board is stopped: stop
# every process whose command line names $WORK, then check none is left. Matching the unique work folder, never a
# program name, is what keeps this from reaching any other process on the machine.
under_work() { ps -axo pid=,command= | while read -r p c; do case "$c" in *"$WORK/"*) [ "$p" != "$$" ] && echo "$p" ;; esac; done; }
cleanup() {
  if [ -n "$BOARD_PID" ]; then
    kill "$BOARD_PID" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$BOARD_PID" 2>/dev/null || break; sleep 1; done
    kill -9 "$BOARD_PID" 2>/dev/null; wait "$BOARD_PID" 2>/dev/null
  fi
  for p in $(under_work); do kill "$p" 2>/dev/null; done
  for _ in 1 2 3 4 5; do [ -z "$(under_work)" ] && break; sleep 1; done
  for p in $(under_work); do kill -9 "$p" 2>/dev/null; done
  [ -z "$(under_work)" ] || say "WARNING: processes from $WORK are still running: $(under_work | tr '\n' ' ')"
  "$TMUX_REAL" -L "$SOCK" kill-server >/dev/null 2>&1 || true
  # A run that reached start and ends here can leave start's progress file, which the gate reads as "an attempt is in
  # flight" (cannot tell) until removed. The board it names is gone, so nothing is in flight. It is removed only when
  # it is this run's: a sandboxed start no older than this run's own start, so a run started by hand on an installed
  # board for the same build is left alone. finish removes it itself when it writes a record.
  [ "$STARTED" = 1 ] && node -e '
    const fs = require("node:fs");
    const f = require(process.argv[1]).recordPath(process.argv[2]).replace(/\.json$/, ".progress.json");
    let p; try { p = JSON.parse(fs.readFileSync(f, "utf8")); } catch { process.exit(0); }
    if (p.kind === "sandboxed" && Date.parse(p.startedAt) >= Number(process.argv[3])) fs.rmSync(f, { force: true });
  ' "$HERE/lib/plus-signin-record.js" "$SHA" "$START_MS" 2>/dev/null
  if [ "$KEEP" = 1 ]; then say "kept the work folder $WORK"; else rm -rf "${WORK:?}"; fi
}
trap cleanup EXIT
trap 'exit 2' INT TERM

T="$WORK/k.tar.gz"
if [ -n "$TARBALL" ]; then cp "$TARBALL" "$T" || die "cannot read $TARBALL"
else curl -fsSL --max-time 600 "$BASE_URL/$ART" -o "$T" || die "could not download $BASE_URL/$ART"; fi
GOT="$(shasum -a 256 < "$T" | cut -d' ' -f1)"
[ "$GOT" = "$SHA" ] || die "the tarball's sha256 is $GOT, not the pointer's $SHA: refused, nothing was booted"
mkdir -p "$WORK/tree" && tar -xzf "$T" -C "$WORK/tree" || die "could not unpack the tarball"
[ -x "$WORK/tree/runtime/bin/node" ] && [ -f "$WORK/tree/app/server.js" ] || die "the tarball has no runtime/bin/node and app/server.js"

# 3. The fully sandboxed throwaway board. Auto-update is switched off BEFORE it first starts (no file means on).
#    The agents' own browser is switched off too: a board fetches it at start (about 100 MB, engine/agentbrowser.js),
#    and its download outlived a stopped board and wrote into a removed work folder (measured, 0.8.21 run).
D="$WORK/data"; mkdir -p "$D/Kosmos" "$WORK/tmp" "$WORK/runners" "$WORK/home" "$WORK/awhome" "$WORK/launch" "$WORK/workers" "$WORK/projects"
printf '{"on":false}\n' > "$D/Kosmos/autoupdate.json"
printf '#!/bin/sh\nexec "%s" -L "%s" "$@"\n' "$TMUX_REAL" "$SOCK" > "$WORK/tmux"; chmod +x "$WORK/tmux"
( cd "$WORK/tree/app" && exec env -i HOME="$WORK/home" PATH=/usr/bin:/bin:/usr/sbin:/sbin LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 \
    AGENT_WORKFORCE_DATA="$D" AGENT_WORKFORCE_HOME="$WORK/awhome" AGENT_WORKFORCE_LAUNCH="$WORK/launch" \
    AGENT_WORKFORCE_WORKERS="$WORK/workers" AGENT_WORKFORCE_PROJECTS="$WORK/projects" AGENT_WORKFORCE_TMUX_BIN="$WORK/tmux" \
    AGENT_WORKFORCE_RUNNERS_DIR="$WORK/runners" KOSMOS_AGENT_BROWSER=off TMPDIR="$WORK/tmp/" PORT="$PORT" "$WORK/tree/runtime/bin/node" server.js ) > "$WORK/board.log" 2>&1 &
BOARD_PID=$!
UP_S="${KOSMOS_PLUS_BOARD_UP_S:-90}"; up=""; i=0
while [ "$i" -lt "$UP_S" ]; do
  i=$((i + 1))
  kill -0 "$BOARD_PID" 2>/dev/null || break
  up="$(curl -s -o /dev/null -D - --max-time 2 "http://127.0.0.1:$PORT/" 2>/dev/null | tr -d '\r' | sed -n 's/^[Xx]-[Kk]osmos-[Bb]oard: //p' | head -1)"
  [ -n "$up" ] && break
  sleep 1
done
[ -n "$up" ] || { tail -5 "$WORK/board.log" | sed 's/^/  board: /'; die "the throwaway board did not come up on port $PORT"; }
# The answer must be from the board this run booted, not another that took the port first.
LISTENER="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' ')"
if [ "$LISTENER" != "$BOARD_PID " ]; then
  # #9018 round 8: the board plus another listener (IPv6 under another pid, say) is not "not the board".
  case " $LISTENER" in
    *" $BOARD_PID "*) die "port $PORT is answered by the throwaway board (pid $BOARD_PID) and also by pid(s) $(printf '%s' "$LISTENER" | tr ' ' '\n' | grep -vx "$BOARD_PID" | tr '\n' ' '): refused, since a request might reach the other" ;;
    *) die "port $PORT is answered by pid(s) ${LISTENER:-none}, not the throwaway board (pid $BOARD_PID): refused" ;;
  esac
fi
say "throwaway board up on :$PORT as $up (from the pointer's $V tarball, sha256 ${SHA:0:12})"

# 4. The sign-in, through the record writer.
# Given only to the two plus-signin-fresh.js calls (#9018 round 9: exported, they reached every later child).
# KOSMOS_PLUS_VERIFIED_SHA256 is checked against the tarball above.
BASE_BOX="$(printf '%s' "$SEED_LC" | sed 's/+[^@]*@/@/')"
HID="$("$SC" anchor "$BASE_BOX")" || die "could not anchor the seed mailbox $BASE_BOX"
FA=(--pointer "$POINTER" --port "$PORT" --board-kind sandboxed)
START_MS="$(node -e 'process.stdout.write(String(Date.now() - 1000))')"; STARTED=1   # before start: it writes the file
KOSMOS_STORE_ROOT="$D/Kosmos" KOSMOS_PLUS_VERIFIED_SHA256="$SHA" node "$FRESH" start "${FA[@]}" --seed "$SEED_LC"; rc=$?
[ "$rc" = 0 ] || exit "$rc"   # 1: start was refused and recorded; 2: setup, nothing recorded
GOTC="$(KOSMOS_SIGNIN_PLACEMENT=1 "$SC" code "$SEED_LC" "$HID" "${KOSMOS_PLUS_CODE_S:-180}")" || die "no sign-in code reached $SEED: nothing recorded"
CODE="${GOTC%% *}"; PLACE="${GOTC#* }"
[[ "$CODE" =~ ^[0-9]{6}$ ]] || die "kosmos-signin-code gave no six-digit code: nothing recorded"
case "$PLACE" in INBOX|SPAM|OTHER) ;; *) die "kosmos-signin-code gave no placement (is it older than kosmos#9018?): nothing recorded" ;; esac
say "the code arrived (filed in $PLACE)"
# kosmos#9026: counted before the step that asks for the certificate, so a run that dies after the request still counts.
node "$HERE/lib/plus-seed-ledger.js" record "$LEDGER" "$SEED_LC" || say "WARNING: could not add this run to the seed ledger $LEDGER"
KOSMOS_SEED_TOTP="$SEED_SECRET" KOSMOS_STORE_ROOT="$D/Kosmos" KOSMOS_PLUS_VERIFIED_SHA256="$SHA" node "$FRESH" finish "${FA[@]}" --code "$CODE" --placement "$PLACE"
exit $?
