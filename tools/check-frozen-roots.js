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
const SOURCES = ['os.homedir()', 'os.tmpdir()'];

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
    const m = /^const ([A-Za-z_][A-Za-z0-9_]*) =(.*)$/.exec(lines[i]);
    if (!m) continue;
    let init = m[2];
    let j = i;
    /* Continue while the declaration has not been terminated. A cap keeps a
       missing semicolon from swallowing the rest of the file. */
    while (!/;\s*$/.test(lines[j]) && j - i < 12 && j + 1 < lines.length) {
      j += 1;
      init += '\n' + lines[j];
    }
    out.push({ name: m[1], init, line: i + 1 });
  }
  return out;
}

/* A resolver's body, captured line-linearly from line `i`. A BLOCK body ends at
   the next line beginning with `}` (the closing brace at column 0, the same
   heuristic the function-declaration scan has always used); an EXPRESSION body
   (a single-expression arrow, `=> expr`) ends at the line ending in `;`.
   🛑 #1752 iter 2: the first version reused `declarations()` for const-held
   resolvers, and its terminator is the first `;` - which for a BLOCK body is the
   first STATEMENT, not the closing brace. So `const home = () => { const b = x;
   return b || os.homedir(); }` had its source call TRUNCATED away and the eager
   const that called it was missed, while the identical `function home()` form was
   caught. Capturing to the brace for block bodies closes that asymmetry. */
function resolverBodyFrom(lines, i, isBlock) {
  const buf = [];
  for (let j = i; j < lines.length && j - i < 400; j += 1) {
    buf.push(lines[j]);
    if (isBlock) { if (/^\}/.test(lines[j]) && j > i) break; }
    else if (/;\s*$/.test(lines[j])) break;
  }
  return buf.join('\n');
}

function functionNamesReaching(src, sources) {
  /* A resolver is a function whose body reaches a raw source, or calls another
     resolver. Gathered from `function NAME(` declarations AND const-held arrow /
     function-expression resolvers (`const dir = () => ...`, `const dir =
     function () {...}`), because a `function NAME(` scan alone is blind to the
     const-held forms and an eager const calling one froze a root undetected. */
  const lines = src.split('\n');
  const bodies = [];
  for (let i = 0; i < lines.length; i += 1) {
    const fn = /^\s*function ([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(lines[i]);
    if (fn) { bodies.push([fn[1], resolverBodyFrom(lines, i, true)]); continue; }
    /* const NAME = (arrow) | function-expression. The value must be
       function-shaped (isLazy), so a const holding a plain value is never a
       resolver candidate and precision is unchanged. */
    const cd = /^const ([A-Za-z_][A-Za-z0-9_]*) =(.*)$/.exec(lines[i]);
    if (!cd || !isLazy(cd[2])) continue;
    /* Block-bodied when this line opens a brace after the `=>` or `function`;
       otherwise a single-expression arrow terminated by `;`. */
    const isBlock = /=>\s*\{/.test(lines[i]) || /=\s*(?:async\s*)?function\b[^=]*\{/.test(lines[i]);
    bodies.push([cd[1], resolverBodyFrom(lines, i, isBlock)]);
  }
  /* Transitive closure to a FIXPOINT rather than a fixed 2 rounds: a chain of
     resolvers of any depth, forward- or reverse-declared, is resolved, and it
     still terminates because `names` only grows and is bounded by the resolver
     count. (The old 2-round cap silently missed a reverse-declared chain 3+
     deep.) */
  const names = new Set();
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, body] of bodies) {
      if (names.has(name)) continue;
      const reaches = sources.some((s) => body.includes(s))
        || [...names].some((n) => new RegExp(`\\b${n}\\s*\\(`).test(body));
      if (reaches) { names.add(name); changed = true; }
    }
  }
  return names;
}

function scan(file) {
  const src = fs.readFileSync(file, 'utf8');
  const resolvers = functionNamesReaching(src, SOURCES);
  const findings = [];
  for (const d of declarations(src)) {
    if (isLazy(d.init)) continue;
    const direct = SOURCES.some((s) => d.init.includes(s));
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
  return findings;
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
