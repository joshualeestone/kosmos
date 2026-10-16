'use strict';
/**
 * kosmos#6287: tools/family-e2e-6239.js (#6239's end-to-end proof) carries a copy of tools/fed-own-e2e.js's (#4693)
 * harness helpers: the sandbox and free-port logic, process start, teardown and the orphan sweep, the HTTP helper,
 * dev-code reading and boardSignin. A fix made in one copy must reach the other, or one proof keeps a bug the other
 * lost.
 *
 * The card proposed extracting them into a shared module. Decided against (the card says why): the helpers close
 * over each harness's own module state (results, halted, the process table, the sandbox), so sharing them means a
 * factory, and re-proving both harnesses against freshly built relay binaries, for two files. This guard keeps the
 * copies identical instead: change one, and this fails until the other matches.
 *
 * Each helper is cut from its definition line to the first line that is exactly `}` (how a top-level function ends in
 * these files), or is its own line when it is a one-liner. The module state the helpers share (the process list, the
 * teardown flags, the exit handler, SCREEN) is cut the same way, to the first line that is exactly `});` or the
 * statement's own line. Lines that are only a `//` comment are left out of the comparison, so one copy may explain
 * more than the other; code may not differ. Every name must be found exactly once in BOTH files, and no cut may run
 * past MAX_LINES, so a rename, a removal or a wrong cut fails here rather than shrinking what is compared.
 *
 *   node --test tools.fedproof-helpers-in-sync-6287.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FED = path.join(__dirname, 'tools', 'fed-own-e2e.js');
const FAMILY = path.join(__dirname, 'tools', 'family-e2e-6239.js');

/* The helpers whose code is the same in both harnesses (measured 2026-10-16 on main; ownedAlive, the orphan sweep,
   differs only by a comment). freePort, boardEnv, startBoard and main differ on purpose (each harness's own boards
   and ports) and are not here. */
const SHARED = [
  'chk', 'info', 'sleep', 'waitFor', 'fedproofPortFreeOn', 'fedproofPortFree', 'start', 'fedproofReadLog', 'stripAnsi',
  'serviceEnv', 'psTable', 'descendantsOf', 'alive', 'stopPids', 'isLive', 'ownedDescendants', 'ownedAlive',
  'fedproofCleanup', 'http', 'devCodes', 'nextCode', 'boardSignin', 'fedproofFinish',
];
/* The module state those helpers read and write, by the start of its first line. */
const SHARED_STATE = [
  'let stopping =', 'const started =', 'const taken =', 'let cleaned =', 'let cleanedDone =', "process.on('exit',",
  'const SCREEN =',
];
/* No helper or statement here is longer than this; a cut that is, ran past its end. */
const MAX_LINES = 40;

/* The code of a cut, without the lines that are only a `//` comment. */
const code = (text) => text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

/** Every top-level statement starting with `prefix`, each as its text (to the first `});` line, or its own line). */
function statements(src, prefix) {
  const lines = src.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith(prefix)) continue;
    if (!lines[i].trimEnd().endsWith('{')) { out.push(lines[i]); continue; }
    let j = i + 1;
    while (j < lines.length && lines[j] !== '});') j += 1;
    out.push(lines.slice(i, j + 1).join('\n'));
  }
  return out;
}

/** Every top-level definition of `name` in `src`, each as its text. */
function definitions(src, name) {
  const lines = src.split('\n');
  const head = new RegExp('^(?:async\\s+)?function\\s+' + name + '\\s*\\(|^const\\s+' + name + '\\s*=');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!head.test(lines[i])) continue;
    const line = lines[i].trimEnd();
    if (line.endsWith(';') || (line.endsWith('}') && !line.endsWith('{}') && line.split('{').length === line.split('}').length)) {
      out.push(lines[i]);
      continue;
    }
    let j = i + 1;
    while (j < lines.length && lines[j] !== '}') j += 1;
    out.push(lines.slice(i, j + 1).join('\n'));
  }
  return out;
}

test('kosmos#6287: the extractor sees a one-character change (control)', () => {
  const a = 'function f(x) {\n  return x + 1;\n}\nconst g = (y) => y;\n';
  const b = 'function f(x) {\n  return x + 2;\n}\nconst g = (y) => y;\n';
  assert.equal(definitions(a, 'f').length, 1);
  assert.notEqual(definitions(a, 'f')[0], definitions(b, 'f')[0], 'a changed body read as the same');
  assert.equal(definitions(a, 'g')[0], definitions(b, 'g')[0]);
  assert.equal(definitions(a, 'missing').length, 0);
  // A comment-only line may differ; code may not.
  assert.equal(code(definitions('function h() {\n  // one\n  return 1;\n}\n', 'h')[0]),
    code(definitions('function h() {\n  // two, longer\n  return 1;\n}\n', 'h')[0]));
  const s1 = "process.on('exit', () => {\n  a();\n});\nconst X = 1;\n";
  const s2 = "process.on('exit', () => {\n  b();\n});\nconst X = 1;\n";
  assert.notEqual(statements(s1, "process.on('exit',")[0], statements(s2, "process.on('exit',")[0]);
  assert.equal(statements(s1, 'const X =')[0], 'const X = 1;');
});

test('kosmos#6287: the shared harness helpers are identical in fed-own-e2e.js and family-e2e-6239.js', () => {
  const fed = fs.readFileSync(FED, 'utf8');
  const family = fs.readFileSync(FAMILY, 'utf8');
  for (const name of SHARED) {
    const a = definitions(fed, name);
    const b = definitions(family, name);
    assert.equal(a.length, 1, `${name}: expected one definition in tools/fed-own-e2e.js, found ${a.length}`);
    assert.equal(b.length, 1, `${name}: expected one definition in tools/family-e2e-6239.js, found ${b.length}`);
    for (const cut of [a[0], b[0]]) {
      assert.ok(cut.split('\n').length <= MAX_LINES, `${name}: the cut ran past ${MAX_LINES} lines, so it did not stop at the helper's end`);
    }
    assert.equal(code(b[0]), code(a[0]), `${name} differs between tools/fed-own-e2e.js and tools/family-e2e-6239.js: a fix to one copy must be made to the other (kosmos#6287)`);
  }
  for (const prefix of SHARED_STATE) {
    const a = statements(fed, prefix);
    const b = statements(family, prefix);
    assert.equal(a.length, 1, `${prefix}: expected one in tools/fed-own-e2e.js, found ${a.length}`);
    assert.equal(b.length, 1, `${prefix}: expected one in tools/family-e2e-6239.js, found ${b.length}`);
    for (const cut of [a[0], b[0]]) assert.ok(cut.split('\n').length <= MAX_LINES, `${prefix}: the cut ran past ${MAX_LINES} lines`);
    assert.equal(code(b[0]), code(a[0]), `${prefix} differs between the two harnesses: the state the shared helpers use must stay the same (kosmos#6287)`);
  }
});
