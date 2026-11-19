#!/usr/bin/env bash
# kosmos#8599: `kosmos <verb> | head -1` must not end in an unhandled EPIPE stack trace.
#
# Runs the REAL install/kosmos and the REAL engine/clipipe.js against a fake app whose triage engine prints about
# 1 MB, far more than a pipe holds, so the reader (head -1) closes while node is still writing. Five arms:
#   1. guarded: no EPIPE, ENOTCONN or ECONNRESET and no "Unhandled 'error'" on stderr, and the reader got its line
#   2. CONTROL, guard off (KOSMOS_CLIPIPE_SET=1 before the wrapper, so it adds nothing): the trace IS there, which
#      proves this test can see the defect at all
#   3. CONTROL, full output: nothing closes early, every byte arrives and the verb exits 0
#   4. the person's own NODE_OPTIONS reaches what the CLI's node starts, and the preload does not
#   5. a home folder with a space in it is guarded too
set -u

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$SELF_DIR/.." && pwd)"
NODE_BIN="$(command -v node)"
if [ -z "$NODE_BIN" ]; then echo "SKIP: no node on PATH"; exit 0; fi

fail() { echo "FAIL: $1"; exit 1; }

HOME_DIR="$(mktemp -d "${TMPDIR:-/tmp}/test-cli-epipe-8599.XXXXXXXXXX")"
trap 'rm -rf "$HOME_DIR"' EXIT
mkdir -p "$HOME_DIR/runtime/bin" "$HOME_DIR/app/engine" "$HOME_DIR/reports"
ln -s "$NODE_BIN" "$HOME_DIR/runtime/bin/node"
cp "$REPO/engine/clipipe.js" "$HOME_DIR/app/engine/clipipe.js"
# A fake triage engine: no reports needed, and a digest of 20000 lines (about 1 MB).
cat > "$HOME_DIR/app/engine/feedback.js" <<'EOF'
module.exports = { reportsForTriage: () => ({ ok: true, reports: [], notes: ['fake triage note'] }) };
EOF
cat > "$HOME_DIR/app/engine/feedback-triage.js" <<'EOF'
module.exports = { digestFor: () => Array.from({ length: 20000 }, (_, i) => 'digest line ' + i + ' ' + 'x'.repeat(40)).join('\n') };
EOF
export KOSMOS_HOME="$HOME_DIR"
unset KOSMOS_CLIPIPE_SET KOSMOS_USER_NODE_OPTIONS KOSMOS_USER_NODE_OPTIONS_SET

ERR="$HOME_DIR/err.txt"
LINE="$HOME_DIR/line.txt"

# 1. Guarded.
bash "$REPO/install/kosmos" feedback triage --dir "$HOME_DIR/reports" 2>"$ERR" | head -1 > "$LINE"
rc1=${PIPESTATUS[0]}
[ "$rc1" = 141 ] || fail "the command did not end with 141 (a closed reader) through the wrapper: rc $rc1 / $(head -3 "$ERR")"
grep -q '^digest line 0 ' "$LINE" || fail "the reader did not get the first line: $(cat "$LINE")"
if grep -qE "EPIPE|ENOTCONN|ECONNRESET|Unhandled 'error'" "$ERR"; then fail "a closed reader still printed a trace: $(head -3 "$ERR")"; fi
grep -q 'fake triage note' "$ERR" || fail "the verb's own stderr note is missing (did the verb run?): $(cat "$ERR")"

# 2. CONTROL: the same run with the guard off prints the trace this card is about.
KOSMOS_CLIPIPE_SET=1 bash "$REPO/install/kosmos" feedback triage --dir "$HOME_DIR/reports" 2>"$ERR" | head -1 > /dev/null
grep -q 'EPIPE' "$ERR" || fail "CONTROL: with the guard off the run showed no EPIPE, so arm 1 proves nothing: $(head -3 "$ERR")"

# 3. CONTROL: with nothing closing early, all 20000 lines arrive and the verb exits 0.
n="$(bash "$REPO/install/kosmos" feedback triage --dir "$HOME_DIR/reports" 2>/dev/null | wc -l | tr -d ' ')"
[ "$n" = "20000" ] || fail "CONTROL: the full output was not all there (got $n lines, want 20000)"
bash "$REPO/install/kosmos" feedback triage --dir "$HOME_DIR/reports" >/dev/null 2>&1 || fail "CONTROL: the full run did not exit 0"

# 4. What the CLI's node starts sees the person's own NODE_OPTIONS, and not the preload.
cat > "$HOME_DIR/app/engine/feedback-triage.js" <<'EOF'
module.exports = { digestFor: () => require('child_process').execFileSync(process.execPath,
  ['-e', 'process.stdout.write(JSON.stringify([process.env.NODE_OPTIONS ?? null, process.env.KOSMOS_CLIPIPE_SET ?? null]))']).toString() };
EOF
seen="$(NODE_OPTIONS='--max-old-space-size=300' bash "$REPO/install/kosmos" feedback triage --dir "$HOME_DIR/reports" 2>/dev/null)"
[ "$seen" = '["--max-old-space-size=300",null]' ] || fail "a child of the CLI's node saw $seen, want the person's NODE_OPTIONS only"
seen="$(env -u NODE_OPTIONS bash "$REPO/install/kosmos" feedback triage --dir "$HOME_DIR/reports" 2>/dev/null)"
[ "$seen" = '[null,null]' ] || fail "with no NODE_OPTIONS of the person's, a child saw $seen, want none"
# 4b (kosmos#8603). Guard off (KOSMOS_CLIPIPE_SET=1 before the wrapper, as arm 2): the wrapper adds no preload, so a
#    child sees the person's NODE_OPTIONS exactly as they set it.
seen="$(KOSMOS_CLIPIPE_SET=1 NODE_OPTIONS='--max-old-space-size=300' bash "$REPO/install/kosmos" feedback triage --dir "$HOME_DIR/reports" 2>/dev/null)"
[ "$seen" = '["--max-old-space-size=300","1"]' ] || fail "guard off: a child of the CLI's node saw $seen, want the person's NODE_OPTIONS untouched (and the caller's KOSMOS_CLIPIPE_SET=1)"

# 5. A home folder with a space in it is guarded too (the preload path is quoted inside NODE_OPTIONS).
cat > "$HOME_DIR/app/engine/feedback-triage.js" <<'EOF'
module.exports = { digestFor: () => Array.from({ length: 20000 }, (_, i) => 'digest line ' + i + ' ' + 'x'.repeat(40)).join('\n') };
EOF
SPACED="$HOME_DIR/with space"
mkdir -p "$SPACED/runtime/bin"
cp -R "$HOME_DIR/app" "$SPACED/app"   # a real folder (not a link), so the path node is given has the space in it
ln -s "$NODE_BIN" "$SPACED/runtime/bin/node"
KOSMOS_HOME="$SPACED" bash "$REPO/install/kosmos" feedback triage --dir "$HOME_DIR/reports" 2>"$ERR" | head -1 > "$LINE"
grep -q '^digest line 0 ' "$LINE" || fail "with a space in the home folder the reader got: $(cat "$LINE") / $(head -3 "$ERR")"
if grep -qE "EPIPE|ENOTCONN|ECONNRESET|Unhandled 'error'|Cannot find module" "$ERR"; then fail "a home folder with a space: $(head -3 "$ERR")"; fi

echo "PASS: test-cli-epipe-8599 (a closed reader is quiet; the guard-off control shows the trace; full output intact; children see only the person's NODE_OPTIONS)"
