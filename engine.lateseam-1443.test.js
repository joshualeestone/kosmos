/*
 * #1443: a sandbox seam installed AFTER a module is required must be honoured.
 *
 * `tools/check-frozen-roots.js` is the static half and it reads declarations. This
 * is the behavioural half and it reads what a module actually resolves, which is
 * not the same question: the static guard found two modules whose frozen paths
 * never surface in exports, and this probe found the shape in modules whose
 * declaration the guard's pattern did not match. Neither alone covers the class.
 *
 * The hazard is silent in the worst way. A test that installs its sandbox late
 * reads and writes the OPERATOR'S REAL data root. It does not fail, it passes, and
 * the damage lands outside the run.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ENGINE = path.join(__dirname, 'engine');

/* Each module is probed in its OWN process: `require` caches, and a module already
   loaded under one root would answer from that cache and read as honest. */
const PROBE = `
const os=require('node:os'),fs=require('node:fs'),path=require('node:path');
const A=fs.mkdtempSync(path.join(os.tmpdir(),'seam-a-'));
const B=fs.mkdtempSync(path.join(os.tmpdir(),'seam-b-'));
process.env.AGENT_WORKFORCE_DATA=A;
let m; try { m=require(process.argv[1]); } catch { console.log('SKIP'); process.exit(0); }
process.env.AGENT_WORKFORCE_DATA=B;
const frozen=[]; const live=[]; const seen=new Set();
/* 🛑 Object.keys IS NOT ENOUGH, and the gap was real rather than theoretical.
   engine/tokendoors.js exports DOORS as a MAP, whose keys enumerate as [], so
   this probe returned OK on 18 doors each holding a frozen path into the
   SECRETS directory. A Map, a Set and an array all hide their contents from
   Object.keys, and the one module that used a Map is the one where a late seam
   would have deleted an operator's real API token. */
(function walk(o,p,d){ if(!o||d>3||seen.has(o))return; if(typeof o==='object')seen.add(o);
  const entries=[];
  if (o instanceof Map) { let i=0; for(const [k,v] of o) entries.push(['['+String(k)+']',v]); }
  else if (o instanceof Set) { let i=0; for(const v of o) entries.push(['{'+(i++)+'}',v]); }
  else if (Array.isArray(o)) o.forEach((v,i)=>entries.push(['['+i+']',v]));
  /* 🛑 getOwnPropertyNames, NOT Object.keys. \`Object.defineProperty\` defaults to
     enumerable:false, so a module doing
       Object.defineProperty(module.exports, 'FILE', { value: FILE })
     is invisible to a keys walk while still handing every caller a frozen path.
     That is not hypothetical here: engine/store.js:363 defines ROOT, AVATARS and
     PROFILES with defineProperty, and the only thing keeping THIS probe sighted
     on the module at the centre of the card is a comment there saying
     enumerable:true. Nothing machine-checked that comment. This costs nothing and
     removes the dependency on it. */
  else for(const k of Object.getOwnPropertyNames(o)) { let v; try{v=o[k];}catch{continue;} entries.push([k,v]); }
  for(const [k,v] of entries){
    if(typeof v==='string'&&v.includes(A)) frozen.push(p+k);
    /* 🛑 THE POSITIVE ARM. Without it this probe only ever says "no export
       mentions the OLD root", which a module exporting null, '' or nothing at all
       satisfies vacuously. A botched conversion that stopped resolving a path
       ENTIRELY would have passed silently, and that is the same false green the
       whole card is about. Counting exports that resolve under the NEW root makes
       the check able to tell "moved" from "gone". */
    else if(typeof v==='string'&&v.includes(B)) live.push(p+k);
    else if(v&&typeof v==='object'&&d<3) walk(v,p+k+'.',d+1); } })(m,'',0);
console.log(frozen.length?('FROZEN '+frozen.join(',')):('OK '+live.length));
fs.rmSync(A,{recursive:true,force:true}); fs.rmSync(B,{recursive:true,force:true});
`;

function probe(file) {
  try {
    return String(execFileSync(process.execPath, ['-e', PROBE, file], { encoding: 'utf8' })).trim();
  } catch { return 'SKIP'; }
}

test('#1443: no engine module exposes a path frozen to the require-time root', () => {
  const files = fs.readdirSync(ENGINE)
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
    .map((f) => path.join(ENGINE, f));
  /* A FLOOR, because a broken derivation would iterate an empty list and pass.
     Measured at 68 modules when this landed. */
  assert.ok(files.length > 40,
    `only ${files.length} engine modules found; the derivation is broken and the assertion below `
    + 'would pass over an empty list');

  const frozen = [];
  const skipped = [];
  let looked = 0;
  let live = 0;
  for (const f of files) {
    const r = probe(f);
    if (r === 'SKIP') { skipped.push(path.basename(f)); continue; }
    looked += 1;
    if (r.startsWith('FROZEN')) frozen.push(`${path.basename(f)}: ${r.slice(7)}`);
    else live += Number(r.slice(3)) || 0;
  }
  /* 🛑 NAME THE SKIPS, DO NOT FLOOR THEM. This was `looked > 30` against a
     population of 68, so THIRTY-SEVEN modules could have stopped loading while
     the frozen list emptied for the wrong reason and this still passed. A floor
     set below half the population is not a floor, it is a formality.
     Measured now: 68 of 68 load, 0 SKIP. So the honest assertion is that nothing
     skipped, and any module that cannot load gets NAMED rather than silently
     dropped -- a silent skip is exactly the false green this card is about. */
  assert.deepEqual(skipped, [],
    `these engine modules could not be loaded by the probe, so they were never checked:\n  `
    + skipped.join('\n  '));
  assert.ok(looked === files.length,
    `only ${looked} of ${files.length} modules were probed`);

  /* 🛑 THE POSITIVE ARM, and without it every assertion here is satisfiable by
     resolving NOTHING. The frozen check only says "no export mentions the OLD
     root"; a module exporting null passes it. This says the conversion actually
     MOVED the paths rather than removing them. */
  assert.ok(live > 0,
    `no engine export resolved under the NEW root (live=${live} across ${looked} modules), so this `
    + 'test proved only that nothing mentions the old one, which an empty or null export '
    + 'satisfies vacuously');

  assert.deepEqual(frozen, [],
    'these modules resolve a data root at require time, so a sandbox seam installed afterwards is '
    + 'ignored and they read the operator\'s REAL data:\n  ' + frozen.join('\n  '));
});
