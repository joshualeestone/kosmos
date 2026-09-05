'use strict';
/*
 * #1704 slice 2b-i, the load-bearing INVARIANT of the single-site fix:
 * engine/worldenv's bootstrap must be the FIRST `require('./engine/...')` in
 * server.js. It applies the active world's data-root env, and ~26 engine modules
 * freeze store.ROOT at require time -- so any engine module required ABOVE the
 * bootstrap would freeze at the DEFAULT root before the override lands, silently
 * re-introducing the cross-world data bleed this slice fixes.
 *
 * This guards that ordering. A blind "grep for require" would false-positive on
 * the many `require(...)` mentions in server.js's prose comments and false-negative
 * on the multi-line destructuring requires (`const { ... } = require('./engine/x')`),
 * so it strips block comments first and then reads the require LITERALS in source
 * order. The final test proves the check itself can FAIL on a bad ordering.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/* The engine requires in `src`, in source order, ignoring block comments (which
   in server.js quote `require(...)` in prose). Line comments never carry an engine
   require in this file, and stripping block comments is enough to remove the prose
   mentions; the require literal itself is unambiguous. */
function engineRequiresInOrder(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ''); // drop block comments
  const re = /require\((['"])\.\/engine\/([A-Za-z0-9_.-]+)\1\)/g;
  const out = [];
  let m;
  while ((m = re.exec(code)) !== null) out.push(m[2]);
  return out;
}

test('engine/worldenv is the FIRST engine require in server.js (the ordering invariant)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const requires = engineRequiresInOrder(src);
  // Positive control: the scan actually found the engine requires (not a vacuous
  // pass on zero matches -- a regex that matched nothing would also "pass").
  assert.ok(requires.length > 10, `expected many engine requires, found ${requires.length}`);
  assert.equal(requires[0], 'worldenv', `the first engine require must be worldenv, was '${requires[0]}'`);
  // And it is the bootstrap call, not a stray reference.
  assert.match(src, /require\(['"]\.\/engine\/worldenv['"]\)\.bootstrapWorldEnv\(/,
    'server.js must call worldenv.bootstrapWorldEnv at the top');
});

test('the check CAN fail: a non-worldenv engine require placed first is caught', () => {
  const bad = [
    "const http = require('node:http');",
    "const commitments = require('./engine/commitments');", // a freeze BEFORE the bootstrap
    "const worldRegistryBase = require('./engine/worldenv').bootstrapWorldEnv(process.env);",
  ].join('\n');
  const requires = engineRequiresInOrder(bad);
  assert.equal(requires[0], 'commitments', 'the negative control must see the offending require first');
  assert.notEqual(requires[0], 'worldenv', 'so the real assertion would (correctly) fail on this ordering');
});
