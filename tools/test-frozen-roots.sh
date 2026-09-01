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
T="$(mktemp -d)"; trap 'rm -rf "${T:?}"' EXIT

fixture() { printf '%s\n' "$2" > "$T/$1.js"; }
# 🛑 THE EXIT CODE ALONE CANNOT TELL A FINDING FROM A CRASH, AND THAT IS HOW A CRASH
# SHIPPED GREEN. A ReferenceError exits 1, which is exactly what an arm expecting a
# finding asserts, so three arms reported PASS against a rule that never ran once:
# the whole foreign-destructure arm was a temporal-dead-zone crash and the suite said
# ALL PASS. An arm that cannot distinguish "the tool found the thing" from "the tool
# died" is not an arm.
# So: a crash is its own verdict, and an exit-1 with no finding line is another. Both
# differ from "1", so every arm expecting a finding now fails on either.
# 🛑 ONE COPY OF THIS LOGIC, NOT TWO. `crash_verdict` below used to be a HAND COPY
# of run()'s body, so the arm that verifies run()'s crash detection was verifying a
# DIFFERENT FUNCTION that merely looked the same. A duplicated rule is one edit away
# from a test that no longer tests the thing it names.
# ⚠️ UNREADABLE IS ITS OWN VERDICT. It used to satisfy "the tool found the thing", so
# a liveness arm asserting `1` passed on a file the scanner GAVE UP on rather than on
# a finding. An arm that cannot tell a freeze from an abandoned parse is not an arm,
# which is the same argument the crash case above is made of.
_verdict() {   # $1 = tool path, $2 = fixture name
  node "$1" "$T/$2.js" >"$T/out" 2>&1
  rc=$?
  if grep -qE 'ReferenceError|TypeError|SyntaxError|RangeError|^    at ' "$T/out"; then echo "CRASH"; return; fi
  if grep -q '^UNREADABLE' "$T/out"; then echo "UNREADABLE"; return; fi
  if [ "$rc" = "1" ] && ! grep -qE 'resolves a root at require time|^STALE' "$T/out"; then
    echo "NOFINDING"; return
  fi
  echo "$rc"
}
run() { _verdict "$TOOL" "$1"; }

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
# Stripping a trailing line comment without knowing about strings cut
# `const U = 'https://x/a';` at the URL's `//`, so the line no longer ended in `;`,
# the capture ran on, and the NEXT line's freeze was attributed to U. Nine such
# lines exist in engine/ today.
# ⚠️ MECHANISM CORRECTED. This arm and its counterweight used to say the TERMINATOR
# strips the comment. It does not, at this call site: `declarations()` runs
# `scanText(rawSrc)` first, so comments and strings are already blanked before
# `terminated()` ever sees a line, and `terminated`'s own `lineInfo(t).code` is
# redundant there. Measured: replacing it with a bare `/;\s*$/` test leaves the
# suite ALL PASS, and so does restoring the string-unaware strip these arms were
# written against. THE ARMS ARE STILL RIGHT AND STILL WANTED: they assert the
# end-to-end property, which is what anyone cares about. What was wrong was the
# sentence naming which line delivers it, and an arm that misnames its own
# mechanism sends the next reader to defend the wrong code.
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
# Same mechanism note as that arm: the blanking upstream is what delivers this, not
# the terminator's own strip.
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
# The counterweight to the captured-getter arm. DRY_RUN really is a boolean.
# ⚠️ THIS LINE USED TO CITE HOME_FOR_TEST TOO, and check-frozen-roots.js retracts
# that: it returns homeDir(), so the tool now deliberately FIRES on it (arm 54).
# Two files asserting opposite things about one identifier is the retraction
# landing in one artifact and not its sibling.
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
# 🛑 THE ARM PLANTS ITS OWN ALLOWLIST ENTRY RATHER THAN BORROWING THE REAL ONE.
# It used to rely on the production KNOWN map holding a `server.js:` key that the
# fake repo's file could not match. That coupling makes the arm red ON CORRECT CODE
# the day the allowlist empties, and emptying it is the tool's STATED GOAL: the list
# is meant to shrink to nothing. An arm that breaks when the thing it guards is
# fixed is a trap for whoever does the fixing, and they will read it as their bug.
# Measured before this change: with KNOWN emptied, the suite reported
# "FAIL the STALE path did not fire".
FAKE="$T/fakerepo"
mkdir -p "$FAKE/tools"
sed "s|^const KNOWN = new Map(\[|const KNOWN = new Map([['server.js:ARM42_PLANTED','planted by arm 42 so this arm owns its own fixture'],|" "$TOOL" > "$FAKE/tools/check.js"
planted=$(grep -c 'ARM42_PLANTED' "$FAKE/tools/check.js")
if [ "$planted" = "1" ]; then ok "arm 42 planted its own allowlist entry (independent of the real map)"
else bad "arm 42 could not plant its entry" "$planted occurrences, want 1"; fi
printf 'const x = 1;\n' > "$FAKE/server.js"
out_stale="$(cd "$FAKE" && node tools/check.js server.js 2>&1)"; rc_stale=$?
if [ "$rc_stale" = "1" ] && printf '%s' "$out_stale" | grep -q '^STALE'; then
  ok "an allowlist entry that matches nothing is named AND exits 1"
else bad "the STALE path did not fire" "rc=$rc_stale out=$(printf '%s' "$out_stale" | head -1)"; fi

printf 'const y = 2;\n' > "$FAKE/other.js"
out_scope="$(cd "$FAKE" && node tools/check.js other.js 2>&1)"; rc_scope=$?
if [ "$rc_scope" = "0" ]; then ok "and an entry whose file was NOT scanned is not called stale"
else bad "a narrowed run reported a stale entry" "rc=$rc_scope"; fi

# ---- arm 43: the DIRECTORY-walking branch of main(), three ways ------------
# Every other arm passes a single .js file, so the recursion, the .test.js
# exclusion and the unreadable-target path were exercised by nothing at all. A
# regression to a flat readdir would report a clean run over FEWER files, which is
# the same false-clean shape this tool exists to prevent.
WALK="$T/walk"
mkdir -p "$WALK/sub"
printf "const store = require('./store');\nconst DEEP = path.join(store.ROOT, 'x');\n" > "$WALK/sub/deep.js"
# 🛑 GREP THE OUTPUT, NOT THE BARE EXIT CODE. This read `rc = 1` and an uncaught
# exception also exits 1, so with a ReferenceError planted in scan() this check
# still reported PASS while 65 other arms went red. That is the defect run() was
# fixed for, in the arms that bypass run().
out_walk="$(node "$TOOL" "$WALK" 2>&1)"; rc_walk=$?
if [ "$rc_walk" = "1" ] && printf '%s' "$out_walk" | grep -q 'resolves a root at require time'; then
  ok "the directory walk RECURSES into a subdirectory"
else bad "a freeze in a subdirectory was not found" "rc=$rc_walk out=$(printf '%s' "$out_walk" | head -1)"; fi

mv "$WALK/sub/deep.js" "$WALK/sub/deep.test.js"
out_skip="$(node "$TOOL" "$WALK" 2>&1)"; rc_skip=$?
if [ "$rc_skip" = "0" ] && ! printf '%s' "$out_skip" | grep -qE 'ReferenceError|^    at '; then
  ok "and it excludes .test.js while recursing"
else bad "a .test.js file was scanned" "rc=$rc_skip"; fi

out_missing="$(node "$TOOL" "$T/definitely-not-here-9999" 2>&1)"; rc_missing=$?
if [ "$rc_missing" = "2" ] && printf '%s' "$out_missing" | grep -q 'cannot read target'; then
  ok "an unreadable target exits 2, not a stack trace"
else bad "a missing target did not exit 2" "rc=$rc_missing"; fi

# ---- arm 44: an odd quote inside a REGEX must not blind the rest of the file
# This silenced THREE files in the enforced scope (clipath, reporthook, unfurl).
# The quote inside the regex opened a string mode that never closed, so every
# scan saw whitespace from there to EOF. reporthook lost 131 of its 221 lines.
fixture regexquote "const store = require('./store');
if (/[\"\\\\\$]/.test('x')) { /* nothing */ }
const FILE = path.join(store.ROOT, 'x');"
if [ "$(run regexquote)" = "1" ]; then ok "a freeze after an odd-quote regex is still found"
else bad "an odd quote inside a regex blinded the rest of the file"; fi

# ---- arm 45: and DIVISION is not mistaken for a regex ---------------------
# The counterweight: treating every / as a regex would swallow to end of line.
fixture divisionnotregex "const store = require('./store');
const total = 10; const count = 2;
const n = total / count;
const FILE = path.join(store.ROOT, 'x');"
if [ "$(run divisionnotregex)" = "1" ]; then ok "division is not read as a regex literal"
else bad "a division swallowed the rest of the line"; fi

# ---- arm 46: a file the blanker CANNOT finish is named, never clean -------
# The belt to the braces above: if some future shape desynchronises the walk
# again, a clean result must not be reported for a file that was not read.
fixture unterminated "const store = require('./store');
const S = 'this string never closes
const FILE = path.join(store.ROOT, 'x');"
out_unread="$(node "$TOOL" "$T/unterminated.js" 2>&1)"; rc_unread=$?
if [ "$rc_unread" != "0" ] && printf '%s' "$out_unread" | grep -q '^UNREADABLE'; then
  ok "a file the scanner cannot finish reading is NAMED and gates"
else bad "an unreadable file reported clean" "rc=$rc_unread"; fi

# ---- arm 47: a freeze deep inside a long declaration ----------------------
# The capture cap was 12 lines, so a freeze on declaration line 14 was SILENT while
# line 13 was reported. 22 module-level declarations in the enforced scope are
# longer than that, up to 201 lines, including tokendoors.js's own 127-line SPECS.
# ⚠️ AND THE END-OF-FILE PLANT SWEEP COULD NOT SEE THIS BY CONSTRUCTION: a plant at
# EOF is always a SHORT declaration. The method reported 69 of 69 files sighted.
{ printf "const store = require('./store');\nconst BIG = [\n"
  i=1; while [ "$i" -le 40 ]; do printf "  'filler%s',\n" "$i"; i=$((i+1)); done
  printf "  path.join(store.ROOT, 'x'),\n];\n"; } > "$T/deepdecl.js"
if [ "$(run deepdecl)" = "1" ]; then ok "a freeze 40 lines into a declaration is still found"
else bad "a freeze past the capture cap went silent"; fi

{ printf "const store = require('./store');\nconst BIG = [\n"
  i=1; while [ "$i" -le 40 ]; do printf "  'filler%s',\n" "$i"; i=$((i+1)); done
  printf "  () => path.join(store.ROOT, 'x'),\n];\n"; } > "$T/deepdecllazy.js"
if [ "$(run deepdecllazy)" = "0" ]; then ok "and a DEFERRED one that deep stays silent"
else bad "fired on a deferred entry deep in a declaration"; fi

# ---- arm 48: a destructured foreign getter, renamed or used lazily ---------
# The foreign arm marked the USES and did not treat the destructure as the freeze,
# unlike its store sibling. A renamed binding dropped out (the LOCAL name is not
# path-shaped) and a lazy-only use looked deferred though the getter had already
# been evaluated by the destructure itself.
fixture foreignrenamed "const { FILE: F } = require('./limits');
const P = path.join(F,'x');"
if [ "$(run foreignrenamed)" = "1" ]; then ok "a RENAMED destructured getter is flagged"
else bad "a renamed binding dropped out of the path-shaped test"; fi

fixture foreignlazyuse "const { FILE } = require('./limits');
const P = () => path.join(FILE,'x');"
if [ "$(run foreignlazyuse)" = "1" ]; then ok "a destructured getter used only lazily is still flagged"
else bad "a lazy USE hid a destructure that already evaluated the getter"; fi

# ---- arm 49: an inline block comment before a regex is not a desync --------
# `before` was computed from RAW source, so after an inline comment it ended in the
# comment's closing delimiter, the regex was read as code, and its quote opened a
# string mode that never closed. That reds the build on correct code, in a repo
# whose house style is heavy inline comments.
fixture commentregex "const ok = /* note */ /[\"]/.test('a');
const store = require('./store');
const F = () => path.join(store.ROOT,'x');"
if [ "$(run commentregex)" = "0" ]; then ok "an inline comment before a regex does not desync the scanner"
else bad "a comment before a regex made the file unreadable"; fi

# ---- arm 50: a bare-identifier source matches on a WORD BOUNDARY ----------
# Every source used to be dotted or parenthesised, so substring matching was safe.
# This branch added BARE names (destructured ROOT/AVATARS/PROFILES and the foreign
# getters), and `DOC_ROOT_LABEL` then matched `ROOT`.
fixture bareword "const { ROOT } = require('./store');
const DOC_ROOT_LABEL = 'x';
const LABEL = DOC_ROOT_LABEL;
const dirFor = () => path.join(ROOT,'a');"
n_false=$(node "$TOOL" "$T/bareword.js" 2>&1 | grep -c 'const LABEL')
n_real=$(node "$TOOL" "$T/bareword.js" 2>&1 | grep -c 'const { ROOT }')
if [ "$n_false" = "0" ] && [ "$n_real" = "1" ]; then ok "a name CONTAINING a bare source is not a use of it"
else bad "bare-identifier source matched as a substring" "false=$n_false real=$n_real"; fi

fixture barewordforeign "const { FILE } = require('./limits');
const MAX_FILE_SIZE = 10;
const X = MAX_FILE_SIZE * 2;"
if [ "$(node "$TOOL" "$T/barewordforeign.js" 2>&1 | grep -c 'const X ')" = "0" ]; then
  ok "and MAX_FILE_SIZE is not a use of a destructured FILE"
else bad "a foreign bare source matched as a substring"; fi

# ---- arm 51: run() itself must report a CRASH, not a finding ---------------
# 🛑 THE PREVIOUS VERSION OF THIS ARM DID NOT TEST ITS OWN HEADING. It asserted
# that an ordinary fixture reads clean, which duplicates arm 5, and left the CRASH
# branch of run() covered by nothing: deleting its grep would have gone unnoticed.
# This drives a deliberately broken COPY of the tool, so the real one is untouched.
CRASHTOOL="$T/crashtool.js"
printf 'throw new ReferenceError("planted crash");\n' > "$CRASHTOOL"
printf 'const store = require("./store");\nconst F = path.join(store.ROOT, "x");\n' > "$T/forcrash.js"
out_c="$(node "$CRASHTOOL" "$T/forcrash.js" 2>&1)"; rc_c=$?
if [ "$rc_c" = "1" ] && printf '%s' "$out_c" | grep -qE 'ReferenceError'; then
  ok "a crashing tool exits 1, which is why the exit code alone cannot be trusted"
else bad "the crash fixture did not behave as expected" "rc=$rc_c"; fi

crash_verdict() { _verdict "$CRASHTOOL" "$1"; }
if [ "$(crash_verdict forcrash)" = "CRASH" ]; then ok "run()'s own logic reports CRASH rather than 1"
else bad "run()'s crash detection did not fire" "got $(crash_verdict forcrash)"; fi

# ---- arm 52: the DEPTH-aware declaration terminator ------------------------
# Load-bearing and previously unguarded: replacing `depth <= 0 && terminated(...)`
# with `terminated(...)` alone left the suite ALL PASS while a real freeze went
# silent. Arm 13 looks like it covers this and does not: it exercises
# functionNamesReaching's adepth rule, a different half.
fixture depthterm "const store = require('./store');
const M = {
  fn() {
    return 1;
  },
  file: path.join(store.ROOT, 'x'),
};"
if [ "$(run depthterm)" = "1" ]; then ok "a freeze after a nested block inside a declaration is found"
else bad "the depth-aware terminator stopped at an interior semicolon"; fi

# ---- arm 53: reported LINE NUMBERS are true --------------------------------
# Three comment blocks argue for the width- and newline-preserving normalisation
# and nothing tested it. Replacing padAfter/padBefore with a plain replacement
# left the suite ALL PASS while positions drifted. The tool gates CI on a 434KB
# server.js, where a drifting line number sends a reader to the wrong place.
fixture lineno "const a = 1;
const store = require('./store');
const b = 2;
const { ROOT } = store;
const d = () => path.join(ROOT, 'x');"
line_reported=$(node "$TOOL" "$T/lineno.js" 2>&1 | grep -o ':[0-9]*  const { ROOT }' | grep -o '[0-9]*')
if [ "$line_reported" = "4" ]; then ok "the destructure on line 4 is reported at line 4"
else bad "a reported line number drifted" "said line $line_reported, the destructure is on line 4"; fi

# ---- arm 54: HOME_FOR_TEST is a real root ---------------------------------
# It was cited in this file as a getter that must NOT be swept in, as evidence the
# filter avoids false positives. It returns homeDir(). Both engine/accounts.js and
# engine/openaiaccounts.js export it. Half the example was the defect.
fixture homefortest "const accounts = require('./accounts');
const H = accounts.HOME_FOR_TEST;"
if [ "$(run homefortest)" = "1" ]; then ok "capturing HOME_FOR_TEST is flagged, it resolves a real root"
else bad "HOME_FOR_TEST captured silently, it returns homeDir()"; fi

fixture homesuffix "const m = require('./limits');
const H = m.SOMETHING_HOME;"
if [ "$(run homesuffix)" = "1" ]; then ok "and the _HOME suffix is path-shaped"
else bad "a _HOME getter capture went silent"; fi

# ---- arm 55: a MULTI-LINE laundering, the fourth axis --------------------
# `lines.every` -> `lines.some` survived the entire suite. The some/every fix was
# applied over SOURCES, over occurrences and over arrow scope; the LINES axis had
# no arm, and arm 8 is single-line so it cannot reach this. engine/forget.js:KINDS
# is exactly this multi-line member shape.
fixture launderlines "const store = require('./store');
const M = {
  live: () => store.ROOT,
  file: path.join(store.ROOT, 'x'),
};"
if [ "$(run launderlines)" = "1" ]; then ok "a deferred member on ANOTHER LINE does not launder a freeze"
else bad "multi-line laundering: one lazy line exempted the whole declaration"; fi

# ---- arm 56: resolver CALLS are marks too ---------------------------------
# Dropping resolver names from `marks` survived. The rule's own comment says a line
# whose freeze is path.join(base(),'b') was never examined.
fixture resolvermark "const store = require('./store');
const base = () => store.ROOT;
const M = { live: () => store.ROOT, file: path.join(base(),'x') };"
if [ "$(run resolvermark)" = "1" ]; then ok "a resolver CALL counts as an occurrence to examine"
else bad "a line whose freeze is a resolver call was not examined"; fi

# ---- arm 57: an arrow whose scope CLOSED, isolated from the isCall rule ----
# Arm 19 names this rule and passes on the isCall rule instead: its fixture uses
# .map(...), which the isCall test rejects first. This fixture stores the arrow in
# an array, so only the depth-drop rejection can catch it.
fixture scopeclosed "const store = require('./store');
const F = [(x) => x].concat(path.join(store.ROOT,'y'));"
if [ "$(run scopeclosed)" = "1" ]; then ok "an arrow whose scope already closed does not defer a later freeze"
else bad "the depth-drop rejection is not what catches this"; fi

# ---- arm 58: declarations() takes let/var and the exports forms ------------
# Arm 20 covers the same widening in functionNamesReaching, NOT here. The two look
# like one arm and are not: narrowing declarations() to `const` survived.
fixture declletform "const store = require('./store');
let DIR = path.join(store.ROOT,'x');"
if [ "$(run declletform)" = "1" ]; then ok "declarations() sees a let-declared freeze"
else bad "declarations() was narrowed to const and nothing noticed"; fi

fixture declexports "const store = require('./store');
exports.DIR = path.join(store.ROOT,'x');"
if [ "$(run declexports)" = "1" ]; then ok "declarations() sees an exports.X freeze"
else bad "the exports.X form dropped out of declarations()"; fi

# ---- arm 59: the store under a local alias, via a RESOLVER -----------------
# Arm 22 passes via capturedGetter, which only inspects declaration initializers.
# The behaviour only storeLocals provides is a RESOLVER reaching an aliased store.
fixture aliasresolver "const st = require('./store');
function dirp(){ return path.join(st.ROOT,'x'); }
const F = path.join(dirp(),'a');"
if [ "$(run aliasresolver)" = "1" ]; then ok "a resolver reaching an ALIASED store is tracked"
else bad "storeLocals is not what catches the aliased-store resolver path"; fi

# ---- arm 60: the derived getters, via a RESOLVER --------------------------
# Arms 9 and 10 also pass via capturedGetter. Removing AVATARS/PROFILES from
# SOURCES survived, because capturedGetter never inspects resolver bodies.
fixture derivedresolver "const store = require('./store');
function dirp(){ return path.join(store.AVATARS,'x'); }
const F = path.join(dirp(),'a');"
if [ "$(run derivedresolver)" = "1" ]; then ok "a resolver reaching store.AVATARS is tracked"
else bad "SOURCES lost a derived getter and only the resolver path noticed"; fi

# ---- arm 61: TWO rounds of transitive closure, not one --------------------
# A helper that calls a resolver is itself a resolver. One round survived.
fixture tworounds "const store = require('./store');
const F = path.join(outer(),'a');
function outer() {
  return inner();
}
function inner() {
  return path.join(store.ROOT,'x');
}"
if [ "$(run tworounds)" = "1" ]; then ok "a helper that calls a resolver is itself a resolver"
else bad "only one round of closure ran"; fi

# ---- arm 62: padBefore preserves newlines too -----------------------------
# Arm 53 exercises padAfter only. A multi-line inline require goes through
# padBefore, whose replacement is SHORTER than the text it replaces; losing its
# newline preservation drifts every line number after it.
# ⚠️ My first version of this arm asserted the wrong thing: it expected the freeze
# to be reported on the LATER line that USES the captured value. The multi-line
# require IS the freeze, correctly reported at its own line 2 spanning 3 lines.
# The arm was wrong, not the tool.
fixture padbefore "const a = 1;
const R = require(
  './store'
).ROOT;
const b = 2;
const FROZEN = path.join(R,'x');"
pb_line=$(node "$TOOL" "$T/padbefore.js" 2>&1 | grep -o ':[0-9]*  const R ' | grep -o '[0-9]*')
if [ "$pb_line" = "2" ]; then ok "a multi-line require freeze is reported at its own line 2"
else bad "padBefore lost a newline and the line drifted" "said $pb_line, want 2"; fi
# 🛑 THE LINE ABOVE CANNOT SEE THE RULE THIS ARM IS NAMED FOR. `const R` sits BEFORE
# the multi-line require, so a lost newline drifts every line AFTER it and leaves
# this assertion at 2 either way. Deleting the newline preservation from padBefore
# left the whole suite ALL PASS while reported lines moved by two. An arm whose
# fixture is upstream of its own effect is decoration.
# So assert a line DOWNSTREAM of the pad, where the drift actually lands.
# ⚠️ AND THE FIXTURE HAD TO CHANGE, WHICH IS THE SECOND HALF OF THE SAME MISTAKE. My
# first downstream assertion named `const FROZEN`, a line the tool does not report at
# all: once `const R` is flagged, a later use of R is not a separate finding. An arm
# asserting a finding that is never emitted reads empty and fails for the wrong
# reason. The downstream line has to be an INDEPENDENT freeze.
fixture padbefore_after "const a = 1;
const R = require(
  './store'
).ROOT;
const b = 2;
const os = require('os');
const HOME = os.homedir();"
# 🛑 AND THIS FIXTURE TESTS padAfter, NOT padBefore, WHICH IS THE SAME MISNAMING ONE
# LAYER ON. A multi-line `require(\n './store' \n)` is rewritten by the MODULE-PATH
# rule, which pads AFTER. I wrote this arm under the padBefore heading and only found
# out by mutating padAfter and watching THIS assertion go red. An arm that reds on a
# rule it does not name is how a suite reports coverage it does not have.
pa_after=$(node "$TOOL" "$T/padbefore_after.js" 2>&1 | grep -o ':[0-9]*  const HOME ' | grep -o '[0-9]*')
if [ "$pa_after" = "7" ]; then ok "padAfter keeps a downstream line's number across a multi-line require path (7)"
else bad "padAfter newline loss drifted a downstream line" "said $pa_after, want 7"; fi

# The genuine padBefore path needs the newline between `require(store)` and `.ROOT`,
# which is a different rewrite from the one above. Verified by mutating padBefore
# alone: this line moves 6 -> 5 and the padAfter assertion above does not move.
fixture padbefore_only "const a = 1;
const R = require('./store')
  .ROOT;
const b = 2;
const os = require('os');
const HOME = os.homedir();"
pb_only=$(node "$TOOL" "$T/padbefore_only.js" 2>&1 | grep -o ':[0-9]*  const HOME ' | grep -o '[0-9]*')
if [ "$pb_only" = "6" ]; then ok "padBefore keeps a downstream line's number across a split member access (6)"
else bad "padBefore newline loss drifted a downstream line" "said $pb_only, want 6"; fi

# ---- arm 63: no SKIP BY NAME in either half of the captured-getter rule ----
# capturedGetter dropped its `env` name check; capturedMarks kept it, so the two
# halves disagreed in the silent direction and a deferred sibling laundered a real
# capture whenever the receiver was called env.
fixture envmark "const store = require('./store');
const env = require('./env');
const M = { live: () => store.ROOT, file: path.join(env.DIR,'x') };"
if [ "$(run envmark)" = "1" ]; then ok "a receiver named env is not skipped by name"
else bad "capturedMarks still skips a receiver because of its name"; fi

fixture procenv "const W = process.env.KOSMOS_WORKERS_DIR || path.join('a','b');"
if [ "$(run procenv)" = "0" ]; then ok "and process.env is still not a captured getter"
else bad "removing the name check swept in process.env"; fi

# ---- arm 64: a REGEX LITERAL does not desync the line walker ---------------
# lineInfo was the THIRD quote-walker and the only one not taught about regexes.
# blankComments and blankStrings copy a regex verbatim because it IS code, so its
# quote survived into the text lineInfo walks. Live in scope: status.js captured
# 501 lines where main captured 13.
fixture regexline "const store = require('./store');
const RE = /[\\w'-]{2,}\\.\$/;
const F = path.join(store.ROOT,'x');"
n_rl=$(node "$TOOL" "$T/regexline.js" 2>&1 | grep -c 'resolves a root')
if [ "$n_rl" = "1" ]; then ok "an apostrophe inside a regex does not run the capture on"
else bad "a regex literal desynchronised the line walker" "$n_rl findings, want 1"; fi

# ---- arm 65: the source match is WORD-BOUNDED, the odd sibling -------------
# `functionNamesReaching` was the one member of the source-matching family using a
# plain `body.includes(s)`; the other three go through hasSource/sourceOccurrences.
# This branch is what made that dangerous, by adding BARE-NAME sources. A substring
# hit then makes an unrelated helper a resolver, on correct code, in a CI gate.
fixture wordb "const { FILE } = require('./limits');
const MAX_FILE_SIZE = 10;
function budget() { return MAX_FILE_SIZE * 2; }
const CAP = budget();"
wb=$(node "$TOOL" "$T/wordb.js" 2>&1 | grep -c 'const CAP')
if [ "$wb" = "0" ]; then ok "MAX_FILE_SIZE does not make a helper a resolver via bare FILE"
else bad "a substring source match reported correct code" "$wb hits on const CAP"; fi

# ---- arm 66: a ONE-LINE function does not swallow the next line ------------
# Both body-capture breaks were guarded by `j > i`, so a definition that closes on
# its own line ran on and adopted whatever followed. Counterweight to the arm for
# the arrow form below: this is the `function` half.
fixture oneline_fn "const store = require('./store');
function label() { return 'x'; }
const TITLE = label() + '!';
const dirFor = () => path.join(store.ROOT, 'y');"
of=$(node "$TOOL" "$T/oneline_fn.js" 2>&1 | grep -c 'const TITLE')
if [ "$of" = "0" ]; then ok "a one-line function body stops at its own closing brace"
else bad "a one-line function swallowed the following line" "$of hits on const TITLE"; fi

# ---- arm 67: a ONE-LINE arrow const does not swallow the next line ---------
# The idiom this branch introduces 23 times. Its break required j > i, so it always
# took at least one extra line.
fixture oneline_arrow "const store = require('./store');
const label = () => 'x';
const dirFor = () => path.join(store.ROOT, 'y');
const TITLE = label() + '!';"
oa=$(node "$TOOL" "$T/oneline_arrow.js" 2>&1 | grep -c 'const TITLE')
if [ "$oa" = "0" ]; then ok "a one-line arrow const body stops at its own semicolon"
else bad "a one-line arrow swallowed a following line" "$oa hits on const TITLE"; fi

# ---- arm 68: a MULTI-LINE definition still reaches its whole body ----------
# The counterweight to the two arms above: having taught the capture to stop on the
# definition line, a genuine multi-line helper must still be seen whole, or the fix
# for a false positive becomes a false negative.
fixture multiline_helper "const store = require('./store');
function dirFor() {
  const seg = 'liveness';
  return path.join(store.ROOT, seg);
}
const CAP = dirFor();"
mh=$(run multiline_helper)
if [ "$mh" = "1" ]; then ok "a multi-line helper is still a resolver after the one-line fix"
else bad "the one-line termination fix blinded the multi-line case" "verdict $mh, want 1"; fi

# ---- arm 69: normaliseAccess handles the DOUBLE-quoted subscript ----------
# `['X']` and `["X"]` are one idea with two spellings and only the single-quoted one
# had an arm; removing the double-quoted rewrite left the suite green.
fixture dq_sub "const store = require('./store');
const HOME = store[\"ROOT\"];"
if [ "$(run dq_sub)" = "1" ]; then ok "a double-quoted subscript access is normalised"
else bad "store[\"ROOT\"] was not seen" "verdict $(run dq_sub)"; fi

# ---- arm 70: declarations() sees module.exports.X --------------------------
# const/let/var and exports.X had an arm; the third spelling did not.
fixture mod_exports "const os = require('os');
module.exports.HOME = os.homedir();"
if [ "$(run mod_exports)" = "1" ]; then ok "module.exports.X is a declaration"
else bad "module.exports.X was not scanned" "verdict $(run mod_exports)"; fi

# ---- arm 71: an ASYNC FUNCTION declaration is a resolver body -------------
# The async ARROW had an arm; the async function half did not.
fixture async_fn "const store = require('./store');
async function dirFor() {
  return path.join(store.ROOT, 'y');
}
const CAP = dirFor();"
if [ "$(run async_fn)" = "1" ]; then ok "an async function declaration is seen as a resolver"
else bad "async function was not matched" "verdict $(run async_fn)"; fi

# ---- arm 72: os.tmpdir() is a tracked source ------------------------------
# A SOURCES member with no arm of its own.
fixture tmpdir "const os = require('os');
const SCRATCH = os.tmpdir();"
if [ "$(run tmpdir)" = "1" ]; then ok "os.tmpdir() is a tracked root source"
else bad "os.tmpdir() is in SOURCES but nothing asserts it" "verdict $(run tmpdir)"; fi

# ---- arm 73: the DATA env seam is a tracked source ------------------------
# Reached only through the laundering arm, so it had no direct assertion.
fixture dataenv "const BASE = process.env.AGENT_WORKFORCE_DATA;
const DIR = path.join(BASE, 'x');"
if [ "$(run dataenv)" = "1" ]; then ok "the AGENT_WORKFORCE_DATA seam is tracked directly"
else bad "the DATA seam has no direct coverage" "verdict $(run dataenv)"; fi

# ---- arm 74: the PATH_SHAPED names THIS BRANCH mints ----------------------
# FILE and DIR had arms. LOG, SEEN, FLAG and ROOT are exactly the names this branch
# introduces (messages.LOG, messages.SEEN, firstrun.FLAG, attachments.ROOT) and
# trimming PATH_SHAPED to FILE|DIR left the suite green.
pn_fail=0
for nm in LOG SEEN FLAG; do
  fixture "pn_$nm" "const { $nm } = require('./messages');
const COPY = $nm;"
  v=$(node "$TOOL" "$T/pn_$nm.js" 2>&1 | grep -c "const { $nm }")
  [ "$v" = "1" ] || { pn_fail=$((pn_fail+1)); echo "      $nm not treated as path-shaped"; }
done
if [ "$pn_fail" = "0" ]; then ok "LOG, SEEN and FLAG are path-shaped names"
else bad "$pn_fail of the names this branch mints are not path-shaped"; fi

# ---- arm 75: SOURCES is DERIVED from the getter names ---------------------
# The comment above GETTER_VALUE_NAMES claims the three names live in one place, and
# SOURCES used to spell them out again. Narrowing the list then un-tracked a
# destructured or aliased AVATARS while the dotted form stayed tracked, with the
# suite green throughout. Now that SOURCES maps over the list, narrowing it breaks
# BOTH spellings and this arm sees it.
fixture derived_src "const store = require('./store');
const { AVATARS } = require('./store');
const A = AVATARS;
const B = store.PROFILES;"
ds=$(node "$TOOL" "$T/derived_src.js" 2>&1 | grep -c 'resolves a root at require time')
if [ "$ds" -ge 2 ]; then ok "both the destructured and dotted getter spellings are tracked ($ds)"
else bad "a getter name is tracked in one spelling only" "$ds findings, want >= 2"; fi

# ---- arm 76: the enforced scope stays FAST --------------------------------
# ⚠️ HONEST PROVENANCE, AND THE SECOND HALF OF IT IS A RETRACTION OF MY OWN.
# A reviewer reported that unbounding prevToken's prefix costs ~39s on
# engine/status.js alone. I could not reproduce that, and that half stands: measured
# again in the correct layout, n=3 each, the mutant is not slower (316-369ms against
# a 337-376ms base).
# 🛑 BUT I ALSO WROTE THAT THE MUTATION "CHANGED THE TOOL'S VERDICT (rc 0 -> 1), so
# that edit is a correctness mutation rather than a performance one". THAT IS FALSE.
# In the correct layout the two runs are rc 0 BOTH and BYTE-IDENTICAL in output.
# The rc 0 -> 1 I saw came from MY OWN HARNESS: it copied the tool to a temp dir and
# ran it from OUTSIDE the repo, where `path.relative(path.join(__dirname, '..'), f)`
# yields a different key, which stops matching the `server.js:GATE_LOG` allowlist
# entry, which turns a KNOWN line into a finding. I attributed my harness's own
# confound to the mutation.
# ⭐ A MUTATION HARNESS THAT RELOCATES THE CODE UNDER TEST CHANGES ANY BEHAVIOUR THAT
# DEPENDS ON ITS OWN LOCATION, and this tool derives its allowlist keys from
# __dirname. Mutate in a copy that sits where the original sat.
# ⇒ SO THE HONEST STATE IS: prevToken's 12-character bound is UNGUARDED, and removing
# it is output-identical and not measurably slower at this repo size. It is a
# performance optimisation whose benefit I cannot demonstrate here, NOT a correctness
# rule. Nobody should read my earlier sentence as having closed the question, because
# closing it falsely is worse than leaving it open.
# The arm is still worth its two lines: this file's own commit log records a 53s
# regression I introduced once, the gate runs on every commit, and a wall-clock
# ceiling catches ANY future quadratic blowup regardless of which line causes it.
# It is a REGRESSION FLOOR, not evidence for the reviewer's mechanism, and the bound
# is deliberately loose so a busy machine does not red it.
perf_start=$(date +%s)
node "$TOOL" engine server.js >/dev/null 2>&1; perf_rc=$?
perf_ms=$(( $(date +%s) - perf_start ))
# ⭐ ASSERT THE EXIT CODE TOO. This arm ran the real gate and threw its verdict away.
# Checking it costs nothing and catches every mutation that reds the enforced scope
# without reding a fixture arm, which this round produced three of.
if [ "$perf_rc" = "0" ]; then ok "the enforced scope still exits 0"
else bad "the enforced scope is RED" "rc=$perf_rc -- run: node tools/check-frozen-roots.js engine server.js"; fi
if [ "$perf_ms" -le 20 ]; then ok "the enforced scope completes well inside 20s (${perf_ms}s)"
else bad "the enforced scope got dramatically slower" "${perf_ms}s, baseline is under 1s"; fi

# ---- arm 77: a NON path-shaped foreign destructure is not reported --------
# The PATH_SHAPED filter inside the foreign-destructure loop had no arm: removing it
# left the suite green while every `const { thing } = require(...)` in the repo
# became a finding. Precision, and the direction that fires on correct code.
fixture foreign_plain "const { thing, helper } = require('./util');
const A = thing;
const B = helper();"
fp=$(node "$TOOL" "$T/foreign_plain.js" 2>&1 | grep -c 'resolves a root at require time')
if [ "$fp" = "0" ]; then ok "a foreign destructure of non-path names is not a freeze"
else bad "the PATH_SHAPED filter is not guarding the foreign loop" "$fp findings, want 0"; fi

# ---- arm 78: a foreign getter's LOCAL name is tracked downstream ----------
# `foreignGetters.push(local)` is what makes the ALIASED name a source for the rest
# of the file. Without it the destructure is still reported and every later use of
# the alias goes silent, which is the half that matters for a renamed import.
fixture foreign_alias "const { FILE: F } = require('./limits');
const P = path.join(F, 'x');"
fa=$(node "$TOOL" "$T/foreign_alias.js" 2>&1 | grep -c 'resolves a root at require time')
if [ "$fa" -ge 2 ]; then ok "a foreign getter's local alias is tracked downstream ($fa)"
else bad "the alias registration is unguarded: downstream use went silent" "$fa findings, want >= 2"; fi

# ---- arm 79: a file that cannot be READ is reported, not crashed on -------
# The pre-pass used to `continue` on a read failure and the scan loop then re-read
# the same file with no guard, so the tool died with an uncaught stack rather than
# the named error main() produces. A file we cannot open is exactly what the
# UNREADABLE report is for: a clean result for it means "I could not look".
# ⚠️ NAMED SKIP rather than a silent pass: a context that can still read a mode-000
# file (root, or a filesystem ignoring the bit) cannot exercise this, and an arm that
# quietly passes there would assert coverage it does not have.
fixture unreadable_io "const os = require('os');
const HOME = os.homedir();"
chmod 000 "$T/unreadable_io.js" 2>/dev/null || true
if cat "$T/unreadable_io.js" >/dev/null 2>&1; then
  ok "SKIPPED: this context can read a mode-000 file, so the IO path is unexercisable here"
else
  io_out=$(node "$TOOL" "$T/unreadable_io.js" 2>&1); io_rc=$?
  if printf '%s' "$io_out" | grep -qE 'ReferenceError|TypeError|^    at '; then
    bad "an unreadable file crashed the tool" "rc=$io_rc"
  elif printf '%s' "$io_out" | grep -q '^UNREADABLE'; then
    ok "an unreadable file is reported as UNREADABLE rather than crashing"
  else
    bad "an unreadable file was neither reported nor crashed on" "rc=$io_rc: $(printf '%s' "$io_out" | head -1)"
  fi
fi
chmod 644 "$T/unreadable_io.js" 2>/dev/null || true

# ---- arm 80: both destructure arms NAME an alias the same way ------------
# The store arm printed `{ ROOT }` for `const { ROOT: R } = store` while the foreign
# arm printed `{ FILE: F }` for the same shape. A reader who greps the named file for
# `{ ROOT }` finds nothing. Display only: the store arm still MATCHES on the source
# name, which is a deliberate decision documented at that loop.
fixture alias_store "const store = require('./store');
const { ROOT: R } = store;
const P = path.join(R, 'x');"
fixture alias_foreign "const { FILE: F } = require('./limits');
const P = path.join(F, 'x');"
as=$(node "$TOOL" "$T/alias_store.js" 2>&1 | grep -c '{ ROOT: R }')
af=$(node "$TOOL" "$T/alias_foreign.js" 2>&1 | grep -c '{ FILE: F }')
if [ "$as" = "1" ] && [ "$af" = "1" ]; then ok "both destructure arms report an alias as source: local"
else bad "the two destructure arms name an alias differently" "store=$as foreign=$af, want 1 and 1"; fi

# ---- arm 81: the STORE alias is a source downstream ----------------------
# The mirror of the foreign-alias arm, and it was missing. Dropping `aliases` from
# SRC_SOURCES left the whole suite green AND the enforced scope clean, while the
# downstream use of a destructured getter went unreported. Of every unguarded rule
# found this round it was the only one failing in the SILENT direction, which this
# file argues is the worse one.
fixture store_alias_src "const store = require('./store');
const { ROOT } = store;
const P = path.join(ROOT, 'x');"
sa=$(node "$TOOL" "$T/store_alias_src.js" 2>&1 | grep -c 'resolves a root at require time')
if [ "$sa" -ge 2 ]; then ok "a store alias is a source for later lines ($sa)"
else bad "the store alias registration is unguarded: downstream use went silent" "$sa findings, want >= 2"; fi

# ---- arm 82: the resolver-CALL match is word-bounded ----------------------
# Two more members of the word-boundary family, both unguarded. A resolver named
# `dir` plus the ubiquitous `path.dirname` makes a substring match fire on correct
# code; the enforced scope goes red with two false positives, but a red scope is a
# backstop and not an arm, and it names nothing.
fixture callword "const store = require('./store');
const dir = () => path.join(store.ROOT, 'x');
const NAME = path.dirname('/a/b/c');"
cw=$(node "$TOOL" "$T/callword.js" 2>&1 | grep -c 'const NAME')
if [ "$cw" = "0" ]; then ok "path.dirname does not count as a call to a resolver named dir"
else bad "the resolver-call match is not word-bounded" "$cw hits on const NAME"; fi
# ⚠️ TWO CALL SITES, AND THE FIXTURE ABOVE ONLY REACHES ONE. The identical regex
# lives in the declaration scan AND in functionNamesReaching's closure round, and
# mutating the second left the arm above green. A second fixture, where the decoy is
# itself a HELPER whose body carries the substring, is what reaches the closure.
fixture callword_closure "const store = require('./store');
const dir = () => path.join(store.ROOT, 'x');
const NAME = () => path.dirname('/a/b');
const A = NAME();"
cwc=$(node "$TOOL" "$T/callword_closure.js" 2>&1 | grep -c 'const A')
if [ "$cwc" = "0" ]; then ok "a helper whose body merely CONTAINS a resolver name is not a resolver"
else bad "the closure-round call match is not word-bounded" "$cwc hits on const A"; fi

# ---- arm 83: the COLUMN-ZERO brace ends a function body ------------------
# The four body terminators are: the one-line break, the 400-line cap, the column-0
# `}`, and the arrow `;` at depth zero. The first two have arms; these two did not.
# Removing the column-0 break reds the enforced scope with a 501-line capture.
fixture col0_break "const store = require('./store');
function helper() {
  return 1;
}
function other() {
  return path.join(store.ROOT, 'x');
}
const A = helper();"
cb=$(node "$TOOL" "$T/col0_break.js" 2>&1 | grep -c 'const A')
if [ "$cb" = "0" ]; then ok "a function body ends at its column-zero brace, not at the next function"
else bad "the column-zero terminator is unguarded" "$cb hits on const A"; fi

# ---- arm 84: the ARROW semicolon at depth zero ends a body ----------------
# The fourth terminator. Without it a two-line arrow helper runs on into whatever
# follows and a later resolver is attributed to it.
fixture arrow_break "const store = require('./store');
const label = (a) =>
  String(a);
const dirFor = () => path.join(store.ROOT, 'y');
const TITLE = label('a');"
ab=$(node "$TOOL" "$T/arrow_break.js" 2>&1 | grep -c 'const TITLE')
if [ "$ab" = "0" ]; then ok "a multi-line arrow body ends at its own semicolon"
else bad "the arrow terminator is unguarded" "$ab hits on const TITLE"; fi

# ---- arm 85: capturedMarks checks its RECEIVER too ------------------------
# Its sibling capturedGetter has an arm for exactly this rule. The rule exists in
# two places and was tested in one, so removing the receiver check here survived
# both the suite and the enforced scope.
fixture marks_recv "const store = require('./store');
const TREE = { ROOT: 'a' };
const M = { dir: () => path.join(store.ROOT,'x'), head: TREE.ROOT };"
mr=$(node "$TOOL" "$T/marks_recv.js" 2>&1 | grep -c 'const M')
if [ "$mr" = "0" ]; then ok "a plain object receiver is not treated as the store in capturedMarks"
else bad "capturedMarks does not check its receiver" "$mr hits on const M"; fi

# ---- arm 86: the ALIAS destructure scan is anchored ----------------------
# The tool's own comment beside this scan lists "unanchored, it matched a destructure
# INSIDE A FUNCTION BODY" as a measured defect of THIS scan, and the existing
# anchoring arm bites the OTHER scan. A documented defect with its arm pointed at the
# sibling is how a fixed bug comes back.
fixture alias_anchor "const store = require('./store');
const TREE = { ROOT: 'a' };
function dirFor() {
  const { ROOT } = store;
  return path.join(ROOT, 'x');
}
const B = TREE.ROOT;"
aa=$(node "$TOOL" "$T/alias_anchor.js" 2>&1 | grep -c 'const B')
if [ "$aa" = "0" ]; then ok "a destructure inside a function body is not a module-level alias"
else bad "the alias destructure scan is unanchored" "$aa hits on const B"; fi

# ---- arm 87: blankStrings RECURSES into a template hole ------------------
# The passthrough had an arm; the recursion did not. Without it an expression inside
# `${...}` is treated as string text, so a mention of a root inside a template
# literal fires on correct code while the identical expression outside one is silent.
fixture tpl_recurse "const MSG = \`see \${label('store.ROOT')} here\`;"
tr=$(run tpl_recurse)
if [ "$tr" = "0" ]; then ok "a root name quoted inside a template hole is not a freeze"
else bad "blankStrings does not recurse into the hole" "verdict $tr, want 0"; fi

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
