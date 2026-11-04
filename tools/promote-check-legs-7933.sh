#!/bin/bash
# kosmos#7933: the #7777 promote check's legs for a platform the checking Mac cannot boot (Linux), run where it can
# (.github/workflows/linux-promote-check-7933.yml, a stock ubuntu-24.04 runner). The fresh install from the served
# installer is linux-family-install-7281.yml; this adds the other legs the Mac check has:
#   verify  prod's own manifest-verify.js accepts the staged tarball (before and after unpacking), and refuses a cut
#           tarball and the right manifest checked as another version (the controls)
#   data    prod seeded and booted, then staging, staging again, then prod again, on one sandboxed data set with every
#           Kosmos service closed; each boot answers health and page with no error lines and the seed reads back
#   update  a prod install from the served /setup is updated to staging the way a Linux board is: the served
#           installer run over it with KOSMOS_UPDATE_CHANNEL=staging (Linux boards do not self-install: engine/platform.js SELF_INSTALL is darwin
#           and win32, so their own /api/update refuses; see #7935). The project is kept, and systemd runs a new
#           board process that loaded the staged version. Linux only: it installs for real under systemd, so it refuses to run outside CI.
#
#   bash tools/promote-check-legs-7933.sh <verify|data|update|all> [linux|mac]
# PLATFORM picks the pointers: linux reads dist/latest-linux.json and dist/latest-linux-staging.json; mac reads
# dist/latest.json and dist/latest-staging.json (so verify and data can be rehearsed on a Mac). SITE defaults to
# https://installkosmos.com. Work goes under WORK (default a new temp folder). Exit 0 only when every leg asked for
# passed; each leg ends with one "LEG <name>: PASS" or "LEG <name>: FAIL <why>" line.
set -uo pipefail
LEG="${1:-}"; PLATFORM="${2:-linux}"; SITE="${SITE:-https://installkosmos.com}"
case "$LEG" in verify|data|update|all) ;; *) echo "usage: $0 <verify|data|update|all> [linux|mac]" >&2; exit 2 ;; esac
case "$PLATFORM" in linux) PP=latest-linux.json; SP=latest-linux-staging.json ;; mac) PP=latest.json; SP=latest-staging.json ;;
  *) echo "platform must be linux or mac" >&2; exit 2 ;; esac
HERE="$(cd "$(dirname "$0")" && pwd)"
W="${WORK:-$(mktemp -d "${TMPDIR:-/tmp}/promote-legs-7933.XXXXXX")}"; mkdir -p "$W/dl"
echo "work folder: $W"
fails=0
pass() { echo "LEG $1: PASS"; }
fail() { echo "LEG $1: FAIL $2"; fails=$((fails + 1)); }
field() { sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$2" | head -1; }
sha() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# ---- the two builds, by their pointers, hash-checked -------------------------------------------------------------
fetch() {  # <pointer file> <label>; leaves $W/<label>/ unpacked and $W/<label>.ver
  local ptr="$1" lb="$2" a m want
  curl -fsS -m 30 "$SITE/dist/$ptr" -o "$W/$lb.json" || { echo "no $ptr is served"; return 1; }
  a="$(field artifact "$W/$lb.json")"; m="$(field manifest "$W/$lb.json")"; want="$(field sha256 "$W/$lb.json")"
  [ -n "$a" ] && [ -n "$m" ] && [ -n "$want" ] && [ -n "$(field version "$W/$lb.json")" ] || { echo "$ptr has no version, artifact, manifest or sha256"; return 1; }
  for f in "$a" "$m" "$m.sig"; do case "$f" in */*|.*) echo "$ptr names '$f', not a plain file name"; return 1 ;; esac; curl -fsS -m 300 "$SITE/dist/$f" -o "$W/dl/$f" || { echo "could not fetch $f"; return 1; }; done
  [ "$(sha "$W/dl/$a")" = "$want" ] || { echo "$a does not hash to the pointer's $want"; return 1; }
  rm -rf "${W:?}/$lb"; mkdir -p "$W/$lb"; tar -xzf "$W/dl/$a" -C "$W/$lb" || { echo "could not unpack $a"; return 1; }
  field version "$W/$lb.json" > "$W/$lb.ver"
  printf '%s\n%s\n' "$W/dl/$a" "$W/dl/$m" > "$W/$lb.files"
  echo "$lb: $(cat "$W/$lb.ver") ($a, sha matches the pointer)"
}
if [ "$LEG" != update ]; then
  fetch "$PP" prod || { fail fetch "prod"; exit 1; }
  fetch "$SP" staging || { fail fetch "staging"; exit 1; }
  PV="$(cat "$W/prod.ver")"; SV="$(cat "$W/staging.ver")"
  # Staging the same as prod (right after a promote) leaves nothing to check: every leg would pass on one build.
  [ "$PV" != "$SV" ] || { fail fetch "staging and prod are both $PV: there is no jump to check"; exit 1; }
fi

# ---- verify ------------------------------------------------------------------------------------------------------
leg_verify() {
  local N="$W/prod/runtime/bin/node" V="$W/prod/app/engine/manifest-verify.js" tb m o rc next
  tb="$(sed -n 1p "$W/staging.files")"; m="$(sed -n 2p "$W/staging.files")"
  [ -x "$N" ] && [ -f "$V" ] || { fail verify "prod has no runtime/bin/node or engine/manifest-verify.js"; return; }
  o="$("$N" "$V" "$m" "$m.sig" "$tb" - "$SV" "$W/prod" 2>&1)"; rc=$?; echo "  before unpacking: rc=$rc $o"
  [ "$rc" -eq 0 ] || { fail verify "prod's verifier refused the staged download"; return; }
  o="$("$N" "$V" "$m" "$m.sig" "$tb" "$W/staging" "$SV" "$W/prod" 2>&1)"; rc=$?; echo "  unpacked: rc=$rc $o"
  [ "$rc" -eq 0 ] || { fail verify "prod's verifier refused the unpacked staged files"; return; }
  head -c "$(( $(wc -c < "$tb") / 2 ))" "$tb" > "$W/dl/cut.tar.gz"
  o="$("$N" "$V" "$m" "$m.sig" "$W/dl/cut.tar.gz" - "$SV" "$W/prod" 2>&1)"; rc=$?; echo "  CONTROL cut tarball: rc=$rc $o"
  [ "$rc" -ne 0 ] && printf '%s' "$o" | grep -q 'does not match' || { fail verify "CONTROL: a cut tarball was not refused for its hash"; return; }
  next="${SV%.*}.$(( 10#${SV##*.} + 1 ))"
  o="$("$N" "$V" "$m" "$m.sig" "$tb" - "$next" "$W/prod" 2>&1)"; rc=$?; echo "  CONTROL as $next: rc=$rc $o"
  [ "$rc" -ne 0 ] && printf '%s' "$o" | grep -qF "not $next" || { fail verify "CONTROL: the manifest was not refused as $next"; return; }
  pass verify
}

# ---- data --------------------------------------------------------------------------------------------------------
leg_data() (  # a subshell: the sandbox env stays in it
  SB="$W/sb"; rm -rf "$SB"; mkdir -p "$SB"/{home,data,projects,workers,launch,tmux}
  PORT="${DATA_PORT:-17641}"
  printf '#!/bin/sh\nexit 0\n' > "$SB/tmuxstub"; chmod +x "$SB/tmuxstub"
  export HOME="$SB/home" AGENT_WORKFORCE_DATA="$SB/data" AGENT_WORKFORCE_PROJECTS="$SB/projects" AGENT_WORKFORCE_WORKERS="$SB/workers"
  export AGENT_WORKFORCE_CLAUDE_CONFIG="$SB/claude.json" AGENT_WORKFORCE_LAUNCH="$SB/launch" TMUX_TMPDIR="$SB/tmux" PORT
  unset TMUX TMUX_PANE CLAUDE_CONFIG_DIR
  for v in ANTHROPIC_MODELS_URL CLAUDE_DOWNLOAD_BASE CLOUDFLARE_VERIFY_URL COMMUNITY_URL CREATED_URL FEEDBACK_URL GEMINI_MODELS_URL GITHUB_DEVICE_URL GITHUB_TOKEN_URL GITHUB_VERIFY_URL GROK_SUB_MODELS_URL OPENAI_MODELS_URL RELEASE_BASE TUNNEL_COORDINATOR XAI_MODELS_URL; do export "AGENT_WORKFORCE_$v=https://127.0.0.1:9"; done
  export AGENT_WORKFORCE_TMUX_BIN="$SB/tmuxstub" AGENT_WORKFORCE_TUNNEL_RELAY=127.0.0.1:9 KOSMOS_CATALOGUE_BASE=https://127.0.0.1:9 KOSMOS_RELEASE_BASE=https://127.0.0.1:9
  echo '{"internal":true}' > "$SB/data/internal.json"; echo '{}' > "$SB/data/first-run.json"
  bad=0; p=""
  trap '[ -n "$p" ] && kill "$p" 2>/dev/null' EXIT
  boot() {  # <build dir> <label>
    local h pg e api
    # Something else answering on the port would pass every boot below, so it must be free first.
    if curl --noproxy '*' -s -m 2 -o /dev/null "http://127.0.0.1:$PORT/api/health"; then echo "  $2: port $PORT already answers, not this board"; bad=1; return; fi
    "$W/$1/runtime/bin/node" "$W/$1/app/server.js" > "$SB/board-$2.log" 2>&1 & p=$!   # each build on its own node
    for _ in $(seq 1 60); do curl --noproxy '*' -s -m 2 -o /dev/null "http://127.0.0.1:$PORT/api/health" && break; kill -0 "$p" 2>/dev/null || break; sleep 1; done
    h="$(curl --noproxy '*' -s -m 5 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/health")"
    pg="$(curl --noproxy '*' -s -m 8 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")"
    # The running board serves the seed, not only the files reading back through the engine.
    local body; body="$(curl --noproxy '*' -s -m 8 "http://127.0.0.1:$PORT/api/projects")"
    case "$body" in *'"name":"Masterclass prep"'*) api=served ;; *) api="NOT served"; bad=1 ;; esac
    kill -0 "$p" 2>/dev/null || { echo "  $2: the board died"; bad=1; }
    kill "$p" 2>/dev/null; for _ in 1 2 3 4 5 6 7 8; do kill -0 "$p" 2>/dev/null || break; sleep 1; done
    kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null; wait "$p" 2>/dev/null; p=""
    e="$(grep -ciE 'FAIL|unhandled|uncaught|TypeError|ReferenceError|SyntaxError|EACCES|EADDRINUSE|corrupt' "$SB/board-$2.log")"
    echo "  $2: health $h, page $pg, project $api over /api/projects, error lines $e"
    [ "$e" = 0 ] || grep -iE 'FAIL|unhandled|uncaught|TypeError|ReferenceError|SyntaxError|EACCES|EADDRINUSE|corrupt' "$SB/board-$2.log" | head -5 | sed 's/^/    /'
    [ "$h" = 200 ] && [ "$pg" = 200 ] && [ "$e" = 0 ] || bad=1
  }
  readback() {  # <build dir> <label>
    local out; out="$("$W/$1/runtime/bin/node" "$HERE/promote-check-seed-7933.js" "$W/$1/app" read 2>&1)"; echo "  $2 read: $out"
    [ "$out" = "read projects 1 Masterclass prep:2 held 1" ] || bad=1
  }
  "$W/prod/runtime/bin/node" "$HERE/promote-check-seed-7933.js" "$W/prod/app" seed || { echo "LEG data: FAIL could not seed with prod"; exit 1; }
  boot prod "first-$PV"; readback prod "first-$PV"
  boot staging "then-$SV"; readback staging "then-$SV"
  boot staging "again-$SV"
  boot prod "rollback-$PV"; readback prod "rollback-$PV"
  if [ "$bad" = 0 ]; then echo "LEG data: PASS"; else echo "LEG data: FAIL a boot or a read above"; exit 1; fi
)

# ---- update (Linux, CI only) ---------------------------------------------------------------------------------------
leg_update() {
  [ "$PLATFORM" = linux ] && [ "$(uname -s)" = Linux ] || { fail update "runs only on Linux"; return; }
  [ -n "${CI:-}" ] && [ -n "${GITHUB_ACTIONS:-}" ] || { fail update "refusing: it installs Kosmos for real under systemd; it runs on GitHub Actions only"; return; }
  local port="${KOSMOS_PORT:-16180}" root tok sv pv got pid0 pid1 up=""
  curl -fsS -m 30 "$SITE/dist/$SP" -o "$W/staging-ptr.json" || { fail update "no $SP is served"; return; }
  sv="$(field version "$W/staging-ptr.json")"
  curl -fsS -m 30 "$SITE/dist/$PP" -o "$W/prod-ptr.json" || { fail update "no $PP is served"; return; }
  pv="$(field version "$W/prod-ptr.json")"
  [ -n "$sv" ] && [ -n "$pv" ] && [ "$sv" != "$pv" ] || { fail update "prod '$pv' and staging '$sv': there is no jump to check"; return; }
  curl -fsSL "$SITE/setup" -o "$W/setup.sh" || { fail update "could not fetch $SITE/setup"; return; }
  KOSMOS_RELEASE_BASE="$SITE/dist" sh "$W/setup.sh" > "$W/setup.log" 2>&1 || { tail -20 "$W/setup.log"; fail update "the prod install failed"; return; }
  for _ in $(seq 1 60); do curl -fsS -m 3 -o /dev/null "http://127.0.0.1:$port/api/health" && { up=1; break; }; sleep 2; done
  [ -n "$up" ] || { tail -20 "$W/setup.log"; fail update "the prod install's board never answered"; return; }
  # The version the ANSWERING PROCESS loaded (its x-kosmos-board header, read from its package.json at boot). The
  # page's kosmos-version meta is read from disk per request, so an old process would name new files.
  ver() { curl -s -m 5 -D - -o /dev/null "http://127.0.0.1:$port/" | tr -d '\r' | sed -n 's/^[xX]-[kK]osmos-[bB]oard: *\([^@+]*\).*/\1/p' | head -1; }
  bpid() { systemctl --user show -p MainPID --value kosmos-board.service 2>/dev/null; }
  # The process listening on the port is systemd's board or a child of it, so the header read below is that board's.
  ours() {
    local l q i
    l="$(ss -ltnpH "sport = :$port" 2>/dev/null | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)"; q="$l"
    for i in 1 2 3 4 5 6; do [ -n "$q" ] && [ "$q" != 0 ] || return 1; [ "$q" = "$1" ] && return 0; q="$(awk '/^PPid:/{print $2}' "/proc/$q/status" 2>/dev/null)"; done
    return 1
  }
  # As linux-family-install-7281.yml: the unit and the board systemd runs carry the dead beacon, so it is not counted.
  beacon() {
    grep -qxF "Environment=\"AGENT_WORKFORCE_CREATED_URL=$AGENT_WORKFORCE_CREATED_URL\"" "$HOME/.config/systemd/user/kosmos-board.service" \
      && tr '\0' '\n' < "/proc/$(bpid)/environ" | grep -xF "AGENT_WORKFORCE_CREATED_URL=$AGENT_WORKFORCE_CREATED_URL" > /dev/null
  }
  got="$(ver)"; pid0="$(bpid)"; echo "  installed from /setup: $got (systemd MainPID $pid0)"
  [ "$got" = "$pv" ] || { fail update "/setup installed '$got', not prod's $pv"; return; }
  ours "$pid0" || { fail update "the process answering port $port is not systemd's board ($pid0)"; return; }
  [ -n "${AGENT_WORKFORCE_CREATED_URL:-}" ] && beacon || { fail update "the prod board does not carry the dead install beacon (it would count as an install)"; return; }
  root="$HOME/Library/Application Support/Kosmos"; tok="$(cat "$root/board.token" 2>/dev/null)"
  [ -n "$tok" ] || { fail update "no board.token at $root"; return; }
  api() { curl -s -m 30 -H "x-kosmos-board-token: $tok" -H 'content-type: application/json' "$@"; }
  api -X POST "http://127.0.0.1:$port/api/projects" --data '{"name":"Masterclass prep"}' > /dev/null
  case "$(api "http://127.0.0.1:$port/api/projects")" in *'"name":"Masterclass prep"'*) ;; *) fail update "could not add a project to the prod install"; return ;; esac
  echo staging > "$root/source-channel"
  # Only the check: pressing the board's own Update is refused on Linux today (#7935), and once it is not it would race
  # the installer below.
  echo "  board's own check: $(api -X POST "http://127.0.0.1:$port/api/update/check" --data '{}' | head -c 300)"
  curl -fsSL "$SITE/setup-staging" -o "$W/setup-staging.sh" || { fail update "could not fetch $SITE/setup-staging"; return; }
  KOSMOS_UPDATE_CHANNEL=staging KOSMOS_RELEASE_BASE="$SITE/dist" sh "$W/setup-staging.sh" > "$W/setup-staging.log" 2>&1 \
    || { tail -20 "$W/setup-staging.log"; fail update "/setup-staging over the prod install failed"; return; }
  grep -E 'on disk now|already|updat' "$W/setup-staging.log" | head -4 | sed 's/^/  setup-staging: /'
  for _ in $(seq 1 60); do [ "$(ver)" = "$sv" ] && break; sleep 2; done
  got="$(ver)"; pid1="$(bpid)"; echo "  after /setup-staging over it: $got (staging pointer $sv), systemd MainPID $pid1"
  [ "$got" = "$sv" ] || { tail -20 "$HOME/.local/share/kosmos/logs/install.log" 2>/dev/null; fail update "the answering board loaded $got, not $sv"; return; }
  [ "$(systemctl --user is-active kosmos-board.service)" = active ] || { fail update "systemd does not run the updated board"; return; }
  [ -n "$pid1" ] && [ "$pid1" != 0 ] && [ "$pid1" != "$pid0" ] || { fail update "systemd's board process did not change ($pid0 -> $pid1): the board was not restarted"; return; }
  ours "$pid1" || { fail update "the process answering port $port is not systemd's updated board ($pid1)"; return; }
  beacon || { fail update "the updated board does not carry the dead install beacon"; return; }
  case "$(api "http://127.0.0.1:$port/api/projects")" in *'"name":"Masterclass prep"'*) ;; *) fail update "the project was not kept"; return ;; esac
  grep -qx staging "$root/source-channel" || { fail update "the in-place update stamped '$(cat "$root/source-channel" 2>/dev/null)', not staging"; return; }
  pass update
}

case "$LEG" in
  verify) leg_verify ;;
  data) leg_data || fails=$((fails + 1)) ;;
  update) leg_update ;;
  all) leg_verify; leg_data || fails=$((fails + 1))
       if [ "$PLATFORM" = linux ]; then leg_update; else echo "LEG update: SKIPPED (Linux only)"; fi ;;
esac
echo "promote-check-legs-7933: $fails leg(s) failed"
[ "$fails" -eq 0 ]
