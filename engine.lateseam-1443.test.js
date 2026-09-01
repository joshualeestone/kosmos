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
const frozen=[]; const seen=new Set();
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
  else for(const k of Object.keys(o)) { let v; try{v=o[k];}catch{continue;} entries.push([k,v]); }
  for(const [k,v] of entries){
    if(typeof v==='string'&&v.includes(A)) frozen.push(p+k);
    else if(v&&typeof v==='object'&&d<3) walk(v,p+k+'.',d+1); } })(m,'',0);
console.log(frozen.length?('FROZEN '+frozen.join(',')):'OK');
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
  let looked = 0;
  for (const f of files) {
    const r = probe(f);
    if (r === 'SKIP') continue;
    looked += 1;
    if (r.startsWith('FROZEN')) frozen.push(`${path.basename(f)}: ${r.slice(7)}`);
  }
  /* A SECOND FLOOR: if every module failed to load, every answer is SKIP and the
     list above is empty for the wrong reason. */
  assert.ok(looked > 30,
    `only ${looked} of ${files.length} modules actually loaded, so this arm measured almost nothing`);

  assert.deepEqual(frozen, [],
    'these modules resolve a data root at require time, so a sandbox seam installed afterwards is '
    + 'ignored and they read the operator\'s REAL data:\n  ' + frozen.join('\n  '));
});
