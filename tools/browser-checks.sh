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
# ⚠️ ONE RUN DIRECTORY, REMOVED WHOLE. The first version kept an array of
# sandboxes and removed each on exit, and it never removed one: new_sandbox
# is called as `sb="$(new_sandbox)"`, a subshell, so the append to the array
# happened in a copy and cleanup saw an empty list. 200 leaked sandboxes,
# 131 MB, in TMPDIR by 2026-08-24 18:20, and a "gates running" signal in
# tools/run-tests.sh that counted them as 200 live gates (#708). Every sandbox
# now lives under one per-run directory, and cleanup removes that directory.
# Servers were never affected: boot_board appends to SERVER_PIDS directly.
RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/kosmos-bc.XXXXXX")"
SERVER_PIDS=()
cleanup() {
  local pid
  for pid in "${SERVER_PIDS[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null; done
  rm -rf "$RUN_DIR"
}
trap cleanup EXIT

new_sandbox() {
  local sb; sb="$(mktemp -d "$RUN_DIR/sb.XXXXXX")"
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
# A red must say WHY in the summary, or it gets re-run instead of read (#616:
# the gate now asks 28 checks, and a label alone is a coin to flip). Each
# attempt's output is captured as well as streamed, and on the final failure
# the check's own FAIL and error lines are kept and printed under its label.
REASONS=()
run_one() {
  local label="$1"; shift
  local cap; cap="$(mktemp "${TMPDIR:-/tmp}/kosmos-bc-out.XXXXXX")"
  RAN+=("$label")
  sec "$label"
  HEADED=0 NODE_PATH="$PW_NODE_PATH" "$@" 2>&1 | tee "$cap"; local rc="${PIPESTATUS[0]}"
  if [ "$rc" -eq 0 ]; then
    log "PASS  $label"; rm -f "$cap"
    return 0
  fi
  # ⚠️ 126 AND 127 ARE NOT ASSERTIONS. They mean the thing could not be run
  # at all (a binary missing, like `timeout` on macOS, or not executable),
  # and they were read as four failed checks on 2026-08-24 by the person who
  # wrote this line. A gate must still refuse on them, and it must not retry
  # them (the binary will not appear), and it must say what they are.
  if [ "$rc" -eq 126 ] || [ "$rc" -eq 127 ]; then
    log "COULD NOT RUN  $label (exit $rc: a program it needs is missing or not executable; this is not an assertion failing)"
    FAILED+=("$label")
    REASONS+=("$label:"$'\n'"           exit $rc: could not run, a program it needs is missing or not executable. Read the line above the exit, not the assertions.")
    rm -f "$cap"
    return 1
  fi
  log "⚠️  $label failed once, retrying (flaky-timeout guard). A retried pass is reported, not hidden."
  RETRIED+=("$label")
  if HEADED=0 NODE_PATH="$PW_NODE_PATH" "$@" 2>&1 | tee "$cap"; [ "${PIPESTATUS[0]}" -eq 0 ]; then
    log "PASS  $label (on retry — treat repeated retries as a finding, not noise)"; rm -f "$cap"
    return 0
  fi
  log "FAIL  $label (failed twice)"
  FAILED+=("$label")
  local why; why="$(grep -E '^\s*(FAIL|✖)|Error|Timeout|REFUS|refus' "$cap" | grep -vE '^\s*at ' | head -3 | cut -c1-200 | sed 's/^/           /')"
  REASONS+=("$label:"$'\n'"${why:-           (no FAIL or error line in its output; read the full log)}")
  rm -f "$cap"
  return 1
}

# free-ish ports, distinct per check
# Ports come from the OS, one per boot, chosen at the moment this run starts
# (#633). They used to be fixed (17341 to 17347), and two runs of this script
# on one Mac, the release gate and a person's own check, talked to each
# other's boards and then lost them when the other run ended: a red that read
# as a flaky check and was a collision. A port the kernel just handed out is
# free for this run alone; the window between picking and binding is a few
# milliseconds and two runs started seconds apart never share one. The
# chosen ports are printed so a log can be read back against a boot.
free_port() {
  node -e 'const s=require("node:net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})'
}
pick_ports() {
  local picked=() p n
  while [ "${#picked[@]}" -lt 9 ]; do
    p="$(free_port)"
    for n in ${picked[@]+"${picked[@]}"}; do [ "$n" = "$p" ] && p=""; done
    [ -n "$p" ] && picked+=("$p")
  done
  P1="${picked[0]}"; P2="${picked[1]}"; P3="${picked[2]}"; P4="${picked[3]}"; P5="${picked[4]}"; P6="${picked[5]}"; P7="${picked[6]}"; P8="${picked[7]}"; P9="${picked[8]}"
}
pick_ports
log "ports for this run: $P1 $P2 $P3 $P4 $P5 $P6 $P7 $P8 $P9 (chosen by the OS, #633)"

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
# #529/#620: the doors, on two boards: gh absent (the no-install road, against a stub GitHub), and a stand-in gh that
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
AGENT_WORKFORCE_GH_BIN=/nonexistent/gh AGENT_WORKFORCE_VERCEL_BIN=/nonexistent/vercel AGENT_WORKFORCE_GITHUB_DEVICE_URL="http://127.0.0.1:$P9/device" AGENT_WORKFORCE_GITHUB_TOKEN_URL="http://127.0.0.1:$P9/token" AGENT_WORKFORCE_GITHUB_VERIFY_URL="http://127.0.0.1:$P9/user" AGENT_WORKFORCE_DATA="$sb5/data" AGENT_WORKFORCE_WORKERS="$sb5/workers" AGENT_WORKFORCE_LAUNCH="$sb5/launch" AGENT_WORKFORCE_PROJECTS="$sb5/projects" AGENT_WORKFORCE_TMUX_BIN="$FAKE_TMUX" AGENT_WORKFORCE_FAKE_PANES="$sb5/panes.txt" AGENT_WORKFORCE_RELEASE_BASE="http://127.0.0.1:9/dist" AGENT_WORKFORCE_DRY_RUN=1 PORT="$P5" node server.js > "$sb5/server.log" 2>&1 &
SERVER_PIDS+=("$!")
FAKE_GH_MARK="$sb6/mark" AGENT_WORKFORCE_GH_BIN="$sb6/fake-gh" FAKE_VERCEL_MARK="$sb6/vmark" AGENT_WORKFORCE_VERCEL_BIN="$sb6/fake-vercel" AGENT_WORKFORCE_CLOUDFLARE_VERIFY_URL="http://127.0.0.1:$P7/verify" AGENT_WORKFORCE_DATA="$sb6/data" AGENT_WORKFORCE_WORKERS="$sb6/workers" AGENT_WORKFORCE_LAUNCH="$sb6/launch" AGENT_WORKFORCE_PROJECTS="$sb6/projects" AGENT_WORKFORCE_TMUX_BIN="$FAKE_TMUX" AGENT_WORKFORCE_FAKE_PANES="$sb6/panes.txt" AGENT_WORKFORCE_RELEASE_BASE="http://127.0.0.1:9/dist" AGENT_WORKFORCE_DRY_RUN=1 PORT="$P6" node server.js > "$sb6/server.log" 2>&1 &
SERVER_PIDS+=("$!")
if wait_up "$P5" "$sb5/server.log" && wait_up "$P6" "$sb6/server.log"; then
  curl -s -X POST "http://127.0.0.1:$P5/api/first-run/complete" >/dev/null; curl -s -X POST "http://127.0.0.1:$P6/api/first-run/complete" >/dev/null
  run_one "render-github-door" node docs/browser-checks/render-github-door.js "http://127.0.0.1:$P5" "http://127.0.0.1:$P6" "$sb6/mark" "$sb6/vmark" "$P7" "$P9"
else
  FAILED+=("render-github-door (a server did not boot)")
fi
# #616: every check that was green on a clean main in #545's count, and was
# not wired, now runs here. Two groups. The first shares one board with
# first run completed through the product's own route (on a fresh board the
# first-run pane sits on top of Settings and a check clicks a paragraph).
# render-offline-note goes LAST on that board on purpose: it kills the server
# it loads from, and anything scheduled after it on the same board reads as
# a dead check. The second group boots its own fixture server in-process
# and runs bare. A check nobody asks a question of is a script; these are
# now asked one every release.
sb7="$(new_sandbox)"
if boot_board "$sb7" "$P8"; then
  curl -s -X POST "http://127.0.0.1:$P8/api/first-run/complete" >/dev/null
  B8="http://127.0.0.1:$P8"
  B8_PID="${SERVER_PIDS[${#SERVER_PIDS[@]}-1]}"   # the board just booted, for render-offline-note to take away by pid (#708)
  run_one "contrast"            env KOSMOS_URL="$B8" node docs/browser-checks/contrast.js
  run_one "named-controls"      env KOSMOS_URL="$B8" node docs/browser-checks/named-controls.js
  run_one "render-create-form"  node docs/browser-checks/render-create-form.js "$B8"
  run_one "render-found-undo"   node docs/browser-checks/render-found-undo.js "$B8"
  run_one "render-made-endings" node docs/browser-checks/render-made-endings.js "$B8"
  run_one "render-rename-say"   node docs/browser-checks/render-rename-say.js "$B8"
  run_one "render-role-limit"   node docs/browser-checks/render-role-limit.js "$B8"
  run_one "render-role-order"   node docs/browser-checks/render-role-order.js "$B8"
  run_one "render-reload-toast"  env KOSMOS_URL="$B8" node docs/browser-checks/render-reload-toast.js "$sb7/shots-reload"
  run_one "render-updates-stale" env KOSMOS_URL="$B8" node docs/browser-checks/render-updates-stale.js "$sb7/shots-updates"
  run_one "render-switch-states" env KOSMOS_URL="$B8" node docs/browser-checks/render-switch-states.js
  run_one "render-theme-toggle"  env KOSMOS_URL="$B8" node docs/browser-checks/render-theme-toggle.js "$sb7/shots-toggle"
  run_one "render-offline-note"  env KOSMOS_URL="$B8" node docs/browser-checks/render-offline-note.js "$sb7/shots-offline" "$B8_PID"
else
  for n in contrast named-controls render-create-form render-found-undo render-made-endings render-rename-say render-role-limit render-role-order render-reload-toast render-updates-stale render-switch-states render-theme-toggle render-offline-note; do FAILED+=("$n (server did not boot)"); done
fi
for n in live-connect render-agent-nav render-busy-line render-made-before render-memory-words render-org-drag render-pjsettings render-settings-nav render-talk-search render-talk render-tasks render-url-state; do
  run_one "$n" node "docs/browser-checks/$n.js"
done
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
  log "why, from each check's own output (the full log has the rest):"
  for r in ${REASONS[@]+"${REASONS[@]}"}; do log "  $r"; done
  exit 1
fi
log "all page checks passed"
exit 0
