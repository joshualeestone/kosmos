#!/bin/bash
# The frozen-root checker, arm by arm, on synthetic fixtures.
#
# 🛑 THE ARMS THAT MATTER ARE 3 AND 4. This tool exists because two hand-written
# checks each had a blind spot the other did not, and BOTH REPORTED A CLEAN ZERO:
# one keyed on a string the fix relocated, the other assumed one line. So a test
# that only proves "it finds the obvious case" would recreate exactly the
# instrument this replaces.
set -u
FAILS=0
ok()  { echo "PASS  $1"; }
bad() { echo "FAIL  $1"; FAILS=$((FAILS+1)); }

TOOL="$(cd "$(dirname "$0")/.." && pwd)/tools/check-frozen-roots.js"
[ -r "$TOOL" ] || { echo "FAIL  $TOOL not found"; exit 1; }
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT

fixture() { printf '%s\n' "$2" > "$T/$1.js"; }
run() { node "$TOOL" "$T/$1.js" >"$T/out" 2>&1; echo $?; }

# ---- arm 1: a lazy arrow const must NOT be flagged (PRECISION) -------------
fixture lazy "const os = require('os');
const TRASH = () => path.join(os.homedir(), '.Trash');"
if [ "$(run lazy)" = "0" ]; then ok "a lazy arrow const is not flagged"
else bad "flagged a lazy const: the tool would fail every correct file"; fi

# ---- arm 2: the obvious frozen case IS flagged (LIVENESS) ------------------
fixture frozen "const os = require('os');
const HOME = os.homedir();"
if [ "$(run frozen)" = "1" ]; then ok "a one-line frozen const is flagged"
else bad "missed the obvious frozen const"; fi

# ---- arm 3: MULTI-LINE, the blind spot of a line-based grep ---------------
fixture multiline "const os = require('os');
const ROOT = process.env.SOMETHING
  ? path.join(process.env.SOMETHING, 'x')
  : path.join(os.homedir(), 'Library', 'Application Support');"
if [ "$(run multiline)" = "1" ]; then ok "a MULTI-LINE frozen const is flagged"
else bad "missed a multi-line declaration -- this is store.js and SUPPORT_DIR"; fi

# ---- arm 4: INDIRECTION, the blind spot created by the fix itself ---------
# A const that reaches os.homedir() only through a helper. A check keyed on the
# literal `os.homedir()` inside the const goes blind here, which is exactly what
# happened when the sweep moved the call behind homeDir().
fixture indirect "const os = require('os');
function homeDir() { return process.env.AW_HOME || os.homedir(); }
const WORKERS = path.join(homeDir(), 'work', 'workers');"
if [ "$(run indirect)" = "1" ]; then ok "a const frozen VIA A HELPER is flagged"
else bad "missed indirection -- the fix relocates the string and the check goes blind"; fi

# ---- arm 5: a const with no root at all must not be flagged ---------------
fixture inert "const NAME = 'kosmos';
const N = 3;"
if [ "$(run inert)" = "0" ]; then ok "an unrelated const is not flagged"
else bad "flagged a const that resolves no root"; fi

# ---- arm 6: it must TERMINATE ---------------------------------------------
# The first version of this checker hung for over two minutes on a 2600-line
# file: `(?:[^;]|\n)*?` where `[^;]` already matches a newline backtracks
# exponentially. A checker that never returns is worse than the defect.
LARGE="$T/large.js"; : > "$LARGE"
for i in $(seq 1 400); do printf 'const V%s = someCall(a, b, c);\n' "$i" >> "$LARGE"; done
printf 'const HOME = os.homedir();\n' >> "$LARGE"
START=$(date +%s)
node "$TOOL" "$LARGE" >/dev/null 2>&1
ELAPSED=$(( $(date +%s) - START ))
if [ "$ELAPSED" -lt 10 ]; then ok "terminates on a large file (${ELAPSED}s)"
else bad "took ${ELAPSED}s on 400 lines -- pathological backtracking is back"; fi

echo
if [ "$FAILS" -eq 0 ]; then echo "ALL PASS (6 arms)"; else echo "$FAILS FAILED"; fi
exit "$FAILS"
