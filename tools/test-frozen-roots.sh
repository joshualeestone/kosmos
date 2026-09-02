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

# ---- arm 4b: INDIRECTION THROUGH AN ARROW resolver (#1752) -----------------
# The same as arm 4, but the resolver is `const home = () =>` rather than
# `function home(`. A `function NAME(` scan is blind to it, so a const calling
# it froze a root undetected. This is #1752's third blind spot; the arrow form
# of tokendoor's factory-and-Map shape was invisible to both prior instruments.
fixture indirect_arrow "const os = require('os');
const home = () => process.env.AW_HOME || os.homedir();
const WORKERS = path.join(home(), 'work', 'workers');"
if [ "$(run indirect_arrow)" = "1" ]; then ok "a const frozen via an ARROW resolver is flagged (#1752)"
else bad "missed an arrow resolver -- a const = () => os.homedir() the eager const calls is invisible"; fi

# ---- arm 4c: a BLOCK-BODY arrow resolver (#1752 iter 2) --------------------
# The blind spot the single-expression arm above dodges: when the arrow has a
# BLOCK body, the source call is after the first `;` (the first statement), and
# a body captured to the first `;` truncates it away. The full block must be
# read, exactly as a `function NAME(` body is.
# MULTI-LINE on purpose: the source call is on a LATER line than the first `;`,
# so a body captured to the first `;` truncates before it. A one-line block
# would end in `;` and be captured whole, dodging the very hole this pins.
fixture arrow_block "const os = require('os');
const home = () => {
  const base = process.env.AW_HOME;
  return base || os.homedir();
};
const CONFIG = path.join(home(), 'config.json');"
if [ "$(run arrow_block)" = "1" ]; then ok "a const frozen via a BLOCK-BODY arrow resolver is flagged (#1752)"
else bad "missed a block-body arrow -- the source call after the first ; was truncated"; fi

# ---- arm 4d: a REVERSE-DECLARED chain 3 deep (#1752 iter 2) ----------------
# A fixed round count silently misses a chain declared in reverse: each round
# propagates one resolver level, so a 3-deep reverse chain needs 3. A fixpoint
# closure catches it; a 2-round cap does not.
fixture reverse_chain "const os = require('os');
const c = () => path.dirname(b());
const b = () => path.dirname(a());
const a = () => os.homedir();
const FROZEN = path.join(c(), 'x');"
if [ "$(run reverse_chain)" = "1" ]; then ok "a REVERSE-declared 3-deep resolver chain is flagged (#1752)"
else bad "missed a reverse 3-deep chain -- the closure gave up before reaching the source"; fi

# ---- arm 4e: an INDENTED closing brace must not OVER-CAPTURE (#1752 iter 3) -
# PRECISION, the PR-blocking direction. A lazy helper whose `}` is indented must
# end at its own brace, not sweep in the next module-level source const. If it
# over-captures, the helper is wrongly a resolver and its eager CALLER is falsely
# flagged. Here `make` returns no root; only `SEP` (a real frozen const) should
# be flagged, never `CALLER`.
fixture indented_fp "const os = require('os');
const make = () => {
    return 'plain';
  };
const SEP = os.homedir();
const CALLER = make();"
run indented_fp >/dev/null
if grep -q 'CALLER' "$T/out"; then bad "an indented-brace helper over-captured -- CALLER falsely flagged (gate reds a legit file)"
else ok "an indented closing brace does not over-capture into a false positive (#1752)"; fi

# ---- arm 4f: a function-EXPRESSION with a DEFAULT PARAM is caught (#1752) --
# `const f = function (x = 5) { ... }` -- the `=` of the default param must not
# be mistaken for the end of the function head and truncate the block body.
fixture fnexpr_default "const os = require('os');
const home = function (x = 5) {
  const b = x;
  return b || os.homedir();
};
const CONFIG = path.join(home(), 'config.json');"
if [ "$(run fnexpr_default)" = "1" ]; then ok "a function-expression resolver with a default param is flagged (#1752)"
else bad "missed a function-expression with a default param -- the head was mis-parsed and the body truncated"; fi

# ---- arm 4g: a DESTRUCTURING param on a WRAPPED expression arrow (#1752) ---
# The param's `{ }` balances on the head line; without a paren-depth guard the
# body-brace balance fires on the param and the wrapped body (with the root) is
# truncated -> a FALSE NEGATIVE on an ordinary options-object helper.
fixture destructure_param "const os = require('os');
const resolveDir = ({ profile }) =>
  path.join(os.homedir(), '.app', profile);
const PROFILE_DIR = resolveDir({ profile: 'default' });"
if [ "$(run destructure_param)" = "1" ]; then ok "a destructuring-param wrapped-arrow resolver is flagged (#1752)"
else bad "missed a destructuring-param arrow -- the param brace ended the capture before the body"; fi

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
