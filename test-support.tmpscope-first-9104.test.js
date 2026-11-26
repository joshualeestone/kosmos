'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9104: EVERY suite test file requires ./test-support/tmpscope (or tmpscope-outside-home) FIRST, so any temp
 * folder made while it runs (by the file, a test-support helper, product code it loads such as engine/store.js's test
 * home, or a child it spawns) lands in the file's own folder and is removed when the process ends, even when it ends
 * early (SIGTERM, an uncaught throw). Without it, a folder swept only in test.after() or on 'exit' is left behind when
 * the process stops early, and a full validation of an unrelated branch goes red on the #4273 leak check (#9098, and
 * before it #8225, #7442, #6017).
 *
 * Why every file, not only the ones that look like they make temp folders: an earlier version of this guard tried to
 * detect users (tmpdir( in the file, then helpers that call it), and each review round found another path it could
 * not see (helpers, then product modules). Requiring it everywhere costs one line and cannot have a false pass.
 *
 * "First" means: before any tmpdir() call and before any require that is not a Node builtin, because tmpscope works by
 * pointing TMPDIR at its folder, and a path computed before that (in the file, or in a module it loads) is not in it.
 * Builtins (node:fs, os, path...) compute no temp path at load, so they may come first.
 *
 * Which files: the ones the suite runs, `*.test.js` and `engine/*.test.js` (tools/run-tests.sh).
 *
 *   node --test test-support.tmpscope-first-9104.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');

const ROOT = __dirname;
// './test-support/tmpscope', '../test-support/tmpscope', or a root variable joined on: require(R + '/test-support/tmpscope').
const SCOPE = /require\(\s*(?:[\w.]+\s*\+\s*)?(['"])(?:\.\.?)?(?:\/\.\.)*\/?test-support\/tmpscope(?:-outside-home)?(?:\.js)?\1\s*\)/;
// Files without tmpscope on purpose, each with its reason. Adding one needs a reason as good.
const EXEMPT = new Map([
  ['test-support.tmpscope.test.js', 'it tests tmpscope itself, and its control case must run without it'],
  ['engine/status.test.js', 'kosmos#5334: its tmux socket tests need the short real temp path (a scoped one pushes the socket past the OS length limit); each fixture there is removed in its own finally'],
]);
const USES_TMPDIR = /\btmpdir\s*\(/;
const BUILTIN = new Set(builtinModules);
// The code before index `end`, with comments removed and string/template contents reduced to the characters a
// module spec or a call can hold, so a comment that names tmpdir() or require() is not read as a call, while
// `${os.tmpdir()}` inside a template still is. Quotes inside a regex literal are not modelled: a file whose prefix
// holds one may be misread (none does today).
function codeOnly(t, end) {
  let out = '';
  let i = 0;
  while (i < end) {
    const c = t[i];
    if (c === '/' && t[i + 1] === '/') { const e = t.indexOf('\n', i); i = e < 0 || e > end ? end : e; continue; }
    if (c === '/' && t[i + 1] === '*') { const e = t.indexOf('*/', i + 2); i = e < 0 ? end : Math.min(end, e + 2); out += ' '; continue; }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < end && t[j] !== c) { if (t[j] === '\\') j++; j++; }
      out += c + t.slice(i + 1, Math.min(j, end)).replace(/[^\n]/g, (ch) => (/[\w\-/.:@()]/.test(ch) ? ch : ' ')) + c;
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// Why the text fails the rule, or null when it passes.
function check(text) {
  // Matched in the code only, so a comment that mentions the require does not count as one.
  const code = codeOnly(text, text.length);
  const m = SCOPE.exec(code);
  if (!m) return 'never requires test-support/tmpscope';
  const before = code.slice(0, m.index);
  if (USES_TMPDIR.test(before)) return 'calls tmpdir() before requiring tmpscope';
  const reqs = before.matchAll(/\brequire\s*\(\s*(['"`])([^'"`]*)\1\s*\)/g);
  for (const r of reqs) {
    const spec = r[2];
    // A node: spec is always a builtin (node:test is not even listed in builtinModules).
    if (!spec.startsWith('node:') && !BUILTIN.has(spec)) return `requires ${spec} before tmpscope (a helper can compute a temp path at load)`;
  }
  return null;
}

function suiteFiles() {
  const out = [];
  for (const dir of ['.', 'engine']) {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) {
      if (name.endsWith('.test.js')) out.push(dir === '.' ? name : `${dir}/${name}`);
    }
  }
  return out.sort();
}

test('controls: the check can return each failing answer, and passes the shapes that are fine', () => {
  const T = 'os.tmp' + 'dir()'; // spelled apart so this file's own text is not a sample
  const S = "require('./test-support/tmpscope');";
  assert.match(check(`const os = require('node:os');\nfs.mkdtempSync(${T});\n`), /never requires/);
  assert.match(check(`const d = ${T};\n${S}\n`), /before requiring/);
  assert.match(check(`const h = require('./test-support/helper');\n${S}\n${T};\n`), /requires \.\/test-support\/helper before/);
  assert.match(check(`const x = require('some-package');\n${S}\n${T};\n`), /requires some-package before/);
  assert.equal(check(`'use strict';\n${S}\nconst os = require('node:os');\n${T};\n`), null);
  assert.equal(check(`const os = require('node:os');\nconst p = require('path');\n${S}\n${T};\n`), null);
  assert.equal(check(`// we used to call ${T} here, and require('./x')\n${S}\n${T};\n`), null);
  assert.equal(check(`require('../test-support/tmpscope-outside-home');\n${T};\n`), null);
  // No tmpdir() in sight still needs it: a module it loads can make the folder (engine/store.js does).
  assert.match(check(`const store = require('../engine/store');\nconsole.log(1);\n`), /never requires/);
  assert.equal(check(`const test = require('node:test');\n${S}\n${T};\n`), null);
  assert.equal(check(`const R = __dirname;\nrequire(R + '/test-support/tmpscope');\n${T};\n`), null);
  assert.match(check(`require('./test-support/tmpscopes');\n${T};\n`), /never requires/);
  // A mention in a comment is not the require (#9104 review).
  assert.match(check(`// new files: require('./test-support/tmpscope') first\n${T};\n`), /never requires/);
  // A call inside a template literal is still a call.
  assert.match(check('const d = `${' + T + '}/x`;\n' + S + '\n'), /before requiring/);
});

test('every suite test file requires tmpscope first (#9104)', () => {
  const files = suiteFiles();
  // A listing that found nothing would pass every file (bulletin a-test-nothing-runs-is-an-unarmed-guard).
  assert.ok(files.length > 1000, `listed only ${files.length} test files`);
  const bad = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const why = EXEMPT.has(f) ? null : check(text);
    if (why) bad.push(`${f}: ${why}`);
  }
  for (const f of EXEMPT.keys()) assert.ok(files.includes(f), `exempt file ${f} no longer exists: drop it from EXEMPT`);
  assert.deepEqual(bad, [], `put require('./test-support/tmpscope') (or '../test-support/tmpscope' in engine/) before\n` +
    `everything but Node builtins in:\n  ${bad.join('\n  ')}`);
});
