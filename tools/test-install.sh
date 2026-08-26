#!/bin/bash
# The install lifecycle, as a runnable regression test.
#
# Everything the installer's comments describe as measured-and-fixed (the
# staged swap, the identity probes, the honest refusals, the reversible
# uninstall) was verified by hand at least once; this harness is what keeps
# those verifications true without a human re-driving them. It runs the real
# setup.sh, piped into `sh` from stdin the way the marketing line does, with
# EVERY root the scripts write to overridden into a disposable sandbox.
#
# ⚠️ NOT part of plain `yarn test`, deliberately: it needs the staged trees
# in dist/ (build them first: tools/build-tmux-bundle.sh and
# tools/build-kosmos-bundle.sh, KOSMOS_ALLOW_MINOS=1 for a dev machine),
# it binds a TCP port, and it starts and stops real processes. Run it as
# `yarn test:install` before shipping installer changes.
#
# ⚠️ SAFE ON A MACHINE WITH A REAL BOARD: the port is probed free first,
# every root is under mktemp, and nothing touches launchd or tmux state
# outside the sandbox (the launchd dir is overridden; the tmux ownership
# predicate keeps session kills away from anything not marked ours).
# LaunchServices too: setup.sh skips lsregister whenever a sandbox
# override is set, so sandbox bundles never enter the operator's real
# machine-global database (dozens of dead mktemp paths had registered
# under the production bundle id before that gate existed).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETUP="$HERE/install/setup.sh"
TMUX_SRC="$HERE/dist/tmux-bundle"
KOS_SRC="$HERE/dist/kosmos-bundle"

if [ ! -d "$TMUX_SRC" ] || [ ! -d "$KOS_SRC" ]; then
  echo "SKIP: dist/ staged trees missing. Build them first:" >&2
  echo "  KOSMOS_ALLOW_MINOS=1 tools/build-tmux-bundle.sh dist" >&2
  echo "  KOSMOS_ALLOW_MINOS=1 tools/build-kosmos-bundle.sh dist" >&2
  exit 1
fi

# ---- the disk, before a byte is written (#736) -------------------------------
# A full run holds every sandbox home's Node runtime and, before the shared
# Claude Code below, a 345 MB Claude Code per home: ~4 GB for eleven homes,
# which took this Mac to 288 MB free with five agents working. Refuse under
# 3 GB and name the disk; tools/test-disk-guard.sh shows the guard red and green.
. "$HERE/tools/lib/disk-guard.sh"
kosmos_require_free_mb "${KOSMOS_HARNESS_MIN_FREE_MB:-3072}" "${TMPDIR:-/tmp}" "a full install-harness run" || exit 1
# ---- a cut, before a port is taken (#708) ------------------------------------
# Two copies of this gate on one Mac poison each other (fixed ports, the real
# folder fingerprints, the gui launchd domain); measured 2026-08-26 01:29. A
# cut's own run (KOSMOS_INSTALL_GATE=1) is the cut and never refuses itself;
# tools/test-cut-guard.sh shows the guard red and green.
. "$HERE/tools/lib/cut-guard.sh"
if [ "${KOSMOS_INSTALL_GATE:-0}" != 1 ] && [ "${KOSMOS_HARNESS_IGNORE_CUT:-0}" != 1 ]; then
  kosmos_refuse_if_cut_live "a full install-harness run" || exit 1
fi
SB="$(mktemp -d)"
# ---- ONE Claude Code for every sandbox home (#736) --------------------------
# setup.sh's "Kosmos needs Claude Code and this Mac does not have it" step runs
# Anthropic's real installer into any home without one: 345 MB downloaded per
# sandbox home, eleven homes a run. The engine, the installer and create.js all
# honour AGENT_WORKFORCE_CLAUDE_BIN, so every home is pointed at one shared
# binary: the operator's real Claude Code when this Mac has one, else a stub
# that answers --version (nothing in this harness ever starts an agent). The
# FIRST install leg below keeps the real download as the positive control that
# the carry still works; it clears the seam for that one command.
mkdir -p "$SB/claude-shared"
_real_claude="${HOME}/.local/bin/claude"
[ -f "$_real_claude" ] && [ -x "$_real_claude" ] || _real_claude="$(command -v claude 2>/dev/null || true)"
if [ -n "$_real_claude" ] && [ -f "$_real_claude" ] && [ -x "$_real_claude" ]; then
  ln -s "$_real_claude" "$SB/claude-shared/claude"
  echo "claude for sandbox homes: shared, $_real_claude"
else
  printf '#!/bin/sh\ncase "$1" in --version) echo "0.0.0 (harness stub, not Claude Code)";; *) echo "harness stub: not Claude Code" >&2; exit 64;; esac\n' > "$SB/claude-shared/claude"
  chmod +x "$SB/claude-shared/claude"
  echo "claude for sandbox homes: stub (this Mac has no Claude Code)"
fi
export AGENT_WORKFORCE_CLAUDE_BIN="$SB/claude-shared/claude"
# The board-kill list is a glob, not a hardcoded home/home2/... list: a
# future pass that adds a seventh sandbox home must not silently leak a
# board process onto the operator's machine.
# The kill skips this shell's own pid: the stale-pidfile fixture seeds $$
# as a live-but-not-a-board pid, and the first version of this trap
# SIGTERMed the harness itself right after printing the summary.
# ⚠️ TWO SWEEPS, AND THE SECOND EXISTS BECAUSE THE FIRST LEAKED TWICE (#231).
# The pidfile glob only finds boards that wrote "$SB"/home*/board.pid; on
# 2026-08-21 two suite-started servers survived their worktree's removal
# (one answering as Kosmos on the product's default port for 24 minutes).
# Anything whose COMMAND LINE references this sandbox dies with the suite:
# every server the suite can start is launched by a path under $SB, so
# pgrep -f "$SB" is a complete inventory, and it cannot reach unrelated
# processes because $SB is a fresh mktemp path no one else names.
trap 'for _p in "$SB"/home*/board.pid; do if [ -f "$_p" ]; then _k="$(cat "$_p" 2>/dev/null)"; [ "$_k" = "$$" ] || kill "$_k" 2>/dev/null || true; fi; done; for _k in $(pgrep -f "$SB" 2>/dev/null); do [ "$_k" = "$$" ] || kill "$_k" 2>/dev/null || true; done; chflags -R nouchg "$SB" 2>/dev/null || true; chmod -R u+w "$SB" 2>/dev/null || true; echo "sandbox size at exit: $(du -sh "$SB" 2>/dev/null | cut -f1) (deleted now; keeping one is #736)"; rm -rf "$SB"' EXIT
mkdir -p "$SB/data" "$SB/launch"

# 🛑 REAL CONTENT IN THE DATA FOLDER, BEFORE ANYTHING RUNS. The "user data
# untouched" check further down asserted only that the DIRECTORY still
# existed, and this folder was created empty, so it passed on an uninstall
# that had emptied it and would have passed on one that emptied it every
# time. The most consequential promise either path makes is that a person's
# agents, projects and history are not deleted, and it was resting on
# `[ -d ]` against nothing.
#
# ⚠️ Shapes the product really writes, so a sweep keyed on any of them would
# find these: a JSON record, a per-agent folder, and a dot-file.
mkdir -p "$SB/data/projects" "$SB/data/agents/harness-agent"
printf '{"name":"Josh","does":"Runs a company"}' > "$SB/data/you.json"
printf 'their own words\n' > "$SB/data/agents/harness-agent/CLAUDE.md"
printf '[{"id":"p1","name":"A project"}]' > "$SB/data/projects/projects.json"
printf 'x' > "$SB/data/.hidden-record"
DATA_FINGERPRINT="$(cd "$SB/data" && find . -type f -exec shasum {} \; | sort)"
# 🔑 THE PERSON'S FILES AND THE APP'S OWN PLUMBING ARE DIFFERENT QUESTIONS, and
# one whole-tree comparison could not tell them apart. It went red the day the
# board began installing its agent supervisor at boot -- `create.installSupervisor`
# writes `AgentWorkforce/bin/agent-supervisor.sh`, which has to be current for an
# agent to survive a restart at all. Nothing of the person's was touched: one file
# APPEARED, and an equality check called the upgrade promise broken while it was
# being kept.
#
# ⚠️ SPLIT RATHER THAN LOOSENED, and the split is STRICTER than what it replaces.
# Three claims, each able to fail alone: every seeded file is byte for byte what
# it was, nothing the person had has vanished, and the additions are EXACTLY the
# ones we expect. A surprise write into the data directory still fails, and now it
# fails by naming itself.
data_paths() { (cd "$SB/data" && find . -type f | sort); }
data_hashes() { (cd "$SB/data" && find . -type f -exec shasum {} \; | sort); }
DATA_PATHS_BEFORE="$(data_paths)"
# Two files, not one, since #745: the board refreshes BOTH the supervisor and
# the codex notify bridge into the person's bin/ at start (server.js ->
# create.installSupervisor). Before #745 the bridge's source was missing from
# every served bundle, so the copy threw and only the supervisor ever landed;
# the release gate (#624) then read that broken state as the expectation and
# refused the first bundle that carried the fix. Sorted, the way comm emits.
EXPECTED_ADDS="$(printf '%s\n' ./AgentWorkforce/bin/agent-supervisor.sh ./AgentWorkforce/bin/codex-report-bridge.js)"

# ⚠️ THE PRODUCT'S DEFAULT PORT, RECORDED BEFORE ANYTHING RUNS, and checked
# again at the end. Found by Splinter, 2026-08-21: a test run left a board
# answering on the default port from a deleted worktree, and the installer's
# own fresh-path probe then met it and explained it as "another account on this
# Mac" -- a confident wrong cause about our own litter.
# 🔑 A LEAK ON ANY OTHER PORT IS UNTIDY; A LEAK ON THIS ONE ANSWERS AS KOSMOS
# to the next person who installs. That asymmetry is why this one port gets a
# check of its own rather than a general no-leaks sweep, which would need to
# know which of a dev machine's boards were already there.
# 🛑 READ FROM THE INSTALLER, NEVER TYPED HERE. A literal 16180 in this file is
# a copy of a value that has already moved once tonight (4317 -> 16180), and a
# guard keyed on a superseded value passes while watching the wrong thing --
# which is the same defect class this check exists to catch. Derived, it cannot
# drift; if the extraction ever fails, that is loud rather than silently green.
# ⚠️ #910: THE PORT IS NO LONGER ONE LITERAL, it is uid 501 (the primary
# account, which is what THIS test-runner's own account and virtually
# every real single-user Mac already is) pinned to the unchanged value,
# with every other uid deriving an alternate. Extracted from setup.sh's
# own pinned-case line, which stays a plain literal for exactly this
# reason -- still "read from the installer, never typed here" in spirit,
# just reading the ONE line that answers "what does the account this
# harness actually runs as get" instead of a single global default that
# no longer exists.
KOSMOS_DEFAULT_PORT="$(sed -n 's/^  _kosmos_default_port=\([0-9][0-9]*\)$/\1/p' "$HERE/install/setup.sh" | head -1)"
[ -n "$KOSMOS_DEFAULT_PORT" ] || { echo "FAIL: could not read the default port out of install/setup.sh" >&2; exit 1; }
[ "$(/usr/bin/id -u)" = 501 ] || echo "WARN: this harness is not running as uid 501 -- KOSMOS_DEFAULT_PORT ($KOSMOS_DEFAULT_PORT, the pinned-primary value) will not match this account's own derived port for the checks below that assume it does" >&2
DEFAULT_PORT_BEFORE=free
curl -s -m 1 -o /dev/null "http://127.0.0.1:$KOSMOS_DEFAULT_PORT/" 2>/dev/null && DEFAULT_PORT_BEFORE=busy

# A free port, probed rather than assumed: several agents and a real board
# share dev machines.
# ⚠️ 4460-4499 IS DELIBERATELY NOWHERE NEAR THE DEFAULT. Anything this suite
# leaks must be litter rather than something a real install would find.
PORT=4460
while curl -s -m 1 -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; do
  PORT=$((PORT + 1))
  [ "$PORT" -lt 4500 ] || { echo "FAIL: no free port found in 4460-4499" >&2; exit 1; }
done

export KOSMOS_HOME="$SB/home" KOSMOS_BIN_DIR="$SB/bin" KOSMOS_APP_DIR="$SB/apps"
export KOSMOS_PROFILE_FILE="$SB/zprofile"
# SHELL pinned for determinism only (belt and suspenders): with
# KOSMOS_PROFILE_FILE exported above, setup.sh's non-zsh hedge is
# unreachable in this run regardless of SHELL; the pin keeps that true
# even if the hedge's precedence ever changes.
export SHELL=/bin/zsh
printf '# the operator\047s own line\n' > "$SB/zprofile"
export KOSMOS_TMUX_SRC="$TMUX_SRC" KOSMOS_SRC="$KOS_SRC" KOSMOS_PORT="$PORT"
# 🔑 #908: every board this gate starts logs its requests OUTSIDE the sandbox
# (server.js), so the next time the byte-for-byte check names
# seen-version.json (#891) the log names the client that loaded the page.
# 🛑 BY PATH, NEVER BY EXPORTING KOSMOS_INSTALL_GATE=1 HERE: that flag is
# this file's own release-gate short mode (line ~740, #624), and the first
# version of this block exported it, turning every full run into the
# 81-check short run without a word. A cut already sets the flag (and so
# gets the log); a full run names the path. It outlives the sandbox and the
# run; read it with `grep " GET / " ~/.claude/logs/install-gate-requests.log`.
export KOSMOS_INSTALL_GATE_LOG="${KOSMOS_INSTALL_GATE_LOG:-$HOME/.claude/logs/install-gate-requests.log}"
echo "request log for every sandboxed board: $KOSMOS_INSTALL_GATE_LOG (#908)"
export AGENT_WORKFORCE_DATA="$SB/data" AGENT_WORKFORCE_LAUNCH="$SB/launch"
# 🛑 EVERY ROOT THE GATE NAMES, AND AN INERT TMUX, or the board this harness
# installs refuses to start (#634): a sandbox with some roots live is the
# exact thing the app now refuses, and it refused this harness at its first
# install the evening the gate merged (2026-08-24). DRY_RUN=1 is what makes
# every board's tmux sends no-ops here (the harness never sets TMUX_BIN, so
# install/kosmos may hand a board the machine's tmux); the install's own
# tmux (bundled, sandboxed) is untouched.
# ⚠️ AND THE TWO ROOTS THE GATE DOES NOT NAME: the claude config (which
# engine/trust.js WRITES through) and the config root. Left unset they are
# the operator's real ~/.claude.json and config, for every board this
# harness starts; the build's smoke test sandboxes both, so does this.
# tools/test-build-smoke-sandbox.sh audits these exports against the gate.
export AGENT_WORKFORCE_PROJECTS="$SB/projects" AGENT_WORKFORCE_WORKERS="$SB/workers" AGENT_WORKFORCE_DRY_RUN=1
export AGENT_WORKFORCE_CLAUDE_CONFIG="$SB/claude.json" AGENT_WORKFORCE_CONFIG_ROOT="$SB/config"
# A test that steals the operator's browser is a test nobody runs twice:
# every pass suppresses the fresh-install open unless it deliberately
# substitutes the recording stub below to assert the open itself.
export KOSMOS_NO_OPEN=1
# Points the system-folder probe at a directory that must stay EMPTY for
# every pass that sets KOSMOS_APP_DIR: the override must bypass the probe
# entirely, or every sandboxed run on a dev machine would be creating and
# removing directories in the real /Applications.
mkdir -p "$SB/sysnever"
export KOSMOS_SYS_APP_DIR="$SB/sysnever"
# The directory's fractional mtime, not its contents: a probe that mkdirs
# and then rmdirs leaves the folder empty, so an emptiness check cannot
# fail for the thing it names. A create-and-remove does move the mtime.
SYSNEVER_MTIME="$(stat -f %Fm "$SB/sysnever")"
# A convention-not-enforcement net for the operator's REAL folders: the
# probe passes below run with KOSMOS_APP_DIR deliberately empty, relying on
# every such invocation also overriding HOME. Snapshot the real folders and
# fail loudly at the end if anything changed them.
# Names alone cannot see an in-place replacement (the single most likely
# real-folder mutation on a dev machine with a real Kosmos install), so the
# snapshot hashes name + mtime + size of every top-level entry.
real_apps_fingerprint() {
  # ⚠️ A MISSING FOLDER FINGERPRINTS AS "absent", IT DOES NOT KILL THE RUN.
  # A never-touched Mac has no ~/Applications until something creates it,
  # and under set -euo pipefail a failing find aborted the whole harness
  # with zero output before a single assertion ran (measured with
  # HOME=/tmp/kosmos-nohome: exit 1, no sentences). %Fm not %m, so a
  # same-second create-and-delete still moves the fingerprint.
  [ -d "$1" ] || { printf 'absent\n'; return 0; }
  find "$1" -maxdepth 1 -exec stat -f '%N %Fm %z' {} \; 2>/dev/null | sort | shasum | cut -d' ' -f1 || true
}
REAL_HOME_APPS_BEFORE="$(real_apps_fingerprint "$HOME/Applications")"
REAL_SYS_APPS_BEFORE="$(real_apps_fingerprint /Applications)"
cat > "$SB/open-stub" <<EOS
#!/bin/sh
echo "\$@" >> "$SB/opened.log"
EOS
chmod +x "$SB/open-stub"

PASS=0; FAIL=0; SKIPS=0
chk() {
  if eval "$2"; then PASS=$((PASS + 1)); echo "PASS  $1"
  else FAIL=$((FAIL + 1)); echo "FAIL  $1"; fi
}
# Exit codes read as verdicts (#785). rc_ok is "exited 0" and, when it did
# not, says the code, naming 126 and 127 as could-not-run (a program missing
# or not executable) rather than a failed assertion. rc_refused is "exited
# non-zero on purpose": a 126 or 127 is NOT a refusal, it is the thing not
# running at all, and before this a tampered download that could not run
# passed the "refuses" check.
rc_say() {
  case "$1" in
    126|127) echo "      exit $1: could not run (a program missing or not executable), not a failed assertion" ;;
    *) echo "      exit $1" ;;
  esac
}
rc_ok() { [ "$1" -eq 0 ] && return 0; rc_say "$1"; return 1; }
rc_refused() {
  case "$1" in
    0) echo "      exit 0: it did not refuse"; return 1 ;;
    126|127) rc_say "$1"; return 1 ;;
    *) return 0 ;;
  esac
}

seed_kosmos_bundle() { # $1 = Applications dir, $2 = the KOSMOS_HOME it bakes
  mkdir -p "$1/Kosmos.app/Contents/MacOS"
  printf '#!/bin/bash\nKOSMOS_HOME="${KOSMOS_HOME:-%s}"\n' "$2" > "$1/Kosmos.app/Contents/MacOS/Kosmos"
}
seed_residue() { # $1 = full residue path, $2 = the KOSMOS_HOME it bakes
  mkdir -p "$1/Contents/MacOS"
  printf '#!/bin/bash\nKOSMOS_HOME="${KOSMOS_HOME:-%s}"\n' "$2" > "$1/Contents/MacOS/Kosmos"
}

# The closing "nothing leaked" checks and the summary, as functions: the
# release gate (below, KOSMOS_INSTALL_GATE=1) runs them after the install
# passes and exits before the probe blocks; the full run reaches them at the
# end. Everything they read is set before the first install.
closing_checks() {
  echo "== no sandbox path entered LaunchServices =="
  # The lsregister sandbox gate had only a comment behind it; this converts
  # it into a fact. (The dump is a few seconds; it is the one machine-global
  # database a sandboxed run used to pollute.)
  LSDUMP="$SB/lsdump.txt"
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -dump > "$LSDUMP" 2>/dev/null || true
  chk "the LaunchServices dump is non-empty (the control can see)" "[ -s \"$LSDUMP\" ]"
  chk "no sandbox path registered with LaunchServices" "! grep -qF \"$SB\" \"$LSDUMP\""
  chk "sysnever still untouched at the end" "[ \"\$(stat -f %Fm \"$SB/sysnever\")\" = \"$SYSNEVER_MTIME\" ] && [ -z \"\$(ls -A \"$SB/sysnever\")\" ]"

  echo "== nothing was left answering on the product's default port =="
  DEFAULT_PORT_AFTER=free
  curl -s -m 1 -o /dev/null "http://127.0.0.1:$KOSMOS_DEFAULT_PORT/" 2>/dev/null && DEFAULT_PORT_AFTER=busy
  # Same shape as the real-folders checks below: it reports the BEFORE state too,
  # because a machine that already had a board there is not this run's doing.
  chk "port $KOSMOS_DEFAULT_PORT is as we found it (was: $DEFAULT_PORT_BEFORE)" "[ \"$DEFAULT_PORT_AFTER\" = \"$DEFAULT_PORT_BEFORE\" ]"

  echo "== the operator's real folders were never touched (top-level entries) =="
  chk "real home Applications unchanged (a FAIL here can also mean something else changed it DURING the run; check before blaming the installer)" "[ \"\$(real_apps_fingerprint \"$HOME/Applications\")\" = \"$REAL_HOME_APPS_BEFORE\" ]"
  chk "real /Applications unchanged (a FAIL here can also mean something else changed it DURING the run; check before blaming the installer)" "[ \"\$(real_apps_fingerprint /Applications)\" = \"$REAL_SYS_APPS_BEFORE\" ]"
}
summary_and_exit() {
  echo
  if [ "$SKIPS" -gt 0 ]; then
    echo "$PASS passed, $FAIL failed, $SKIPS block(s) SKIPPED (a skipped run is NOT a full run)"
  else
    echo "$PASS passed, $FAIL failed"
  fi
  # An EXIT, not a test: as the script's last line the test's status was the
  # exit code; inside a function it was a return, and the gate printed its
  # summary and walked on into the probe blocks (measured).
  # In gate mode a SKIPPED block is a red: the gate promises the download
  # path (the artifact people receive), and a skipped pass is that promise
  # not kept, not a pass.
  if [ "${KOSMOS_INSTALL_GATE:-0}" = 1 ] && [ "$SKIPS" -gt 0 ]; then
    echo "GATE: $SKIPS block(s) were SKIPPED; a skipped pass is not a passed one"; exit 1
  fi
  if [ "$FAIL" -eq 0 ]; then exit 0; else exit 1; fi
}

echo "== install (piped into sh, local sources, port $PORT) =="
# The ONE real Claude Code download of the run (the positive control for the
# carry): the shared seam is cleared for this command only.
RC=0; cat "$SETUP" | AGENT_WORKFORCE_CLAUDE_BIN= sh > "$SB/install.log" 2>&1 || RC=$?
chk "install exits 0" "rc_ok $RC"
# #916: the two files the added-files check expects (bin/agent-supervisor.sh,
# bin/codex-report-bridge.js) are written by the BOARD at boot (server.js,
# create.installSupervisor() right after listen), and the installer starts the
# board and exits without waiting for it. Under load (16.8 on 0.5.40a) the
# diff below ran before node reached that line and reported both files
# "expected, not added" on a correct bundle. So the diff waits for the board's
# first answer, bounded; "board answers" further down still reports the
# boot itself, and a board that never answers gets the same red it always did,
# now after 30s rather than by luck.
_boot_wait=0; until curl -s -m 2 -o /dev/null "http://127.0.0.1:$PORT/"; do
  _boot_wait=$((_boot_wait+1)); [ "$_boot_wait" -ge 60 ] && { echo "note: the board did not answer within 30s of install exit; the data-folder diff runs anyway"; break; }; sleep 0.5
done
# 🔑 THE UPGRADE PATH, ASSERTED HERE AND NOT ONLY AFTER THE UNINSTALL. An
# update re-runs THIS installer over an existing install (engine/update.js
# fetches /setup and runs it), so "install does not touch the person's data" is
# the upgrade promise, and it is the one nobody tests because the machine you
# build on already has data and you would notice. Checked at both ends so a
# failure names the right actor: the post-uninstall comparison alone would
# report an install that ate the data as an uninstall bug.
SURVIVED="$(printf '%s\n' "$DATA_FINGERPRINT" | while read -r _h _f; do
  [ -n "${_f:-}" ] || continue
  printf '%s  %s\n' "$(shasum "$SB/data/$_f" 2>/dev/null | cut -d' ' -f1)" "$_f"
done)"
EXPECTED_SURVIVORS="$(printf '%s\n' "$DATA_FINGERPRINT" | while read -r _h _f; do
  [ -n "${_f:-}" ] || continue
  printf '%s  %s\n' "$_h" "$_f"
done)"
ADDED="$(printf '%s\n' "$DATA_PATHS_BEFORE" > "$SB/.before.txt"; data_paths > "$SB/.after.txt"; comm -13 "$SB/.before.txt" "$SB/.after.txt")"
GONE="$(comm -23 "$SB/.before.txt" "$SB/.after.txt")"

chk "installing over an existing home leaves the person's own files byte for byte" \
  "[ \"\$SURVIVED\" = \"\$EXPECTED_SURVIVORS\" ]"
chk "and nothing the person had is gone" "[ -z \"\$GONE\" ]"
chk "and the only things it added are the supervisor and the codex bridge the agents point at" \
  "[ \"\$ADDED\" = \"\$EXPECTED_ADDS\" ]"
# A mismatch names its paths. The 0.5.24 cut went red on this check with a
# correct bundle and the red named no file, so learning which one meant
# reproducing the run. Every grep pipeline ends "|| true" because the harness
# runs under pipefail and an empty grep here once ended the run after the first
# red; an empty list says "(none)" rather than printing a blank entry. The cut
# (release.sh step 4b) carries these indented lines to its own output.
if [ "$ADDED" != "$EXPECTED_ADDS" ]; then
  _extra="$(printf '%s\n' "$ADDED" | grep -vxF -f <(printf '%s\n' "$EXPECTED_ADDS") | grep -v '^$' || true)"
  _short="$(printf '%s\n' "$EXPECTED_ADDS" | grep -vxF -f <(printf '%s\n' "$ADDED") | grep -v '^$' || true)"
  if [ -z "$_extra" ] && [ -z "$_short" ]; then
    echo "   the same paths, but not the same text (order, a repeat, or a blank); added:"; printf '%s\n' "$ADDED" | sed 's/^/      /'
    echo "   expected:"; printf '%s\n' "$EXPECTED_ADDS" | sed 's/^/      /'
  else
    echo "   added, not expected:"; if [ -n "$_extra" ]; then printf '%s\n' "$_extra" | sed 's/^/      /'; else echo "      (none)"; fi
    echo "   expected, not added:"; if [ -n "$_short" ]; then printf '%s\n' "$_short" | sed 's/^/      /'; else echo "      (none)"; fi
  fi
fi
chk "board answers" "curl -s -m 2 -o /dev/null http://127.0.0.1:$PORT/"
chk "command works through the symlink" "\"$SB/bin/kosmos\" status | grep -q running"
chk "app bundle created" "[ -x \"$SB/apps/Kosmos.app/Contents/MacOS/Kosmos\" ]"
# The PATH wiring lands in the SANDBOX profile (the sandbox bin dir is not
# on this shell's PATH, so the wiring arm must fire), exactly once, and a
# pre-existing line survives.
chk "PATH wiring wrote the sandbox profile" "grep -qxF '# kosmos: PATH for the kosmos command (removed by --uninstall)' \"$SB/zprofile\""
chk "PATH wiring wrote the export line (the functional half)" "grep -qF \"$SB/bin\" \"$SB/zprofile\""
chk "the gold-K icon landed inside the app, intact" "[ \"\$(shasum -a 256 \"$SB/apps/Kosmos.app/Contents/Resources/Kosmos.icns\" 2>/dev/null | cut -d' ' -f1)\" = \"\$(shasum -a 256 \"$KOS_SRC/app/assets/Kosmos.icns\" | cut -d' ' -f1)\" ]"
chk "the bundle declares its architecture (no Rosetta prompt)" "grep -q 'LSArchitecturePriority' \"$SB/apps/Kosmos.app/Contents/Info.plist\" && grep -q 'arm64' \"$SB/apps/Kosmos.app/Contents/Info.plist\""
chk "VERSION record installed" "[ -f \"$SB/home/VERSION\" ]"
# 🛑 THE BOARD'S LOGIN JOB. Its absence is what made a reboot look like total
# failure on 2026-08-22: the board died with the machine, nothing started it,
# and the browser's cached page then reported six separate "we could not check
# this computer" panels for one dead process.
# #883: KOSMOS_HOME here is "$SB/home", never the real default, so the
# board label carries the derived suffix -- computed the same way setup.sh
# derives it, so this assertion tracks real behavior rather than assuming
# the bare label a non-default KOSMOS_HOME no longer gets.
BOARD_LABEL_SUFFIX="$(printf '%s' "$SB/home" | shasum -a 256 | cut -c1-8)"
BOARD_PLIST="$SB/launch/com.kosmos.board.$BOARD_LABEL_SUFFIX.plist"
# #513: THE TRANSCRIPT MUST PROVE THE GUARD HELD. Under the sandbox the
# registration is skipped on purpose; a transcript that still promised
# "Kosmos will start itself" could not tell a working guard from a broken
# one, so the sentence pair is pinned both ways: the skip said, the
# promise absent. These two pins cover the NARRATION; the ACT (no launchd
# job pointing at the sandbox) is proven by the launchctl probe a few
# lines below, and neither subsumes the other: a regression that
# registered for real while still saying "skipped" passes this pair and
# fails that probe.
chk "the sandboxed transcript says the registration was skipped" "grep -q 'registering it with launchd was skipped on purpose' \"$SB/install.log\""
chk "the sandboxed transcript does not promise a login start it never registered" "! grep -q 'Kosmos will start itself when you log in' \"$SB/install.log\""
chk "the board gets a login job" "[ -f \"$BOARD_PLIST\" ]"
chk "the login job starts THIS install's command" "grep -qF \"$SB/home/bin/kosmos\" \"$BOARD_PLIST\" && grep -q '<string>start</string>' \"$BOARD_PLIST\""
chk "the login job runs at login" "grep -q '<key>RunAtLoad</key><true/>' \"$BOARD_PLIST\""
# ⚠️ Both of these were learned by bisecting a hand-written copy of this file
# on the fleet Mac, and neither is cosmetic. launchd sets no PATH and no LANG:
# without LANG tmux sanitises its format output, replacing the tab separators,
# and every agent comes back on the board named `angel-discord_0.0_2.1.223_…`.
chk "the login job carries a UTF-8 locale (tmux mangles its output without one)" "grep -q 'en_US.UTF-8' \"$BOARD_PLIST\""
chk "the login job carries this install's bundled tmux on PATH" "grep -qF \"$SB/home/tmux/bin\" \"$BOARD_PLIST\""
# The icon bakes the install-time port; a login job on the DEFAULT port would
# start a second board the icon never opens.
chk "the login job carries this install's port" "grep -qF \"<key>KOSMOS_PORT</key><string>$PORT</string>\" \"$BOARD_PLIST\""
chk "the login job is well-formed plist XML" "plutil -lint \"$BOARD_PLIST\" >/dev/null 2>&1"
# ⚠️ A SANDBOXED RUN MUST NOT REGISTER A REAL JOB. AGENT_WORKFORCE_LAUNCH
# points the plist at a temp folder and launchd has no equivalent knob, so the
# installer skips launchctl entirely when that variable is set. Without the
# gate this harness would leave a job on the operator's machine that starts a
# board from a deleted mktemp tree at every login.
# ⚠️ ASKED AS "does any registered job point INTO THE SANDBOX", not as "does a
# job exist". The operator's own machine will carry a real com.kosmos.board
# once this ships, so an existence check would be permanently green for a
# reason that has nothing to do with this harness.
chk "a sandboxed install registered no launchd job pointing at the sandbox" \
  "! /bin/launchctl print \"gui/\$(/usr/bin/id -u)/com.kosmos.board\" 2>/dev/null | grep -qF \"$SB\""
chk "KOSMOS_APP_DIR bypasses the probe entirely" "[ \"\$(stat -f %Fm \"$SB/sysnever\")\" = \"$SYSNEVER_MTIME\" ] && [ -z \"\$(ls -A \"$SB/sysnever\")\" ]"
# ⚠️ THE GENERATED LAUNCHER IS A REAL GUI PROCESS NOW (#677), NOT A SHORT
# SCRIPT THAT EXITS: on success it runs a window's own event loop, and on
# this section's refusal path it blocks in an NSAlert modal nobody can
# click in a headless harness. Neither case returns control on its own, so
# nothing below waits for an exit code -- each launch runs detached, polls
# for the OBSERVABLE EFFECT that proves the branch was taken, then
# explicitly terminates it. Measured: waiting on an exit code here hung a
# run for 38 minutes before anyone noticed (#677 phase 3 postmortem). The
# suite's own EXIT trap (above) would eventually sweep an orphan by its
# $SB-containing command line, but only once the script itself exits --
# which a blocking foreground wait never allows, so it is not a substitute
# for this.
wait_for_file() {
  # $1: file to wait for (non-empty), $2: max whole seconds (bash has no
  # portable fractional sleep across macOS versions, so this polls once a
  # second rather than pretend to finer granularity).
  local f="$1" n="${2:-10}" i=0
  while [ ! -s "$f" ] && [ "$i" -lt "$n" ]; do sleep 1; i=$((i + 1)); done
  [ -s "$f" ]
}

# ⚠️ ACTUALLY LAUNCHING THE REAL COMPILED .app REGISTERS IT WITH
# LaunchServices, even run directly by path with lsregister never called --
# confirmed by hand (launched a throwaway .app, never touched lsregister,
# `lsregister -dump` showed it anyway). The old bash launcher never
# triggered this: it exited before AppKit ever activated. So every launch
# below unregisters its OWN path afterward, or the operator's REAL
# machine-global LaunchServices database gains a dead entry for a mktemp
# path that stops existing the moment this suite's EXIT trap runs -- the
# exact kind of stray entry closing_checks()'s "no sandbox path registered"
# check exists to catch. deregister_kosmos_app is the one place that does
# it, so it cannot drift out of step across the three call sites below.
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
deregister_kosmos_app() { "$LSREGISTER" -u "$SB/apps/Kosmos.app" >/dev/null 2>&1 || true; }

# The account that installed, using its own KOSMOS_HOME override: the
# guard must PASS (a uid compare, exactly the leg the old under-HOME proxy
# false-alarmed on), and `start` -- not `open`, which the old bash launcher
# invoked -- must be what it runs: the window IS what `open` used to open,
# so the compiled binary calls `kosmos start` directly and loads the board
# itself (#677 phase 2, native-app/main.swift's startBoard()). The stub
# home keeps the real board and the real browser out of it.
mkdir -p "$SB/fakehome/bin"
printf '#!/bin/sh\necho "$@" >> "%s/launcher.log"\nexit 0\n' "$SB" > "$SB/fakehome/bin/kosmos"
chmod +x "$SB/fakehome/bin/kosmos"
KOSMOS_HOME="$SB/fakehome" KOSMOS_APP_LOG="$SB/launcher-app.log" \
  "$SB/apps/Kosmos.app/Contents/MacOS/Kosmos" > /dev/null 2>&1 &
LAUNCHER_PID=$!
wait_for_file "$SB/launcher.log" 30 || true
kill "$LAUNCHER_PID" >/dev/null 2>&1 || true
wait "$LAUNCHER_PID" 2>/dev/null || true
deregister_kosmos_app
chk "launcher passes its own account and starts the board" "[ -s \"$SB/launcher.log\" ] && grep -qx 'start' \"$SB/launcher.log\""
chk "the launcher's baked port travels with it" "grep -q '\"port\":'\"$PORT\"'[,}]' \"$SB/apps/Kosmos.app/Contents/Resources/kosmos-install.json\""
# The NEGATIVE control: the refusal is the guard's whole purpose, and
# without this the entire uid block could be deleted while the suite
# stayed green. #677: a wrong owner can no longer be synthesized by
# sed-patching the compiled binary -- that is what threw "illegal byte
# sequence" the first time this ran -- so this patches a COPY of the real
# kosmos-install.json's ownerUid instead, fed back in through
# KOSMOS_APP_CONFIG, the same test-only seam the Swift code already reads.
# Still editing plain text, still no second real macOS account required.
WRONG_UID=$(( $(id -u) + 1 ))
sed -e "s/\"ownerUid\":[0-9]*/\"ownerUid\":$WRONG_UID/" \
  "$SB/apps/Kosmos.app/Contents/Resources/kosmos-install.json" > "$SB/wrong-owner-config.json"
LNS_BEFORE="$(wc -l < "$SB/launcher.log" | tr -d ' ')"
# 🛑 A SANDBOX HOME FOR THE OTHER ACCOUNT, AND NO KOSMOS_HOME OVERRIDE.
# Since #720 the launcher looks for the clicking account's OWN Kosmos and
# starts that. #677: Swift's NSHomeDirectory(), unlike bash's $HOME, does
# NOT honor an overridden environment variable at all (confirmed
# empirically), so this uses KOSMOS_APP_TEST_HOME, the seam that stands in
# for it in tests only -- with the real value this ran the operator's real
# board from inside the harness and the refusal never happened (#720,
# 2026-08-24, the bash-era version of the exact same mistake). An empty
# home is an account that never installed.
# ⚠️ env -u KOSMOS_HOME, NOT a bare KOSMOS_APP_CONFIG=... prefix: KOSMOS_HOME
# is EXPORTED well above (line 155, for the whole install/update/uninstall
# sweep) and stays live in every command's environment unless a command
# either overrides it (case A above does, with its own KOSMOS_HOME=...
# prefix) or removes it. Without -u this branch inherits the exported
# KOSMOS_HOME and resolveInstall's top-priority override branch fires
# instead of the uid-comparison branch this case exists to test --
# measured: it never reached "refused, no own install" at all.
mkdir -p "$SB/otherhome"
env -u KOSMOS_HOME KOSMOS_APP_CONFIG="$SB/wrong-owner-config.json" KOSMOS_APP_TEST_HOME="$SB/otherhome" KOSMOS_APP_LOG="$SB/refuse-app.log" \
  "$SB/apps/Kosmos.app/Contents/MacOS/Kosmos" > /dev/null 2>&1 &
REFUSE_PID=$!
_i=0
while ! grep -q 'refused, no own install' "$SB/refuse-app.log" 2>/dev/null && [ "$_i" -lt 30 ]; do sleep 1; _i=$((_i + 1)); done
REFUSED_LOGGED=1
grep -q 'refused, no own install' "$SB/refuse-app.log" 2>/dev/null || REFUSED_LOGGED=0
kill "$REFUSE_PID" >/dev/null 2>&1 || true
wait "$REFUSE_PID" 2>/dev/null || true
deregister_kosmos_app
chk "launcher refuses a different account (that has no Kosmos of its own)" "[ \"$REFUSED_LOGGED\" = 1 ] && [ \"\$(wc -l < \"$SB/launcher.log\" | tr -d ' ')\" = \"$LNS_BEFORE\" ]"
# And #720's own branch, on a stub: an account that HAS its own copy gets
# that one started (the stub records the call), never this icon's, and
# never anything real on this machine.
mkdir -p "$SB/ownhome/.local/share/kosmos/bin"
printf '#!/bin/sh\nprintf "%%s %%s\\n" "$1" "${KOSMOS_HOME:-}" >> "%s/own-open.log"\nexit 0\n' "$SB" > "$SB/ownhome/.local/share/kosmos/bin/kosmos"
chmod +x "$SB/ownhome/.local/share/kosmos/bin/kosmos"
# Same env -u KOSMOS_HOME reasoning as the case above.
env -u KOSMOS_HOME KOSMOS_APP_CONFIG="$SB/wrong-owner-config.json" KOSMOS_APP_TEST_HOME="$SB/ownhome" KOSMOS_APP_LOG="$SB/own-app.log" \
  "$SB/apps/Kosmos.app/Contents/MacOS/Kosmos" > /dev/null 2>&1 &
OWN_PID=$!
wait_for_file "$SB/own-open.log" 30 || true
kill "$OWN_PID" >/dev/null 2>&1 || true
wait "$OWN_PID" 2>/dev/null || true
deregister_kosmos_app
chk "an account with its own Kosmos gets that one started" "[ -s \"$SB/own-open.log\" ]"
chk "and it was THEIR copy that was called, with their home baked" "grep -q \"^start $SB/ownhome/.local/share/kosmos\" \"$SB/own-open.log\""
chk "and this icon's launcher log did not grow (nothing real was opened)" "[ \"\$(wc -l < \"$SB/launcher.log\" | tr -d ' ')\" = \"$LNS_BEFORE\" ]"

echo "== #910: per-account port derivation, shell and Swift agree =="
# 🔑 THE SAME FORMULA LIVES IN FOUR FILES (install/kosmos, install/setup.sh,
# install/pkg-scripts/postinstall, and native-app/main.swift, whose own
# kosmosDefaultPort() centralizes it for THREE call sites inside
# resolveInstall() plus the selftest hatch below) and has to move
# together. Bash-to-bash agreement is nearly free to
# assert (it is the same few lines, copied); the ONE cross-language
# boundary that could silently drift is bash vs. the compiled Swift binary,
# so that is the pairing actually worth testing here. main.swift carries a
# tiny, deliberate exit hatch for exactly this (`--kosmos-app-port-selftest
# <uid>`, same shape as the pre-existing `--kosmos-app-selftest` build-time
# check) -- nothing outside a compiled Swift binary can call
# kosmosDefaultPort() directly to compare against.
_kosmos_expected_port() { # $1 = uid
  if [ "$1" = 501 ]; then printf '16180'; else printf '%s' "$((16180 + 1 + ($1 % 3999)))"; fi
}
for _uid in 501 502 1000 4999 5000; do
  _expected="$(_kosmos_expected_port "$_uid")"
  _swift_got="$("$KOS_SRC/app/bin/kosmos-app" --kosmos-app-port-selftest "$_uid")"
  chk "uid $_uid: Swift's kosmosDefaultPort agrees with the shell formula ($_expected)" "[ \"$_swift_got\" = \"$_expected\" ]"
done
chk "uid 501 is pinned to the literal, unchanged default" "[ \"\$(_kosmos_expected_port 501)\" = 16180 ]"
chk "uid 1000 and uid 4999 wrap the same modulo to the identical port (1000 % 3999 = 4999 % 3999)" "[ \"\$(_kosmos_expected_port 1000)\" = \"\$(_kosmos_expected_port 4999)\" ]"
chk "the derived alternate never lands back on the pinned primary port" "[ \"\$(_kosmos_expected_port 502)\" != 16180 ]"
# ⚠️ WHAT THIS SECTION CANNOT PROVE, NAMED RATHER THAN LEFT IMPLICIT: none of
# the checks above exercise install/kosmos's or install/setup.sh's OWN
# embedded formula against a non-primary uid -- both call `/usr/bin/id -u`
# by absolute path (deliberately, matching this repo's own style for
# security-sensitive system binaries), which cannot be safely stubbed via a
# PATH trick, and this harness has no second real macOS account to run as.
# `_kosmos_expected_port` above is a SEPARATE, hand-written copy of the
# formula, so a bug in the real code that also happened to make its way
# into that copy would not be caught by it. What CAN be verified without a
# second real account: the two shell copies stay byte-identical to each
# other (a copy-paste drift between them would be silent otherwise, since
# every other scenario in this file always sets KOSMOS_PORT explicitly and
# never actually reaches either fallback).
# Located by its own distinctive first line, not a hardcoded line number --
# either file gaining or losing lines elsewhere would silently point a
# line-number-based extraction at the wrong content.
_kosmos_formula_from() { # $1 = file, reads from the anchor line through PORT=
  awk '/^_kosmos_uid="\$\(\/usr\/bin\/id -u\)"$/{f=1} f{print} f&&/^PORT="\$\{KOSMOS_PORT:-\$_kosmos_default_port\}"$/{exit}' "$1"
}
chk "install/kosmos's derivation block was found (or this check is vacuous)" "[ -n \"\$(_kosmos_formula_from "$HERE/install/kosmos")\" ]"
chk "install/setup.sh's derivation block was found (or this check is vacuous)" "[ -n \"\$(_kosmos_formula_from "$HERE/install/setup.sh")\" ]"
chk "install/kosmos and install/setup.sh carry the byte-identical derivation" \
  "diff <(_kosmos_formula_from \"$HERE/install/kosmos\") <(_kosmos_formula_from \"$HERE/install/setup.sh\") >/dev/null"

# 🔑 postinstall's KOSMOS_PORT guard, EXECUTED not just diffed: unlike the
# two shell files above (byte-identical to each other so a text diff is
# meaningful), postinstall names its own variables and can't run through
# setup.sh's own `sh < "$SETUP"` pipe (it needs CONSOLE_UID resolved and a
# real console session before it would ever reach this block). Extracted
# by its own distinctive anchors and actually sourced in a subshell with
# CONSOLE_UID/KOSMOS_PORT set, so a regression in the REAL code is caught,
# not a hand-copied duplicate of it.
_postinstall_port_block() {
  awk '/^_kosmos_port_ok=0$/{f=1} f{print} f&&/^fi$/{c++; if(c==2) exit}' "$HERE/install/pkg-scripts/postinstall"
}
chk "postinstall's KOSMOS_PORT guard block was found (or this check is vacuous)" "[ -n \"\$(_postinstall_port_block)\" ]"
_postinstall_page_port() { # $1 = CONSOLE_UID, $2 = KOSMOS_PORT (may be unset/empty)
  ( CONSOLE_UID="$1"; KOSMOS_PORT="${2:-}"; eval "$(_postinstall_port_block)"; printf '%s' "$_KOSMOS_PAGE_PORT" )
}
chk "a valid KOSMOS_PORT override is used as-is" "[ \"\$(_postinstall_page_port 502 8080)\" = 8080 ]"
chk "the boundary value 65535 is accepted" "[ \"\$(_postinstall_page_port 502 65535)\" = 65535 ]"
chk "an empty KOSMOS_PORT falls back to the derived default, not an error" "[ \"\$(_postinstall_page_port 502 '')\" = \"\$(_kosmos_expected_port 502)\" ]"
chk "a non-numeric KOSMOS_PORT falls back to the derived default (best-effort, never exits)" "[ \"\$(_postinstall_page_port 502 abc)\" = \"\$(_kosmos_expected_port 502)\" ]"
chk "a leading-zero KOSMOS_PORT falls back to the derived default" "[ \"\$(_postinstall_page_port 502 0070)\" = \"\$(_kosmos_expected_port 502)\" ]"
chk "an over-65535 KOSMOS_PORT falls back to the derived default" "[ \"\$(_postinstall_page_port 502 70000)\" = \"\$(_kosmos_expected_port 502)\" ]"
chk "an unset KOSMOS_PORT for uid 501 still pins the literal 16180" "[ \"\$(_postinstall_page_port 501)\" = 16180 ]"

echo "== update (stale file must not survive; board must restart) =="
touch "$SB/home/app/engine/stale-marker.js"
# #935: a bare `cat` here aborted the WHOLE SUITE under set -e when the pid
# file was not there yet (three times in a row under load 13-16, and once
# at load 2 on 2026-08-26), with no chk line to say why. Bounded wait, and
# an absent file becomes a NAMED value the "new pid" check below still
# compares against, so the run continues and the red says what it saw.
wait_for_file "$SB/home/board.pid" 30 || echo "note: $SB/home/board.pid absent after 30s before the update (the board from the install is not running or has not written its pid)"
PID1="$(cat "$SB/home/board.pid" 2>/dev/null || echo none)"
RC=0; cat "$SETUP" | sh > "$SB/update.log" 2>&1 || RC=$?
chk "update exits 0" "rc_ok $RC"
chk "stale file gone (swap, not merge)" "[ ! -e \"$SB/home/app/engine/stale-marker.js\" ]"
chk "board restarted (new pid)" "[ \"$PID1\" != \"$(cat "$SB/home/board.pid")\" ]"
chk "board serves after update" "curl -s -m 2 -o /dev/null http://127.0.0.1:$PORT/"
# The idempotency check lives HERE, after a SECOND install against the
# same profile: after one install a count of 1 is guaranteed even with
# the marker guard deleted, so a first-pass count check cannot fail.
chk "PATH wiring still written exactly once after a rerun" "[ \"\$(grep -cxF '# kosmos: PATH for the kosmos command (removed by --uninstall)' \"$SB/zprofile\")\" = 1 ]"

echo "== refusals speak sentences =="
OUT="$(sh -s -- --uninstal < "$SETUP" 2>&1 || true)"
chk "typo flag refuses instead of installing" "echo \"\$OUT\" | grep -q 'The only option is --uninstall'"

echo "== uninstall reverses the machine =="
# ⚠️ SEEDED THE WAY plistFor WRITES IT (#931): the uninstall now removes
# only a job whose ProgramArguments name THIS install's supervisor, so an
# empty <plist/> is, correctly, nobody's and survives. One of each here:
# ours must go, and the anonymous one must stay.
printf '<plist version="1.0"><dict><key>ProgramArguments</key><array><string>/bin/bash</string><string>%s/AgentWorkforce/bin/agent-supervisor.sh</string><string>tiharness</string></array></dict></plist>\n' "$SB/data" > "$SB/launch/com.kosmos.agent.tiharness.plist"
printf '<plist/>' > "$SB/launch/com.kosmos.agent.tinobody.plist"
seed_residue "$SB/apps/.Kosmos.app.stage.333" "$SB/home"
seed_residue "$SB/apps/.Kosmos.app.old.444" "$SB/home"
# 🔑 #891: THE APP'S OWN REMEMBERED ANSWERS, SEEDED THE WAY A REAL RUN WOULD
# LEAVE THEM (whats-new seen, first run completed, the found-agents card
# dismissed) so the byte-for-byte check below has something real to catch.
# Cut 0.5.32 attempt a caught exactly this shape live: one of these three
# (seen-version.json) appeared in a sandboxed data folder mid-gate and
# survived the uninstall (#889/#891). Seeded directly rather than driven
# through the routes that write them, matching this file's own precedent a
# few lines up (`seed_residue`) for a plumbing shape the product writes but
# this harness does not need to exercise the write path itself to prove the
# sweep.
mkdir -p "$SB/data/AgentWorkforce"
printf '{"completedAt":"2026-01-01T00:00:00.000Z"}' > "$SB/data/AgentWorkforce/first-run.json"
printf '{"version":"0.5.32"}' > "$SB/data/AgentWorkforce/seen-version.json"
printf '{"dismissedAt":"2026-01-01T00:00:00.000Z"}' > "$SB/data/AgentWorkforce/found-agents-dismissed.json"
# ⚠️ THE PREMISE OF THE REMOVAL CHECK, ASSERTED. The agent plist above is
# seeded here for exactly this reason; the board's is written by the install
# instead, so "it is gone" would pass vacuously on any run where it was never
# written — which is precisely the bug this change fixes.
chk "the board's login job is there before the uninstall (or its removal cannot fail)" "[ -f \"$BOARD_PLIST\" ]"
chk "the three remembered-answer files are there before the uninstall too" \
  "[ -f \"$SB/data/AgentWorkforce/first-run.json\" ] && [ -f \"$SB/data/AgentWorkforce/seen-version.json\" ] && [ -f \"$SB/data/AgentWorkforce/found-agents-dismissed.json\" ]"
RC=0; sh -s -- --uninstall < "$SETUP" > "$SB/uninstall.log" 2>&1 || RC=$?
chk "uninstall exits 0" "rc_ok $RC"
chk "home gone" "[ ! -d \"$SB/home\" ]"
chk "symlink gone" "[ ! -e \"$SB/bin/kosmos\" ] && [ ! -L \"$SB/bin/kosmos\" ]"
chk "app gone" "[ ! -d \"$SB/apps/Kosmos.app\" ]"
chk "override-branch stage and aside residue swept" "[ ! -e \"$SB/apps/.Kosmos.app.stage.333\" ] && [ ! -e \"$SB/apps/.Kosmos.app.old.444\" ]"
# #891: the app's remembered answers do not survive the uninstall either.
chk "first-run.json swept" "[ ! -e \"$SB/data/AgentWorkforce/first-run.json\" ]"
chk "seen-version.json swept" "[ ! -e \"$SB/data/AgentWorkforce/seen-version.json\" ]"
chk "found-agents-dismissed.json swept" "[ ! -e \"$SB/data/AgentWorkforce/found-agents-dismissed.json\" ]"
chk "agent plist removed" "[ ! -e \"$SB/launch/com.kosmos.agent.tiharness.plist\" ]"
chk "a job naming no supervisor of ours survives the uninstall (#931)" "[ -e \"$SB/launch/com.kosmos.agent.tinobody.plist\" ]"
# ⚠️ THE BOARD'S JOB DOES NOT MATCH THE AGENTS' GLOB, so it needs its own
# removal and its own check. Left behind it runs a deleted `kosmos` at every
# login forever, invisible to somebody who believes they uninstalled Kosmos.
# #883: asserted against the DERIVED (suffixed) label, and also against the
# bare label -- the uninstall path must find the suffixed file it should
# actually be removing, not accidentally "succeed" by finding nothing at a
# name that was never written in the first place.
chk "the board's login job removed" "[ ! -e \"$BOARD_PLIST\" ]"
chk "no stray bare-label plist exists to be confused with it" "[ ! -e \"$SB/launch/com.kosmos.board.plist\" ]"
chk "user data folder survives" "[ -d \"$SB/data\" ]"
# ⚠️ BYTE FOR BYTE, not merely present. The directory check above cannot tell
# a preserved folder from an emptied one, and an uninstall that deleted a
# person's agents while leaving the folder would have passed it.
# ⚠️ ON FAILURE THIS CHECK NAMES THE FILE. It used to print PASS or FAIL and
# nothing else, and the EXIT trap then deleted the sandbox: the gate knew a
# byte had changed and could not say which. Cut 0.5.32 attempt a died on it
# (2026-08-25, #889) and the only way to learn what was written was to rebuild
# the bundle by hand and run a patched copy. The diff below is the patched
# copy, made permanent: `<` lines are the fingerprint before the install,
# `>` lines are the folder after the uninstall; a file that appears only on the
# right was left behind, one on both sides with different hashes was changed.
if [ "$(data_hashes)" = "$DATA_FINGERPRINT" ]; then
  chk "every user file survives the uninstall byte for byte" true
else
  chk "every user file survives the uninstall byte for byte" false
  echo "      the data folder is not byte for byte what was seeded (< before install, > after uninstall):"
  # ⚠️ `|| true`, or this diagnostic ends the suite: diff exits 1 whenever
  # the folders differ (which is the only time this branch runs), pipefail
  # carries it, and set -e aborts with ~200 checks unrun and no summary
  # line (seen 2026-08-26, #891's red, twice in a row).
  diff <(printf '%s\n' "$DATA_FINGERPRINT") <(data_hashes) | sed 's/^/      /' || true
fi
# POSITIVE CONTROL: the fingerprint is not empty, so the comparison above is
# comparing something. An empty string equals an empty string.
# ⚠️ `grep -c .` COUNTS LINES; `printf '%s' | wc -l` COUNTS NEWLINES and so
# under-reports by one on a string with no trailing newline. The first version
# used the latter against a threshold of 4 with 4 files seeded, so the control
# failed while the thing it guards was working perfectly. A control that cries
# wolf gets deleted, which would have left the vacuous comparison standing.
chk "the fingerprint covers real files" \
  "[ \"\$(printf '%s\\n' \"\$DATA_FINGERPRINT\" | grep -c .)\" -ge 4 ]"
chk "PATH wiring removed from the sandbox profile" "! grep -q kosmos \"$SB/zprofile\""
chk "the export line came out too (adjacency arm has a check that can fail)" "! grep -qF \"$SB/bin\" \"$SB/zprofile\""
chk "the operator's own profile line survives" "grep -q 'own line' \"$SB/zprofile\""
# The ADJACENCY arm specifically: install and uninstall above shared one
# BIN_DIR, so the exact-text match alone would have passed. Plant a
# marker + export naming a DIFFERENT bin dir (the changed-KOSMOS_BIN_DIR
# case the regex exists for) and run the uninstall again.
printf '%s\nexport PATH="/different/bin:$PATH"\n' '# kosmos: PATH for the kosmos command (removed by --uninstall)' >> "$SB/zprofile"
RC=0; sh -s -- --uninstall < "$SETUP" > "$SB/uninstall2.log" 2>&1 || RC=$?
chk "second uninstall exits 0" "rc_ok $RC"
chk "adjacency arm removed an export from a DIFFERENT bin dir" "! grep -q '/different/bin' \"$SB/zprofile\""
chk "the operator's line still survives the second sweep" "grep -q 'own line' \"$SB/zprofile\""
# The pre-existing-backup HALT arm: a prior failed run's preserved copy
# must never be overwritten or removed by a later run, and the profile
# must not be edited while it stands (new safety code gets its own
# check that can fail, or it is the least trustworthy code in the file).
printf '%s\nexport PATH="/halt/bin:$PATH"\n' '# kosmos: PATH for the kosmos command (removed by --uninstall)' >> "$SB/zprofile"
printf 'PRESERVED FROM AN EARLIER RUN\n' > "$SB/zprofile.kosmos-uninstall-backup"
cp "$SB/zprofile" "$SB/zprofile.before-halt"
RC=0; sh -s -- --uninstall < "$SETUP" > "$SB/uninstall3.log" 2>&1 || RC=$?
chk "halt-arm uninstall exits 0" "rc_ok $RC"
chk "a pre-existing backup halts the edit (profile untouched)" "cmp -s \"$SB/zprofile\" \"$SB/zprofile.before-halt\""
chk "the preserved backup survives byte-identical" "[ \"\$(cat \"$SB/zprofile.kosmos-uninstall-backup\")\" = 'PRESERVED FROM AN EARLIER RUN' ]"
chk "the halt names the backup in its note" "grep -q 'already exists from an earlier run' \"$SB/uninstall3.log\""
rm -f "$SB/zprofile.kosmos-uninstall-backup" "$SB/zprofile.before-halt"
chk "port released (uninstall stopped the board itself)" "! curl -s -m 1 -o /dev/null http://127.0.0.1:$PORT/"

echo "== the download path (file:// origin, no local-copy shortcut) =="
# The local-copy branch above never runs reachable(), verify_download() or
# tar; the release path must be driven too, and curl serves file:// for
# both probes, so no server is needed. A flipped byte in the sidecar must
# refuse in a sentence.
mkdir -p "$SB/dist"
# ⚠️ A missing tarball SKIPS ONLY THIS BLOCK, loudly and counted. The first
# version exited 0 here, so a machine with the staged trees but not the
# packed tarballs ran none of the later passes and still printed "N
# passed, 0 failed" -- a partial run indistinguishable from a full one.
if cp "$HERE/dist/tmux-arm64.tar.gz" "$HERE/dist/tmux-arm64.tar.gz.sha256" \
   "$HERE/dist/kosmos-arm64.tar.gz" "$HERE/dist/kosmos-arm64.tar.gz.sha256" "$SB/dist/" 2>/dev/null; then
  unset KOSMOS_TMUX_SRC KOSMOS_SRC
  export KOSMOS_RELEASE_BASE="file://$SB/dist"
  RC=0; cat "$SETUP" | sh > "$SB/dl-install.log" 2>&1 || RC=$?
  chk "download-path install exits 0" "rc_ok $RC"
  chk "download-path board answers" "curl -s -m 2 -o /dev/null http://127.0.0.1:$PORT/"
  "$SB/bin/kosmos" stop > /dev/null 2>&1 || true
  sh -s -- --uninstall < "$SETUP" > /dev/null 2>&1 || true
  printf 'x' >> "$SB/dist/kosmos-arm64.tar.gz"
  RC=0; cat "$SETUP" | sh > "$SB/tamper.log" 2>&1 || RC=$?
  chk "tampered download refuses" "rc_refused $RC"
  chk "tamper refusal speaks a sentence" "grep -q 'did not arrive intact' \"$SB/tamper.log\""
  chk "no stage residue after refusal" "[ -z \"\$(ls -d \"$SB/home\"/.kosmos.stage.* 2>/dev/null)\" ]"

  echo "== the pointer pins the bytes (the 0.5.13 wedge, 2026-08-24) =="
  # Repair the tarball the tamper pass above flipped a byte in.
  cp "$HERE/dist/kosmos-arm64.tar.gz" "$SB/dist/kosmos-arm64.tar.gz"
  BUNDLE_V="$(tar -xzOf "$SB/dist/kosmos-arm64.tar.gz" app/package.json | sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
  if [ -n "$BUNDLE_V" ]; then
    # (a) With the pointer naming the bundle and versioned artifacts
    # published, the installer prefers the versioned name and the
    # read-back confirms what landed.
    printf '{"version":"%s"}\n' "$BUNDLE_V" > "$SB/dist/latest.json"
    cp "$SB/dist/kosmos-arm64.tar.gz" "$SB/dist/kosmos-$BUNDLE_V-arm64.tar.gz"
    cp "$SB/dist/kosmos-arm64.tar.gz.sha256" "$SB/dist/kosmos-$BUNDLE_V-arm64.tar.gz.sha256"
    RC=0; cat "$SETUP" | sh > "$SB/pinned.log" 2>&1 || RC=$?
    chk "pinned install exits 0" "rc_ok $RC"
    chk "the run names its target version" "grep -q \"installs Kosmos $BUNDLE_V\" \"$SB/pinned.log\""
    chk "the versioned artifact name was fetched" "grep -q \"kosmos-$BUNDLE_V-arm64.tar.gz\" \"$SB/pinned.log\""
    chk "the read-back states what is on disk" "grep -q \"on disk now: Kosmos $BUNDLE_V\" \"$SB/pinned.log\""
    "$SB/bin/kosmos" stop > /dev/null 2>&1 || true
    sh -s -- --uninstall < "$SETUP" > /dev/null 2>&1 || true
    # (b) THE WEDGE ITSELF: the pointer moves ahead while the only bytes
    # reachable are the previous release (a stale cache in miniature:
    # no versioned artifact for the new version, the plain name still
    # holding old bytes). The installer must refuse in a sentence and
    # exit non-zero, never print done over the old version.
    printf '{"version":"9.9.9-wedge"}\n' > "$SB/dist/latest.json"
    RC=0; cat "$SETUP" | sh > "$SB/stale.log" 2>&1 || RC=$?
    chk "stale-bytes install refuses (exit non-zero)" "rc_refused $RC"
    chk "the refusal names both versions" "grep -q 'release pointer says 9.9.9-wedge' \"$SB/stale.log\" && grep -q \"files that landed are $BUNDLE_V\" \"$SB/stale.log\""
    chk "no false installed-done over old bytes" "! grep -q 'on disk now: Kosmos' \"$SB/stale.log\""
    rm -f "$SB/dist/latest.json" "$SB/dist/kosmos-$BUNDLE_V-arm64.tar.gz" "$SB/dist/kosmos-$BUNDLE_V-arm64.tar.gz.sha256"
  else
    echo "SKIP pointer-pins passes: could not read the bundle version"
    SKIPS=$((SKIPS + 1))
  fi
else
  echo "SKIP download-path passes: packed tarballs missing from dist/ (later passes still run)"
  SKIPS=$((SKIPS + 1))
fi

# ---- the release gate stops here (#624) --------------------------------------
# KOSMOS_INSTALL_GATE=1 is what release.sh step 4b runs on the bundle it just
# built: the passes above prove the bundle INSTALLS (a real setup.sh run from
# the staged trees, the update, the uninstalls, and the download path from the
# packed tarballs, the artifact people actually receive), then the closing
# checks that nothing leaked out of the sandbox, and the summary. The probe
# blocks below exercise the installer's icon and ownership rules, which are
# not what a cut is asking, and they carry fixtures of their own.
# ⚠️ A gate that ran only bash -n on this file was the hole: a change to the
# bundle SHAPE (a file the installer's post-extract check expects, a changed
# extract) byte-compared served==built perfectly and could still not install.
# tools/test-install-gate-control.sh proves the gate reds on such a bundle.
if [ "${KOSMOS_INSTALL_GATE:-0}" = 1 ]; then
  echo "== release gate: stopping before the probe blocks (KOSMOS_INSTALL_GATE=1) =="
  closing_checks
  summary_and_exit
fi

echo "== the Applications probe (system folder when writable, home when not) =="
# ⚠️ These passes leave KOSMOS_APP_DIR EMPTY on purpose -- they exercise the
# very branches that override bypasses -- so every OTHER root the probe code
# can touch is pointed into the sandbox instead: KOSMOS_SYS_APP_DIR replaces
# /Applications and HOME replaces the real home. A fallback that only ever
# runs where the primary works is untested by construction; the probe's
# failure leg is the one a standard (non-admin) user lives on.
export KOSMOS_TMUX_SRC="$TMUX_SRC" KOSMOS_SRC="$KOS_SRC"
unset KOSMOS_RELEASE_BASE
SBH="$SB/probe-home"
SYS_OK="$SB/sysapps"
mkdir -p "$SBH" "$SYS_OK"
# A stale icon from a pre-2026-08-13 install: the system-folder install must
# clean it up, or the machine keeps two Kosmos icons, one of them dead-stale.
# The fixture is a REAL bundle carrying the launcher line, because the
# cleanup (rightly) demands proof of ownership before deleting; a bare
# directory would pin nothing but the ownership refusal.
seed_kosmos_bundle "$SBH/Applications" "$SB/home2"
export KOSMOS_HOME="$SB/home2" KOSMOS_BIN_DIR="$SB/bin2"
# KOSMOS_NO_OPEN is cleared and the open command is the recording stub, so
# this pass also pins the one behavior a hardcoded /usr/bin/open hid from
# the suite: a fresh install invokes the open, an update does not.
# KOSMOS_PROFILE_FILE is emptied HERE, deliberately: with a sandbox
# override present (SYS_APP_DIR) and no profile named, the profile gate
# must SKIP -- this is the arm that stops a harness run writing the
# operator's real ~/.zprofile (leaked once, 2026-08-18, before the gate).
RC=0; cat "$SETUP" | HOME="$SBH" KOSMOS_HOME_APP_DIR="$SBH/Applications" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_OK" KOSMOS_PROFILE_FILE= KOSMOS_NO_OPEN= KOSMOS_OPEN_CMD="$SB/open-stub" sh > "$SB/probe1.log" 2>&1 || RC=$?
chk "the profile gate skipped: no zprofile written under the sandbox HOME" "[ ! -e \"$SBH/.zprofile\" ]"
chk "probe install exits 0" "rc_ok $RC"
chk "app landed in the system folder" "[ -x \"$SYS_OK/Kosmos.app/Contents/MacOS/Kosmos\" ]"
chk "transcript names Applications" "grep -q 'you will find it in Applications, as Kosmos' \"$SB/probe1.log\""
chk "stale home-folder icon cleaned up" "[ ! -d \"$SBH/Applications/Kosmos.app\" ]"
chk "the move is named in the transcript" "grep -q 'icon moved here' \"$SB/probe1.log\""
chk "no probe residue in the system folder" "[ -z \"\$(ls -A \"$SYS_OK\" | grep -v '^Kosmos.app\$')\" ]"
chk "the TCC warm-up prints for a system-folder icon" "grep -q 'manage apps' \"$SB/probe1.log\""
chk "the success closing line is pinned" "grep -q '^  Kosmos is running\\.\$' \"$SB/probe1.log\""
chk "fresh install opened the dashboard" "[ \"\$(wc -l < \"$SB/opened.log\" 2>/dev/null | tr -d ' ')\" = \"1\" ] && grep -q \"127.0.0.1:$PORT\" \"$SB/opened.log\""

# The update run through the same probe env must NOT open the browser.
RC=0; cat "$SETUP" | HOME="$SBH" KOSMOS_HOME_APP_DIR="$SBH/Applications" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_OK" KOSMOS_NO_OPEN= KOSMOS_OPEN_CMD="$SB/open-stub" sh > "$SB/probe1b.log" 2>&1 || RC=$?
chk "probe update exits 0" "rc_ok $RC"
chk "update did not open the dashboard" "[ \"\$(wc -l < \"$SB/opened.log\" | tr -d ' ')\" = \"1\" ]"
KOSMOS_HOME="$SB/home2" "$SB/bin2/kosmos" stop > /dev/null 2>&1 || true

export KOSMOS_HOME="$SB/home3" KOSMOS_BIN_DIR="$SB/bin3"
if [ "$(id -u)" -eq 0 ]; then
  # chmod 555 does not deny root, so the probe would succeed against the
  # "read-only" folder and every fallback assertion would fail for an
  # environment reason. Skip loudly and seed the icon the sweep pass below
  # expects the fallback install to have left.
  echo "SKIP fallback leg: running as root, chmod 555 does not deny root"
  SKIPS=$((SKIPS + 1))
  seed_kosmos_bundle "$SBH/Applications" "$SB/home3"
else
  SYS_RO="$SB/sysro"
  mkdir -p "$SYS_RO"
  chmod 555 "$SYS_RO"
  # KOSMOS_NO_OPEN stays exported here: a fresh install with the suppressor
  # set must stay quiet, which pins the suppressor itself.
  RC=0; cat "$SETUP" | HOME="$SBH" KOSMOS_HOME_APP_DIR="$SBH/Applications" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_RO" KOSMOS_OPEN_CMD="$SB/open-stub" sh > "$SB/probe2.log" 2>&1 || RC=$?
  chk "fallback install exits 0" "rc_ok $RC"
  chk "app fell back to the home folder" "[ -x \"$SBH/Applications/Kosmos.app/Contents/MacOS/Kosmos\" ]"
  chk "transcript names the home folder" "grep -q 'you will find it in the Applications folder inside your home folder' \"$SB/probe2.log\""
  chk "no probe residue in the read-only folder" "[ -z \"\$(ls -A \"$SYS_RO\")\" ]"
  chk "no TCC warm-up when the icon goes to the home folder" "! grep -q 'manage apps' \"$SB/probe2.log\""
  chk "KOSMOS_NO_OPEN suppressed the fresh-install open" "[ \"\$(wc -l < \"$SB/opened.log\" | tr -d ' ')\" = \"1\" ]"
  chmod 755 "$SYS_RO"
fi

echo "== the uninstall sweep proves ownership before deleting =="
# The system-folder icon was installed by the home2 install; this uninstall
# runs as the home3 install, so the sweep must take the per-user icon and
# REFUSE the shared one it does not own, in a sentence.
RC=0; HOME="$SBH" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_OK" sh -s -- --uninstall < "$SETUP" > "$SB/probe-un.log" 2>&1 || RC=$?
chk "sweep uninstall exits 0" "rc_ok $RC"
chk "home-folder icon swept" "[ ! -d \"$SBH/Applications/Kosmos.app\" ]"
chk "another install's system icon left alone" "[ -d \"$SYS_OK/Kosmos.app\" ]"
chk "the refusal speaks a sentence" "grep -q \"in $SYS_OK could not be proven to belong to this install\" \"$SB/probe-un.log\""
# The OWNER's uninstall takes it. Probe and stage residue are seeded first
# so the sweep the served header PROMISES ("--uninstall sweeps it") is
# pinned rather than assumed, in both folders.
# The swept residue must be PROVABLY OURS (the sweep now demands the same
# launcher token as the visible bundle); one foreign aside is seeded too
# and must survive, named, because an aside can be another account's only
# surviving icon.
seed_residue "$SYS_OK/.Kosmos.app.stage.999" "$SB/home2"
seed_residue "$SYS_OK/.Kosmos.app.old.111" "$SB/home2"
seed_residue "$SYS_OK/.Kosmos.app.old.333" "/another/accounts/kosmos"
seed_residue "$SBH/Applications/.Kosmos.app.stage.888" "$SB/home2"
seed_residue "$SBH/Applications/.Kosmos.app.old.222" "$SB/home2"
mkdir -p "$SYS_OK/.kosmos-write-probe.777"
export KOSMOS_HOME="$SB/home2" KOSMOS_BIN_DIR="$SB/bin2"
RC=0; HOME="$SBH" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_OK" sh -s -- --uninstall < "$SETUP" > "$SB/probe-un2.log" 2>&1 || RC=$?
chk "owner uninstall exits 0" "rc_ok $RC"
chk "system-folder icon swept by its owner" "[ ! -d \"$SYS_OK/Kosmos.app\" ]"
chk "our stage and probe residue swept from the system folder" "[ ! -e \"$SYS_OK/.Kosmos.app.stage.999\" ] && [ ! -e \"$SYS_OK/.kosmos-write-probe.777\" ] && [ ! -e \"$SYS_OK/.Kosmos.app.old.111\" ]"
chk "the foreign aside survives" "[ -d \"$SYS_OK/.Kosmos.app.old.333\" ]"
chk "the foreign aside is named" "grep -q '.Kosmos.app.old.333 could not be proven to belong to this install' \"$SB/probe-un2.log\""
chk "stage residue swept from the home folder" "[ ! -e \"$SBH/Applications/.Kosmos.app.stage.888\" ]"
chk "aside residue swept from the home folder" "[ ! -e \"$SBH/Applications/.Kosmos.app.old.222\" ]"

echo "== aliased folders (~/Applications symlinked to the system folder) =="
# The failure this pins: with ~/Applications a symlink to the system
# folder, the stale-icon cleanup and the home-folder sweep both look
# THROUGH the link at the bundle the other branch owns. Delete either
# pwd -P guard in setup.sh and these assertions fail: the install would
# remove the app it just wrote, the foreign uninstall would delete a
# bundle its ownership check had just refused.
SBH3="$SB/alias-home"
SYSALIAS="$SB/sysalias"
mkdir -p "$SBH3" "$SYSALIAS"
ln -s "$SYSALIAS" "$SBH3/Applications"
export KOSMOS_HOME="$SB/home4" KOSMOS_BIN_DIR="$SB/bin4"
RC=0; cat "$SETUP" | HOME="$SBH3" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYSALIAS" sh > "$SB/alias.log" 2>&1 || RC=$?
chk "aliased install exits 0" "rc_ok $RC"
chk "app survives its own stale-icon cleanup" "[ -x \"$SYSALIAS/Kosmos.app/Contents/MacOS/Kosmos\" ]"
chk "no phantom move sentence" "! grep -q 'icon moved here' \"$SB/alias.log\""
KOSMOS_HOME="$SB/home4" "$SB/bin4/kosmos" stop > /dev/null 2>&1 || true
# A DIFFERENT install's uninstall in the aliased world: the ownership
# check refuses the system icon, and the home sweep must not delete it
# through the symlink either.
RC=0; HOME="$SBH3" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYSALIAS" KOSMOS_HOME="$SB/home5" KOSMOS_BIN_DIR="$SB/bin5" sh -s -- --uninstall < "$SETUP" > "$SB/alias-un.log" 2>&1 || RC=$?
chk "foreign uninstall exits 0 in the aliased world" "rc_ok $RC"
chk "refused bundle survives the aliased home sweep" "[ -d \"$SYSALIAS/Kosmos.app\" ]"
# The owner's uninstall takes it, exactly once, with no survivor note.
RC=0; HOME="$SBH3" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYSALIAS" sh -s -- --uninstall < "$SETUP" > "$SB/alias-un2.log" 2>&1 || RC=$?
chk "owner uninstall exits 0 in the aliased world" "rc_ok $RC"
chk "aliased bundle removed by its owner" "[ ! -d \"$SYSALIAS/Kosmos.app\" ]"
chk "no spurious survivor note" "! grep -q 'could not remove' \"$SB/alias-un2.log\""

echo "== a foreign Kosmos.app in the system folder is never claimed =="
# The failure this pins: an app named Kosmos that this installer did NOT
# create sits at the system path. make_app begins with rm -rf on its
# target, so claiming the path destroys a stranger's app while printing
# success. The install must divert to the per-user folder, say so, and
# leave the foreign bundle byte-identical.
SYS_FOREIGN="$SB/sysforeign"
mkdir -p "$SYS_FOREIGN/Kosmos.app/Contents/MacOS"
printf '#!/bin/bash\n# not ours\nKOSMOS_HOME="${KOSMOS_HOME:-/somewhere/else/kosmos}"\n' > "$SYS_FOREIGN/Kosmos.app/Contents/MacOS/KosmosDesktop"
SBH4="$SB/divert-home"
mkdir -p "$SBH4"
export KOSMOS_HOME="$SB/home6" KOSMOS_BIN_DIR="$SB/bin6"
RC=0; cat "$SETUP" | HOME="$SBH4" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_FOREIGN" sh > "$SB/divert.log" 2>&1 || RC=$?
chk "divert install exits 0" "rc_ok $RC"
chk "foreign bundle untouched" "grep -q 'not ours' \"$SYS_FOREIGN/Kosmos.app/Contents/MacOS/KosmosDesktop\""
chk "our app went to the home folder instead" "[ -x \"$SBH4/Applications/Kosmos.app/Contents/MacOS/Kosmos\" ]"
chk "the divert speaks its own sentence" "grep -q 'something else already has the Kosmos spot' \"$SB/divert.log\""
KOSMOS_HOME="$SB/home6" "$SB/bin6/kosmos" stop > /dev/null 2>&1 || true

echo "== foreign bundle PLUS aliased folders: no icon at all, said honestly =="
# The composed case: something not ours holds the system spot AND the home
# Applications folder is a symlink to the same place. "Divert to the home
# folder" would write straight back through the link onto the bundle the
# ownership check just refused, so the only honest outcome is no icon,
# with a sentence, and the stranger's app byte-identical.
SYSALIAS2="$SB/sysalias2"
mkdir -p "$SYSALIAS2/Kosmos.app/Contents/MacOS"
printf '#!/bin/bash\n# stranger\nKOSMOS_HOME="${KOSMOS_HOME:-/not/ours/at/all}"\n' > "$SYSALIAS2/Kosmos.app/Contents/MacOS/Kosmos"
SBH7="$SB/alias-foreign-home"
mkdir -p "$SBH7"
ln -s "$SYSALIAS2" "$SBH7/Applications"
export KOSMOS_HOME="$SB/home9" KOSMOS_BIN_DIR="$SB/bin9"
RC=0; cat "$SETUP" | HOME="$SBH7" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYSALIAS2" sh > "$SB/alias-foreign.log" 2>&1 || RC=$?
chk "foreign-aliased install exits 0" "rc_ok $RC"
chk "the stranger's app is byte-identical" "grep -q 'stranger' \"$SYSALIAS2/Kosmos.app/Contents/MacOS/Kosmos\""
chk "nothing new appeared beside the stranger's app" "[ \"\$(ls -A \"$SYSALIAS2\" | grep -cv '^Kosmos.app\$')\" = \"0\" ]"
chk "the skip speaks its own sentence" "grep -q 'is the same folder, so no icon was created' \"$SB/alias-foreign.log\""
KOSMOS_HOME="$SB/home9" "$SB/bin9/kosmos" stop > /dev/null 2>&1 || true

if [ "$(id -u)" -eq 0 ]; then
  echo "SKIP wedge and survivor-note legs: running as root, chmod denials do not bind"
  SKIPS=$((SKIPS + 1))
else
  echo "== a bundle that cannot be replaced sends the icon to the home folder =="
  # The retry leg: the system folder is writable (the probe passes) but the
  # bundle inside it cannot be moved aside (user-immutable, the flag a
  # leftover can carry; rename fails EPERM on an immutable source, and
  # chflags binds even root, unlike the chmod shapes). The ownership line
  # matches, so the divert does not fire; make_app must fail on the swap,
  # clean its stage AND its aside, leave the old bundle whole, and the
  # retry must land the icon in the home folder.
  SYS_WEDGE="$SB/syswedge"
  seed_kosmos_bundle "$SYS_WEDGE" "$SB/home7"
  chflags uchg "$SYS_WEDGE/Kosmos.app"
  SBH5="$SB/wedge-home"
  mkdir -p "$SBH5"
  export KOSMOS_HOME="$SB/home7" KOSMOS_BIN_DIR="$SB/bin7"
  RC=0; cat "$SETUP" | HOME="$SBH5" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_WEDGE" sh > "$SB/wedge.log" 2>&1 || RC=$?
  chk "wedge install exits 0" "rc_ok $RC"
  chk "retry landed the icon in the home folder" "[ -x \"$SBH5/Applications/Kosmos.app/Contents/MacOS/Kosmos\" ]"
  chk "retry sentence names the home folder" "grep -q 'you will find it in the Applications folder inside your home folder' \"$SB/wedge.log\""
  chk "the unmovable bundle was never gutted" "[ -f \"$SYS_WEDGE/Kosmos.app/Contents/MacOS/Kosmos\" ]"
  chk "the surviving system icon is named" "grep -q 'could not be replaced; use the' \"$SB/wedge.log\""
  chk "no stage or aside residue in the wedged folder" "[ -z \"\$(ls -A \"$SYS_WEDGE\" | grep -v '^Kosmos.app\$')\" ]"
  chflags nouchg "$SYS_WEDGE/Kosmos.app"
  KOSMOS_HOME="$SB/home7" "$SB/bin7/kosmos" stop > /dev/null 2>&1 || true

  echo "== a deep-locked old bundle can no longer wedge the slot =="
  # The reproduced husk: rm -rf on a bundle with one unwritable nested
  # directory deletes the launcher, then dies, leaving a husk no later
  # ownership check can prove and no uninstall will touch. The rename-
  # aside swap must leave the VISIBLE slot holding a complete bundle at
  # every moment; the locked residue may survive only under the hidden
  # aside name.
  SYS_DEEP="$SB/sysdeep"
  seed_kosmos_bundle "$SYS_DEEP" "$SB/home19"
  mkdir -p "$SYS_DEEP/Kosmos.app/Contents/Resources/sub"
  touch "$SYS_DEEP/Kosmos.app/Contents/Resources/sub/keep"
  chmod 555 "$SYS_DEEP/Kosmos.app/Contents/Resources/sub"
  SBH17="$SB/deep-home"
  mkdir -p "$SBH17"
  export KOSMOS_HOME="$SB/home19" KOSMOS_BIN_DIR="$SB/bin19"
  RC=0; cat "$SETUP" | HOME="$SBH17" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_DEEP" sh > "$SB/deep.log" 2>&1 || RC=$?
  chk "deep-locked reinstall exits 0" "rc_ok $RC"
  chk "the visible slot holds a complete bundle" "[ -x \"$SYS_DEEP/Kosmos.app/Contents/MacOS/Kosmos\" ]"
  # #677: the anchor moved off the (now compiled) launcher and onto its
  # per-install config file -- bundle_is_ours checks the same new anchor,
  # see install/setup.sh.
  chk "the new bundle is provably ours" "grep -qF '\"kosmosHome\":\"$SB/home19\"' \"$SYS_DEEP/Kosmos.app/Contents/Resources/kosmos-install.json\""
  chk "the locked aside is named at install time" "grep -q 'could not remove the leftover hidden folder' \"$SB/deep.log\""
  KOSMOS_HOME="$SB/home19" "$SB/bin19/kosmos" stop > /dev/null 2>&1 || true
  # ⚠️ The lock STAYS for the uninstall. The first version of this pass
  # unlocked before uninstalling, which undid the exact condition under
  # test and let a silent best-effort sweep read as a kept promise. The
  # served header says the sweep names what it cannot remove; hold it to
  # that.
  RC=0; HOME="$SBH17" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_DEEP" sh -s -- --uninstall < "$SETUP" > "$SB/deep-un.log" 2>&1 || RC=$?
  chk "deep-world uninstall exits 0" "rc_ok $RC"
  chk "deep-world slot fully cleared" "[ ! -e \"$SYS_DEEP/Kosmos.app\" ]"
  # The aside here is OUR OWN, gutted unprovable by its best-effort
  # cleanup dying on the locked dir; either it is gone, or the transcript
  # names it (as unremovable, or as unprovable, whichever was observed).
  chk "surviving locked residue is gone or named" "[ -z \"\$(ls -A \"$SYS_DEEP\" 2>/dev/null | grep -F '.Kosmos.app.old')\" ] || grep -Eq 'could not remove the leftover hidden folder|could not be proven to belong to this install' \"$SB/deep-un.log\""
  chmod -R u+w "$SYS_DEEP" 2>/dev/null || true

  echo "== a survivor is NAMED (positive control for the could-not-remove note) =="
  # Without this pass the survivor-note branches could be deleted whole and
  # the suite would stay green: the note was only ever asserted absent. A
  # write-locked containing folder makes the owner's own rm fail, which
  # must produce the sentence, not silence.
  SYS_LOCKED="$SB/syslocked"
  seed_kosmos_bundle "$SYS_LOCKED" "$SB/home8"
  chmod 555 "$SYS_LOCKED"
  export KOSMOS_HOME="$SB/home8" KOSMOS_BIN_DIR="$SB/bin8"
  SBH6="$SB/locked-home"
  mkdir -p "$SBH6"
  RC=0; HOME="$SBH6" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_LOCKED" sh -s -- --uninstall < "$SETUP" > "$SB/locked-un.log" 2>&1 || RC=$?
  chk "locked uninstall exits 0" "rc_ok $RC"
  chk "the survivor is named" "grep -q 'could not remove' \"$SB/locked-un.log\""
  chk "the survivor survives" "[ -d \"$SYS_LOCKED/Kosmos.app\" ]"
  chmod 755 "$SYS_LOCKED"
fi

echo "== the cleanup and uninstall notes each have a driving pass =="
# A foreign Kosmos.app in the HOME folder at cleanup time: the system-folder
# install must leave it and name it (setup.sh's "not created by this
# install is in the Applications folder inside your home folder").
SBH9="$SB/foreign-home"
mkdir -p "$SBH9/Applications/Kosmos.app/Contents/MacOS"
printf '#!/bin/bash\n# theirs\nKOSMOS_HOME="${KOSMOS_HOME:-/not/ours}"\n' > "$SBH9/Applications/Kosmos.app/Contents/MacOS/Kosmos"
SYS_OK3="$SB/sysok3"
mkdir -p "$SYS_OK3"
export KOSMOS_HOME="$SB/home10" KOSMOS_BIN_DIR="$SB/bin10"
RC=0; cat "$SETUP" | HOME="$SBH9" KOSMOS_HOME_APP_DIR="$SBH9/Applications" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_OK3" sh > "$SB/fhome.log" 2>&1 || RC=$?
chk "foreign-home install exits 0" "rc_ok $RC"
chk "foreign home bundle survives the cleanup" "grep -q 'theirs' \"$SBH9/Applications/Kosmos.app/Contents/MacOS/Kosmos\""
chk "the foreign home bundle is named" "grep -q 'not created by this install is in the Applications folder inside your home folder' \"$SB/fhome.log\""
KOSMOS_HOME="$SB/home10" "$SB/bin10/kosmos" stop > /dev/null 2>&1 || true
# Its uninstall drives the home-folder refusal note too.
RC=0; HOME="$SBH9" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_OK3" sh -s -- --uninstall < "$SETUP" > "$SB/fhome-un.log" 2>&1 || RC=$?
chk "foreign-home uninstall exits 0" "rc_ok $RC"
chk "home refusal speaks its sentence" "grep -q 'inside your home folder was not created by this install' \"$SB/fhome-un.log\""
chk "foreign home bundle survives uninstall" "[ -d \"$SBH9/Applications/Kosmos.app\" ]"

# An unresolvable SYSTEM folder on uninstall: the fail-closed note must
# name the side that failed the check, and the home icon must survive.
SBH10="$SB/nosys-home"
mkdir -p "$SBH10"
seed_kosmos_bundle "$SBH10/Applications" "$SB/home11"
export KOSMOS_HOME="$SB/home11" KOSMOS_BIN_DIR="$SB/bin11"
RC=0; HOME="$SBH10" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SB/no-such-sys" sh -s -- --uninstall < "$SETUP" > "$SB/nosys-un.log" 2>&1 || RC=$?
chk "no-sys uninstall exits 0" "rc_ok $RC"
chk "fail-closed note names the system folder" "grep -q \"could not check $SB/no-such-sys\" \"$SB/nosys-un.log\""
chk "home icon left alone under fail-closed" "[ -d \"$SBH10/Applications/Kosmos.app\" ]"

if [ "$(id -u)" -eq 0 ]; then
  echo "SKIP chmod-denial note legs: running as root"
  SKIPS=$((SKIPS + 1))
else
  # The move-cleanup's OWN failure note: a write-locked home Applications
  # makes the stale icon undeletable, and the survivor must be named
  # ("an older Kosmos icon is still...").
  SBH11="$SB/locked-stale-home"
  seed_kosmos_bundle "$SBH11/Applications" "$SB/home12"
  # Lock the INNERMOST directory, not Applications: rm -rf deletes
  # depth-first, so an outer lock lets the launcher be deleted before the
  # failure, and the next run reads the gutted husk as foreign (measured:
  # the first version of this pass locked Applications and the uninstall
  # printed the refusal note instead of the could-not-remove note). With
  # MacOS/ locked the launcher survives every failed rm, so ownership
  # stays provable across both runs.
  chmod 555 "$SBH11/Applications/Kosmos.app/Contents/MacOS"
  SYS_OK4="$SB/sysok4"
  mkdir -p "$SYS_OK4"
  export KOSMOS_HOME="$SB/home12" KOSMOS_BIN_DIR="$SB/bin12"
  RC=0; cat "$SETUP" | HOME="$SBH11" KOSMOS_HOME_APP_DIR="$SBH11/Applications" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_OK4" sh > "$SB/stale-locked.log" 2>&1 || RC=$?
  chk "locked-stale install exits 0" "rc_ok $RC"
  chk "undeletable stale icon is named" "grep -q 'an older Kosmos icon is still' \"$SB/stale-locked.log\""
  KOSMOS_HOME="$SB/home12" "$SB/bin12/kosmos" stop > /dev/null 2>&1 || true

  # The home-folder "could not remove" on uninstall: the folder stays
  # locked so the home sweep's rm fails and must name the survivor.
  RC=0; HOME="$SBH11" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_OK4" sh -s -- --uninstall < "$SETUP" > "$SB/locked-home-un.log" 2>&1 || RC=$?
  chmod -R u+w "$SBH11" 2>/dev/null || true
  chk "locked-home uninstall exits 0" "rc_ok $RC"
  chk "home survivor is named" "grep -q \"could not remove $SBH11/Applications/Kosmos.app\" \"$SB/locked-home-un.log\""

  # The last give-up sentence: probe fails AND the home folder cannot take
  # a bundle either; Kosmos itself must still install and say so.
  SYS_RO2="$SB/sysro2"
  mkdir -p "$SYS_RO2"
  chmod 555 "$SYS_RO2"
  SBH12="$SB/no-icon-home"
  mkdir -p "$SBH12/Applications"
  chmod 555 "$SBH12/Applications"
  export KOSMOS_HOME="$SB/home13" KOSMOS_BIN_DIR="$SB/bin13"
  RC=0; cat "$SETUP" | HOME="$SBH12" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_RO2" sh > "$SB/noicon.log" 2>&1 || RC=$?
  chk "no-icon install exits 0" "rc_ok $RC"
  chk "the give-up sentence prints" "grep -q 'could not create the app icon, but Kosmos itself is fine' \"$SB/noicon.log\""
  chmod 755 "$SYS_RO2" "$SBH12/Applications"
  KOSMOS_HOME="$SB/home13" "$SB/bin13/kosmos" stop > /dev/null 2>&1 || true
fi

echo "== a link entry at the SYSTEM path is never claimed (dangling or resolvable) =="
# The install-side mirror of the uninstall's -L discipline: a symlink
# whose target cannot be stat'd (dangling here; another user's mode-700
# home in the field) fails -e, and an -e-only occupancy gate would let
# the probe claim the slot and rm -rf the link. The install must divert
# and leave the link byte-identical.
SYS_LNK="$SB/syslnk"
mkdir -p "$SYS_LNK"
ln -s "$SB/nowhere/Kosmos.app" "$SYS_LNK/Kosmos.app"
SBH18="$SB/lnk-home"
mkdir -p "$SBH18"
export KOSMOS_HOME="$SB/home20" KOSMOS_BIN_DIR="$SB/bin20"
RC=0; cat "$SETUP" | HOME="$SBH18" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_LNK" sh > "$SB/syslnk.log" 2>&1 || RC=$?
chk "system-link install exits 0" "rc_ok $RC"
chk "the link entry survives untouched" "[ -L \"$SYS_LNK/Kosmos.app\" ] && [ \"\$(readlink \"$SYS_LNK/Kosmos.app\")\" = \"$SB/nowhere/Kosmos.app\" ]"
chk "the install diverted to the home folder" "[ -x \"$SBH18/Applications/Kosmos.app/Contents/MacOS/Kosmos\" ]"
chk "the divert names the occupied spot" "grep -q 'something else already has the Kosmos spot' \"$SB/syslnk.log\""
KOSMOS_HOME="$SB/home20" "$SB/bin20/kosmos" stop > /dev/null 2>&1 || true
# The RESOLVABLE case: a user's link pointing at a bundle whose launcher
# would pass the ownership grep. Deciding by content would claim and
# replace the link; deciding by linkness must divert and leave both the
# link and its target byte-identical.
SYS_LNK2="$SB/syslnk2"
REALB="$SB/realbundle"
mkdir -p "$SYS_LNK2"
seed_kosmos_bundle "$REALB" "$SB/home23"
ln -s "$REALB/Kosmos.app" "$SYS_LNK2/Kosmos.app"
SBH21="$SB/lnk2-home"
mkdir -p "$SBH21"
export KOSMOS_HOME="$SB/home23" KOSMOS_BIN_DIR="$SB/bin23"
RC=0; cat "$SETUP" | HOME="$SBH21" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_LNK2" sh > "$SB/syslnk2.log" 2>&1 || RC=$?
chk "resolvable-link install exits 0" "rc_ok $RC"
chk "the resolvable link survives untouched" "[ -L \"$SYS_LNK2/Kosmos.app\" ] && [ \"\$(readlink \"$SYS_LNK2/Kosmos.app\")\" = \"$REALB/Kosmos.app\" ]"
chk "the link's target survives untouched" "[ -f \"$REALB/Kosmos.app/Contents/MacOS/Kosmos\" ]"
chk "the resolvable-link install diverted home" "[ -x \"$SBH21/Applications/Kosmos.app/Contents/MacOS/Kosmos\" ]"
KOSMOS_HOME="$SB/home23" "$SB/bin23/kosmos" stop > /dev/null 2>&1 || true

echo "== every inner level of the ownership predicate rejects a link =="
# The root-link guard is driven elsewhere; these pin the three INNER
# guards (Contents, MacOS, launcher leaf), each of which could be
# deleted from bundle_is_ours while the suite stayed green. Fixture: an
# otherwise-ours bundle with one level replaced by a link whose target
# would pass the content grep; the uninstall must refuse and name it.
for _lvl in contents macos leaf; do
  LNK_SYS="$SB/sys-inner-$_lvl"
  LNK_TGT="$SB/tgt-inner-$_lvl"
  seed_kosmos_bundle "$LNK_TGT" "$SB/home-inner"
  mkdir -p "$LNK_SYS/Kosmos.app"
  case "$_lvl" in
    contents) ln -s "$LNK_TGT/Kosmos.app/Contents" "$LNK_SYS/Kosmos.app/Contents" ;;
    macos) mkdir -p "$LNK_SYS/Kosmos.app/Contents"; ln -s "$LNK_TGT/Kosmos.app/Contents/MacOS" "$LNK_SYS/Kosmos.app/Contents/MacOS" ;;
    leaf) mkdir -p "$LNK_SYS/Kosmos.app/Contents/MacOS"; ln -s "$LNK_TGT/Kosmos.app/Contents/MacOS/Kosmos" "$LNK_SYS/Kosmos.app/Contents/MacOS/Kosmos" ;;
  esac
  RC=0; HOME="$SB/inner-home-$_lvl" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$LNK_SYS" KOSMOS_HOME="$SB/home-inner" KOSMOS_BIN_DIR="$SB/bin-inner" sh -s -- --uninstall < "$SETUP" > "$SB/inner-$_lvl.log" 2>&1 || RC=$?
  chk "inner-$_lvl link uninstall exits 0" "rc_ok $RC"
  chk "inner-$_lvl link bundle survives, named" "[ -e \"$LNK_SYS/Kosmos.app\" ] && grep -q 'could not be proven to belong to this install' \"$SB/inner-$_lvl.log\""
done

echo "== a link entry is decided by its target, and each skip sentence is its own =="
# The unknown-skip leg: a dangling home Applications symlink plus a foreign
# system bundle. The install must refuse to guess, write no icon, and say
# "could not be checked" rather than "is the same folder".
SYS_F2="$SB/sysforeign2"
mkdir -p "$SYS_F2/Kosmos.app/Contents/MacOS"
printf '#!/bin/bash\n# stranger2\nKOSMOS_HOME="${KOSMOS_HOME:-/not/ours/2}"\n' > "$SYS_F2/Kosmos.app/Contents/MacOS/Kosmos"
SBH13="$SB/dangling-home"
mkdir -p "$SBH13"
ln -s "$SB/does-not-exist" "$SBH13/Applications"
export KOSMOS_HOME="$SB/home15" KOSMOS_BIN_DIR="$SB/bin15"
RC=0; cat "$SETUP" | HOME="$SBH13" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_F2" sh > "$SB/unknown-skip.log" 2>&1 || RC=$?
chk "unknown-skip install exits 0" "rc_ok $RC"
chk "unknown-skip speaks its own sentence" "grep -q 'could not be checked, so no icon was created' \"$SB/unknown-skip.log\""
chk "unknown-skip does not claim the same-folder cause" "! grep -q 'is the same folder' \"$SB/unknown-skip.log\""
chk "the second stranger is untouched" "grep -q 'stranger2' \"$SYS_F2/Kosmos.app/Contents/MacOS/Kosmos\""
KOSMOS_HOME="$SB/home15" "$SB/bin15/kosmos" stop > /dev/null 2>&1 || true

# A home-folder LINK at uninstall: one pointing at the system bundle this
# uninstall sweeps is our residue and goes; one pointing anywhere else is
# left and named as a link.
SYS_OK5="$SB/sysok5"
seed_kosmos_bundle "$SYS_OK5" "$SB/home16"
SBH14="$SB/link-home"
mkdir -p "$SBH14/Applications"
ln -s "$SYS_OK5/Kosmos.app" "$SBH14/Applications/Kosmos.app"
export KOSMOS_HOME="$SB/home16" KOSMOS_BIN_DIR="$SB/bin16"
RC=0; HOME="$SBH14" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_OK5" sh -s -- --uninstall < "$SETUP" > "$SB/link-un.log" 2>&1 || RC=$?
chk "link uninstall exits 0" "rc_ok $RC"
chk "our link swept with its bundle" "[ ! -e \"$SBH14/Applications/Kosmos.app\" ] && [ ! -L \"$SBH14/Applications/Kosmos.app\" ]"
chk "the link sweep is named" "grep -q 'removing a link that pointed at the removed Kosmos app' \"$SB/link-un.log\""
ln -s "$SB/somewhere-else/Kosmos.app" "$SBH14/Applications/Kosmos.app"
RC=0; HOME="$SBH14" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_OK5" sh -s -- --uninstall < "$SETUP" > "$SB/link-un2.log" 2>&1 || RC=$?
chk "foreign link survives" "[ -L \"$SBH14/Applications/Kosmos.app\" ]"
chk "foreign link is named as a link" "grep -q 'is a link this install did not create' \"$SB/link-un2.log\""

if [ "$(id -u)" -eq 0 ]; then
  echo "SKIP stale-system-icon leg: running as root"
  SKIPS=$((SKIPS + 1))
else
  # The two-icon state, named: the probe fails on a machine whose earlier
  # install owns a system icon; the fresh icon goes home and the stale
  # one is called out.
  SYS_RO3="$SB/sysro3"
  seed_kosmos_bundle "$SYS_RO3" "$SB/home17"
  chmod 555 "$SYS_RO3"
  SBH15="$SB/stale-sys-home"
  mkdir -p "$SBH15"
  export KOSMOS_HOME="$SB/home17" KOSMOS_BIN_DIR="$SB/bin17"
  RC=0; cat "$SETUP" | HOME="$SBH15" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_RO3" sh > "$SB/stale-sys.log" 2>&1 || RC=$?
  chk "stale-sys install exits 0" "rc_ok $RC"
  chk "fresh icon landed in the home folder" "[ -x \"$SBH15/Applications/Kosmos.app/Contents/MacOS/Kosmos\" ]"
  chk "the unreachable system icon is named" "grep -q 'could not be updated from this account' \"$SB/stale-sys.log\""
  chmod 755 "$SYS_RO3"
  KOSMOS_HOME="$SB/home17" "$SB/bin17/kosmos" stop > /dev/null 2>&1 || true
fi

if [ "$(id -u)" -eq 0 ]; then
  echo "SKIP foreign-home-fallback leg: running as root"
  SKIPS=$((SKIPS + 1))
else
  echo "== the home folder gets the same ownership gate =="
  # The one path that used to replace without proof: probe fails, the
  # fallback targets ~/Applications, and a stranger's Kosmos.app already
  # sits there. No icon may be written, the stranger stays byte-identical,
  # and the sentence says so.
  SYS_RO6="$SB/sysro6"
  mkdir -p "$SYS_RO6"
  chmod 555 "$SYS_RO6"
  SBH20="$SB/foreign-fallback-home"
  mkdir -p "$SBH20/Applications/Kosmos.app/Contents/MacOS"
  printf '#!/bin/bash\n# their home app\nKOSMOS_HOME="${KOSMOS_HOME:-/their/place}"\n' > "$SBH20/Applications/Kosmos.app/Contents/MacOS/Kosmos"
  export KOSMOS_HOME="$SB/home22" KOSMOS_BIN_DIR="$SB/bin22"
  RC=0; cat "$SETUP" | HOME="$SBH20" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_RO6" sh > "$SB/foreign-fb.log" 2>&1 || RC=$?
  chk "foreign-fallback install exits 0" "rc_ok $RC"
  chk "the stranger's home app is untouched" "grep -q 'their home app' \"$SBH20/Applications/Kosmos.app/Contents/MacOS/Kosmos\""
  chk "no icon was written over it" "grep -q 'left alone and no icon was created' \"$SB/foreign-fb.log\""
  chmod 755 "$SYS_RO6"
  KOSMOS_HOME="$SB/home22" "$SB/bin22/kosmos" stop > /dev/null 2>&1 || true
fi

echo "== the KOSMOS_HOME delete gate demands Kosmos-specific evidence =="
# A bare VERSION file is not proof: KOSMOS_HOME pointed at a folder
# holding one (the shape of KOSMOS_HOME=$HOME with a stray ~/VERSION)
# must be refused in a sentence, with the folder left intact.
NOTKOS="$SB/not-kosmos"
mkdir -p "$NOTKOS"
printf '1.0\n' > "$NOTKOS/VERSION"
printf 'precious\n' > "$NOTKOS/user-data.txt"
RC=0; KOSMOS_HOME="$NOTKOS" KOSMOS_BIN_DIR="$SB/bin-nk" sh -s -- --uninstall < "$SETUP" > "$SB/notkos.log" 2>&1 || RC=$?
chk "not-a-Kosmos-install uninstall exits 0" "rc_ok $RC"
chk "the folder is refused in a sentence" "grep -q 'does not look like a Kosmos install' \"$SB/notkos.log\""
chk "the folder survives with its contents" "grep -q 'precious' \"$NOTKOS/user-data.txt\""

echo "== the KOSMOS_HOME character guard refuses in a sentence =="
# Brand-new safety code protecting every grep -F ownership gate from
# failing open; each refused class must exit 2 with the sentence and
# without installing anything.
RC=0; KOSMOS_HOME="$SB/evil\"quote" sh < "$SETUP" > "$SB/guard1.log" 2>&1 || RC=$?
chk "a quote in KOSMOS_HOME is refused" "[ $RC -eq 2 ] && grep -q 'would defeat the safety checks' \"$SB/guard1.log\""
RC=0; KOSMOS_HOME="$SB/evil}brace" sh < "$SETUP" > "$SB/guard2.log" 2>&1 || RC=$?
chk "a closing brace in KOSMOS_HOME is refused" "[ $RC -eq 2 ] && grep -q 'would defeat the safety checks' \"$SB/guard2.log\""
RC=0; KOSMOS_HOME="$(printf '%s\n%s' "$SB/evil" "line")" sh < "$SETUP" > "$SB/guard3.log" 2>&1 || RC=$?
chk "a newline in KOSMOS_HOME is refused" "[ $RC -eq 2 ] && grep -q 'would defeat the safety checks' \"$SB/guard3.log\""

echo "== both folders foreign: both named, both untouched =="
# Foreign in the system spot AND a foreign Kosmos.app in the home folder:
# the divert has nowhere to write, both refusals must speak, and both
# strangers stay byte-identical.
SYS_F3="$SB/sysforeign3"
mkdir -p "$SYS_F3/Kosmos.app/Contents/MacOS"
printf '#!/bin/bash\n# stranger3\nKOSMOS_HOME="${KOSMOS_HOME:-/not/ours/3}"\n' > "$SYS_F3/Kosmos.app/Contents/MacOS/Kosmos"
SBH22="$SB/dual-foreign-home"
mkdir -p "$SBH22/Applications/Kosmos.app/Contents/MacOS"
printf '#!/bin/bash\n# their home app 2\nKOSMOS_HOME="${KOSMOS_HOME:-/their/place/2}"\n' > "$SBH22/Applications/Kosmos.app/Contents/MacOS/Kosmos"
export KOSMOS_HOME="$SB/home24" KOSMOS_BIN_DIR="$SB/bin24"
RC=0; cat "$SETUP" | HOME="$SBH22" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_F3" sh > "$SB/dual.log" 2>&1 || RC=$?
chk "dual-foreign install exits 0" "rc_ok $RC"
chk "the home stranger survives" "grep -q 'their home app 2' \"$SBH22/Applications/Kosmos.app/Contents/MacOS/Kosmos\""
chk "the system stranger survives" "grep -q 'stranger3' \"$SYS_F3/Kosmos.app/Contents/MacOS/Kosmos\""
chk "the home refusal speaks" "grep -q 'not created by this install is in the Applications folder inside' \"$SB/dual.log\""
chk "the system spot is named too" "grep -q 'something else also has the Kosmos spot' \"$SB/dual.log\""
KOSMOS_HOME="$SB/home24" "$SB/bin24/kosmos" stop > /dev/null 2>&1 || true
# NOT drivable here, recorded rather than implied: the APP_SYS_FAILED
# sentence (a refused write into a writable, empty system folder needs a
# TCC denial the harness cannot produce) and make_app's restore-failure
# note (the slot would have to become unwritable between two renames in
# one run). Both legs are reasoned and hand-verified, not pinned.

echo "== the KOSMOS_PORT guard refuses in a sentence =="
RC=0; KOSMOS_PORT="80abc" sh < "$SETUP" > "$SB/portg1.log" 2>&1 || RC=$?
chk "a non-numeric KOSMOS_PORT is refused" "[ $RC -eq 2 ] && grep -q 'KOSMOS_PORT must be a number' \"$SB/portg1.log\""
RC=0; KOSMOS_PORT="4317}\"; echo PWNED; :\"" sh < "$SETUP" > "$SB/portg2.log" 2>&1 || RC=$?
chk "an injection-shaped KOSMOS_PORT is refused" "[ $RC -eq 2 ] && ! grep -q PWNED \"$SB/portg2.log\""

echo "== the override uninstall proves ownership too =="
# The KOSMOS_APP_DIR branch used to delete any Kosmos.app by name; the
# header bound is unconditional, so a stranger's bundle in the override
# dir must survive, named.
APPS_F="$SB/apps-foreign"
mkdir -p "$APPS_F/Kosmos.app/Contents/MacOS"
printf '#!/bin/bash\n# override stranger\nKOSMOS_HOME="${KOSMOS_HOME:-/not/ours/override}"\n' > "$APPS_F/Kosmos.app/Contents/MacOS/Kosmos"
RC=0; KOSMOS_APP_DIR="$APPS_F" KOSMOS_HOME="$SB/home25" KOSMOS_BIN_DIR="$SB/bin25" sh -s -- --uninstall < "$SETUP" > "$SB/ovf-un.log" 2>&1 || RC=$?
chk "override-foreign uninstall exits 0" "rc_ok $RC"
chk "the override stranger survives" "grep -q 'override stranger' \"$APPS_F/Kosmos.app/Contents/MacOS/Kosmos\""
chk "the override stranger is named" "grep -q 'could not be proven to belong to this install' \"$SB/ovf-un.log\""

echo "== a stranger's board on the port is never presented as this install's =="
# cmd_start's healthy() accepts any Kosmos-identifying board, so a fresh
# install onto an occupied port must say so, not print "Kosmos is
# running", and must NOT open a browser onto the stranger's board.
export KOSMOS_HOME="$SB/home26" KOSMOS_BIN_DIR="$SB/bin26" KOSMOS_APP_DIR="$SB/apps26"
RC=0; cat "$SETUP" | sh > "$SB/first-board.log" 2>&1 || RC=$?
chk "first board install exits 0" "rc_ok $RC"
# ⚠️ Probe-style env, deliberately: with KOSMOS_APP_DIR set, the sandbox
# belt suppresses the open on its own and BOARD_OURS is never consulted
# (proven by mutation: deleting the BOARD_OURS clause kept the suite
# green in that shape). With KOSMOS_APP_DIR empty and the stub as the
# open command, BOARD_OURS is the SOLE suppressor, so this pass pins it.
SBH23="$SB/stranger-home"
SYS28="$SB/sys28"
mkdir -p "$SBH23" "$SYS28"
export KOSMOS_HOME="$SB/home27" KOSMOS_BIN_DIR="$SB/bin27"
# A LIVE pid that is not a board, seeded as home27's pidfile: this drives
# the ps leg of the BOARD_OURS proof (a recycled pid must not read as
# ours). Deleting the ps case would flip this run to "Kosmos is running"
# and open the stub, failing both assertions below.
mkdir -p "$SB/home27"
printf '%s' "$$" > "$SB/home27/board.pid"
OPENED_BEFORE_STRANGER="$(wc -l < "$SB/opened.log" | tr -d ' ')"
RC=0; cat "$SETUP" | HOME="$SBH23" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS28" KOSMOS_NO_OPEN= KOSMOS_OPEN_CMD="$SB/open-stub" sh > "$SB/stranger-board.log" 2>&1 || RC=$?
chk "occupied-port install exits 0" "rc_ok $RC"
chk "the occupied port is named, not claimed" "grep -q 'something else is already answering on port' \"$SB/stranger-board.log\" && ! grep -q '^  Kosmos is running\.\$' \"$SB/stranger-board.log\""
chk "no browser was opened onto the stranger's board" "[ \"\$(wc -l < \"$SB/opened.log\" | tr -d ' ')\" = \"$OPENED_BEFORE_STRANGER\" ]"
rm -f "$SB/home27/board.pid"
# The ANCHOR of the ps predicate, pinned: another install's LIVE server
# pid in this home's pidfile must still read as not-ours (the unanchored
# *app/server.js* pattern would accept it, print "Kosmos is running",
# and open the stub).
export KOSMOS_HOME="$SB/home31" KOSMOS_BIN_DIR="$SB/bin31"
mkdir -p "$SB/home31"
cp "$SB/home26/board.pid" "$SB/home31/board.pid"
OPENED_BEFORE_ANCHOR="$(wc -l < "$SB/opened.log" | tr -d ' ')"
RC=0; cat "$SETUP" | HOME="$SB/anchor-home" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SB/sys31" KOSMOS_NO_OPEN= KOSMOS_OPEN_CMD="$SB/open-stub" sh > "$SB/anchor.log" 2>&1 || RC=$?
chk "anchored install exits 0" "rc_ok $RC"
chk "another install's live server does not read as ours" "grep -q 'something else is already answering on port' \"$SB/anchor.log\""
chk "no open on another install's server" "[ \"\$(wc -l < \"$SB/opened.log\" | tr -d ' ')\" = \"$OPENED_BEFORE_ANCHOR\" ]"
KOSMOS_HOME="$SB/home26" "$SB/bin26/kosmos" stop > /dev/null 2>&1 || true

echo "== a link at the SYSTEM path survives uninstall, named =="
# The round-14 gap: an owned-target LINK at the system entry passed the
# leaf -L and the grep (both follow links) and was deleted as "the
# Kosmos app". Linkness must decide at the root for the uninstall too.
SYS29="$SB/sys29"
REALB2="$SB/realbundle2"
mkdir -p "$SYS29"
seed_kosmos_bundle "$REALB2" "$SB/home28"
ln -s "$REALB2/Kosmos.app" "$SYS29/Kosmos.app"
SBH24="$SB/lnk3-home"
mkdir -p "$SBH24"
export KOSMOS_HOME="$SB/home28" KOSMOS_BIN_DIR="$SB/bin28"
RC=0; HOME="$SBH24" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS29" sh -s -- --uninstall < "$SETUP" > "$SB/lnk3-un.log" 2>&1 || RC=$?
chk "owned-target-link uninstall exits 0" "rc_ok $RC"
chk "the link survives the uninstall" "[ -L \"$SYS29/Kosmos.app\" ]"
chk "its target survives too" "[ -f \"$REALB2/Kosmos.app/Contents/MacOS/Kosmos\" ]"
chk "the link is named, not claimed" "grep -q 'could not be proven to belong to this install' \"$SB/lnk3-un.log\""

echo "== the production open default is real =="
# Every observing pass substitutes the recording stub, and command -v
# silently no-ops on an unresolvable value, so a typo in the default
# would disable the branch's headline behavior on every real install
# while the suite stayed green. Pin the literal and the binary.
chk "the served file defaults to /usr/bin/open" "grep -q 'KOSMOS_OPEN_CMD:-/usr/bin/open' \"$SETUP\""
chk "/usr/bin/open exists on this machine" "[ -x /usr/bin/open ]"

echo "== the open gate's sandbox belt, and a file-shadowed Applications =="
# The [ -z KOSMOS_APP_DIR ] clause in the open gate: a fresh sandboxed
# install with the suppressor CLEARED must still not open. Without this
# pass the belt could be deleted and the suite would stay green, because
# every other override pass inherits the global KOSMOS_NO_OPEN.
chk "port free before the belt pass (a leaked board here makes the belt assertion vacuous)" "! curl -s -m 1 -o /dev/null http://127.0.0.1:$PORT/"
OPENED_LINES_BEFORE="$(wc -l < "$SB/opened.log" | tr -d ' ')"
export KOSMOS_HOME="$SB/home18" KOSMOS_BIN_DIR="$SB/bin18"
RC=0; cat "$SETUP" | KOSMOS_APP_DIR="$SB/apps18" KOSMOS_NO_OPEN= KOSMOS_OPEN_CMD="$SB/open-stub" sh > "$SB/belt.log" 2>&1 || RC=$?
chk "belt install exits 0" "rc_ok $RC"
chk "the verbatim override alone suppresses the open" "[ \"\$(wc -l < \"$SB/opened.log\" | tr -d ' ')\" = \"$OPENED_LINES_BEFORE\" ]"
KOSMOS_HOME="$SB/home18" "$SB/bin18/kosmos" stop > /dev/null 2>&1 || true

if [ "$(id -u)" -eq 0 ]; then
  echo "SKIP file-shadowed leg: running as root (the read-only probe dir does not bind)"
  SKIPS=$((SKIPS + 1))
else
  # ~/Applications exists as a regular FILE and the probe fails: the icon
  # step used to die here, aborting before "Starting Kosmos" on a run
  # that could still deliver a working install. It must finish, say the
  # give-up sentence, and leave the board running.
  SYS_RO5="$SB/sysro5"
  mkdir -p "$SYS_RO5"
  chmod 555 "$SYS_RO5"
  SBH19="$SB/file-home"
  mkdir -p "$SBH19"
  touch "$SBH19/Applications"
  export KOSMOS_HOME="$SB/home21" KOSMOS_BIN_DIR="$SB/bin21"
  RC=0; cat "$SETUP" | HOME="$SBH19" KOSMOS_APP_DIR= KOSMOS_SYS_APP_DIR="$SYS_RO5" sh > "$SB/fileapps.log" 2>&1 || RC=$?
  chk "file-shadowed Applications does not abort the install" "rc_ok $RC"
  chk "the give-up sentence prints for the shadowed folder" "grep -q 'could not create the app icon, but Kosmos itself is fine' \"$SB/fileapps.log\""
  chk "the board still came up" "curl -s -m 2 -o /dev/null http://127.0.0.1:$PORT/"
  KOSMOS_HOME="$SB/home21" "$SB/bin21/kosmos" stop > /dev/null 2>&1 || true
  chmod 755 "$SYS_RO5"
fi

echo "== #883: a sandboxed KOSMOS_HOME derives its own board label and env roots =="
# 🔑 THE WHOLE FILE'S GLOBAL EXPORTS (AGENT_WORKFORCE_DATA/_PROJECTS/_WORKERS,
# set once near the top) are exactly the family Pete's release-walk
# convention does NOT set -- so every scenario above already exercises the
# NEW label-derivation logic (KOSMOS_HOME here is never the real default),
# but none of them can exercise "derive the three env keys because they are
# missing", since they are never missing here. This section deliberately
# unsets them for three sub-scenarios to reproduce Pete's exact convention
# (KOSMOS_HOME + KOSMOS_HOME_APP_DIR + KOSMOS_PORT, nothing else) rather than
# the fuller harness family, which is the precise shape #883 was filed
# against. Each sub-scenario stops its own board before the next starts --
# healthy() treats ANY answering Kosmos board as "already running" (by
# design, #664/#874's own territory), so a still-live board from a prior
# sub-scenario would make the next one's install silently skip starting its
# OWN process on the shared $PORT rather than a genuine port-free test.
# 🔑 CONFIRMED, NOT ASSUMED: an occasionally-slow `kosmos stop` here is the
# SAME identity gap #910 was filed for (install/kosmos's healthy() answers
# "is A Kosmos board here", never "is MY Kosmos board here"), just wearing a
# different costume. Traced directly while building this section: when the
# prior scenario's board is still dying at the moment the next one's
# `cmd_start` runs, `healthy()` sees IT and calls the whole thing "already
# running" -- so the next scenario's OWN process never starts, its pidfile
# is never written, and a later `kosmos stop` against that KOSMOS_HOME
# correctly refuses to touch a process it does not recognize ("Something is
# answering... but it was not started by this command, so it was left
# alone."). A plain wait cannot fix that -- there is nothing for the next
# scenario to eventually recognize as its own. So this helper does not just
# wait: past the timeout it force-kills whatever is actually listening
# (this suite's own disposable sandboxed boards, never a real user's), so
# the NEXT scenario starts from a genuinely clean port rather than
# inheriting an ambiguous one.
wait_port_free() {
  local i
  for i in $(seq 1 30); do
    curl -fsS -m 1 -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null || return 0
    sleep 0.5
  done
  lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | xargs -r kill -9 2>/dev/null || true
  for i in $(seq 1 10); do
    curl -fsS -m 1 -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null || return 0
    sleep 0.5
  done
  return 1
}

echo "-- default KOSMOS_HOME: byte-identical label, no env keys added --"
# A sandboxed HOME so "the real default" resolves somewhere safe to read,
# never the operator's actual ~/.local/share/kosmos. AGENT_WORKFORCE_LAUNCH
# still overridden for file-write safety -- that override is orthogonal to
# the KOSMOS_HOME-default check this scenario is actually testing.
SBH_DEF="$SB/defaulthome"
mkdir -p "$SBH_DEF"
export KOSMOS_BIN_DIR="$SB/bindef"
RC=0; cat "$SETUP" | env -u KOSMOS_HOME HOME="$SBH_DEF" AGENT_WORKFORCE_LAUNCH="$SB/launchdef" KOSMOS_APP_DIR="$SB/appsdef" sh > "$SB/defaulthome-install.log" 2>&1 || RC=$?
chk "default-KOSMOS_HOME install exits 0" "rc_ok $RC"
DEF_PLIST="$SB/launchdef/com.kosmos.board.plist"
chk "default install's plist keeps the literal, unsuffixed label" "[ -f \"$DEF_PLIST\" ]"
chk "default install's plist adds no AGENT_WORKFORCE_DATA key" "! grep -q AGENT_WORKFORCE_DATA \"$DEF_PLIST\""
chk "default install's plist adds no AGENT_WORKFORCE_PROJECTS key" "! grep -q AGENT_WORKFORCE_PROJECTS \"$DEF_PLIST\""
chk "default install's plist adds no AGENT_WORKFORCE_WORKERS key" "! grep -q AGENT_WORKFORCE_WORKERS \"$DEF_PLIST\""
HOME="$SBH_DEF" "$SBH_DEF/.local/share/kosmos/bin/kosmos" stop > /dev/null 2>&1 || true
chk "the port is genuinely free before the trailing-slash default scenario starts" "wait_port_free"

echo "-- default KOSMOS_HOME, but \$HOME carries a trailing slash: still byte-identical --"
# 🔑 THE REGRESSION TEST FOR CHALLENGE-LOOP ITERATION 1'S OWN FINDING. Without
# normalizing _kosmos_home_default the same way KOSMOS_HOME itself already
# is (install/setup.sh's own header: "a trailing slash on $HOME made every
# ownership and board proof in this file use //-flavored paths"), a $HOME
# like this one would make a genuinely-default install compare as
# non-default -- suffixed label, extra env keys, the exact regression the
# byte-identical invariant exists to prevent. The scenario above alone
# cannot catch this: its $HOME never carries a trailing slash.
SBH_SLASH="$SB/defaulthome-slash"
mkdir -p "$SBH_SLASH"
export KOSMOS_BIN_DIR="$SB/bindefslash"
RC=0; cat "$SETUP" | env -u KOSMOS_HOME HOME="$SBH_SLASH/" AGENT_WORKFORCE_LAUNCH="$SB/launchdefslash" KOSMOS_APP_DIR="$SB/appsdefslash" sh > "$SB/defaulthome-slash-install.log" 2>&1 || RC=$?
chk "trailing-slash-HOME default install exits 0" "rc_ok $RC"
DEF_SLASH_PLIST="$SB/launchdefslash/com.kosmos.board.plist"
chk "trailing-slash-HOME install still keeps the literal, unsuffixed label" "[ -f \"$DEF_SLASH_PLIST\" ]"
chk "trailing-slash-HOME install still adds no AGENT_WORKFORCE_DATA key" "! grep -q AGENT_WORKFORCE_DATA \"$DEF_SLASH_PLIST\""
HOME="$SBH_SLASH/" "$SBH_SLASH/.local/share/kosmos/bin/kosmos" stop > /dev/null 2>&1 || true
chk "the port is genuinely free before Pete's-convention scenario starts" "wait_port_free"

echo "-- Pete's exact convention: unique label, all three roots under KOSMOS_HOME --"
PETE_HOME="$SB/petehome"
export KOSMOS_HOME="$PETE_HOME" KOSMOS_BIN_DIR="$SB/binpete"
RC=0; cat "$SETUP" | env -u AGENT_WORKFORCE_DATA -u AGENT_WORKFORCE_PROJECTS -u AGENT_WORKFORCE_WORKERS \
  AGENT_WORKFORCE_LAUNCH="$SB/launchpete" KOSMOS_HOME_APP_DIR="$SB/petehome-apps" KOSMOS_APP_DIR="$SB/appspete" \
  sh > "$SB/pete-install.log" 2>&1 || RC=$?
chk "Pete's-convention install exits 0" "rc_ok $RC"
PETE_SUFFIX="$(printf '%s' "$PETE_HOME" | shasum -a 256 | cut -c1-8)"
PETE_PLIST="$SB/launchpete/com.kosmos.board.$PETE_SUFFIX.plist"
chk "Pete's-convention plist carries the derived, suffixed label" "[ -f \"$PETE_PLIST\" ]"
chk "Pete's-convention plist does NOT reuse the bare default label" "[ ! -f \"$SB/launchpete/com.kosmos.board.plist\" ]"
chk "Pete's-convention plist's AGENT_WORKFORCE_DATA is under KOSMOS_HOME" "grep -q \"<key>AGENT_WORKFORCE_DATA</key><string>$PETE_HOME/data</string>\" \"$PETE_PLIST\""
chk "Pete's-convention plist's AGENT_WORKFORCE_PROJECTS is under KOSMOS_HOME" "grep -q \"<key>AGENT_WORKFORCE_PROJECTS</key><string>$PETE_HOME/projects</string>\" \"$PETE_PLIST\""
chk "Pete's-convention plist's AGENT_WORKFORCE_WORKERS is under KOSMOS_HOME" "grep -q \"<key>AGENT_WORKFORCE_WORKERS</key><string>$PETE_HOME/workers</string>\" \"$PETE_PLIST\""
chk "Pete's-convention plist ALSO carries the #634 override for the NEXT restart" "grep -q '<key>AGENT_WORKFORCE_HALF_SANDBOX_OK</key><string>1</string>' \"$PETE_PLIST\""
chk "the four new keys sit one per line, not squished onto one" "[ \"\$(grep -c '<key>AGENT_WORKFORCE_' \"\$PETE_PLIST\")\" = 4 ] && [ \"\$(grep -c '<key>AGENT_WORKFORCE_DATA</key>.*<key>AGENT_WORKFORCE_PROJECTS</key>' \"\$PETE_PLIST\")\" = 0 ]"

echo "-- #883 challenge-loop iteration 4: a REBOOT uses only the plist's own env, not this session's exports --"
# 🔑 THE FIX THAT ITERATION 3 SHIPPED ONLY COVERED THE SAME-SESSION START.
# A real reboot or self-update (engine/update.js) runs `kosmos start` as a
# FRESH process whose entire environment IS the plist's EnvironmentVariables
# dict -- nothing this installing shell had exported survives. Iteration 4
# caught this by direct reproduction, not by reading: simulating exactly
# what launchd does at the next login -- invoking `bin/kosmos start` with
# ONLY the plist's own keys as its environment -- reproduced the #634
# refusal even after the "session export" fix, because
# AGENT_WORKFORCE_HALF_SANDBOX_OK had not yet been added to the plist
# itself. This scenario is that exact reproduction, kept as a permanent
# regression test.
_plist_env_line() { # $1 = key, reads the plist XML shape <key>K</key><string>V</string>
  sed -n "s|.*<key>$1</key><string>\\([^<]*\\)</string>.*|\\1|p" "$PETE_PLIST" | head -1
}
# 🛑 STOPPED FIRST, AND VERIFIED FREE, OR THIS TEST IS VACUOUS. Pete's board
# from the install above is still live at this point. `cmd_start`'s own
# healthy() short-circuits to "already running" the moment ANYTHING answers
# on the port -- so without stopping it first, `kosmos start` below would
# never spawn a NEW process with the constructed env at all, and this test
# would "pass" whether or not the fix exists (measured: it did, on the very
# first version of this test, before this stop was added).
KOSMOS_HOME="$PETE_HOME" "$PETE_HOME/bin/kosmos" stop > /dev/null 2>&1 || true
chk "the port is genuinely free before the reboot simulation" "wait_port_free"
# board.log is append-only (install/kosmos's own >> ), so it still carries
# every earlier legitimate start from this same KOSMOS_HOME -- truncated
# here so the assertion below is scoped to THIS run's output only, not "no
# refusal anywhere in the file's whole history" (which happened to be true
# by construction so far, but is a weaker guarantee than it looks like).
: > "$PETE_HOME/logs/board.log"
RC=0; env -i \
  HOME="$(_plist_env_line HOME)" \
  PATH="$(_plist_env_line PATH)" \
  LANG="$(_plist_env_line LANG)" \
  KOSMOS_PORT="$(_plist_env_line KOSMOS_PORT)" \
  AGENT_WORKFORCE_DATA="$(_plist_env_line AGENT_WORKFORCE_DATA)" \
  AGENT_WORKFORCE_PROJECTS="$(_plist_env_line AGENT_WORKFORCE_PROJECTS)" \
  AGENT_WORKFORCE_WORKERS="$(_plist_env_line AGENT_WORKFORCE_WORKERS)" \
  AGENT_WORKFORCE_HALF_SANDBOX_OK="$(_plist_env_line AGENT_WORKFORCE_HALF_SANDBOX_OK)" \
  "$PETE_HOME/bin/kosmos" start > "$SB/reboot-sim.log" 2>&1 || RC=$?
chk "a simulated reboot (plist env only) starts the board, not #634's refusal" "rc_ok $RC"
# ⚠️ board.log, NOT reboot-sim.log: the shell wrapper's own stdout only ever
# says "Kosmos did not come up, see board.log" -- the actual #634 sentence
# (or any other startup failure) is written by the server process itself,
# into board.log. Checking the wrong file here would pass vacuously no
# matter what actually failed (confirmed: it did, on the first version of
# this check, before the target file was corrected).
chk "the reboot-simulation's board.log does not carry the half-sandboxed refusal" "! grep -q 'will not start half-sandboxed' \"$PETE_HOME/logs/board.log\""
KOSMOS_HOME="$PETE_HOME" "$PETE_HOME/bin/kosmos" stop > /dev/null 2>&1 || true
wait_port_free || echo "WARN: port did not go quiet after the reboot-simulation stop"

echo "-- re-running the same sandboxed install derives the identical label --"
# Deliberately NOT stopped first: the board from the run above is still
# live, matching the real self-update shape (engine/update.js spawns this
# exact script as a detached child of the RUNNING board) that #883's own
# escalation named as the repeated-poisoning path.
RC=0; cat "$SETUP" | env -u AGENT_WORKFORCE_DATA -u AGENT_WORKFORCE_PROJECTS -u AGENT_WORKFORCE_WORKERS \
  AGENT_WORKFORCE_LAUNCH="$SB/launchpete" KOSMOS_HOME_APP_DIR="$SB/petehome-apps" KOSMOS_APP_DIR="$SB/appspete" \
  sh > "$SB/pete-install2.log" 2>&1 || RC=$?
chk "second run against the same KOSMOS_HOME exits 0" "rc_ok $RC"
chk "second run derives the SAME label, not a new one (idempotency)" "[ -f \"$PETE_PLIST\" ]"
KOSMOS_HOME="$PETE_HOME" "$PETE_HOME/bin/kosmos" stop > /dev/null 2>&1 || true
chk "the port is genuinely free before the override scenario starts" "wait_port_free"

echo "-- an explicit override still wins over the derived default --"
export KOSMOS_HOME="$SB/petehome-override" KOSMOS_BIN_DIR="$SB/binpete-override"
# 🔑 AGENT_WORKFORCE_HALF_SANDBOX_OK="0" DELIBERATELY, not unset: the
# derivation's own pattern is `[ -n "${VAR:-}" ] || export VAR=1`, and "0"
# is a non-empty string -- `-n "0"` is true, so this checks the override
# actually respects a caller's explicit "0" rather than treating it as
# falsy and silently overwriting it with the derived "1" (challenge-loop
# iteration 5 asked specifically whether this exact case was covered; it
# wasn't, until this scenario).
RC=0; cat "$SETUP" | env -u AGENT_WORKFORCE_PROJECTS -u AGENT_WORKFORCE_WORKERS \
  AGENT_WORKFORCE_DATA="$SB/petehome-override-data" AGENT_WORKFORCE_LAUNCH="$SB/launchpete-override" \
  AGENT_WORKFORCE_HALF_SANDBOX_OK="0" \
  KOSMOS_HOME_APP_DIR="$SB/petehome-override-apps" KOSMOS_APP_DIR="$SB/appspete-override" \
  sh > "$SB/pete-override-install.log" 2>&1 || RC=$?
chk "override-scenario install exits 0" "rc_ok $RC"
OVERRIDE_SUFFIX="$(printf '%s' "$SB/petehome-override" | shasum -a 256 | cut -c1-8)"
OVERRIDE_PLIST="$SB/launchpete-override/com.kosmos.board.$OVERRIDE_SUFFIX.plist"
chk "an explicit AGENT_WORKFORCE_DATA is carried through as given, not overwritten" "grep -q \"<key>AGENT_WORKFORCE_DATA</key><string>$SB/petehome-override-data</string>\" \"$OVERRIDE_PLIST\""
chk "AGENT_WORKFORCE_PROJECTS still derives from KOSMOS_HOME when not itself overridden" "grep -q \"<key>AGENT_WORKFORCE_PROJECTS</key><string>$SB/petehome-override/projects</string>\" \"$OVERRIDE_PLIST\""
chk "AGENT_WORKFORCE_WORKERS still derives from KOSMOS_HOME when not itself overridden" "grep -q \"<key>AGENT_WORKFORCE_WORKERS</key><string>$SB/petehome-override/workers</string>\" \"$OVERRIDE_PLIST\""
chk "an explicit AGENT_WORKFORCE_HALF_SANDBOX_OK=0 is carried through as given, not overwritten to 1" "grep -q '<key>AGENT_WORKFORCE_HALF_SANDBOX_OK</key><string>0</string>' \"$OVERRIDE_PLIST\""
KOSMOS_HOME="$SB/petehome-override" "$SB/petehome-override/bin/kosmos" stop > /dev/null 2>&1 || true

echo "== #924: uninstall derives its data root the same way install does, or it sweeps somebody else's real data =="
# 🔑 THE EXACT INCIDENT. Pete's act-three uninstall ran with KOSMOS_HOME set
# (a sandboxed convention walk, exactly the "Pete's exact convention"
# scenario above) and AGENT_WORKFORCE_DATA unset. The install path derives
# AGENT_WORKFORCE_DATA from KOSMOS_HOME for a non-default KOSMOS_HOME
# (#883, proven above) -- uninstall() never did, so `_remote_state` and
# `_support` fell through to the REAL, unsandboxed
# $HOME/Library/Application Support, and would sweep the shared supervisor
# and remembered-answer files there while KOSMOS_HOME itself stayed
# correctly scoped: correctly-scoped LABEL (#883's own duplication above
# already covers the plist), wrong DATA ROOT, so the run LOOKED targeted
# and was not.
#
# A fake HOME stands in for "the real machine" here, never the operator's
# actual one -- the whole point of this section is "does the sandboxed
# uninstall reach outside its own KOSMOS_HOME", so what it must not touch
# has to be a planted, observable file, not the operator's real
# Application Support.
D924_HOME="$SB/d924-realhome"
mkdir -p "$D924_HOME/Library/Application Support/AgentWorkforce/bin"
printf 'REAL SHARED SUPERVISOR, OUTSIDE THE SANDBOXED WALK\n' > "$D924_HOME/Library/Application Support/AgentWorkforce/bin/sentinel"
printf '{"real":true}\n' > "$D924_HOME/Library/Application Support/AgentWorkforce/first-run.json"

echo "-- Pete's exact incident, reproduced: KOSMOS_HOME set, AGENT_WORKFORCE_DATA unset --"
D924_KHOME="$SB/d924-sandboxedhome"
export KOSMOS_HOME="$D924_KHOME" KOSMOS_BIN_DIR="$SB/bin924"
RC=0; cat "$SETUP" | env -u AGENT_WORKFORCE_DATA -u AGENT_WORKFORCE_PROJECTS -u AGENT_WORKFORCE_WORKERS \
  HOME="$D924_HOME" AGENT_WORKFORCE_LAUNCH="$SB/launch924" KOSMOS_HOME_APP_DIR="$SB/d924home-apps" KOSMOS_APP_DIR="$SB/apps924" \
  sh > "$SB/d924-install.log" 2>&1 || RC=$?
chk "#924 setup install exits 0" "rc_ok $RC"
KOSMOS_HOME="$D924_KHOME" "$D924_KHOME/bin/kosmos" stop > /dev/null 2>&1 || true
chk "the port is genuinely free before #924's uninstall runs" "wait_port_free"

RC=0; cat "$SETUP" | env -u AGENT_WORKFORCE_DATA -u AGENT_WORKFORCE_PROJECTS -u AGENT_WORKFORCE_WORKERS \
  HOME="$D924_HOME" KOSMOS_HOME="$D924_KHOME" AGENT_WORKFORCE_LAUNCH="$SB/launch924" KOSMOS_HOME_APP_DIR="$SB/d924home-apps" KOSMOS_APP_DIR="$SB/apps924" \
  sh -s -- --uninstall > "$SB/d924-uninstall.log" 2>&1 || RC=$?
chk "#924 uninstall exits 0" "rc_ok $RC"
chk "the real Application Support's shared supervisor survives byte for byte" \
  "[ \"\$(cat \"$D924_HOME/Library/Application Support/AgentWorkforce/bin/sentinel\" 2>/dev/null)\" = 'REAL SHARED SUPERVISOR, OUTSIDE THE SANDBOXED WALK' ]"
chk "the real Application Support's first-run.json survives" "[ -f \"$D924_HOME/Library/Application Support/AgentWorkforce/first-run.json\" ]"
chk "the sandboxed KOSMOS_HOME itself is gone" "[ ! -d \"$D924_KHOME\" ]"

echo "-- an explicit AGENT_WORKFORCE_DATA at uninstall time still wins over the derived default --"
D924_EXPLICIT_DATA="$SB/d924-explicit-data"
mkdir -p "$D924_EXPLICIT_DATA/AgentWorkforce/bin"
printf 'explicit-scenario supervisor\n' > "$D924_EXPLICIT_DATA/AgentWorkforce/bin/sentinel"
RC=0; cat "$SETUP" | env -u AGENT_WORKFORCE_PROJECTS -u AGENT_WORKFORCE_WORKERS \
  HOME="$D924_HOME" KOSMOS_HOME="$D924_KHOME" AGENT_WORKFORCE_DATA="$D924_EXPLICIT_DATA" \
  AGENT_WORKFORCE_LAUNCH="$SB/launch924b" KOSMOS_HOME_APP_DIR="$SB/d924home-apps-b" KOSMOS_APP_DIR="$SB/apps924b" \
  sh > "$SB/d924-explicit-install.log" 2>&1 || RC=$?
chk "#924 explicit-AGENT_WORKFORCE_DATA setup install exits 0" "rc_ok $RC"
KOSMOS_HOME="$D924_KHOME" "$D924_KHOME/bin/kosmos" stop > /dev/null 2>&1 || true
chk "the port is genuinely free before the explicit-override uninstall runs" "wait_port_free"
RC=0; cat "$SETUP" | env -u AGENT_WORKFORCE_PROJECTS -u AGENT_WORKFORCE_WORKERS \
  HOME="$D924_HOME" KOSMOS_HOME="$D924_KHOME" AGENT_WORKFORCE_DATA="$D924_EXPLICIT_DATA" \
  AGENT_WORKFORCE_LAUNCH="$SB/launch924b" KOSMOS_HOME_APP_DIR="$SB/d924home-apps-b" KOSMOS_APP_DIR="$SB/apps924b" \
  sh -s -- --uninstall > "$SB/d924-explicit-uninstall.log" 2>&1 || RC=$?
chk "explicit-override uninstall exits 0" "rc_ok $RC"
chk "the caller's explicit AGENT_WORKFORCE_DATA is what got swept, not the KOSMOS_HOME-derived default" "[ ! -f \"$D924_EXPLICIT_DATA/AgentWorkforce/bin/sentinel\" ]"
chk "the caller's explicit AGENT_WORKFORCE_DATA scenario never touched the real Application Support sentinel" \
  "[ \"\$(cat \"$D924_HOME/Library/Application Support/AgentWorkforce/bin/sentinel\" 2>/dev/null)\" = 'REAL SHARED SUPERVISOR, OUTSIDE THE SANDBOXED WALK' ]"

echo "-- the belt: a non-default KOSMOS_HOME whose AGENT_WORKFORCE_DATA is forced back to the real default is refused, not swept --"
# Defense in depth for the derivation above ever not firing (a future
# reorder, a caller who sandboxes KOSMOS_HOME but mistakenly points
# AGENT_WORKFORCE_DATA at the real path by hand). Forced here by setting
# AGENT_WORKFORCE_DATA explicitly to the same path the DEFAULT would
# resolve to, while KOSMOS_HOME stays sandboxed -- the exact mismatch the
# guard exists to catch.
#
# DELIBERATELY no fresh install for this scenario: $D924_KHOME no longer
# exists on disk (scenario 1 already uninstalled and removed it above),
# and the guard doesn't need it to. It fires on a pure string comparison
# of env vars before uninstall() ever inspects KOSMOS_HOME's contents --
# confirmed by reading uninstall() top to bottom, there is no
# `[ -d "$KOSMOS_HOME" ]` precondition ahead of it. Reusing the variable
# name (not the directory) keeps this scenario's intent legible: "the
# same sandboxed KOSMOS_HOME, now with AGENT_WORKFORCE_DATA misconfigured".
RC=0; cat "$SETUP" | env -u AGENT_WORKFORCE_PROJECTS -u AGENT_WORKFORCE_WORKERS \
  HOME="$D924_HOME" KOSMOS_HOME="$D924_KHOME" AGENT_WORKFORCE_DATA="$D924_HOME/Library/Application Support" \
  AGENT_WORKFORCE_LAUNCH="$SB/launch924" KOSMOS_HOME_APP_DIR="$SB/d924home-apps" KOSMOS_APP_DIR="$SB/apps924" \
  sh -s -- --uninstall > "$SB/d924-belt-uninstall.log" 2>&1 || RC=$?
chk "the belt-scenario uninstall refuses (exit 1), it does not silently sweep" "[ \"$RC\" = 1 ]"
chk "the belt-scenario names why it refused" "grep -q 'refusing to touch' \"$SB/d924-belt-uninstall.log\""
chk "the belt-scenario never touched the real Application Support sentinel" \
  "[ \"\$(cat \"$D924_HOME/Library/Application Support/AgentWorkforce/bin/sentinel\" 2>/dev/null)\" = 'REAL SHARED SUPERVISOR, OUTSIDE THE SANDBOXED WALK' ]"

echo "-- control: a DEFAULT KOSMOS_HOME with AGENT_WORKFORCE_DATA unset still targets Application Support as before (unchanged) --"
# The belt above must never fire for a genuine real-machine uninstall --
# KOSMOS_HOME here equals its own default, so the guard's
# "KOSMOS_HOME != _kosmos_home_default" condition is false and the sweep
# proceeds exactly as it always has.
D924_DEFHOME="$SB/d924-defaulthome"
mkdir -p "$D924_DEFHOME/Library/Application Support/AgentWorkforce/bin"
printf 'default-scenario supervisor\n' > "$D924_DEFHOME/Library/Application Support/AgentWorkforce/bin/sentinel"
# ⚠️ NO AGENT_WORKFORCE_LAUNCH OVERRIDE HERE, DELIBERATELY. An earlier
# version of this scenario passed one anyway (copy-pasted from the
# sandboxed scenarios above) while leaving KOSMOS_HOME at its real
# default -- LAUNCH sandboxed, DATA/PROJECTS/WORKERS not, which is
# exactly the half-sandboxed shape `engine/sandbox.js`'s #634 guard
# exists to refuse. Caught by running this scenario, not by reading it:
# the board printed "Kosmos will not start half-sandboxed" and the
# install step itself failed before uninstall was ever reached. Leaving
# AGENT_WORKFORCE_LAUNCH unset here is safe -- $HOME is already this
# scenario's own fake $D924_DEFHOME, so the real default it falls back to
# is "$D924_DEFHOME/Library/LaunchAgents", not the operator's actual one.
RC=0; cat "$SETUP" | env -u KOSMOS_HOME -u AGENT_WORKFORCE_DATA -u AGENT_WORKFORCE_PROJECTS -u AGENT_WORKFORCE_WORKERS -u AGENT_WORKFORCE_LAUNCH \
  HOME="$D924_DEFHOME" KOSMOS_HOME_APP_DIR="$SB/d924home-apps-c" KOSMOS_APP_DIR="$SB/apps924c" \
  sh > "$SB/d924-default-install.log" 2>&1 || RC=$?
# Every cat below is guarded with `|| true`: this whole block runs under
# the file's own set -e, and a failed diagnostic dump (the log it wants to
# show is itself missing, which is plausible for a board that failed
# before writing one) must never abort the rest of the suite -- that would
# turn a debug aid into a second, more confusing failure mode.
[ "$RC" = 0 ] || {
  echo "DEBUG #924 control install log:"; cat "$SB/d924-default-install.log" 2>&1 || true;
  echo "DEBUG #924 control board.log:"; cat "$D924_DEFHOME/.local/share/kosmos/logs/board.log" 2>&1 || true;
  echo "DEBUG #924 control install.log:"; cat "$D924_DEFHOME/.local/share/kosmos/logs/install.log" 2>&1 || true;
}
chk "#924 control (default KOSMOS_HOME) install exits 0" "rc_ok $RC"
HOME="$D924_DEFHOME" "$D924_DEFHOME/.local/share/kosmos/bin/kosmos" stop > /dev/null 2>&1 || true
chk "the port is genuinely free before the control uninstall runs" "wait_port_free"
# 🛑 AGENT_WORKFORCE_LAUNCH IS PINNED FOR THE UNINSTALL STEP (#946). A fake
# HOME scopes the files; it does not scope the launchd domain. With
# KOSMOS_HOME at its default the label is the bare com.kosmos.board, and
# this uninstall ran `launchctl bootout gui/$uid/com.kosmos.board`: the
# REAL board's job on the build Mac, taken down on every full gate run
# (measured 2026-08-26 00:39 and 00:53, restored by hand both times). The
# install step above keeps LAUNCH unset for the reason its comment gives;
# the uninstall's data-root assertion below does not need launchctl at all,
# and the plist it should remove is the one the install wrote under the
# fake HOME, which is exactly where this points.
RC=0; cat "$SETUP" | env -u KOSMOS_HOME -u AGENT_WORKFORCE_DATA -u AGENT_WORKFORCE_PROJECTS -u AGENT_WORKFORCE_WORKERS \
  HOME="$D924_DEFHOME" AGENT_WORKFORCE_LAUNCH="$D924_DEFHOME/Library/LaunchAgents" KOSMOS_HOME_APP_DIR="$SB/d924home-apps-c" KOSMOS_APP_DIR="$SB/apps924c" \
  sh -s -- --uninstall > "$SB/d924-default-uninstall.log" 2>&1 || RC=$?
chk "control uninstall exits 0" "rc_ok $RC"
chk "control: the real (for this scenario's fake HOME) Application Support supervisor IS swept, matching pre-#924 behavior" \
  "[ ! -f \"$D924_DEFHOME/Library/Application Support/AgentWorkforce/bin/sentinel\" ]"

echo "== #931: a sandboxed uninstall removes only the agent jobs that name ITS supervisor, never another install's =="
# 🔑 THE EXACT INCIDENT SHAPE, with a fake HOME standing in for the real
# machine. KOSMOS_HOME sandboxed, AGENT_WORKFORCE_LAUNCH unset: the plist
# loop resolves to "$HOME/Library/LaunchAgents", the REAL directory, and
# before #931 booted out and deleted every com.kosmos.agent.*.plist there.
# The proof of ownership is inside each file: plistFor writes the creating
# install's supervisor path into ProgramArguments. Two planted jobs, same
# shape engine/create.js writes: one naming the sandboxed install's
# supervisor (ours, must go) and one naming the fake real machine's
# (foreign, must survive byte for byte). No install is needed: the loop
# runs on whatever is in the directory, and the names are unique to this
# scenario so the (harmless, || true) launchctl calls on gui/$uid touch no
# real label.
D931_HOME="$SB/d931-realhome"
D931_KHOME="$SB/d931-sandboxedhome"
mkdir -p "$D931_HOME/Library/LaunchAgents" "$D931_KHOME"
plist931() {
  printf '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n  <key>Label</key><string>com.kosmos.agent.%s</string>\n  <key>ProgramArguments</key>\n  <array>\n    <string>/bin/bash</string>\n    <string>%s/AgentWorkforce/bin/agent-supervisor.sh</string>\n    <string>%s</string>\n  </array>\n</dict>\n</plist>\n' "$1" "$2" "$1"
}
plist931 d931own "$D931_KHOME/data" > "$D931_HOME/Library/LaunchAgents/com.kosmos.agent.d931own.plist"
plist931 d931foreign "$D931_HOME/Library/Application Support" > "$D931_HOME/Library/LaunchAgents/com.kosmos.agent.d931foreign.plist"
FOREIGN931_BEFORE="$(shasum -a 256 < "$D931_HOME/Library/LaunchAgents/com.kosmos.agent.d931foreign.plist" | cut -c1-64)"
RC=0; cat "$SETUP" | env -u AGENT_WORKFORCE_DATA -u AGENT_WORKFORCE_PROJECTS -u AGENT_WORKFORCE_WORKERS -u AGENT_WORKFORCE_LAUNCH \
  HOME="$D931_HOME" KOSMOS_HOME="$D931_KHOME" KOSMOS_HOME_APP_DIR="$SB/d931home-apps" KOSMOS_APP_DIR="$SB/apps931" \
  sh -s -- --uninstall > "$SB/d931-uninstall.log" 2>&1 || RC=$?
chk "#931 sandboxed uninstall (LAUNCH unset, the incident shape) exits 0" "rc_ok $RC"
chk "the job naming the sandboxed install's supervisor is removed" "[ ! -e \"$D931_HOME/Library/LaunchAgents/com.kosmos.agent.d931own.plist\" ]"
chk "the job naming another install's supervisor survives byte for byte" \
  "[ \"\$(shasum -a 256 < \"$D931_HOME/Library/LaunchAgents/com.kosmos.agent.d931foreign.plist\" 2>/dev/null | cut -c1-64)\" = \"$FOREIGN931_BEFORE\" ]"
chk "the survivor is named in the log rather than skipped silently" "grep -q 'leaving the background job for d931foreign' \"$SB/d931-uninstall.log\""
chk "the removed job is named in the log as removed" "grep -q 'removing the background job for d931own' \"$SB/d931-uninstall.log\""

echo "-- control: a DEFAULT KOSMOS_HOME uninstall still removes the jobs naming the real supervisor --"
# The proof must not turn a real uninstall into one that leaves every job
# behind: with KOSMOS_HOME at its default, the resolved data root IS the
# (fake) real Application Support, and the foreign job from above is now
# the one that names it.
plist931 d931own "$D931_KHOME/data" > "$D931_HOME/Library/LaunchAgents/com.kosmos.agent.d931own.plist"
# 🛑 AGENT_WORKFORCE_LAUNCH IS SET HERE, ON PURPOSE, AND THE FIRST VERSION
# DID NOT: a default-KOSMOS_HOME uninstall with it unset runs `launchctl
# bootout gui/$uid/com.kosmos.board`, the REAL board's label, and this
# scenario took the live Kosmos on the build Mac down at 00:39 on
# 2026-08-26 (the closing "port 16180 is as we found it" check caught it).
# A fake HOME scopes the FILES; it does not scope the launchd domain. The
# ownership proof under test is the file loop, which reads this directory
# either way.
RC=0; cat "$SETUP" | env -u KOSMOS_HOME -u AGENT_WORKFORCE_DATA -u AGENT_WORKFORCE_PROJECTS -u AGENT_WORKFORCE_WORKERS \
  HOME="$D931_HOME" AGENT_WORKFORCE_LAUNCH="$D931_HOME/Library/LaunchAgents" KOSMOS_HOME_APP_DIR="$SB/d931home-apps-b" KOSMOS_APP_DIR="$SB/apps931b" \
  sh -s -- --uninstall > "$SB/d931-control-uninstall.log" 2>&1 || RC=$?
chk "#931 control (default KOSMOS_HOME) uninstall exits 0" "rc_ok $RC"
chk "control: the job naming the real supervisor IS removed, as before #931" "[ ! -e \"$D931_HOME/Library/LaunchAgents/com.kosmos.agent.d931foreign.plist\" ]"
chk "control: the sandboxed install's job is the survivor this time" "[ -e \"$D931_HOME/Library/LaunchAgents/com.kosmos.agent.d931own.plist\" ]"
rm -f "$D931_HOME/Library/LaunchAgents/com.kosmos.agent.d931own.plist"


echo "== #928/#934: a sandboxed KOSMOS_HOME never touches the real kosmos link, profile, Applications or claude link =="
# 🔑 PETE'S CONVENTION AGAIN (KOSMOS_HOME + app dirs + port, nothing else),
# now with the four machine-global overrides UNSET, which every scenario
# above sets and so could never catch: KOSMOS_BIN_DIR (#928's live
# incident, the real ~/.local/bin/kosmos repointed into a walk sandbox and
# dangling after the tmp cleaner) and KOSMOS_PROFILE_FILE; KOSMOS_HOME_APP_DIR is
# and NOT AGENT_WORKFORCE_CLAUDE_BIN (see setup.sh: the carry lands at
# Anthropic's own path, so that one is the person's real tool, and the
# planted claude below must simply be FOUND and left alone). A fake HOME
# with planted sentinels stands in
# for the real machine; each must survive the install AND the uninstall
# byte for byte, and the sandbox must get its own copies under KOSMOS_HOME.
D928_HOME="$SB/d928-realhome"
D928_KHOME="$SB/d928-sandboxedhome"
mkdir -p "$D928_HOME/.local/bin" "$D928_HOME/Applications"
printf '#!/bin/sh\necho REAL KOSMOS COMMAND\n' > "$D928_HOME/.local/bin/kosmos"; chmod +x "$D928_HOME/.local/bin/kosmos"
printf '# the person'"'"'s own profile\n' > "$D928_HOME/.zprofile"
printf '#!/bin/sh\necho REAL CLAUDE\n' > "$D928_HOME/.local/bin/claude"; chmod +x "$D928_HOME/.local/bin/claude"
SENT928_KOSMOS="$(shasum -a 256 < "$D928_HOME/.local/bin/kosmos" | cut -c1-64)"
SENT928_PROFILE="$(shasum -a 256 < "$D928_HOME/.zprofile" | cut -c1-64)"
SENT928_CLAUDE="$(shasum -a 256 < "$D928_HOME/.local/bin/claude" | cut -c1-64)"
d928_untouched() {
  [ "$(shasum -a 256 < "$D928_HOME/.local/bin/kosmos" 2>/dev/null | cut -c1-64)" = "$SENT928_KOSMOS" ] \
  && [ ! -L "$D928_HOME/.local/bin/kosmos" ] \
  && [ "$(shasum -a 256 < "$D928_HOME/.zprofile" 2>/dev/null | cut -c1-64)" = "$SENT928_PROFILE" ] \
  && [ "$(shasum -a 256 < "$D928_HOME/.local/bin/claude" 2>/dev/null | cut -c1-64)" = "$SENT928_CLAUDE" ] \
  && [ ! -e "$D928_HOME/Applications/Kosmos.app" ]
}
RC=0; cat "$SETUP" | env -u KOSMOS_BIN_DIR -u KOSMOS_PROFILE_FILE -u AGENT_WORKFORCE_CLAUDE_BIN \
  -u AGENT_WORKFORCE_DATA -u AGENT_WORKFORCE_PROJECTS -u AGENT_WORKFORCE_WORKERS \
  HOME="$D928_HOME" KOSMOS_HOME="$D928_KHOME" AGENT_WORKFORCE_LAUNCH="$SB/launch928" KOSMOS_APP_DIR="$SB/apps928" \
  sh > "$SB/d928-install.log" 2>&1 || RC=$?
[ "$RC" = 0 ] || { echo "DEBUG #928 install log:"; tail -20 "$SB/d928-install.log" 2>&1 || true; }
chk "#928 sandboxed install with the four overrides unset exits 0" "rc_ok $RC"
chk "the real kosmos command, profile, claude and Applications are untouched by the install" "d928_untouched"
chk "the sandbox got its own kosmos link under KOSMOS_HOME/localbin" "[ -L \"$D928_KHOME/localbin/kosmos\" ]"
chk "the sandbox's PATH line went to KOSMOS_HOME/zprofile, not the real profile" "grep -qxF '# kosmos: PATH for the kosmos command (removed by --uninstall)' \"$D928_KHOME/zprofile\""
KOSMOS_HOME="$D928_KHOME" "$D928_KHOME/bin/kosmos" stop > /dev/null 2>&1 || true
chk "the port is genuinely free before #928's uninstall runs" "wait_port_free"
RC=0; cat "$SETUP" | env -u KOSMOS_BIN_DIR -u KOSMOS_PROFILE_FILE -u AGENT_WORKFORCE_CLAUDE_BIN \
  -u AGENT_WORKFORCE_DATA -u AGENT_WORKFORCE_PROJECTS -u AGENT_WORKFORCE_WORKERS \
  HOME="$D928_HOME" KOSMOS_HOME="$D928_KHOME" AGENT_WORKFORCE_LAUNCH="$SB/launch928" KOSMOS_APP_DIR="$SB/apps928" \
  sh -s -- --uninstall > "$SB/d928-uninstall.log" 2>&1 || RC=$?
chk "#928 sandboxed uninstall exits 0" "rc_ok $RC"
chk "the real kosmos command, profile, claude and Applications are untouched by the uninstall too" "d928_untouched"
chk "the sandboxed KOSMOS_HOME itself is gone" "[ ! -d \"$D928_KHOME\" ]"
# Control: an explicit KOSMOS_BIN_DIR still wins over the derived default.
D928_BIN="$SB/d928-explicit-bin"
RC=0; cat "$SETUP" | env -u KOSMOS_PROFILE_FILE -u AGENT_WORKFORCE_CLAUDE_BIN \
  -u AGENT_WORKFORCE_DATA -u AGENT_WORKFORCE_PROJECTS -u AGENT_WORKFORCE_WORKERS \
  HOME="$D928_HOME" KOSMOS_HOME="$D928_KHOME" KOSMOS_BIN_DIR="$D928_BIN" AGENT_WORKFORCE_LAUNCH="$SB/launch928b" KOSMOS_APP_DIR="$SB/apps928b" \
  sh > "$SB/d928-explicit-install.log" 2>&1 || RC=$?
chk "#928 control: explicit KOSMOS_BIN_DIR install exits 0" "rc_ok $RC"
chk "control: the caller's explicit KOSMOS_BIN_DIR is where the link went" "[ -L \"$D928_BIN/kosmos\" ]"
chk "control: and the derived localbin was not used" "[ ! -e \"$D928_KHOME/localbin/kosmos\" ]"
KOSMOS_HOME="$D928_KHOME" "$D928_KHOME/bin/kosmos" stop > /dev/null 2>&1 || true
chk "the port is genuinely free after #928's control" "wait_port_free"

echo "== #918: an uninstall sweeps OTHER installs' orphaned board labels too, never a live one =="
# 🔑 THE EXACT SHAPE. #883 gave every non-default KOSMOS_HOME its own
# permanent, hash-suffixed launchd label so two sandboxed installs stop
# colliding -- and, named as follow-up work in that same challenge-loop,
# traded the collision for a slower leak: nothing ever swept a suffixed
# label whose KOSMOS_HOME later vanished. A walk convention that deletes
# its scratch directory directly, rather than running --uninstall against
# that exact KOSMOS_HOME, leaves the label registered forever. This
# scenario reproduces it: two sandboxed installs SHARE one launch dir (the
# way two walk runs on one Mac would), one of the two KOSMOS_HOMEs is
# deleted directly (no --uninstall), and a plain --uninstall of the OTHER
# one must sweep the orphan too -- while a THIRD, still-alive install in
# the same launch dir must survive untouched.
D918_LAUNCH="$SB/launch918"
D918_HOME_A="$SB/d918-home-a"
D918_KHOME_A="$SB/d918-khome-a"
mkdir -p "$D918_HOME_A"
RC=0; cat "$SETUP" | env -u AGENT_WORKFORCE_DATA -u AGENT_WORKFORCE_PROJECTS -u AGENT_WORKFORCE_WORKERS \
  HOME="$D918_HOME_A" KOSMOS_HOME="$D918_KHOME_A" AGENT_WORKFORCE_LAUNCH="$D918_LAUNCH" \
  KOSMOS_HOME_APP_DIR="$SB/d918home-apps-a" KOSMOS_APP_DIR="$SB/apps918a" KOSMOS_BIN_DIR="$SB/bin918a" \
  sh > "$SB/d918-install-a.log" 2>&1 || RC=$?
chk "#918 scenario-A install exits 0" "rc_ok $RC"
KOSMOS_HOME="$D918_KHOME_A" "$D918_KHOME_A/bin/kosmos" stop > /dev/null 2>&1 || true
chk "the port is genuinely free before #918 scenario-B installs" "wait_port_free"

D918_HOME_B="$SB/d918-home-b"
D918_KHOME_B="$SB/d918-khome-b"
mkdir -p "$D918_HOME_B"
RC=0; cat "$SETUP" | env -u AGENT_WORKFORCE_DATA -u AGENT_WORKFORCE_PROJECTS -u AGENT_WORKFORCE_WORKERS \
  HOME="$D918_HOME_B" KOSMOS_HOME="$D918_KHOME_B" AGENT_WORKFORCE_LAUNCH="$D918_LAUNCH" \
  KOSMOS_HOME_APP_DIR="$SB/d918home-apps-b" KOSMOS_APP_DIR="$SB/apps918b" KOSMOS_BIN_DIR="$SB/bin918b" \
  sh > "$SB/d918-install-b.log" 2>&1 || RC=$?
chk "#918 scenario-B install exits 0" "rc_ok $RC"
KOSMOS_HOME="$D918_KHOME_B" "$D918_KHOME_B/bin/kosmos" stop > /dev/null 2>&1 || true
chk "the port is genuinely free before #918 scenario-C installs" "wait_port_free"

D918_HOME_C="$SB/d918-home-c"
D918_KHOME_C="$SB/d918-khome-c"
mkdir -p "$D918_HOME_C"
RC=0; cat "$SETUP" | env -u AGENT_WORKFORCE_DATA -u AGENT_WORKFORCE_PROJECTS -u AGENT_WORKFORCE_WORKERS \
  HOME="$D918_HOME_C" KOSMOS_HOME="$D918_KHOME_C" AGENT_WORKFORCE_LAUNCH="$D918_LAUNCH" \
  KOSMOS_HOME_APP_DIR="$SB/d918home-apps-c" KOSMOS_APP_DIR="$SB/apps918c" KOSMOS_BIN_DIR="$SB/bin918c" \
  sh > "$SB/d918-install-c.log" 2>&1 || RC=$?
chk "#918 scenario-C install exits 0" "rc_ok $RC"
KOSMOS_HOME="$D918_KHOME_C" "$D918_KHOME_C/bin/kosmos" stop > /dev/null 2>&1 || true
chk "the port is genuinely free before #918 scenario-D installs" "wait_port_free"

# 🔑 THE HIGHEST-STAKES PROPERTY, PROVEN THROUGH THE REAL SWEEP, NOT ASSERTED
# BY COMMENT. A default (unsuffixed) KOSMOS_HOME install in the SAME shared
# launch dir gives the sweep a REAL `com.kosmos.board.plist` -- the one
# label every normal end-user install has -- to prove it survives the exact
# loop that ships, not just the glob-exclusion reasoning in setup.sh's own
# comment. A bug here would stop a real person's board from launching at
# their next login.
D918_HOME_D="$SB/d918-home-d"
mkdir -p "$D918_HOME_D"
# ⚠️ AGENT_WORKFORCE_DATA/_PROJECTS/_WORKERS are DELIBERATELY LEFT SET here
# (unlike scenarios A-C), matching #883's own "default KOSMOS_HOME" scenario
# exactly: those three are only ever derived FROM KOSMOS_HOME for a
# non-default one, so a default-KOSMOS_HOME install (this scenario) is
# supposed to keep the shared sandboxed values this script already exported
# globally near the top. Unsetting them here (an earlier version of this
# scenario did) sent this install down a different, untested path and
# failed for a reason that had nothing to do with #918.
RC=0; cat "$SETUP" | env -u KOSMOS_HOME \
  HOME="$D918_HOME_D" AGENT_WORKFORCE_LAUNCH="$D918_LAUNCH" \
  KOSMOS_APP_DIR="$SB/apps918d" KOSMOS_BIN_DIR="$SB/bin918d" \
  sh > "$SB/d918-install-d.log" 2>&1 || RC=$?
chk "#918 scenario-D (default KOSMOS_HOME) install exits 0" "rc_ok $RC"
HOME="$D918_HOME_D" "$D918_HOME_D/.local/share/kosmos/bin/kosmos" stop > /dev/null 2>&1 || true
chk "the port is genuinely free before #918's uninstall runs" "wait_port_free"

chk "four distinct board labels (three suffixed, one bare default) are registered in the shared launch dir before anything is torn down" \
  "[ \"\$(ls \"$D918_LAUNCH\"/com.kosmos.board*.plist 2>/dev/null | wc -l | tr -d ' ')\" = 4 ]"

# 🔑 CHALLENGE-LOOP ITERATION 2: a plist shaped nothing like this file's own
# writer produces -- ProgramArguments[1] is exactly "/bin/kosmos", no home
# prefix at all -- used to slip past BOTH refusal signals at once: an empty
# derived `_orphan_home` reads `[ -d "" ]` as false ("gone"), and
# `dirname ""` is POSIX-defined as "." -- a directory that always exists --
# so the parent-readability guard passed unconditionally too. Placed here,
# in the SAME shared launch dir the real sweep below is about to run
# against, so this is a genuine end-to-end proof through the shipped loop,
# not an isolated unit check.
cat > "$D918_LAUNCH/com.kosmos.board.degenerate.plist" <<'D918_DEGENERATE'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.kosmos.board.degenerate</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/bin/kosmos</string>
    <string>start</string>
  </array>
</dict>
</plist>
D918_DEGENERATE

# 🔑 THE ACTUAL BLOCKER, REPRODUCED. Challenge-loop iteration 3: rounds 1-2
# hardened what happens when PlistBuddy SUCCEEDS but returns something
# unexpected; nobody had tested what happens when it FAILS TO READ at all.
# Verified directly: PlistBuddy exits non-zero (not empty output) for a
# plist with no ProgramArguments key, and under this file's `set -e`, an
# unguarded command substitution assignment aborts the WHOLE SCRIPT right
# there -- silently, mid-uninstall, before the agents' jobs, `bin/kosmos`
# link, PATH line, and KOSMOS_HOME itself are ever removed. This plist is
# syntactically valid XML with a real Label, just missing the one key this
# sweep reads -- exactly the "a future format, a hand-edit" shape the
# surrounding comment already anticipated, and exactly what PlistBuddy
# itself refuses to read.
cat > "$D918_LAUNCH/com.kosmos.board.noargs.plist" <<'D918_NOARGS'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.kosmos.board.noargs</string>
</dict>
</plist>
D918_NOARGS

# Scenario A's scratch directory is deleted DIRECTLY -- exactly the walk
# convention #918 is about, never running --uninstall against it.
rm -rf "$D918_KHOME_A"

# Uninstalling scenario B (a completely different KOSMOS_HOME) must sweep
# scenario A's now-orphaned label as a side effect, while scenario C's --
# still alive, never touched by this uninstall at all -- survives untouched.
RC=0; cat "$SETUP" | env -u AGENT_WORKFORCE_DATA -u AGENT_WORKFORCE_PROJECTS -u AGENT_WORKFORCE_WORKERS \
  HOME="$D918_HOME_B" KOSMOS_HOME="$D918_KHOME_B" AGENT_WORKFORCE_LAUNCH="$D918_LAUNCH" \
  KOSMOS_HOME_APP_DIR="$SB/d918home-apps-b" KOSMOS_APP_DIR="$SB/apps918b" KOSMOS_BIN_DIR="$SB/bin918b" \
  sh -s -- --uninstall > "$SB/d918-uninstall-b.log" 2>&1 || RC=$?
chk "#918 scenario-B uninstall exits 0" "rc_ok $RC"
chk "scenario B's own label is gone (its normal uninstall)" \
  "[ ! -f \"$D918_LAUNCH/com.kosmos.board.\$(printf '%s' \"$D918_KHOME_B\" | shasum -a 256 | cut -c1-8).plist\" ]"
chk "scenario A's ORPHANED label was swept even though this uninstall never named it" \
  "[ ! -f \"$D918_LAUNCH/com.kosmos.board.\$(printf '%s' \"$D918_KHOME_A\" | shasum -a 256 | cut -c1-8).plist\" ]"
chk "scenario C's STILL-ALIVE label survives, untouched by a sweep it has no reason to trigger" \
  "[ -f \"$D918_LAUNCH/com.kosmos.board.\$(printf '%s' \"$D918_KHOME_C\" | shasum -a 256 | cut -c1-8).plist\" ]"
chk "scenario C's own KOSMOS_HOME directory is untouched (only its label was checked, never removed)" "[ -d \"$D918_KHOME_C\" ]"
# 🔑 THE ACTUAL PROPERTY THE REVIEW ASKED FOR: the bare, unsuffixed
# com.kosmos.board.plist -- the real board a normal install has -- survives
# this same sweep untouched. Proven through the shipped loop, not just the
# glob-exclusion comment in setup.sh.
chk "the bare default label (scenario D, a real install's own board) survives the sweep untouched" \
  "[ -f \"$D918_LAUNCH/com.kosmos.board.plist\" ]"
chk "scenario D's own KOSMOS_HOME directory is untouched too" "[ -d \"$D918_HOME_D/.local/share/kosmos\" ]"
chk "a degenerate plist (ProgramArguments[1] with no home prefix) is left alone, not guessed at" \
  "[ -f \"$D918_LAUNCH/com.kosmos.board.degenerate.plist\" ]"
# The BLOCKER's own proof: the uninstall above already had to run past this
# plist to reach this line at all -- "#918 scenario-B uninstall exits 0"
# would itself have failed had the unguarded PlistBuddy read still crashed
# the script mid-function. This assertion confirms the SPECIFIC outcome the
# fix promises (left alone, not guessed at), not just that the process
# survived.
chk "a plist PlistBuddy cannot even read (no ProgramArguments key) does not crash the uninstall, and is left alone" \
  "[ -f \"$D918_LAUNCH/com.kosmos.board.noargs.plist\" ]"
HOME="$D918_HOME_D" "$D918_HOME_D/.local/share/kosmos/bin/kosmos" stop > /dev/null 2>&1 || true
KOSMOS_HOME="$D918_KHOME_C" "$D918_KHOME_C/bin/kosmos" stop > /dev/null 2>&1 || true
chk "the port is genuinely free after #918's scenario" "wait_port_free"


closing_checks
summary_and_exit
