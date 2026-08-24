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
P1=17341; P2=17342; P3=17343; P4=17344

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
