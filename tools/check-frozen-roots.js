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
   store.ROOT added: 29 findings across 21 engine modules, every one of them
   invisible while the guard reported clean and printed nothing.

   `store.ROOT` is a getter. Capturing it into a module-level const evaluates it
   ONCE at require time and throws the laziness away, which is the same freeze in
   a new place. `AGENT_WORKFORCE_DATA` is here for the same reason: the common
   shape was `const BASE = process.env.AGENT_WORKFORCE_DATA || store.ROOT`. */
const SOURCES = ['os.homedir()', 'os.tmpdir()', 'store.ROOT', 'process.env.AGENT_WORKFORCE_DATA'];

/* 🛑 KNOWN DEBT, NAMED AND PRINTED, NEVER SILENTLY SKIPPED.
   An allowlist that hides its entries becomes invisible coverage, which is the
   defect this whole class is about. So every entry is printed on every run and
   the list is meant to shrink to nothing.

   `store.ROOT` is a real instance, confirmed frozen on main. It is excluded
   from #1432 because it has 20+ consumers across server.js and four engine
   modules, so converting it is its own change with its own review, not a
   rider on a seven-module sweep. Tracked separately. */
/* ✅ `engine/store.js:ROOT` WAS THE ONE ENTRY AND IT IS GONE (#1443, fixed).
   Removed rather than kept with a "fixed" note: an allowlist that carries
   resolved entries stops being a debt list and becomes decoration, and the
   design here is that it shrinks to nothing.
   ⚠️ AND REMOVING IT IS WHAT MAKES THE FIX ENFORCED. While the entry stood,
   re-freezing that root would have been SKIPPED BY NAME. Now it fails here. */
const KNOWN = new Map([]);

/* A declaration that is an arrow function is LAZY and fine: `const T = () => …`
   resolves per call. This is the distinction the whole check turns on. */
const isLazy = (init) => /^\s*(\(\s*\)|\([^)]*\))\s*=>/.test(init) || /^\s*function\b/.test(init);

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
        return true;
      });
    }));
};

function declarations(src) {
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
    const m = /^(?:const|let|var) ([A-Za-z_][A-Za-z0-9_]*) =(.*)$/.exec(lines[i])
      || /^exports\.([A-Za-z_][A-Za-z0-9_]*) =(.*)$/.exec(lines[i])
      || /^module\.exports\.([A-Za-z_][A-Za-z0-9_]*) =(.*)$/.exec(lines[i]);
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
       text, so a `//` inside a string cannot corrupt what is scanned. */
    const ends = (t) => /;\s*$/.test(String(t).replace(/\/\/[^\n]*$/, ''));
    while (!ends(lines[j]) && j - i < 12 && j + 1 < lines.length) {
      j += 1;
      init += '\n' + lines[j];
    }
    out.push({ name: m[1], init, line: i + 1 });
  }
  return out;
}

function functionNamesReaching(src, sources) {
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
    const m = /^\s*function ([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(lines[i])
      || /^\s*const ([A-Za-z_][A-Za-z0-9_]*) = (?:\([^)]*\)|[A-Za-z_][A-Za-z0-9_]*)\s*=>/.exec(lines[i]);
    if (!m) continue;
    const buf = [];
    for (let j = i; j < lines.length && j - i < 400; j += 1) {
      buf.push(lines[j]);
      if (j > i && /^\}/.test(lines[j])) break;
      /* An arrow assigned to a const ends at its own `;`, not at a column-0 `}`.
         Without this its body ran on to the next function and swept in references
         belonging to somebody else. */
      if (j > i && /=>/.test(lines[i]) && /;\s*$/.test(lines[j])) break;
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
  const aliases = [];
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:store|require\([^)]*store[^)]*\))/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().trim();
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) aliases.push(name);
    }
  }
  const SRC_SOURCES = SOURCES.concat(aliases);
  /* 🛑 THE DESTRUCTURING IS ITSELF THE FREEZE, AND MARKING ITS USES WAS NOT
     ENOUGH. `const { ROOT } = store` captures the getter's VALUE at require
     time, so a later `const d = () => path.join(ROOT, 'x')` looks lazy and is
     not: the arrow defers the join, never the root. Measured in engine/messages.js,
     where `isLazy` correctly exempted the arrow and the freeze one line above it
     went unreported. Only the value getters count; destructuring a FUNCTION like
     `dataRootFor` freezes nothing. */
  const GETTERS = ['ROOT', 'AVATARS', 'PROFILES'];
  const destructured = [];
  src.split('\n').forEach((l, n) => {
    const dm = /^(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:store|require\([^)]*store[^)]*\))/.exec(l);
    if (!dm) return;
    const names = dm[1].split(',').map((x) => x.split(':')[0].trim()).filter(Boolean);
    const frozen = names.filter((x) => GETTERS.includes(x));
    if (frozen.length) destructured.push({ name: '{ ' + frozen.join(', ') + ' }', line: n + 1, how: 'destructured out of store at require time', lines: 1 });
  });
  const resolvers = functionNamesReaching(src, SRC_SOURCES);
  const findings = [];
  for (const d of declarations(src)) {
    if (isLazy(d.init) || everyRootIsDeferred(d.init, resolvers, SRC_SOURCES)) continue;
    const direct = SRC_SOURCES.some((s) => d.init.includes(s));
    const viaHelper = [...resolvers].some((n) => new RegExp(`\\b${n}\\s*\\(`).test(d.init));
    if (direct || viaHelper) {
      findings.push({
        name: d.name,
        line: d.line,
        how: direct ? 'directly' : 'via a resolver helper',
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
    const st = fs.statSync(t);
    if (st.isDirectory()) {
      for (const f of fs.readdirSync(t)) {
        if (f.endsWith('.js') && !f.endsWith('.test.js')) files.push(path.join(t, f));
      }
    } else files.push(t);
  }
  let total = 0;
  let known = 0;
  for (const f of files.sort()) {
    for (const hit of scan(f)) {
      const key = `${path.relative(path.join(__dirname, '..'), f)}:${hit.name}`;
      if (KNOWN.has(key)) {
        console.log(`KNOWN  ${key}  (${KNOWN.get(key)})`);
        known += 1;
        continue;
      }
      total += 1;
      console.log(`${path.relative(process.cwd(), f)}:${hit.line}  const ${hit.name}  resolves a root at require time (${hit.how}, ${hit.lines} line(s))`);
    }
  }
  if (known) {
    console.log(`${known} known instance(s) above are tracked debt, not new findings.`);
  }
  if (total) {
    console.log('');
    console.log(`${total} module-level constant(s) resolve a filesystem root at require time.`);
    console.log('A caller that sets a sandbox seam AFTER requiring the module reads past it.');
    console.log('Make it a function and call it at each site (#1432).');
  }
  return total === 0 ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { scan, declarations, isLazy, functionNamesReaching };
