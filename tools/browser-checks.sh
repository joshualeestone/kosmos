#!/usr/bin/env bash
#
# The page-layer gate (#39).
#
# `node --test` reads source; it cannot see the page. The scripts under
# docs/browser-checks/ can, but they lived outside every automated run, so a
# page-layer regression reached main uncaught: round 16 of the project-chat
# review ran 18 page mutations and 16 survived the whole suite. This harness
# runs the load-bearing ones headless, on a sandboxed fixture server per check,
# so the release gate covers the page the way the suite covers the engine.
#
# 🔑 THE BROWSER LIVES IN THE JOB, NEVER IN package.json. A clean clone still
# runs with zero dependencies and `yarn test` still needs no browser: the
# README's promise stays literally true. This harness borrows Playwright from a
# NODE_PATH the machine already has (the exact pattern the checks document), and
# fails loud rather than silently skipping if it cannot find one.
#
#   Playwright is resolved from, in order:
#     $KOSMOS_PW_NODE_PATH           (a node_modules dir containing playwright)
#     ~/work/pw-runtime/node_modules
#     ~/.npm/_npx/*/node_modules     (an npx cache, where `npx playwright` lands)
#   To provision one:  PW=$(mktemp -d); cd "$PW" && npm i playwright \
#                        && npx playwright install chromium
#   then export KOSMOS_PW_NODE_PATH="$PW/node_modules".
#
# ⚠️ HEADLESS on purpose. A CI or release machine has no console, and every
# check the MVP runs asserts COMPUTED STATE (aria-checked, which container is
# hidden, derived text), which software rendering reproduces faithfully. Paint
# and geometry are weaker headless; a check that leans on them belongs in a
# headed run, not this gate, and the MVP set is chosen accordingly.
#
# Exit status: 0 iff every selected check passed (after at most one retry).
#
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

FAKE_TMUX="$REPO/test-support/fake-tmux.sh"
FAILED=()
RAN=()
RETRIED=()

log()  { printf '%s\n' "$*"; }
sec()  { printf '\n=== %s ===\n' "$*"; }

# --- Playwright, borrowed not depended-on -----------------------------------
resolve_pw() {
  if [ -n "${KOSMOS_PW_NODE_PATH:-}" ]; then
    [ -d "$KOSMOS_PW_NODE_PATH/playwright" ] && { printf '%s' "$KOSMOS_PW_NODE_PATH"; return 0; }
    log "KOSMOS_PW_NODE_PATH=$KOSMOS_PW_NODE_PATH has no playwright in it." >&2
    return 1
  fi
  local c
  for c in "$HOME/work/pw-runtime/node_modules" "$HOME"/.npm/_npx/*/node_modules; do
    [ -d "$c/playwright" ] && { printf '%s' "$c"; return 0; }
  done
  return 1
}

PW_NODE_PATH="$(resolve_pw || true)"
if [ -z "$PW_NODE_PATH" ]; then
  # 🛑 LOUD, NEVER SILENT. A page gate that cannot find a browser and passes
  # anyway is the exact "a check that cannot report its own weakness is not
  # reporting" failure. Block by default; an operator who means to skip must
  # say so, and even then it is said out loud.
  if [ "${KOSMOS_SKIP_BROWSER_CHECKS:-0}" = "1" ]; then
    log "‼️  BROWSER CHECKS SKIPPED: no Playwright found and KOSMOS_SKIP_BROWSER_CHECKS=1."
    log "‼️  The page layer is NOT covered by this run. This is a deliberate opt-out, printed so it is never mistaken for a pass."
    exit 0
  fi
  log "🛑 No Playwright found, so the page layer cannot be checked."
  log "   Provision one and re-run:"
  log "     PW=\$(mktemp -d); (cd \"\$PW\" && npm i playwright && npx playwright install chromium)"
  log "     KOSMOS_PW_NODE_PATH=\"\$PW/node_modules\" $0"
  log "   Or, to run the rest of the release without page coverage (said out loud): KOSMOS_SKIP_BROWSER_CHECKS=1"
  exit 2
fi
log "Playwright: $PW_NODE_PATH"

# --- a sandbox per check, cleaned up on exit --------------------------------
SANDBOXES=()
SERVER_PIDS=()
cleanup() {
  local pid sb
  for pid in "${SERVER_PIDS[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null; done
  for sb in "${SANDBOXES[@]:-}"; do [ -n "$sb" ] && rm -rf "$sb"; done
}
trap cleanup EXIT

new_sandbox() {
  local sb; sb="$(mktemp -d "${TMPDIR:-/tmp}/kosmos-bc.XXXXXX")"
  SANDBOXES+=("$sb")
  printf '%s' "$sb"
}

# Write a list-panes fixture so the board reports a fixture fleet (april,
# mikey), which the project and composition checks need on screen.
write_fleet() {
  local sb="$1"
  node -e "const f=require('./test-support/fleet');process.stdout.write([f.line({session:'april-discord'}),f.line({session:'mikey-discord'})].join('\n')+'\n')" \
    > "$sb/panes.txt"
}

# Boot node server.js sandboxed on $port with the fixture fleet. Echoes nothing;
# records the pid. Waits until /api/status answers.
boot_board() {
  local sb="$1" port="$2"
  write_fleet "$sb"
  AGENT_WORKFORCE_DATA="$sb/data" AGENT_WORKFORCE_WORKERS="$sb/workers" \
    AGENT_WORKFORCE_LAUNCH="$sb/launch" AGENT_WORKFORCE_PROJECTS="$sb/projects" \
    AGENT_WORKFORCE_TMUX_BIN="$FAKE_TMUX" AGENT_WORKFORCE_FAKE_PANES="$sb/panes.txt" \
    AGENT_WORKFORCE_RELEASE_BASE="http://127.0.0.1:9/dist" AGENT_WORKFORCE_DRY_RUN=1 \
    PORT="$port" node server.js > "$sb/server.log" 2>&1 &
  SERVER_PIDS+=("$!")
  wait_up "$port" "$sb/server.log"
}

# Boot the thread fixture server (self-sandboxing, its own fleet).
boot_thread_server() {
  local sb="$1" port="$2"
  AGENT_WORKFORCE_DATA="$sb/data" AGENT_WORKFORCE_WORKERS="$sb/workers" \
    AGENT_WORKFORCE_LAUNCH="$sb/launch" AGENT_WORKFORCE_PROJECTS="$sb/projects" \
    PORT="$port" node docs/browser-checks/thread-server.js > "$sb/server.log" 2>&1 &
  SERVER_PIDS+=("$!")
  wait_up "$port" "$sb/server.log"
}

wait_up() {
  local port="$1" logf="$2" i
  for i in $(seq 1 60); do
    curl -s "http://127.0.0.1:$port/api/status" >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  log "server on :$port never answered; log tail:"; tail -5 "$logf" 2>/dev/null
  return 1
}

# run_one <label> <cmd...>: run a check headless, retry ONCE on failure, and say
# out loud when it retried. A green that quietly retried is indistinguishable
# from a clean green, so the retry is always printed.
run_one() {
  local label="$1"; shift
  RAN+=("$label")
  sec "$label"
  if HEADED=0 NODE_PATH="$PW_NODE_PATH" "$@"; then
    log "PASS  $label"
    return 0
  fi
  log "⚠️  $label failed once, retrying (flaky-timeout guard). A retried pass is reported, not hidden."
  RETRIED+=("$label")
  if HEADED=0 NODE_PATH="$PW_NODE_PATH" "$@"; then
    log "PASS  $label (on retry — treat repeated retries as a finding, not noise)"
    return 0
  fi
  log "FAIL  $label (failed twice)"
  FAILED+=("$label")
  return 1
}

# free-ish ports, distinct per check
P1=17341; P2=17342; P3=17343; P4=17344; P5=17345; P6=17346

# --- 1. regress-a-night: a night's releases still COMPOSE --------------------
# The one check that asserts the whole board still hangs together (three
# layouts, the switches, accounts, delete history, a task page with parts).
# Computed-state only, so headless is sound.
sb1="$(new_sandbox)"
if boot_board "$sb1" "$P1"; then
  # ⚠️ NODE_PATH on the --seed extraction too: regress-a-night.js requires
  # playwright at module load, BEFORE it reaches the --seed branch, so pulling
  # the seed lines out needs the browser resolvable even though the seed itself
  # never launches one. Without it the extraction printed nothing and the board
  # came up with no project, and the task-page click just timed out.
  seed_js="$(NODE_PATH="$PW_NODE_PATH" node docs/browser-checks/regress-a-night.js --seed)"
  AGENT_WORKFORCE_DATA="$sb1/data" AGENT_WORKFORCE_WORKERS="$sb1/workers" \
    AGENT_WORKFORCE_LAUNCH="$sb1/launch" AGENT_WORKFORCE_PROJECTS="$sb1/projects" \
    AGENT_WORKFORCE_TMUX_BIN="$FAKE_TMUX" AGENT_WORKFORCE_FAKE_PANES="$sb1/panes.txt" \
    node -e "$seed_js"
  run_one "regress-a-night" env KOSMOS_URL="http://127.0.0.1:$P1" node docs/browser-checks/regress-a-night.js
else
  FAILED+=("regress-a-night (server did not boot)")
fi

# --- 2. render-projects: the project page's honesty rules -------------------
sb2="$(new_sandbox)"
if boot_board "$sb2" "$P2"; then
  run_one "render-projects" node docs/browser-checks/render-projects.js \
    "http://127.0.0.1:$P2" "$sb2/shots" "$sb2"
else
  FAILED+=("render-projects (server did not boot)")
fi

# --- 3. render-thread: the send-capable thread, on the fixture server --------
# #540: a board with a stand-in codex, so the add-an-OpenAI-account flow can
# run for real with no real key. HOME is the sandbox too, so the account it
# makes lands under $sb4/home/.codex-<label>, never beside the operator's.
sb4="$(new_sandbox)"
mkdir -p "$sb4/home"
cat > "$sb4/fake-codex" <<'FAKE'
#!/bin/bash
[ "$1" = login ] && [ "$2" = --with-api-key ] || exit 2
key=$(cat); mkdir -p "$CODEX_HOME"; printf '{"auth_mode":"apikey","OPENAI_API_KEY":"%s"}' "$key" > "$CODEX_HOME/auth.json"
FAKE
chmod +x "$sb4/fake-codex"
write_fleet "$sb4"
AGENT_WORKFORCE_HOME="$sb4/home" AGENT_WORKFORCE_CODEX_BIN="$sb4/fake-codex" \
  AGENT_WORKFORCE_DATA="$sb4/data" AGENT_WORKFORCE_WORKERS="$sb4/workers" \
  AGENT_WORKFORCE_LAUNCH="$sb4/launch" AGENT_WORKFORCE_PROJECTS="$sb4/projects" \
  AGENT_WORKFORCE_TMUX_BIN="$FAKE_TMUX" AGENT_WORKFORCE_FAKE_PANES="$sb4/panes.txt" \
  AGENT_WORKFORCE_RELEASE_BASE="http://127.0.0.1:9/dist" AGENT_WORKFORCE_DRY_RUN=1 \
  PORT="$P4" node server.js > "$sb4/server.log" 2>&1 &
SERVER_PIDS+=("$!")
if wait_up "$P4" "$sb4/server.log"; then
  run_one "render-accounts-openai" node docs/browser-checks/render-accounts-openai.js "http://127.0.0.1:$P4"
else
  FAILED+=("render-accounts-openai (server did not boot)")
fi
# #529: the GitHub door, on two boards: gh absent, and a stand-in gh that
# signs in when a marker file appears. No real gh and no real GitHub.
sb5="$(new_sandbox)"; sb6="$(new_sandbox)"
cat > "$sb6/fake-gh" <<'FAKE'
#!/bin/bash
M="${FAKE_GH_MARK:-/tmp/fake-gh-mark}"
if [ "$1" = auth ] && [ "$2" = status ]; then [ -f "$M" ] && { echo "github.com"; echo "  ✓ Logged in to github.com account walker (keyring)"; exit 0; } || { echo "not logged in" >&2; exit 1; }; fi
if [ "$1" = auth ] && [ "$2" = login ]; then echo "! First copy your one-time code: WALK-1234" >&2; echo "Open this URL to continue in your web browser: https://github.com/login/device" >&2; for i in $(seq 1 60); do [ -f "$M" ] && exit 0; sleep 0.5; done; exit 1; fi
exit 2
FAKE
chmod +x "$sb6/fake-gh"; rm -f "$sb6/mark"
cat > "$sb6/fake-vercel" <<'FAKE'
#!/bin/bash
M="${FAKE_VERCEL_MARK:-/tmp/fake-vercel-mark}"
if [ "$1" = whoami ]; then [ -f "$M" ] && { echo "vwalker"; exit 0; } || { echo "Error: not signed in" >&2; exit 1; }; fi
if [ "$1" = login ]; then echo "  Visit https://vercel.com/oauth/device?user_code=VRCL-5678" >&2; echo "Waiting for authentication..." >&2; for i in $(seq 1 60); do [ -f "$M" ] && exit 0; sleep 0.5; done; exit 1; fi
exit 2
FAKE
chmod +x "$sb6/fake-vercel"; rm -f "$sb6/vmark"
write_fleet "$sb5"; write_fleet "$sb6"
AGENT_WORKFORCE_GH_BIN=/nonexistent/gh AGENT_WORKFORCE_VERCEL_BIN=/nonexistent/vercel AGENT_WORKFORCE_DATA="$sb5/data" AGENT_WORKFORCE_WORKERS="$sb5/workers" AGENT_WORKFORCE_LAUNCH="$sb5/launch" AGENT_WORKFORCE_PROJECTS="$sb5/projects" AGENT_WORKFORCE_TMUX_BIN="$FAKE_TMUX" AGENT_WORKFORCE_FAKE_PANES="$sb5/panes.txt" AGENT_WORKFORCE_RELEASE_BASE="http://127.0.0.1:9/dist" AGENT_WORKFORCE_DRY_RUN=1 PORT="$P5" node server.js > "$sb5/server.log" 2>&1 &
SERVER_PIDS+=("$!")
FAKE_GH_MARK="$sb6/mark" AGENT_WORKFORCE_GH_BIN="$sb6/fake-gh" FAKE_VERCEL_MARK="$sb6/vmark" AGENT_WORKFORCE_VERCEL_BIN="$sb6/fake-vercel" AGENT_WORKFORCE_DATA="$sb6/data" AGENT_WORKFORCE_WORKERS="$sb6/workers" AGENT_WORKFORCE_LAUNCH="$sb6/launch" AGENT_WORKFORCE_PROJECTS="$sb6/projects" AGENT_WORKFORCE_TMUX_BIN="$FAKE_TMUX" AGENT_WORKFORCE_FAKE_PANES="$sb6/panes.txt" AGENT_WORKFORCE_RELEASE_BASE="http://127.0.0.1:9/dist" AGENT_WORKFORCE_DRY_RUN=1 PORT="$P6" node server.js > "$sb6/server.log" 2>&1 &
SERVER_PIDS+=("$!")
if wait_up "$P5" "$sb5/server.log" && wait_up "$P6" "$sb6/server.log"; then
  curl -s -X POST "http://127.0.0.1:$P5/api/first-run/complete" >/dev/null; curl -s -X POST "http://127.0.0.1:$P6/api/first-run/complete" >/dev/null
  run_one "render-github-door" node docs/browser-checks/render-github-door.js "http://127.0.0.1:$P5" "http://127.0.0.1:$P6" "$sb6/mark" "$sb6/vmark"
else
  FAILED+=("render-github-door (a server did not boot)")
fi
sb3="$(new_sandbox)"
if boot_thread_server "$sb3" "$P3"; then
  run_one "render-thread" node docs/browser-checks/render-thread.js \
    "http://127.0.0.1:$P3" "$sb3/shots" "$sb3/server.log"
else
  FAILED+=("render-thread (server did not boot)")
fi

# --- report -----------------------------------------------------------------
sec "browser checks summary"
log "ran:     ${RAN[*]:-none}"
[ "${#RETRIED[@]}" -gt 0 ] && log "retried: ${RETRIED[*]}  (repeated retries are a flake to fix, not to accept)"
if [ "${#FAILED[@]}" -gt 0 ]; then
  log "FAILED:  ${FAILED[*]}"
  exit 1
fi
log "all page checks passed"
exit 0
