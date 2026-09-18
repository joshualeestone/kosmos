#!/bin/bash
# kosmos#3233 (the open half of #920): install/setup.sh emits determinate
# download progress for the install page by writing install-progress.js
# (window.__kosmosInstallProgress = {bytes,total,phase,ts}). The emit is
# BEST-EFFORT and must be fully isolated from the download: it can never abort
# the install, and it can never inject anything into the page.
#
# This test extracts the REAL _kp_emit function from the shipped setup.sh (not a
# rewrite) and drives it under `set -euo pipefail` -- the same mode setup.sh runs
# under, and the mode that is ACTIVE again inside the background watcher subshell
# even though the `install_kosmos ... || die` call site suspends it in the main
# body. So this is exactly the context where a non-zero intermediate line would
# abort the watcher. Every arm asserts the function returns 0; the JS is then
# eval'd in node with a stubbed `window` to prove it is valid and injection-safe.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
SETUP="$REPO/install/setup.sh"
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }
has()  { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

[ -f "$SETUP" ] || { echo "FAIL  setup.sh not found at $SETUP"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- extract the real _kp_emit, verbatim, from the shipped setup.sh ----------
FN="$TMP/kp_emit.sh"
awk '/^    _kp_emit\(\) \{/{p=1} p{print} p&&/^    \}$/{exit}' "$SETUP" > "$FN"
if ! grep -q '_kp_emit() {' "$FN" || ! grep -q '__kosmosInstallProgress' "$FN"; then
  echo "FAIL  could not extract _kp_emit from setup.sh (its shape changed -- update this test's awk range)"
  exit 1
fi
pass "extracted the real _kp_emit() from the shipped setup.sh"

# Run the extracted function under set -euo pipefail, with a controlled env, and
# report ONLY its return status (so an abort is visible as non-zero). The output
# file lands in $1 so the caller can inspect it after the subshell exits.
run_emit() { # $1=out_dir  $2=total  $3=stage_bytes(-1 to omit the tar)  $4=phase
  local out_dir="$1" total="$2" stage_bytes="$3" phase="$4"
  ( set -euo pipefail
    _kp_dir="$out_dir"
    _kp_js="$_kp_dir/install-progress.js"
    _kp_total="$total"
    # A fresh stage dir per call: $$ is the parent PID and does not change across
    # these subshells, so a shared name would leak ARM 1's tar into a later arm.
    stage="$(mktemp -d "$TMP/stage.XXXXXX")"
    if [ "$stage_bytes" -ge 0 ]; then
      # a file of the requested size (portable: dd from /dev/zero)
      dd if=/dev/zero of="$stage/kosmos.tar.gz" bs=1 count="$stage_bytes" 2>/dev/null
    fi
    # shellcheck disable=SC1090
    . "$FN"
    _kp_emit "$phase"
  )
}

# node validator: eval the emitted JS with a stubbed window, print bytes/total/phase
JSCHECK="$TMP/check.js"
cat > "$JSCHECK" <<'NODE'
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const window = {};
// eslint-disable-next-line no-eval
eval(src); // if src carried an injection this throws or defines extra globals
const p = window.__kosmosInstallProgress;
if (!p || typeof p !== 'object') { console.error('NOT-AN-OBJECT'); process.exit(2); }
if (typeof p.bytes !== 'number' || !Number.isFinite(p.bytes) || p.bytes < 0) { console.error('BAD-BYTES:' + p.bytes); process.exit(3); }
if (!(p.total === null || (typeof p.total === 'number' && Number.isFinite(p.total)))) { console.error('BAD-TOTAL:' + p.total); process.exit(4); }
if (typeof p.phase !== 'string') { console.error('BAD-PHASE'); process.exit(5); }
process.stdout.write(p.bytes + '|' + p.total + '|' + p.phase);
NODE

# --- ARM 1: known total, real bytes -> valid determinate reading -------------
d="$TMP/a1"; mkdir -p "$d"
if run_emit "$d" "12345" 4 downloading; then
  out=$(node "$JSCHECK" "$d/install-progress.js" 2>&1) && has "$out" "|12345|downloading" \
    && pass "known total: returns 0 and emits valid JS (bytes|total|phase = $out)" \
    || fail "known total: emitted JS invalid or wrong ($out)"
else
  fail "known total: _kp_emit returned non-zero under set -euo pipefail"
fi

# --- ARM 2: EMPTY total (no content-length) -> total:null, still returns 0 ----
# This is the arm the pre-fix `[ -n ] && ...` line aborted on under set -e.
d="$TMP/a2"; mkdir -p "$d"
if run_emit "$d" "" 4 downloading; then
  out=$(node "$JSCHECK" "$d/install-progress.js" 2>&1) && has "$out" "|null|downloading" \
    && pass "empty total: returns 0 and emits total:null (valid JS: $out)" \
    || fail "empty total: emitted JS invalid or total not null ($out)"
else
  fail "empty total: _kp_emit returned non-zero under set -euo pipefail (the set -e isolation regressed)"
fi

# --- ARM 3: no staged tar yet -> bytes:0, still returns 0 --------------------
d="$TMP/a3"; mkdir -p "$d"
if run_emit "$d" "999" -1 downloading; then
  out=$(node "$JSCHECK" "$d/install-progress.js" 2>&1) && has "$out" "0|999|downloading" \
    && pass "no staged tar: returns 0 and emits bytes:0 ($out)" \
    || fail "no staged tar: emitted JS invalid or bytes not 0 ($out)"
else
  fail "no staged tar: _kp_emit returned non-zero under set -euo pipefail"
fi

# --- ARM 4: unwritable cache dir -> cannot write, MUST still return 0 --------
# Point _kp_dir at a path whose parent is a FILE, so mkdir -p fails.
blocker="$TMP/a4-file"; : > "$blocker"
if run_emit "$blocker/cache" "999" 4 downloading; then
  pass "unwritable cache dir: _kp_emit still returns 0 (best-effort, cannot abort the install)"
else
  fail "unwritable cache dir: _kp_emit returned non-zero -- a cache-write failure could abort the install"
fi

# --- ARM 5: the two source-level isolation guards reviewer flagged, pinned ---
# Regression pins for the specific fixes; the behavioral arms above are the real
# proof, these keep the exact guarded lines from being silently reverted.
body="$(cat "$SETUP")"
has "$body" '|| _kp_total=""' \
  && pass "the content-length HEAD assignment is guarded (|| _kp_total=\"\")" \
  || fail "the content-length HEAD assignment lost its || _kp_total=\"\" guard (aborts under pipefail on a failed HEAD)"
has "$body" 'wait "$_kp_watcher" 2>/dev/null || true' \
  && pass "the watcher teardown wait is guarded (|| true)" \
  || fail "the watcher teardown 'wait' lost its || true guard (143 aborts under set -e)"

# --- summary -----------------------------------------------------------------
if [ "$fails" -eq 0 ]; then
  echo "install-progress-emit-3233: all checks passed"
  exit 0
fi
echo "install-progress-emit-3233: $fails failure(s)"
exit 1
