'use strict';
/**
 * Find module-level constants that resolve a filesystem root at REQUIRE time.
 *
 * 🛑 WHY THIS EXISTS. This defect class has been found four times in one day by
 * four people, in four modules, and it is invisible in review because the code
 * looks completely ordinary:
 *
 *     const HOME = os.homedir();
 *
 * A caller that sets a sandbox seam AFTER requiring the module reads straight
 * past it. Measured instances: `accounts.list()` returned four of the
 * operator's real accounts against an empty fixture (#1419), and
 * `delete-leftover`'s TRASH() resolved to the operator's real ~/.Trash
 * (#1432) - in a module that renames files into it.
 *
 * ⭐ AND IT EXISTS BECAUSE MY TWO HAND-WRITTEN CHECKS EACH HAD A BLIND SPOT THE
 * OTHER DID NOT, AND BOTH REPORTED A CLEAN ZERO:
 *
 *   1. A check keyed on `os.homedir()` inside a const went blind the moment the
 *      fix moved `os.homedir()` behind a `homeDir()` helper. THE FIX RELOCATED
 *      THE THING THE CHECK KEYED ON, so the freeze moved up one level and the
 *      check said zero.
 *   2. A line-based scan could not see a declaration spanning lines, which hid
 *      `create.SUPPORT_DIR` (3 lines) and `subscription.CONFIG` (2 lines).
 *
 * ⇒ So this follows INDIRECTION and does not assume one line. It walks the
 * resolver helpers first, then flags any const that reaches one of them.
 */
const fs = require('node:fs');
const path = require('node:path');

/* The roots that matter: anything that can name a real place on the operator's
   machine. Deliberately a list rather than a regex over `os.*`, because the
   point is which VALUES are dangerous, not which API produced them. */
/* 🛑 `store.ROOT` BELONGS HERE AND ITS ABSENCE MADE THIS GUARD BLIND TO THE
   CLASS IT IS NAMED FOR. #1512 made store.ROOT resolve per call, and the note
   below claimed that removing its debt entry "is what makes the fix enforced".
   It did not: store.ROOT was never a SOURCE, so this guard could only ever fail
   on a module freezing os.homedir(). Measured on main before this change, with
   store.ROOT added: 27 findings across 23 engine modules, every one of them
   invisible while the guard reported clean and printed nothing.
   📌 That pair read "29 findings across 21 modules" until a reviewer could not
   reproduce it. Re-measured three ways against `git archive origin/main engine`:
   27 findings, 23 modules, in every configuration constructible. The argument is
   unaffected (the guard was blind to the class it is named for); only the figures
   were stale, and a figure nobody can reproduce is what makes a reader distrust
   the ones that ARE right.

   `store.ROOT` is a getter. Capturing it into a module-level const evaluates it
   ONCE at require time and throws the laziness away, which is the same freeze in
   a new place. `AGENT_WORKFORCE_DATA` is here for the same reason: the common
   shape was `const BASE = process.env.AGENT_WORKFORCE_DATA || store.ROOT`. */
/* 🛑 ALL THREE VALUE GETTERS, NOT JUST ROOT. `store.js` defines ROOT, AVATARS and
   PROFILES with one `defineProperty` loop, and the GETTERS list further down this
   file already names all three -- so listing only ROOT here made the tool
   INTERNALLY INCONSISTENT: it knew AVATARS was a getter when checking
   destructuring, and did not know it when checking freezes. Measured, both arms:
   `const PICS = path.join(store.AVATARS, 'pics')` exited 0 (blind) while the
   identical line on store.ROOT exited 1. `store.PROFILES` is live in
   engine/register.js:73, so this was a reachable shape rather than a hypothetical. */
/* The three VALUE getters store.js defines, in ONE place. This literal used to be
   written out three times in this file, which is the exact divergence the SOURCES
   note above describes, reintroduced within one file. */
const GETTER_VALUE_NAMES = ['ROOT', 'AVATARS', 'PROFILES'];
const SOURCES = ['os.homedir()', 'os.tmpdir()', 'store.ROOT', 'store.AVATARS',
  'store.PROFILES', 'process.env.AGENT_WORKFORCE_DATA'];

/* 🛑 WHAT THIS TOOL CANNOT SEE, STATED HERE BECAUSE AN EMPTY DEBT LIST READS AS
   FULL COVERAGE AND THIS TOOL DOES NOT HAVE IT.
   `declarations()` anchors to column 0, so it finds MODULE-LEVEL declarations
   only. A root frozen inside a FACTORY BODY is invisible to it, and that is not
   hypothetical: engine/tokendoor.js held
       function makeTokenDoor(spec) { const FILE = path.join(DIR, spec.envVar); ... }
   and `makeTokenDoor` is CALLED AT REQUIRE TIME by engine/tokendoors.js, so all
   18 doors froze a path to the SECRETS directory. Measured then: door.FILE ->
   <REAL>/secrets/env/DISCORD_BOT_TOKEN while the seam said sandbox. A late-seam
   test would have deleted an operator's real API token and passed.

   ⚠️ IT IS NOT FIXED BY SCANNING INDENTED CONSTS. A const inside a function body
   is evaluated when that function is CALLED, so it is lazy BY CONSTRUCTION unless
   the function itself runs at require time. Telling those apart needs call-graph
   analysis; a naive indented scan would flag every correct per-call resolver this
   card exists to promote, and a guard that fires on correct code gets excused by
   name until the debt list is decoration.

   📌 TWO GAPS THAT USED TO BELONG IN THIS LIST ARE NOW CLOSED, recorded so the
   list stays a debt list rather than a museum: the store bound under a local name
   other than `store` is now tracked (the store-alias arm), and the walk now recurses,
   so an `engine/<subdir>/*.js` cannot be skipped in silence. Both were reachable
   shapes that happened not to occur in the tree, which is the only reason nobody
   had met them.

   🛑 AND A SCOPE ASYMMETRY, because "two instruments" is only true where BOTH run.
   The static guard runs on `engine server.js`; the behavioural probe in
   engine.lateseam-1443.test.js walks `engine/` only, because loading `server.js` in
   a child process would start a real server. So server.js is covered by ONE
   instrument, and it is this one, whose factory-body gap below is open. Stated here
   rather than left for a reader to infer from two files.

   ⇒ The blind spot is REAL, is NOT closed, and is covered instead by the
   behavioural probe in engine.lateseam-1443.test.js, which loads each module and
   inspects resolved values rather than source text. Two instruments with
   different blind spots; neither alone is coverage. The tokendoor freeze sat in
   the OVERLAP of both and was found by hand. */

/* 🛑 KNOWN DEBT, NAMED AND PRINTED, NEVER SILENTLY SKIPPED.
   An allowlist that hides its entries becomes invisible coverage, which is the
   defect this whole class is about. So every entry is printed on every run and
   the list is meant to shrink to nothing.

   ✅ `engine/store.js:ROOT` WAS THE ORIGINAL ENTRY AND IT IS GONE (#1443, fixed).
   Removed rather than kept with a "fixed" note: an allowlist that carries
   resolved entries stops being a debt list and becomes decoration.
   ⚠️ AND REMOVING IT IS WHAT MAKES THE FIX ENFORCED. While the entry stood,
   re-freezing that root would have been SKIPPED BY NAME. Now it fails here.

   📌 `server.js:GATE_LOG` is the one entry, and it is DELIBERATE rather than debt
   to pay down. The install gate's request log must OUTLIVE the sandbox the gate
   deletes on exit, so it resolves `os.homedir()` on purpose and writes outside
   the seam. It is also inert unless KOSMOS_INSTALL_GATE=1 or the log path is set.
   It is listed here rather than left unenforced because the alternative was
   running the guard on `engine/` only, which confined the check to one directory
   while server.js is this file's own example of the largest store.ROOT consumer. */
const KNOWN = new Map([
  ['server.js:GATE_LOG',
    'deliberate: the install-gate request log must outlive the sandbox the gate deletes on exit, '
    + 'so it resolves os.homedir() on purpose; inert unless KOSMOS_INSTALL_GATE=1'],
]);

/* A declaration that is an arrow function is LAZY and fine: `const T = () => …`
   resolves per call. This is the distinction the whole check turns on. */
/* One pass per line, outside string literals: strip a trailing `//` comment AND
   report the net bracket delta. Both answers need the same quote tracking, so
   they are produced together rather than by two regexes that could disagree. */
const lineInfo = (t) => {
  const str = String(t);
  let quote = null;
  let delta = 0;
  for (let i = 0; i < str.length; i += 1) {
    const c = str[i];
    if (quote) {
      if (c === '\\') { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '/' && str[i + 1] === '/') return { code: str.slice(0, i), delta };
    if (c === '{' || c === '(' || c === '[') delta += 1;
    else if (c === '}' || c === ')' || c === ']') delta -= 1;
  }
  return { code: str, delta };
};

/* 🛑 AN IMMEDIATELY-INVOKED FUNCTION IS NOT LAZY, AND THIS TEST RAN FIRST SO IT
   SHORT-CIRCUITED THE RULE THAT ALREADY KNEW BETTER. Measured, with a passing
   control:
     const FILE = (() => path.join(store.ROOT, 'x'))();  -> exited 0  (a REAL freeze)
     const FILE = path.join(store.ROOT, 'x');            -> exited 1
   The leading `(() =>` satisfied the arrow test, so the whole initializer was
   called deferred and `everyRootIsDeferred` never got to apply its "an arrow
   passed to a call runs NOW" rule. Same defect as that one, a layer earlier.
   The tell is a call applied to the closing paren of a function expression. */
const invokedNow = (init) => /\)\s*\(\s*[^)]*\)\s*;?\s*$/.test(String(init))
  && /=>|function\b/.test(String(init));
/* 🛑 COMMENT-BLANKED SOURCE FOR THE SCANS THAT MATCH PROSE. The destructure scan
   had no comment awareness and the proof was this file: `node check-frozen-roots.js
   tools` exited 1, and three of its findings were SENTENCES inside these very block
   comments, where `const { ROOT } = store` appears as documentation. Any engine
   module that DOCUMENTS the frozen shape would red CI, and every module on this
   branch carries long explanatory comments. Blanks comment bodies while preserving
   every newline and the file's length, so reported line numbers stay true. */
const blankComments = (src) => {
  let out = '';
  let mode = null; // 'line' | 'block' | 'sq' | 'dq' | 'tpl'
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === 'line') { if (c === '\n') { mode = null; out += c; } else out += ' '; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = null; out += '  '; i += 1; } else out += (c === '\n' ? c : ' '); continue; }
    if (mode) { // inside a string: copy verbatim, honour escapes
      out += c;
      if (c === '\\') { if (i + 1 < src.length) { out += src[i + 1]; i += 1; } continue; }
      if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) mode = null;
      continue;
    }
    if (c === '/' && n === '/') { mode = 'line'; out += '  '; i += 1; continue; }
    if (c === '/' && n === '*') { mode = 'block'; out += '  '; i += 1; continue; }
    if (c === "'") { mode = 'sq'; out += c; continue; }
    if (c === '"') { mode = 'dq'; out += c; continue; }
    if (c === '`') { mode = 'tpl'; out += c; continue; }
    out += c;
  }
  return out;
};

/* Blank the CONTENTS of string literals, keeping the quotes and the length, so a
   substring test sees code only. Pairs with blankComments above. */
const blankStrings = (src) => {
  let out = '';
  let q = null;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (q) {
      if (c === '\\') { out += '  '; i += 1; continue; }
      if (c === q) { q = null; out += c; continue; }
      /* 🛑 `${...}` INSIDE A TEMPLATE IS CODE, NOT STRING DATA. Blanking it made
         every source class silent behind a backtick, including the one this file's
         own header is about. Measured, each against a passing control:
           const F = `${store.ROOT}/messages.jsonl`   -> exited 0
           const HOME = `${os.homedir()}/Library`     -> exited 0
           const F = `${dirp()}/x`                    -> exited 0  (via a resolver)
           const F = `${limits.FILE}.tmp`             -> exited 0  (captured getter)
         Copied through verbatim, with brace depth tracked so a nested object or a
         nested template inside the hole does not end it early. */
      if (q === '`' && c === '$' && src[i + 1] === '{') {
        let depth = 0;
        let j = i;
        for (; j < src.length; j += 1) {
          const d = src[j];
          if (d === '{') depth += 1;
          else if (d === '}') { depth -= 1; if (depth === 0) break; }
        }
        out += src.slice(i, j + 1);
        i = j;
        continue;
      }
      out += (c === '\n' ? c : ' ');
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { q = c; out += c; continue; }
    out += c;
  }
  return out;
};

const isLazy = (init) => !invokedNow(init)
  && (/^\s*(\(\s*\)|\([^)]*\))\s*=>/.test(init) || /^\s*function\b/.test(init));

/* A CONTAINER whose every root reference already sits inside an arrow is lazy too,
   and the check above cannot see that: it asks whether the WHOLE initializer is a
   function. `engine/forget.js:KINDS` is an array of
   `{ dir: () => path.join(store.ROOT, ...) }`, which defers correctly and was
   still reported. A guard that fires on correct code is worse than one that
   misses, because the cheapest way out is to excuse it by name, and then the debt
   list is decoration.

   ⚠️ Line-wise, and the limit is real: a root reference on a different line from
   its `=>` still counts as frozen. That direction fails toward REPORTING.

   🛑 AND THE ORIGINAL VERSION OF THIS NOTE CLAIMED THAT WAS THE ONLY DIRECTION IT
   COULD FAIL, WHICH WAS FALSE. It used `SOURCES.some`, so a single deferred
   reference on a line exempted the whole line and laundered a frozen source
   sitting beside it: that shape failed toward SILENCE, which is the direction
   this guard exists to prevent. A stated safety property is worth nothing until
   somebody constructs the case it forbids, and a reviewer did. */
const everyRootIsDeferred = (init, resolverNames, sources) => {
  /* 🛑 RESOLVER CALLS ARE OCCURRENCES TOO. This ran BEFORE the viaHelper test and
     only inspected lines carrying a LITERAL source, so a line whose freeze is
     `path.join(base(), 'b')` was never examined and the exemption skipped the
     resolver check entirely. Adding CORRECT lazy code beside a freeze hid it. */
  const marks = (sources || SOURCES).concat([...(resolverNames || [])].map((n) => n + '('));
  const lines = init.split('\n').filter((l) => marks.some((s) => l.includes(s)));
  /* EVERY source on the line, not SOME. With `some`, one deferred source LAUNDERS
     a frozen one beside it. Measured, both arms:
       { live: () => store.ROOT, file: path.join(process.env.AGENT_WORKFORCE_DATA,'x') }  -> silent
       {                         file: path.join(process.env.AGENT_WORKFORCE_DATA,'x') }  -> reported
     so adding a harmless deferred reference hid a real freeze. */
  return lines.length > 0 && lines.every((l) => marks.filter((s) => l.includes(s))
    .every((s) => {
      /* 🛑 EVERY OCCURRENCE, NOT THE FIRST. `indexOf` examines only the first
         appearance of each source on the line, so a SECOND appearance of the same
         source was never checked:
           [{ dir: () => path.join(store.ROOT,'a') }, { dir: path.join(store.ROOT,'b') }]
         the first is deferred, the second is frozen, and the line was silent.
         Same class as the some/every fix one level down: that moved from "some
         SOURCES" to "every SOURCE", and left "every OCCURRENCE". */
      const positions = [];
      for (let at = l.indexOf(s); at > -1; at = l.indexOf(s, at + 1)) positions.push(at);
      if (!positions.length) return false;
      return positions.every((at) => {
        const arrow = l.lastIndexOf('=>', at);
        if (arrow < 0) return false;
      /* 🛑 THE ARROW MUST SCOPE THIS SOURCE, and my first two attempts did not
         check that. `lastIndexOf('=>')` finds ANY earlier arrow on the line,
         including one belonging to a DIFFERENT member, so
           { live: () => store.ROOT, file: path.join(process.env.AGENT_WORKFORCE_DATA,'x') }
         exempted the frozen half on the strength of the lazy half's arrow. A
         comma between the arrow and the source means they belong to different
         members, so the arrow does not defer this one. */
      /* 🛑 ONLY A COMMA AT DEPTH ZERO SEPARATES MEMBERS. The first version of
         this asked whether ANY comma sat between the arrow and the source, which
         also matched the arrow's OWN call:
           () => path.join(BASE, store.ROOT)   <- correct code, REPORTED as frozen
         The comma there is inside parentheses opened after the arrow, so it is an
         argument separator, not a member separator. Measured, both arms, after
         this change: the line above is silent, and the laundering shape
           { live: () => store.ROOT, file: path.join(process.env.AGENT_WORKFORCE_DATA,'x') }
         is still REPORTED, because ITS comma is at depth zero.
         ⚠️ Depth is clamped at zero: a member that CLOSES its own call before the
         next source (`{ live: () => f(store.ROOT), file: ... }`) returns to depth
         zero and the following comma still separates, which is the safe direction. */
        const between = l.slice(arrow, at);
        let depth = 0;
        for (const ch of between) {
          if (ch === '(' || ch === '[' || ch === '{') depth += 1;
          else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
          else if (ch === ',' && depth <= 0) return false;
        }
        /* 🛑 AN ARROW IS NOT AUTOMATICALLY A DEFERRAL. Two shapes defeated the
           comma rule above, both measured, and both in the SILENT direction:

           1. AN ARROW PASSED TO A CALL RUNS NOW.
                const PATHS = NAMES.map((n) => path.join(store.ROOT, n));
              is a real require-time freeze, and it exited 0 while the identical
              logic written with `function (n)` exited 1. `.map`, `.forEach` and
              friends invoke immediately; only a STORED arrow defers.

           2. AN ARROW WHOSE SCOPE ALREADY CLOSED NEVER COVERED THE SOURCE.
                const FILE = ['a'].map((x) => x).concat(path.join(store.ROOT,'y'));
              exited 0, while the same line without the `.map((x) => x)` exited 1.
              So adding an UNRELATED arrow laundered a freeze, which is exactly the
              some/every defect one level further out.

           So: reject when the arrow is an argument to a call opened before it, and
           reject when bracket depth falls below the arrow's own depth before the
           source is reached. */
        const stack = [];
        let armDepth = -1;
        for (let i = 0; i < l.length; i += 1) {
          const c = l[i];
          if (c === '(' || c === '[' || c === '{') {
            let k = i - 1;
            while (k >= 0 && /\s/.test(l[k])) k -= 1;
            stack.push({ open: i, isCall: c === '(' && k >= 0 && /[A-Za-z0-9_$)\]]/.test(l[k]) });
          } else if (c === ')' || c === ']' || c === '}') {
            stack.pop();
          }
          if (i === arrow) {
            const encl = stack[stack.length - 1];
            if (encl && encl.isCall && encl.open < arrow) return false;
            armDepth = stack.length;
          }
          if (armDepth >= 0 && i > arrow && i <= at && stack.length < armDepth) return false;
        }
        return true;
      });
    }));
};

/* 🛑 THE WHOLE FAMILY READS COMMENT-BLANKED SOURCE, and this function and
   `functionNamesReaching` were the two that did not. Four scans blanked, two split
   raw `src`: the siblings were the spec, the omission was ABSENT rather than wrong,
   and no test could assert on a line that is not there.
   What it permitted, measured, both arms:
     a declaration inside a multi-line block comment, content at column 0, was
     REPORTED as a freeze; and a resolver defined only inside a comment registered
     as a real resolver, so a later line was blamed "via a resolver helper".
   Commented-out code is not code. Blanking preserves every newline, so the line
   numbers this returns stay true. */
function declarations(rawSrc) {
  const src = blankComments(rawSrc);
  /* Multi-line aware, and LINEAR rather than a regex.
     🛑 The first version of this used /^const NAME =((?:[^;]|\n)*?);\s*$/m and
     HUNG for over two minutes on create.js. `[^;]` already matches a newline,
     so `(?:[^;]|\n)` gives the engine an ambiguous choice at every character
     and it backtracks exponentially. A checker that never returns is worse
     than the defect it looks for, so this walks lines instead. */
  const lines = src.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    /* 🛑 `let`, `var` AND `exports.X =` TOO. The scan matched `const` only, so
       `let DIR = path.join(store.ROOT, 'x')` and `exports.DIR = ...` froze a root
       in silence while the identical `const` was reported. A guard that depends on
       which keyword somebody typed is not checking the property it names. */
    /* 🛑 `\s+` AND `\s*=`, NOT LITERAL SINGLE SPACES. This required exactly one
       space after the keyword and one before the `=`, so `const DIR=path.join(
       store.ROOT,'x')` exited 0 while the spaced form exited 1. A guard that
       depends on somebody's spacing is not checking the property it names, which
       is the same sentence as the keyword note above it. */
    const m = /^(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(lines[i])
      || /^exports\.([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(lines[i])
      || /^module\.exports\.([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(lines[i]);
    if (!m) continue;
    let init = m[2];
    let j = i;
    /* Continue while the declaration has not been terminated. A cap keeps a
       missing semicolon from swallowing the rest of the file. */
    /* 🛑 THE TERMINATOR TEST IGNORES A TRAILING LINE COMMENT. `let fetcher = null;
       // test seam` does not END with `;`, so the capture ran on and swallowed ten
       more lines including a resolver call, reporting a mutable test seam as a
       frozen root. Three false positives appeared the moment `let` was accepted,
       and a guard that fires on correct code teaches people to excuse it.
       Comments are stripped for the TERMINATOR TEST ONLY, never from the captured
       text.

       🛑 AND THE STRIP MUST KNOW ABOUT STRINGS. This previously read
       `.replace(/\/\/[^\n]*$/, '')`, and an earlier version of this very comment
       claimed "a `//` inside a string cannot corrupt what is scanned". It can:
       `const U = 'https://example.com/a';` was cut at the `//` inside the URL, so
       the line no longer ended in `;`, the capture ran on for up to 12 more lines,
       and a following freeze was attributed to `U` at the WRONG LINE. Measured: a
       URL line followed by `const FROZEN = path.join(store.ROOT, 'x')` reported
       TWO findings, the first of them false. Nine such run-on lines exist in
       engine/ today (cloudflare.js, githubdevice.js, notify.js, ping.js,
       remote.js, update.js); they were inert only because the lines they swallowed
       happened to carry no source.
       ⚠️ Known limit, stated rather than implied: a `//` inside a REGEX literal is
       still treated as a comment. That shape does not occur in a module-level
       declaration here, and the failure direction is a run-on capture, which
       over-reports rather than going silent. */
    /* 🛑 DEPTH, NOT JUST A SEMICOLON. The terminator was `ends(line)` alone, so a
       BLOCK-BODIED resolver stopped at its first interior statement:
         const dir = () => {
           const seg = 'liveness';        <- ends in ';', capture stopped HERE
           return path.join(store.ROOT, seg);
         };
       The captured text then held no source, so `dir` was never recognised as a
       resolver and every downstream `path.join(dir(), ...)` went SILENT. Measured,
       both arms: the block form exited 0 while the single-expression form of the
       same code exited 1. A declaration is only terminated when a `;` appears at
       bracket depth zero. */
    let depth = lineInfo(lines[i]).delta;
    const terminated = (t) => /;\s*$/.test(lineInfo(t).code);
    while (!(depth <= 0 && terminated(lines[j])) && j - i < 12 && j + 1 < lines.length) {
      j += 1;
      init += '\n' + lines[j];
      depth += lineInfo(lines[j]).delta;
    }
    /* The KEYWORD as matched, so the report cannot print `const FILE` for a line
       that says `exports.FILE` or `let FILE`. Raised in two consecutive reviews:
       a reader who greps the named file for `const FILE` finds nothing. */
    const kw = /^exports\./.test(lines[i]) ? 'exports.'
      : (/^module\.exports\./.test(lines[i]) ? 'module.exports.'
        : (/^(const|let|var)\b/.exec(lines[i]) || [null, 'const'])[1] + ' ');
    out.push({ name: m[1], init, line: i + 1, kw });
  }
  return out;
}

function functionNamesReaching(rawSrc, sources) {
  /* Comment-blanked, for the same reason as `declarations` above: a resolver that
     exists only inside a comment is not a resolver. */
  const src = blankComments(rawSrc);
  /* One pass of transitive closure: a function whose body mentions a raw source
     is a resolver, and so is one that calls a resolver. Two rounds is enough
     for the shapes here and the tool says so rather than pretending to be a
     compiler. */
  /* Also linear: find each `function NAME(` line and take its body as the
     lines up to the next line that is exactly `}`. Two rounds so a helper that
     calls a resolver is itself recognised as one. */
  const lines = src.split('\n');
  const bodies = [];
  for (let i = 0; i < lines.length; i += 1) {
    /* 🛑 ARROW RESOLVERS TOO, AND WITHOUT THIS THE GUARD WAS BLIND TO THE
   CODEBASE'S OWN CONVENTION. #1443 converted 22 modules to exactly
   `const dir = () => path.join(store.ROOT, ...)`, and this scan saw only
   `function NAME(`, so `const X = path.join(dir(), 'x')` was invisible:
   planted in engine/liveness.js it produced rc=0 and named nothing.

   That is this file's own header failure recurring one syntax down. The header
   says the guard exists because a check keyed on os.homedir() went blind the
   moment the fix moved it behind a homeDir() helper. The fix moved again, to an
   arrow, and the guard went blind again. */
    /* 🛑 THE SAME KEYWORD SET AS `declarations()`, AND FOR THE SAME REASON. This
       branch matched `const` only while `declarations()` accepts const/let/var and
       the exports forms, so the two halves of one idea disagreed and BOTH failed
       toward silence. Measured, with a passing control on the const form: `let
       dirp = () => path.join(store.ROOT,'x')` exited 0, and so did
       `const dirp = async () => ...`. An async resolver is still a resolver: the
       freeze is the CAPTURE at require time, not what the function returns. */
    /* One `function` alternative, not two: the plain form is a strict subset of the
       async-optional one and could never match anything it does not. */
    const m = /^\s*(?:async\s+)?function ([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(lines[i])
      || /^\s*(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_][A-Za-z0-9_]*)\s*=>/.exec(lines[i]);
    if (!m) continue;
    const buf = [];
    let adepth = 0;
    for (let j = i; j < lines.length && j - i < 400; j += 1) {
      buf.push(lines[j]);
      adepth += lineInfo(lines[j]).delta;
      if (j > i && /^\}/.test(lines[j])) break;
      /* An arrow assigned to a const ends at its own `;`, not at a column-0 `}`.
         Without this its body ran on to the next function and swept in references
         belonging to somebody else.
         🛑 AT BRACKET DEPTH ZERO, or a BLOCK-BODIED arrow stops at its first
         interior statement and its body never reaches the source:
           const dir = () => {
             const seg = 'liveness';       <- ends in ';', body stopped HERE
             return path.join(store.ROOT, seg);
           };
         `dir` was then not a resolver, so every `path.join(dir(), ...)` downstream
         went SILENT. Measured, both arms: block form rc=0, single-expression form
         rc=1 on identical logic. Same defect as the one in `declarations()`, in a
         second loop, which is why both now share `lineInfo`. */
      if (j > i && /=>/.test(lines[i]) && adepth <= 0 && /;\s*$/.test(lineInfo(lines[j]).code)) break;
    }
    bodies.push([m[1], buf.join('\n')]);
  }
  const names = new Set();
  for (let round = 0; round < 2; round += 1) {
    for (const [name, body] of bodies) {
      const reaches = sources.some((s) => body.includes(s))
        || [...names].some((n) => new RegExp(`\\b${n}\\s*\\(`).test(body));
      if (reaches) names.add(name);
    }
  }
  return names;
}

function scan(file) {
  const src = fs.readFileSync(file, 'utf8');
  /* 🛑 A NAME BOUND OUT OF THE STORE IS THE SAME ROOT UNDER ANOTHER SPELLING, AND
     `const { ROOT } = store;` DEFEATED ALL THREE INSTRUMENTS AT ONCE. The
     destructuring never became a declaration here, the consuming line
     `path.join(ROOT, 'x')` carries no literal source and calls no known resolver,
     and the behavioural probe cannot see a module-internal value. Proved a real
     freeze in engine/messages.js, which is the worst case in tree because it
     exports LOG and SEEN but NOT spillDir, so the probe is structurally blind.
     Every destructured name becomes a source for the rest of this file. */
  /* 🛑 ONLY THE VALUE GETTERS, and ANCHORED, and on COMMENT-BLANKED source. Three
     defects in one scan, each measured with a passing control:
       - it collected EVERY destructured name, so `const { safeKey } = require('./store')`
         made `safeKey` a bare substring source and `const K = safeKey('kosmos')`
         was reported as freezing a root it never touches. The narrower arm below
         already filtered to GETTERS; this one did not, which is the same
         internal-inconsistency defect as SOURCES-vs-GETTERS.
       - unanchored, it matched a destructure INSIDE A FUNCTION BODY, which is lazy
         by construction and is the per-call shape this card promotes.
       - unblanked, it matched the shape written in PROSE in a comment. */
  const scanSrc = blankComments(src);
  const aliases = [];
  for (const m of scanSrc.matchAll(/^(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:store|require\([^)]*store[^)]*\))/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().trim();
      if (GETTER_VALUE_NAMES.includes(name)) aliases.push(name);
    }
  }
  /* 🛑 THE STORE UNDER ANY LOCAL NAME. Every source in SOURCES is spelled
     `store.X`, so the guard was keyed on somebody's choice of variable name:
     `const st = require('./store'); path.join(st.ROOT,'x')` exited 0 while the
     identical code using `store` exited 1. Every engine module happens to import
     it as `store` today, which is exactly why this went unnoticed. */
  const storeLocals = [];
  for (const m of scanSrc.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\([^)]*store[^)]*\)/g)) {
    if (m[1] !== 'store') storeLocals.push(m[1]);
  }
  const GETTER_NAMES = GETTER_VALUE_NAMES;
  const localSources = storeLocals.flatMap((n) => GETTER_NAMES.map((g) => `${n}.${g}`));
  const SRC_SOURCES = SOURCES.concat(aliases, localSources);
  /* 🛑 THE DESTRUCTURING IS ITSELF THE FREEZE, AND MARKING ITS USES WAS NOT
     ENOUGH. `const { ROOT } = store` captures the getter's VALUE at require
     time, so a later `const d = () => path.join(ROOT, 'x')` looks lazy and is
     not: the arrow defers the join, never the root. Measured in engine/messages.js,
     where `isLazy` correctly exempted the arrow and the freeze one line above it
     went unreported. Only the value getters count; destructuring a FUNCTION like
     `dataRootFor` freezes nothing. */
  const GETTERS = GETTER_VALUE_NAMES;
  const destructured = [];
  /* 🛑 WHOLE-SOURCE `matchAll`, NOT A PER-LINE SCAN, AND THE REASON IS THAT THE
     ALIAS SCAN ABOVE ALREADY IS ONE. This was `src.split('\n').forEach` with a
     `^`-anchored regex, so the two halves of the same idea disagreed: a destructure
     wrapped across lines
       const {
         ROOT,
       } = require('./store');
     registered as an ALIAS (so `ROOT` became a source) but not as a FREEZE, and
     with every use inside an arrow nothing was reported at all. Measured, both
     arms: the wrapped form exited 0 while the identical single-line form exited 1.
     That is the exact `engine/messages.js` shape the note above calls the one that
     defeated all three instruments at once. */
  for (const dm of scanSrc.matchAll(/^(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:store|require\([^)]*store[^)]*\))/gm)) {
    const names = dm[1].split(',').map((x) => x.split(':')[0].trim()).filter(Boolean);
    const frozen = names.filter((x) => GETTERS.includes(x));
    if (!frozen.length) continue;
    const line = src.slice(0, dm.index).split('\n').length;
    const spanned = dm[0].split('\n').length;
    destructured.push({ name: '{ ' + frozen.join(', ') + ' }', line, how: 'destructured out of store at require time', lines: spanned });
  }
  /* 🛑 THE FOURTH RELOCATION. This file's header says the guard exists because a
     check keyed on `os.homedir()` went blind when the fix moved behind a helper.
     It moved again to an arrow, again to a resolver, and #1443 has now created
     ~23 NEW lazy getters (`limits.FILE`, `tokendoor.DIR`, `messages.LOG`, ...).
     Capturing one of THOSE at module level re-freezes the root exactly as
     capturing `store.ROOT` does, and the guard could not see it. Measured, with a
     passing control: `const F = limits.FILE;` exited 0 while `const F = store.ROOT;`
     exited 1.

     ⚠️ NARROW ON PURPOSE, because a guard that fires on correct code gets excused
     by name until the debt list is decoration. It requires all three: a BARE member
     access with no call, a SCREAMING property, and a PATH-SHAPED name. That last
     condition is why `DRY_RUN` and `HOME_FOR_TEST` (real exported getters in this
     tree) are not swept in. Verified to add zero findings across every non-test
     .js in the repo before it shipped. */
  const PATH_SHAPED = /^(?:[A-Z][A-Z0-9_]*_(?:DIR|FILE|PATH)|FILE|DIR|LOG|SEEN|FLAG|ROOT|AVATARS|PROFILES)$/;
  /* 🛑 ANYWHERE IN THE INITIALIZER, NOT ONLY AS A BARE ACCESS. The first version
     of this anchored the whole initializer, so the two most natural ways to consume
     one of these getters were silent. Measured, with a passing control:
       const F = limits.FILE;                     -> rc 1
       const F = path.join(limits.FILE, 'x');     -> rc 0   <- a real freeze
       const F = limits.FILE + '.tmp';            -> rc 0   <- a real freeze
     Capturing the getter is the freeze whatever is wrapped around it. The
     PATH_SHAPED filter still carries the false-positive protection (DRY_RUN and
     HOME_FOR_TEST are real exported getters and must not be swept in), and the
     laziness check upstream still exempts a deferred use. Re-verified to add zero
     findings across every non-test .js in the repo after widening. */
  /* 🛑 THE RECEIVER MUST BE A REQUIRED MODULE. The rule constrained the PROPERTY
     name (path-shaped) and left the receiver open apart from a literal `env`, so it
     fired on any object with a path-shaped property. Measured, each against a
     passing control:
       const HEAD = tree.ROOT;    -> exited 1   (a parse tree)
       const L = levels.LOG;      -> exited 1   (a log-level map)
     The zero-findings-repo-wide claim was true and was a property of TODAY'S TREE,
     not of the rule, and CI now enforces this on server.js where a `.ROOT` or a
     `.LOG` on some local object would red the build with a message about filesystem
     roots. Restricted to names this file binds with require(). */
  const requiredLocals = new Set();
  for (const m of scanSrc.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(/g)) {
    requiredLocals.add(m[1]);
  }
  const capturedGetter = (init) => {
    for (const m of String(init).matchAll(/\b([A-Za-z_$][\w$]*)\.([A-Z][A-Z0-9_]*)\b/g)) {
      /* 🛑 NOT `process.env.X`. Widening this rule to match anywhere in the
         initializer immediately produced a FALSE POSITIVE on
           const WORKERS = process.env.KOSMOS_WORKERS_DIR || ...
         in tools/check-block-delivery.js, because the receiver matched is `env`
         and the name is path-shaped. An environment variable is not a module
         getter, and a guard that fires on correct code gets excused by name until
         the debt list is decoration. Caught by re-running the repo-wide sweep
         after widening, which is the only reason it did not ship. */
      if (m[1] === 'env') continue;
      if (!requiredLocals.has(m[1])) continue;
      if (PATH_SHAPED.test(m[2])) return m[2];
    }
    return null;
  };
  const resolvers = functionNamesReaching(src, SRC_SOURCES);
  const findings = [];
  for (const d of declarations(src)) {
    /* 🛑 `invokedNow` GATES BOTH EXEMPTIONS, not just isLazy. Putting it only in
       isLazy left the arrow form silent: in `(() => path.join(store.ROOT,'x'))()`
       the wrapper is a GROUPING paren, not a call, so `everyRootIsDeferred`
       correctly saw the arrow scoping the source and exempted it. Nothing inside an
       initializer that runs at require time can defer anything, so the question is
       settled before either exemption is asked. Measured, both arms: the IIFE forms
       exit 1, the stored arrow and stored function forms exit 0. */
    /* 🛑 NORMALISE BEFORE BLANKING, and the order is the whole fix. Both rewrites
       key on text that lives INSIDE string literals (`require('./store')` and
       `store['ROOT']`), so running them after blankStrings matched nothing: the
       first version of this did exactly that and both arms stayed silent. */
    const initCode = blankStrings(blankComments(d.init)
      .replace(/require\([^)]*store[^)]*\)\s*\./g, 'store.')
      .replace(/\[\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*\]/g, '.$1')
      .replace(/\[\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*\]/g, '.$1'));
    /* 🛑 THE SAME BLANKED TEXT AS EVERY OTHER SOURCE TEST. This exemption was handed
       the RAW initializer while `direct`, `viaHelper` and `captured` below got the
       blanked one, and it failed in BOTH directions. Measured, each against a
       passing control:
         const FILE = /* was () => * / path.join(store.ROOT,'x');   -> exited 0, SILENT
         const M = { dir: () => path.join(store.ROOT,'x') }; // note -> exited 1, on correct code
         const M = { note: 'store.ROOT', dir: () => ... };          -> exited 1, on correct code
       An arrow written in a COMMENT satisfied the arrow-scope rule for a source that
       is not deferred at all, and the engine modules on this branch all carry heavy
       inline comments, so both arms are reachable in ordinary house style. */
    if (!invokedNow(initCode)
      && (isLazy(initCode) || everyRootIsDeferred(initCode, resolvers, SRC_SOURCES))) continue;
    /* 🛑 AGAINST THE STRING-BLANKED INITIALIZER. A source name written inside a
       STRING LITERAL is data, not a freeze, and this file proved it on itself:
       `check-frozen-roots.js tools` reported its own SOURCES and KNOWN arrays,
       whose entries are the strings 'store.ROOT' and 'os.homedir()'. A real freeze
       is CODE (`path.join(store.ROOT, ...)`), so blanking string contents cannot
       hide one, and it is what makes the guard safe to point at a directory of
       tooling rather than only at engine/. */
    /* 🛑 NORMALISE TWO SPELLINGS OF THE SAME ACCESS. Both were silent, measured
       against a control that exits 1:
         const FILE = path.join(require('./store').ROOT, 'x');   -> exited 0
         const F = store['ROOT'];                                -> exited 0
       The first is neither `store.X` nor one of the named locals the storeLocals
       regex collects; the second is a bracket access, and every source in SOURCES
       is spelled with a dot. Rewriting them to the dotted form costs two replaces
       and closes both without widening what counts as a source. */
    const direct = SRC_SOURCES.some((s) => initCode.includes(s));
    /* The same blanked text for every source test, so a name written in a string
       cannot be read as code by one check after another check learned better. */
    const viaHelper = [...resolvers].some((n) => new RegExp(`\\b${n}\\s*\\(`).test(initCode));
    const captured = capturedGetter(initCode);
    if (direct || viaHelper || captured) {
      findings.push({
        name: d.name,
        line: d.line,
        kw: d.kw,
        how: direct ? 'directly' : (viaHelper ? 'via a resolver helper' : `by capturing another module's lazy getter .${captured}`),
        lines: d.init.split('\n').length,
      });
    }
  }
  return destructured.concat(findings);
}

function main(argv) {
  const targets = argv.length ? argv : [path.join(__dirname, '..', 'engine')];
  const files = [];
  for (const t of targets) {
    /* A named error, not a stack trace. A typo in the npm script's target list
       surfaced as an uncaught ENOENT, which reads as the tool being broken rather
       than the argument being wrong. */
    let st;
    try { st = fs.statSync(t); } catch {
      console.error(`check-frozen-roots: cannot read target '${t}' (no such file or directory)`);
      process.exit(2);
    }
    if (st.isDirectory()) {
      /* 🛑 RECURSIVE. `readdirSync` alone does not descend, so a future
         engine/<subdir>/*.js would be skipped in SILENCE while the run still
         printed a clean result. engine/ has no subdirectories today, which is
         precisely why nobody would notice the day it gains one. */
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
            walk(full);
          } else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) files.push(full);
        }
      };
      walk(t);
    } else files.push(t);
  }
  let total = 0;
  let known = 0;
  const matchedKnown = new Set();
  for (const f of files.sort()) {
    for (const hit of scan(f)) {
      const key = `${path.relative(path.join(__dirname, '..'), f)}:${hit.name}`;
      if (KNOWN.has(key)) {
        console.log(`KNOWN  ${key}  (${KNOWN.get(key)})`);
        matchedKnown.add(key);
        known += 1;
        continue;
      }
      total += 1;
      /* The SAME spelling as the KNOWN key above, so a reader can paste the path
         straight into the allowlist. These used to differ (repo-relative for KNOWN,
         cwd-relative for findings), so running from outside the repo printed
         `../../../../tmp/...`, which is not the string the allowlist wants. */
      console.log(`${key.split(':')[0]}:${hit.line}  ${hit.kw || 'const '}${hit.name}  resolves a root at require time (${hit.how}, ${hit.lines} line(s))`);
    }
  }
  if (known) {
    console.log(`${known} known instance(s) above are tracked debt, not new findings.`);
  }
  /* 🛑 AN ALLOWLIST ENTRY THAT MATCHES NOTHING IS THE DEFECT THIS FILE IS ABOUT.
     If GATE_LOG is later renamed or made lazy, its entry stops matching and the run
     simply prints one fewer KNOWN line: the list silently becomes decoration, which
     is the same "invisible coverage" the block at the top forbids. The list is meant
     to SHRINK TO NOTHING, and nothing could tell you when an entry had earned
     removal. Now it says so.

     ⚠️ ONLY FOR FILES THIS RUN ACTUALLY SCANNED. The first version flagged every
     unmatched entry, so ANY run over a subset (a single fixture, or `engine` alone)
     reported server.js:GATE_LOG as stale and exited 1. That took nine arms red at
     once: a check that punishes you for narrowing the target is not a debt check,
     it is a scope check wearing one's clothes. */
  const scannedRel = new Set(files.map((f) => path.relative(path.join(__dirname, '..'), f)));
  const stale = [...KNOWN.keys()]
    .filter((k) => scannedRel.has(k.split(':')[0]))
    .filter((k) => !matchedKnown.has(k));
  if (stale.length) {
    console.log('');
    for (const k of stale) console.log(`STALE  ${k}  is in KNOWN but matched nothing: remove it or fix the key`);
    console.log(`${stale.length} allowlist entr(y/ies) above match nothing. An allowlist that no longer`);
    console.log('describes the code is decoration, which is what this check exists to prevent.');
  }
  if (total) {
    console.log('');
    console.log(`${total} module-level constant(s) resolve a filesystem root at require time.`);
    console.log('A caller that sets a sandbox seam AFTER requiring the module reads past it.');
    console.log('Make it a function and call it at each site (#1432).');
  }
  /* 🛑 THE RETURN, not process.exitCode. The caller is
     `process.exit(main(argv))`, so an exitCode set inside here is DISCARDED by the
     explicit exit. The first version of the stale-entry check set process.exitCode
     and printed its STALE lines while still exiting 0, which is a report nothing
     gates on. Measured: the lines appeared, the exit was 0. */
  return (total === 0 && stale.length === 0) ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { scan, declarations, isLazy, functionNamesReaching };
