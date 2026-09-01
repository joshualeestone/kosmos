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
PASS=0
ok()  { PASS=$((PASS+1)); echo "PASS  $1"; }
# ⚠️ TWO arguments. Five call sites pass a diagnostic as $2 and this printed only
# $1, so the detail (`got [x] want [y]`, `n findings, expected 1`) was discarded
# exactly when somebody needed it to act.
bad() { echo "FAIL  $1"; [ -n "${2:-}" ] && echo "      $2"; FAILS=$((FAILS+1)); }

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

# ---- arm 7: the source AFTER a comma INSIDE the arrow's own call ----------
# 🛑 ARM 1 DOES NOT COVER THIS AND THAT IS WHY THE DEFECT SURVIVED. Arm 1 uses
# `path.join(os.homedir(), '.Trash')`, where the source sits BEFORE the comma, so
# the arrow-to-source slice holds no comma at all. Put the source AFTER the comma
# and the old rule read it as a member separator and reported correct code.
fixture argcomma "const store = require('./store');
const BASE = '/tmp/x';
const KINDS = [{ dir: () => path.join(BASE, store.ROOT) }];"
if [ "$(run argcomma)" = "0" ]; then ok "a source after a comma INSIDE the arrow's own call is not flagged"
else bad "flagged correct lazy code: an argument separator is not a member separator"; fi

# ---- arm 8: and the fix must not launder a real freeze (OVER-CORRECTION) ---
# The counterweight to the arrow-own-call arm. Depth-zero commas DO separate members, so a
# deferred reference must not exempt a frozen one sitting beside it. Without
# this arm, "ignore commas" would pass arm 7 and reopen the hole the branch closed.
fixture launder "const store = require('./store');
const M = { live: () => store.ROOT, file: path.join(process.env.AGENT_WORKFORCE_DATA,'x') };"
if [ "$(run launder)" = "1" ]; then ok "a deferred reference does NOT launder a frozen one beside it"
else bad "LAUNDERED: a depth-zero comma must still separate members"; fi

# ---- arm 9: the DERIVED getters, not just ROOT ----------------------------
# store.js defines ROOT, AVATARS and PROFILES in one defineProperty loop, and
# this tool's own GETTERS list names all three. SOURCES listed only ROOT, so the
# tool knew AVATARS was a getter when checking destructuring and did not know it
# when checking freezes. store.PROFILES is live in engine/register.js.
fixture avatars "const store = require('./store');
const PICS = path.join(store.AVATARS, 'pics');"
if [ "$(run avatars)" = "1" ]; then ok "a frozen store.AVATARS is flagged"
else bad "missed a frozen derived getter: SOURCES is narrower than GETTERS"; fi

fixture profiles "const store = require('./store');
const P = path.join(store.PROFILES, 'x');"
if [ "$(run profiles)" = "1" ]; then ok "a frozen store.PROFILES is flagged"
else bad "missed a frozen derived getter: SOURCES is narrower than GETTERS"; fi

# ---- arm 10: and the derived getters do not FALSE-fire when deferred -------
# The counterweight to the derived-getter arm: widening SOURCES must not report correct code.
fixture avatarslazy "const store = require('./store');
const OK = () => path.join(store.AVATARS, 'pics');"
if [ "$(run avatarslazy)" = "0" ]; then ok "a DEFERRED store.AVATARS is not flagged"
else bad "widening SOURCES made the tool fire on correct lazy code"; fi

# ---- arm 11: a `//` INSIDE A STRING must not end the declaration -----------
# The terminator strips a trailing line comment. Stripping it without knowing
# about strings cut `const U = 'https://x/a';` at the URL's `//`, so the line no
# longer ended in `;`, the capture ran on, and the NEXT line's freeze was
# attributed to U. Nine such lines exist in engine/ today.
fixture urlrunon "const store = require('./store');
const U = 'https://example.com/a';
const FROZEN = path.join(store.ROOT, 'x');"
if [ "$(run urlrunon)" = "1" ]; then
  n=$(node "$TOOL" "$T/urlrunon.js" 2>&1 | grep -c 'resolves a root')
  if [ "$n" = "1" ]; then ok "a // inside a string does not run the capture on (exactly 1 finding)"
  else bad "a // inside a string ran the capture on" "$n findings, expected 1"; fi
else bad "the real freeze after a URL line was not reported" "$(run urlrunon)"; fi

# ---- arm 12: and a REAL trailing comment must still terminate --------------
# The counterweight to the string-// arm: this is the bug the strip was added for.
fixture trailcomment "const store = require('./store');
let fetcher = null; // test seam: (req, token) => Promise
const OK = () => path.join(store.ROOT, 'x');"
if [ "$(run trailcomment)" = "0" ]; then ok "a real trailing // comment still terminates the declaration"
else bad "the trailing-comment terminator regressed"; fi

# ---- arm 13: a BLOCK-BODIED arrow resolver is still a resolver -------------
# Truncating its body at the first interior `;` meant it never reached the source,
# so it was not recognised and every downstream freeze went silent.
fixture blockbody "const store = require('./store');
const dirp = () => {
  const seg = 'liveness';
  return path.join(store.ROOT, seg);
};
const FILE = path.join(dirp(), 'x.json');"
if [ "$(run blockbody)" = "1" ]; then ok "a freeze via a BLOCK-BODIED resolver is flagged"
else bad "block-bodied resolver not recognised, downstream freeze silent"; fi

# ---- arm 14: and it does not fire when that chain is deferred --------------
fixture blocklazy "const store = require('./store');
const dirp = () => {
  const seg = 'liveness';
  return path.join(store.ROOT, seg);
};
const FILE = () => path.join(dirp(), 'x.json');"
if [ "$(run blocklazy)" = "0" ]; then ok "a DEFERRED block-bodied chain is not flagged"
else bad "fired on a correctly deferred block-bodied chain"; fi

# ---- arm 15: a MULTI-LINE destructure is the same freeze -------------------
# The alias scan was whole-source; this arm was per-line, so the two halves of one
# idea disagreed and a wrapped destructure was silent.
fixture multidestr "const {
  ROOT,
} = require('./store');
const dirFor = () => path.join(ROOT, 'x');"
if [ "$(run multidestr)" = "1" ]; then ok "a MULTI-LINE destructure of a getter is flagged"
else bad "multi-line destructure silent while the single-line form is flagged"; fi

# ---- arm 16: capturing ANOTHER module's lazy getter refreezes --------------
# #1443 creates ~23 new getters; capturing one at module level is the same defect
# one relocation further on.
fixture capgetter "const limits = require('./limits');
const F = limits.FILE;"
if [ "$(run capgetter)" = "1" ]; then ok "capturing another module's lazy getter is flagged"
else bad "blind to a captured cross-module getter"; fi

# ---- arm 17: and NOT on a getter that is not path-shaped ------------------
# The counterweight to the captured-getter arm. DRY_RUN and HOME_FOR_TEST are real getters;
# firing on them would be a guard that reports correct code.
fixture capnonpath "const m = require('./remove');
const D = m.DRY_RUN;"
if [ "$(run capnonpath)" = "0" ]; then ok "a non-path-shaped getter capture is NOT flagged"
else bad "fired on a getter that resolves no root"; fi

# ---- arm 18: an arrow passed to a CALL is not a deferral -------------------
# .map/.forEach invoke immediately, so the join happens at require time. Measured:
# this exited 0 while the identical logic written with `function (n)` exited 1.
fixture arrowcall "const store = require('./store');
const NAMES = ['a','b'];
const PATHS = NAMES.map((n) => path.join(store.ROOT, n));"
if [ "$(run arrowcall)" = "1" ]; then ok "an arrow passed to .map does NOT count as deferred"
else bad "a require-time freeze inside .map went silent"; fi

# ---- arm 19: an unrelated arrow must not launder a freeze ------------------
# The counterweight to the arrow-into-call arm, and the some/every defect further out:
# inserting `.map((x) => x)` before a real freeze silenced it.
fixture arrowlaunder "const store = require('./store');
const FILE = ['a'].map((x) => x).concat(path.join(store.ROOT,'y'));"
if [ "$(run arrowlaunder)" = "1" ]; then ok "an unrelated arrow does not launder a freeze beside it"
else bad "an arrow whose scope had already closed exempted a later freeze"; fi

# ---- arm 20: a resolver is a resolver whatever keyword declared it ---------
# functionNamesReaching matched `const` only while declarations() took const/let/var
# and the exports forms, so the two halves of one idea disagreed, both toward silence.
fixture letresolver "const store = require('./store');
let dirp = () => path.join(store.ROOT,'x');
const FILE = path.join(dirp(),'a');"
if [ "$(run letresolver)" = "1" ]; then ok "a resolver declared with let is still a resolver"
else bad "let-declared resolver not recognised, downstream freeze silent"; fi

fixture asyncresolver "const store = require('./store');
const dirp = async () => path.join(store.ROOT,'x');
const FILE = path.join(dirp(),'a');"
if [ "$(run asyncresolver)" = "1" ]; then ok "an async resolver is still a resolver"
else bad "async resolver not recognised"; fi

# ---- arm 21: spacing is not a property of the code ------------------------
fixture nospace "const store = require('./store');
const DIR=path.join(store.ROOT,'x');"
if [ "$(run nospace)" = "1" ]; then ok "a declaration without spaces around = is still checked"
else bad "the guard depended on somebody's spacing"; fi

# ---- arm 22: the store bound under any local name -------------------------
# Every source is spelled `store.X`, so the guard was keyed on a variable name.
# Every engine module imports it as `store` today, which is why this hid.
fixture storealias "const st = require('./store');
const F = path.join(st.ROOT,'x');"
if [ "$(run storealias)" = "1" ]; then ok "the store bound under another local name is still tracked"
else bad "guard keyed on the local variable name rather than the module"; fi

fixture storealiaslazy "const st = require('./store');
const F = () => path.join(st.ROOT,'x');"
if [ "$(run storealiaslazy)" = "0" ]; then ok "and a DEFERRED use under that name is not flagged"
else bad "fired on a correctly deferred use of an aliased store"; fi

# ---- arm 23: capturing a getter is the freeze whatever wraps it -----------
# The rule first matched only a BARE member access, so the two most natural ways
# to consume one of the ~23 getters this branch creates were silent.
fixture capwrapped "const limits = require('./limits');
const F = path.join(limits.FILE, 'x');"
if [ "$(run capwrapped)" = "1" ]; then ok "a captured getter inside path.join is flagged"
else bad "a captured getter was silent because something wrapped it"; fi

fixture capconcat "const limits = require('./limits');
const F = limits.FILE + '.tmp';"
if [ "$(run capconcat)" = "1" ]; then ok "a captured getter in a concatenation is flagged"
else bad "a captured getter was silent because it was concatenated"; fi

# ---- arm 24: and process.env is NOT a module getter -----------------------
# The counterweight to the wrapped-capture arm. Widening it immediately false-positived on
# `process.env.KOSMOS_WORKERS_DIR` in tools/check-block-delivery.js: the receiver
# is `env` and the name is path-shaped. A guard that fires on correct code gets
# excused by name until the debt list is decoration.
fixture capenv "const W = process.env.KOSMOS_WORKERS_DIR || path.join('a','b');"
if [ "$(run capenv)" = "0" ]; then ok "process.env.X_DIR is not mistaken for a captured getter"
else bad "fired on an environment variable read"; fi

# ---- arm 25: an IMMEDIATELY-INVOKED function is not lazy -------------------
# isLazy ran before everyRootIsDeferred and short-circuited it, so the arrow rule
# that already knew "an arrow passed to a call runs NOW" never got to apply.
fixture iifearrow "const store = require('./store');
const FILE = (() => path.join(store.ROOT,'x'))();"
if [ "$(run iifearrow)" = "1" ]; then ok "an IIFE arrow is a freeze, not a deferral"
else bad "an immediately-invoked arrow was treated as lazy"; fi

fixture iifefn "const store = require('./store');
const FILE = (function(){ return path.join(store.ROOT,'x'); })();"
if [ "$(run iifefn)" = "1" ]; then ok "an IIFE function is a freeze, not a deferral"
else bad "an immediately-invoked function was treated as lazy"; fi

# ---- arm 26: and a STORED function is still lazy --------------------------
# The counterweight to the IIFE arm: the fix must not report correct code.
fixture storedfn "const store = require('./store');
const F = function(){ return path.join(store.ROOT,'x'); };"
if [ "$(run storedfn)" = "0" ]; then ok "a stored function expression is still lazy"
else bad "the IIFE fix fired on a correctly stored function"; fi

# ---- arm 27: a destructure INSIDE a function body is lazy -----------------
# The destructure scan was unanchored while declarations() is anchored, so it fired
# on the per-call resolver shape this card exists to promote.
fixture destrinfn "const store = require('./store');
function dirFor(){ const { ROOT } = store; return path.join(ROOT,'x'); }"
if [ "$(run destrinfn)" = "0" ]; then ok "a destructure inside a function body is not flagged"
else bad "fired on a destructure that is lazy by construction"; fi

# ---- arm 28: a destructured NON-getter resolves no root -------------------
# aliases collected every destructured name, so safeKey became a bare substring
# source and any call to it read as a freeze.
fixture destrnongetter "const { safeKey } = require('./store');
const DEFAULT_KEY = safeKey('kosmos');"
if [ "$(run destrnongetter)" = "0" ]; then ok "a destructured non-getter is not a source"
else bad "a name that resolves no root was treated as one"; fi

# ---- arm 29: prose in a COMMENT is not code ------------------------------
# The tool reported its own documentation: `const { ROOT } = store` written inside
# a block comment. Any module DOCUMENTING the frozen shape would red CI.
fixture prosecomment "const store = require('./store');
/* documentation: const { ROOT } = store; is the frozen shape */
const F = () => path.join(store.ROOT,'x');"
if [ "$(run prosecomment)" = "0" ]; then ok "the frozen shape written in a comment is not a finding"
else bad "fired on prose inside a comment"; fi

# ---- arm 30: a source name in a STRING is data, not code -----------------
fixture datastring "const S = ['store.ROOT','os.homedir()'];"
if [ "$(run datastring)" = "0" ]; then ok "source names inside string literals are not findings"
else bad "fired on a data array of source names"; fi

# ---- arm 31: two more spellings of the same access ------------------------
fixture inlinereq "const FILE = path.join(require('./store').ROOT,'x');"
if [ "$(run inlinereq)" = "1" ]; then ok "an inline require('./store').ROOT is tracked"
else bad "inline require access went silent"; fi

fixture bracketaccess "const store = require('./store');
const F = store['ROOT'];"
if [ "$(run bracketaccess)" = "1" ]; then ok "bracket access store['ROOT'] is tracked"
else bad "bracket access went silent"; fi

# ---- arm 32: EVERY OCCURRENCE of a source on a line, not the first --------
# The only widening on this branch that shipped without an arm.
fixture everyoccurrence "const store = require('./store');
const K = [{ dir: () => path.join(store.ROOT,'a') }, { dir: path.join(store.ROOT,'b') }];"
if [ "$(run everyoccurrence)" = "1" ]; then ok "a SECOND occurrence on the line is still checked"
else bad "only the first occurrence of a source on the line was examined"; fi

fixture everyoccurrencelazy "const store = require('./store');
const K = [{ dir: () => path.join(store.ROOT,'a') }, { dir: () => path.join(store.ROOT,'b') }];"
if [ "$(run everyoccurrencelazy)" = "0" ]; then ok "and both-deferred stays silent"
else bad "fired when every occurrence was deferred"; fi

# ---- arm 33: an arrow written in a COMMENT defers nothing ------------------
# The deferral exemption was handed the RAW initializer while every other source
# test got the blanked one, so a `=>` inside a comment satisfied the arrow-scope
# rule for a source that is not deferred at all. Silent direction.
fixture arrowincomment "const store = require('./store');
const FILE = /* was () => */ path.join(store.ROOT, 'x');"
if [ "$(run arrowincomment)" = "1" ]; then ok "an arrow inside a comment does not exempt a freeze"
else bad "a commented-out arrow exempted a real freeze"; fi

# ---- arm 34: and a comment or string must not make correct code fire -------
# The counterweight to the arrow-in-comment arm: the same raw-vs-blanked mismatch
# fired on correct code, and the engine modules here all carry inline comments.
fixture lazywithcomment "const store = require('./store');
const M = { dir: () => path.join(store.ROOT,'x') }; // store.ROOT is lazy"
if [ "$(run lazywithcomment)" = "0" ]; then ok "a trailing comment does not make a lazy member fire"
else bad "fired on correct code because of a trailing comment"; fi

fixture lazywithstring "const store = require('./store');
const M = { note: 'store.ROOT', dir: () => path.join(store.ROOT,'x') };"
if [ "$(run lazywithstring)" = "0" ]; then ok "a source name in a sibling string does not make it fire"
else bad "fired on correct code because of a string literal"; fi

# ---- arm 35: `${...}` in a template is CODE -------------------------------
# blankStrings treated a backtick like any other quote, so every source class went
# silent behind a template literal, including the one this file's header is about.
fixture tplinterp "const store = require('./store');
const F = \`\${store.ROOT}/messages.jsonl\`;"
if [ "$(run tplinterp)" = "1" ]; then ok "a freeze inside a template interpolation is flagged"
else bad "template interpolation hid a freeze"; fi

fixture tplinterplazy "const store = require('./store');
const F = () => \`\${store.ROOT}/x\`;"
if [ "$(run tplinterplazy)" = "0" ]; then ok "and a DEFERRED template interpolation is not flagged"
else bad "fired on a correctly deferred template"; fi

# ---- arm 36: the captured-getter receiver must be a required module --------
# The rule constrained the property name and left the receiver open, so any object
# with a path-shaped property fired. CI now runs this on server.js.
fixture recvnotrequired "const tree = { ROOT: 'not a store' };
const HEAD = tree.ROOT;"
if [ "$(run recvnotrequired)" = "0" ]; then ok "a path-shaped property on a plain object is not a capture"
else bad "fired on an object that is not a required module"; fi

# ---- arm 37: COMMENTED-OUT code is not code -------------------------------
# Found by sweeping for the odd-sibling shape rather than by a failing test: four
# scans read comment-blanked source and two split raw src. The siblings were the
# spec, the omission was ABSENT rather than wrong, and nothing could assert on a
# line that is not there.
fixture declincomment "const store = require('./store');
/*
const FILE = path.join(store.ROOT, 'x');
*/
const F = () => path.join(store.ROOT, 'y');"
if [ "$(run declincomment)" = "0" ]; then ok "a declaration inside a block comment is not a finding"
else bad "reported commented-out code as a freeze"; fi

fixture resolverincomment "const store = require('./store');
/*
const dirp = () => path.join(store.ROOT, 'x');
*/
const FILE = path.join(dirp(), 'a');"
if [ "$(run resolverincomment)" = "0" ]; then ok "a resolver defined only in a comment is not a resolver"
else bad "a commented-out resolver made a later line report via-a-helper"; fi

# ---- arm 38: the normalisation reaches RESOLVERS, not just declarations ----
# The two access rewrites were applied to the per-declaration text only, so a
# resolver written in either spelling was not recognised and every downstream
# freeze through it went silent. Both directions of one treatment, one level down.
fixture resolverbracket "const store = require('./store');
function dirp(){ return path.join(store['ROOT'],'x'); }
const FILE = path.join(dirp(),'a');"
if [ "$(run resolverbracket)" = "1" ]; then ok "a resolver using bracket access is still a resolver"
else bad "bracket-access resolver went unrecognised" "downstream freeze silent"; fi

fixture resolverinlinereq "function dirp(){ return path.join(require('./store').ROOT,'x'); }
const FILE = path.join(dirp(),'a');"
if [ "$(run resolverinlinereq)" = "1" ]; then ok "a resolver using an inline require is still a resolver"
else bad "inline-require resolver went unrecognised" "downstream freeze silent"; fi

# ---- arm 39: prose and code samples are not code, in EVERY scan -------------
# String-blanking reached the declaration initializer and not the other four
# scans, so a source name in prose read as a resolver call and a code sample in a
# template read as a real destructure.
fixture proseinstring "function helpText(){ return 'set store.ROOT to change it'; }
const MSG = helpText() + '!';"
if [ "$(run proseinstring)" = "0" ]; then ok "a source name in prose is not a resolver"
else bad "fired on prose inside a string"; fi

fixture sampleintemplate "const store = require('./store');
const SNIPPET = \`
const { ROOT } = store;
\`;
const F = () => path.join(store.ROOT,'x');"
if [ "$(run sampleintemplate)" = "0" ]; then ok "a code sample in a template is not a destructure"
else bad "fired on a code sample inside a template literal"; fi

# ---- arm 40: a destructured getter from ANY module is the same freeze -------
# destructure-is-the-freeze was hardcoded to store while capturedGetter is
# module-general, and this card mints ~23 new getters. Destructured require is
# live house style here.
fixture foreigndestr "const { FILE } = require('./limits');
const P = path.join(FILE,'x');"
if [ "$(run foreigndestr)" = "1" ]; then ok "a destructured getter from another module is flagged"
else bad "a destructured path getter went silent"; fi

fixture foreigndestrfn "const { safeKey } = require('./store');
const K = safeKey('x');"
if [ "$(run foreigndestrfn)" = "0" ]; then ok "and a destructured FUNCTION is not swept in"
else bad "a destructured function was treated as a path getter"; fi

# ---- arm 41: a curried call in a STORED arrow is still deferred -------------
# The counterweight to the IIFE arm. Its first tell was trailing `)(`, which fires
# on correctly deferred code; the discriminator is structural now.
fixture curried "const store = require('./store');
function wrap(a){ return function(b){ return b; }; }
const F = () => wrap(1)(store.ROOT);"
if [ "$(run curried)" = "0" ]; then ok "a curried call inside a stored arrow stays deferred"
else bad "fired on a correctly deferred curried call"; fi

# ---- arm 42: the STALE allowlist path, both directions ---------------------
# The newest exit-1 route shipped with no arm. Its over-broad failure mode is armed
# by side effect (a regression reds nine arms); the FIRING direction was not, and
# the documented regression it replaced (setting process.exitCode under an explicit
# process.exit(main())) printed its warnings and still exited 0.
FAKE="$T/fakerepo"
mkdir -p "$FAKE/tools"
cp "$TOOL" "$FAKE/tools/check.js"
printf 'const x = 1;\n' > "$FAKE/server.js"
out_stale="$(cd "$FAKE" && node tools/check.js server.js 2>&1)"; rc_stale=$?
if [ "$rc_stale" = "1" ] && printf '%s' "$out_stale" | grep -q '^STALE'; then
  ok "an allowlist entry that matches nothing is named AND exits 1"
else bad "the STALE path did not fire" "rc=$rc_stale out=$(printf '%s' "$out_stale" | head -1)"; fi

printf 'const y = 2;\n' > "$FAKE/other.js"
out_scope="$(cd "$FAKE" && node tools/check.js other.js 2>&1)"; rc_scope=$?
if [ "$rc_scope" = "0" ]; then ok "and an entry whose file was NOT scanned is not called stale"
else bad "a narrowed run reported a stale entry" "rc=$rc_scope"; fi

# ---- the arm labels check THEMSELVES ---------------------------------------
# 🛑 I HAND-MAINTAINED THESE NUMBERS AND BROKE THEM TWICE: once by leaving a gap,
# once by renumbering and stranding every "counterweight to arm N" reference. A
# number maintained by hand in two places is a comment asserting a property the
# file does not have, which is the exact defect this suite exists to catch. So the
# labels are checked here, and cross-references cite arms by NAME rather than by
# number, because names do not drift when an arm is inserted.
LABELS=$(grep -c '^# ---- arm [0-9]' "$0")
SEQ=$(grep -o '^# ---- arm [0-9]*' "$0" | grep -o '[0-9]*' | tr '\n' ' ')
EXPECT=$(seq 1 "$LABELS" | tr '\n' ' ')
if [ "$SEQ" = "$EXPECT" ]; then ok "the arm labels are sequential with no gaps ($LABELS)"
else bad "arm labels are not sequential" "got [$SEQ] want [$EXPECT]"; fi
# ⚠️ NOT `LABELS -eq PASS`. I wrote that first and it went red immediately: LABELS
# counts ARMS and PASS counts CHECKS, and several arms run two fixtures. Two
# different quantities one word apart, asserted as equal. Each labelled arm makes
# at least one check, so the true relation is >=.
if [ "$PASS" -ge "$LABELS" ]; then ok "every labelled arm ran at least one check ($LABELS labels, $PASS checks)"
else bad "fewer checks than labelled arms" "$LABELS labels, $PASS checks"; fi
if grep -q 'counterweight to arm [0-9]' "$0"; then
  bad "a cross-reference cites an arm by NUMBER" "cite it by name; numbers drift when an arm is inserted"
else ok "no cross-reference cites an arm by number"; fi

echo
if [ "$FAILS" -eq 0 ]; then echo "ALL PASS ($PASS checks across $LABELS arms)"; else echo "$FAILS FAILED"; fi
exit "$FAILS"
