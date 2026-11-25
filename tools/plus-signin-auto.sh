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
#   bash tools/plus-signin-auto.sh --pointer <latest-staging.json> --seed <local+tag@domain> \
#        [--port 16977] [--base-url https://installkosmos.com/dist] [--tarball <file>] [--keep]
#   With KOSMOS_SEED_TOTP unset, the seed's meta names its secret and `secrets-map.sh value <target>` reads it.
#
# Exit: plus-signin-fresh.js's contract. 0 = the record says pass; 1 = it says fail (the gate refuses);
#       2 = nothing was recorded (a refused seed, a bad download, a board that did not come up or is not the
#       pointer's build, no code arrived). Seams for tests: KOSMOS_SIGNIN_CODE_BIN, KOSMOS_PLUS_FRESH_JS,
#       KOSMOS_PLUS_BOARD_UP_S (seconds to wait for the board, default 90), KOSMOS_PLUS_CODE_S (default 180).
set -uo pipefail

say() { printf 'plus-signin-auto: %s\n' "$*"; }
die() { say "$*"; exit 2; }

POINTER="" SEED="" PORT=16977 BASE_URL="https://installkosmos.com/dist" TARBALL="" KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in --pointer|--seed|--port|--base-url|--tarball) [ $# -ge 2 ] || die "$1 needs a value" ;; esac
  case "$1" in
    --pointer) POINTER="${2:-}"; shift 2 ;;
    --seed) SEED="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --base-url) BASE_URL="${2:-}"; shift 2 ;;
    --tarball) TARBALL="${2:-}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    *) die "unknown argument $1 (see the usage at the top of this file)" ;;
  esac
done

# 1. THE SEED GUARD. Nothing above this line touches the network, a board or the mailbox; nothing below runs
#    unless it passes.
SEED_LC="$(printf '%s' "$SEED" | tr '[:upper:]' '[:lower:]')"
case "$SEED_LC" in
  *[!a-z0-9.+@_-]*|'') die "the seed ${SEED:-(none)} is not a test address: refused before any call" ;;
esac
printf '%s' "$SEED_LC" | grep -Eq '^[a-z0-9._-]+\+[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]+$' \
  || die "the seed $SEED is not a plus-tag address (local+tag@domain): refused before any call"
META=""
for m in "$HOME"/.config/secrets/kosmosplus-test-*.meta; do
  [ -f "$m" ] || continue
  if sed -n 's/^targets:[[:space:]]*//p' "$m" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' \
       | tr '[:upper:]' '[:lower:]' | grep -qxF "$SEED_LC"; then META="$m"; break; fi
done
[ -n "$META" ] || die "the seed $SEED is not listed in any kosmosplus-test-*.meta under $HOME/.config/secrets: refused before any call"

case "$PORT" in *[!0-9]*|'') die "port $PORT is not numeric" ;; esac
[ -n "$POINTER" ] && [ -f "$POINTER" ] || die "no staging pointer at ${POINTER:-(none)}"
command -v node >/dev/null 2>&1 || die "node is required"
HERE="$(cd "$(dirname "$0")" && pwd)"
FRESH="${KOSMOS_PLUS_FRESH_JS:-$HERE/plus-signin-fresh.js}"
SC="${KOSMOS_SIGNIN_CODE_BIN:-$(command -v kosmos-signin-code || true)}"
[ -f "$FRESH" ] || die "no plus-signin-fresh.js at $FRESH"
[ -n "$SC" ] && [ -x "$SC" ] || die "kosmos-signin-code is not installed (it reads the code from the seed inbox)"

# The authenticator secret: given, or read through the secrets map from the seed's own meta. An otpauth:// URL is
# reduced to its secret= value (plus-signin-fresh.js takes base32 only). Never printed.
if [ -z "${KOSMOS_SEED_TOTP:-}" ]; then
  # The secret's own name, which is the target on the line that is not an address (an address resolves to nothing).
  TARGET="$(sed -n 's/^targets:[[:space:]]*//p' "$META" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '@' | head -1)"
  KOSMOS_SEED_TOTP="$(secrets-map.sh value "$TARGET" 2>/dev/null || true)"
fi
case "${KOSMOS_SEED_TOTP:-}" in
  otpauth://*) KOSMOS_SEED_TOTP="$(printf '%s' "$KOSMOS_SEED_TOTP" | sed -n 's/.*[?&]secret=\([A-Za-z2-7=]*\).*/\1/p')" ;;
esac
[ -n "${KOSMOS_SEED_TOTP:-}" ] || die "no authenticator secret for $SEED (set KOSMOS_SEED_TOTP, or file it with /add-secret)"
export KOSMOS_SEED_TOTP

field() { node -e 'try{process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"))[process.argv[2]]||""))}catch{}' "$POINTER" "$1" 2>/dev/null; }
V="$(field version)"; SHA="$(field sha256)"; ART="$(field artifact)"
[ -n "$V" ] || die "$POINTER names no version"
printf '%s' "$SHA" | grep -Eq '^[0-9a-f]{64}$' || die "$POINTER names no sha256"
case "$ART" in */*|'') [ -n "$TARBALL" ] || die "$POINTER names no artifact file name" ;; esac
if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then die "something already answers on port $PORT: pick another with --port"; fi

# 2. The pointer's own bytes, in a fresh work folder.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/kplusgate.XXXXXX")" || die "could not make a work folder"
SOCK="kplusgate-$$"
TMUX_REAL="$(command -v tmux || echo /usr/bin/false)"
BOARD_PID="" STARTED=0
# Everything the board started runs from inside $WORK (a fresh mktemp folder), including the kosmos-tunnel connector,
# which outlives a stopped board by design (engine/remote.js). So after the board, stop every process whose command
# line names $WORK, then check none is left. Matching the unique work folder, never a program name, is what keeps this
# from reaching any other process on the machine.
under_work() { ps -axo pid=,command= | while read -r p c; do case "$c" in *"$WORK/"*) [ "$p" != "$$" ] && echo "$p" ;; esac; done; }
cleanup() {
  if [ -n "$BOARD_PID" ]; then kill "$BOARD_PID" 2>/dev/null; wait "$BOARD_PID" 2>/dev/null; fi
  for p in $(under_work); do kill "$p" 2>/dev/null; done
  for _ in 1 2 3 4 5; do [ -z "$(under_work)" ] && break; sleep 1; done
  for p in $(under_work); do kill -9 "$p" 2>/dev/null; done
  [ -z "$(under_work)" ] || say "WARNING: processes from $WORK are still running: $(under_work | tr '\n' ' ')"
  "$TMUX_REAL" -L "$SOCK" kill-server >/dev/null 2>&1 || true
  # A run that got past start and ends here leaves start's progress file, which the gate reads as "an attempt is in
  # flight" (cannot tell) until removed. The board it names is gone, so nothing is in flight: remove it. finish
  # removes it itself when it writes a record.
  [ "$STARTED" = 1 ] && rm -f "$(node -e 'process.stdout.write(require(process.argv[1]).recordPath(process.argv[2]).replace(/\.json$/, ".progress.json"))' "$HERE/lib/plus-signin-record.js" "$SHA")"
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
D="$WORK/data"; mkdir -p "$D/Kosmos" "$WORK/home" "$WORK/awhome" "$WORK/launch" "$WORK/workers" "$WORK/projects"
printf '{"on":false}\n' > "$D/Kosmos/autoupdate.json"
printf '#!/bin/sh\nexec "%s" -L "%s" "$@"\n' "$TMUX_REAL" "$SOCK" > "$WORK/tmux"; chmod +x "$WORK/tmux"
( cd "$WORK/tree/app" && exec env -i HOME="$WORK/home" PATH=/usr/bin:/bin:/usr/sbin:/sbin LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 \
    AGENT_WORKFORCE_DATA="$D" AGENT_WORKFORCE_HOME="$WORK/awhome" AGENT_WORKFORCE_LAUNCH="$WORK/launch" \
    AGENT_WORKFORCE_WORKERS="$WORK/workers" AGENT_WORKFORCE_PROJECTS="$WORK/projects" AGENT_WORKFORCE_TMUX_BIN="$WORK/tmux" \
    PORT="$PORT" "$WORK/tree/runtime/bin/node" server.js ) > "$WORK/board.log" 2>&1 &
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
say "throwaway board up on :$PORT as $up (from the pointer's $V tarball, sha256 ${SHA:0:12})"

# 4. The sign-in, through the record writer.
export KOSMOS_STORE_ROOT="$D/Kosmos"
BASE_BOX="$(printf '%s' "$SEED_LC" | sed 's/+[^@]*@/@/')"
HID="$("$SC" anchor "$BASE_BOX")" || die "could not anchor the seed mailbox $BASE_BOX"
FA=(--pointer "$POINTER" --port "$PORT" --board-kind sandboxed)
node "$FRESH" start "${FA[@]}" --seed "$SEED"; rc=$?
[ "$rc" = 0 ] || exit "$rc"   # 1: start was refused and recorded; 2: setup, nothing recorded
STARTED=1   # only now does a progress file exist that this run owns
GOTC="$(KOSMOS_SIGNIN_PLACEMENT=1 "$SC" code "$SEED" "$HID" "${KOSMOS_PLUS_CODE_S:-180}")" || die "no sign-in code reached $SEED: nothing recorded"
CODE="${GOTC%% *}"; PLACE="${GOTC#* }"
printf '%s' "$CODE" | grep -Eq '^[0-9]{6}$' || die "kosmos-signin-code gave no six-digit code: nothing recorded"
case "$PLACE" in INBOX|SPAM|OTHER) ;; *) die "kosmos-signin-code gave no placement (is it older than kosmos#9018?): nothing recorded" ;; esac
say "the code arrived (filed in $PLACE)"
node "$FRESH" finish "${FA[@]}" --code "$CODE" --placement "$PLACE"
exit $?
