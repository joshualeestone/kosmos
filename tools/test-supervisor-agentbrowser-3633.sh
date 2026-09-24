#!/bin/bash
# #3633: the Mac launch hands a Claude agent its own private browser.
#
# bin/agent-supervisor.sh asks engine/agent-browser-config.js for a config path on
# the Claude arm and adds `--mcp-config <path>` only when one comes back. This
# drives the real supervisor against a stub tmux that records the `new-session`
# argv (the test-supervisor-model-2140.sh harness), with the real engine through
# `engine-path` (test-supervisor-env.sh arm 2) and a sandboxed runners folder, in
# three states:
#   - installed  -> `--mcp-config <existing file>` right before --dangerously-skip-permissions
#   - not installed -> no --mcp-config at all (a flag naming a missing file stops claude)
#   - KOSMOS_AGENT_BROWSER=off -> no --mcp-config
#   - the opt-out FILE (the Mac's real path: launchd does not pass the operator's
#     env to the supervisor) -> no --mcp-config
# The "installed" state is made by the real ensureInstalled/ensureShell with their
# download/unpack/prove seams stubbed, so the markers are exactly what the code
# checks, and no browser is downloaded.
AGENT_WORKFORCE_DATA="$(mktemp -d)"; export AGENT_WORKFORCE_DATA
trap 'rm -rf "$AGENT_WORKFORCE_DATA" "${SB1:-}" "${SB2:-}" "${SB3:-}" "${SB4:-}"' EXIT

set -u
cd "$(dirname "$0")/.." || exit 1
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }

make_sandbox() {
  local dir="$1"
  mkdir -p "$dir/bin" "$dir/work" "$dir/runners"
  cp bin/agent-supervisor.sh "$dir/bin/agent-supervisor.sh"
  printf '%s\n' "$PWD/engine" > "$dir/bin/engine-path"
  cat > "$dir/tmux" <<'STUB'
#!/bin/sh
case "$1" in
  has-session) exit 1 ;;
  new-session) printf '%s\n' "$@" > "$STUB_DIR/new-session.args"; exit 0 ;;
  *) exit 0 ;;
esac
STUB
  chmod 755 "$dir/tmux"
}

# Mark the pinned server and this Mac's shell as installed, through the real code.
fake_install() {
  AGENT_WORKFORCE_RUNNERS_DIR="$1/runners" node -e '
    const fs = require("fs"), path = require("path");
    const ab = require("./engine/agentbrowser");
    const PIN = ab.PIN, build = ab.SHELL.builds[process.arch];
    (async () => {
      const a = await ab.ensureInstalled({
        download: async (url, file) => fs.writeFileSync(file, url),
        integrityOf: async (file) => PIN.packages.find((p) => p.url === fs.readFileSync(file, "utf8")).integrity,
        unpack: async (tgz, dest) => fs.writeFileSync(path.join(dest, dest.endsWith("mcp") ? "cli.js" : "package.json"), "//"),
        prove: async () => "Version " + PIN.version,
      });
      const b = await ab.ensureShell({
        download: async (url, file) => fs.writeFileSync(file, "zip"),
        sha256Of: async () => build.sha256,
        unzip: async (zip, dest) => { fs.mkdirSync(path.join(dest, build.folder), { recursive: true }); fs.writeFileSync(path.join(dest, build.folder, "chrome-headless-shell"), ""); },
        proveShell: async () => "Google Chrome for Testing " + ab.SHELL.version,
      });
      if (!a.ok || !b.ok) { console.error(JSON.stringify({ a, b })); process.exit(1); }
    })();'
}

run_claude() {
  local dir="$1"; shift
  env "$@" STUB_DIR="$dir" AGENT_WORKFORCE_RUNNERS_DIR="$dir/runners" AGENT_WORKFORCE_WAIT_POLL_SECS=1 \
    bash "$dir/bin/agent-supervisor.sh" ab-3633 "$dir/work" /usr/bin/true "$dir/tmux" "$dir/start.log" "" claude \
    > "$dir/out.log" 2>&1 || true
}

# --- Arm 1: installed -> --mcp-config <file>, before the permissions flag ------
SB1="$(mktemp -d)"; make_sandbox "$SB1"
if fake_install "$SB1"; then ok "the fake install marked the server and this Mac's shell installed"; else bad "the fake install failed"; fi
run_claude "$SB1"
A="$SB1/new-session.args"
if [ -s "$A" ]; then ok "installed: the supervisor reached new-session"; else bad "installed: new-session never reached: $(tail -3 "$SB1/out.log")"; fi
cfg="$(grep -A1 -x -- '--mcp-config' "$A" | sed -n 2p)"
if [ -n "$cfg" ]; then ok "installed: the claude launch carries --mcp-config"; else bad "installed: no --mcp-config in the launch: $(tr '\n' ' ' < "$A")"; fi
if [ -n "$cfg" ] && [ -f "$cfg" ] && grep -q '"kosmos-browser"' "$cfg" && grep -q -- '--executable-path' "$cfg"; then
  ok "installed: the flag names a file that exists and holds the Mac browser config"
else
  bad "installed: the --mcp-config file is missing or wrong: $cfg"
fi
nxt="$(grep -A2 -x -- '--mcp-config' "$A" | sed -n 3p)"
if [ "$nxt" = "--dangerously-skip-permissions" ]; then ok "installed: a flag follows the config path, so the variadic list ends there"; else bad "installed: after the config path came '$nxt'"; fi

# --- Arm 2: not installed -> no flag ------------------------------------------
SB2="$(mktemp -d)"; make_sandbox "$SB2"
run_claude "$SB2"
A="$SB2/new-session.args"
if [ -s "$A" ]; then ok "not installed: the supervisor still launched the agent"; else bad "not installed: new-session never reached: $(tail -3 "$SB2/out.log")"; fi
if grep -qx -- '--mcp-config' "$A"; then bad "not installed: --mcp-config was passed anyway: $(tr '\n' ' ' < "$A")"; else ok "not installed: no --mcp-config"; fi
# A started install creates its staging folder under runners/playwright-mcp before
# its first await, so any folder there means the launch path asked for one.
if [ -e "$SB2/runners/playwright-mcp" ]; then bad "not installed: the launch path started an install: $(ls -A "$SB2/runners/playwright-mcp")"; else ok "not installed: the launch path did not start an install"; fi

# --- Arm 3: installed but opted out -> no flag ---------------------------------
SB3="$(mktemp -d)"; make_sandbox "$SB3"
fake_install "$SB3" || bad "arm 3: the fake install failed"
run_claude "$SB3" KOSMOS_AGENT_BROWSER=off
A="$SB3/new-session.args"
if [ -s "$A" ] && ! grep -qx -- '--mcp-config' "$A"; then ok "KOSMOS_AGENT_BROWSER=off: launched with no --mcp-config"; else bad "opt-out: $(tr '\n' ' ' < "$A" 2>/dev/null)"; fi

# --- Arm 4: installed, opted out by the file -> no flag -------------------------
SB4="$(mktemp -d)"; make_sandbox "$SB4"
fake_install "$SB4" || bad "arm 4: the fake install failed"
: > "$SB4/runners/playwright-mcp/off"
run_claude "$SB4"
A="$SB4/new-session.args"
if [ -s "$A" ] && ! grep -qx -- '--mcp-config' "$A"; then ok "opt-out file: launched with no --mcp-config"; else bad "opt-out file: $(tr '\n' ' ' < "$A" 2>/dev/null)"; fi

echo
if [ "$FAILS" -eq 0 ]; then echo "all passed"; exit 0; fi
echo "$FAILS failed"; exit 1
