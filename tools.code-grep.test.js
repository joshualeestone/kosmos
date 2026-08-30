'use strict';
/**
 * #1570: a string search cannot tell USE from MENTION. tools/code-grep.js is
 * the tool that can, and these are the properties that make it worth trusting.
 *
 * ⚠️ THE LINE-NUMBER TEST IS NOT A NICETY. I shipped the opposite bug once, in
 * the #1592 sweep: it stripped comments by DELETING them, which shifted every
 * line below, so it reported a real defect at machine.js:191 when the call was
 * at 412. A finding nobody can locate is barely a finding.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TOOL = path.join(__dirname, 'tools', 'code-grep.js');

function withFile(body, contents) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'codegrep-'));
  const f = path.join(d, 'sample.js');
  fs.writeFileSync(f, contents);
  try { return body(f); } finally { fs.rmSync(d, { recursive: true, force: true }); }
}

function run(args) {
  try {
    return { out: execFileSync('node', [TOOL, ...args], { encoding: 'utf8' }), code: 0 };
  } catch (e) {
    return { out: e.stdout || '', code: e.status };
  }
}

test('a comment MENTIONING the call is not a match, and the real call is', () => {
  withFile((f) => {
    const r = run(['accessSync', f]);
    assert.strictEqual(r.code, 0, 'the real call should be found');
    const lines = r.out.trim().split('\n');
    assert.strictEqual(lines.length, 1, `expected exactly the call, got:\n${r.out}`);
    assert.ok(/:6:/.test(lines[0]), `the hit should be line 6, got: ${lines[0]}`);
  }, [
    '// line 1: accessSync is mentioned here in a line comment',   // 1
    '/* line 2-4: a block comment that',                            // 2
    '   also says accessSync, at length,',                          // 3
    '   and must not match */',                                     // 4
    'function f(p) {',                                              // 5
    '  return fs.accessSync(p);',                                   // 6  <- the only use
    '}',                                                            // 7
  ].join('\n'));
});

test('LINE NUMBERS ARE THE REAL ONES, because comments are blanked and not deleted', () => {
  // Twelve comment lines above the call. If comments were removed rather than
  // blanked, this would report line 2 instead of line 14.
  const body = [
    ...Array.from({ length: 12 }, (_, i) => `// filler comment ${i + 1}`),
    'const x = 1;',
    'fs.accessSync(x);',
  ].join('\n');
  withFile((f) => {
    const r = run(['accessSync', f]);
    assert.strictEqual(r.code, 0);
    assert.ok(
      /:14:/.test(r.out),
      `expected the hit at line 14 (12 comments + 1 code line above); got:\n${r.out}`
    );
  }, body);
});

test('a STRING containing the text is not a match either', () => {
  // The instance that started #1570 anchored on a user-facing MESSAGE, which is
  // quoted in comments, tests and changelogs precisely because it is user-facing.
  withFile((f) => {
    const r = run(['cannot find it', f]);
    assert.strictEqual(r.code, 1, `a quoted message must not match; got:\n${r.out}`);
  }, [
    'const msg = "we cannot find it where it should be";',
    'log(msg);',
  ].join('\n'));
});

test('a zero result says WHY it cannot be trusted, on stderr, without polluting stdout', () => {
  withFile((f) => {
    const res = require('node:child_process').spawnSync(
      'node', [TOOL, 'zzz-cannot-exist', f], { encoding: 'utf8' }
    );
    assert.strictEqual(res.status, 1, 'no match should exit 1');
    assert.strictEqual(res.stdout, '', 'stdout must stay clean for pipelines');
    assert.match(
      res.stderr,
      /built at runtime|alias|computed/,
      'a zero must carry the caveat that this reads SOURCE TEXT only'
    );
  }, 'const a = 1;\n');
});

test('a match prints NO caveat, so the warning keeps its meaning', () => {
  withFile((f) => {
    const res = require('node:child_process').spawnSync(
      'node', [TOOL, 'accessSync', f], { encoding: 'utf8' }
    );
    assert.strictEqual(res.status, 0);
    assert.strictEqual(res.stderr, '', 'a caveat on every run is noise and gets ignored');
  }, 'fs.accessSync(p);\n');
});

test('KNOWN BLIND SPOT, asserted so it is documented rather than discovered', () => {
  // A regex literal containing a quote character confuses the scanner: it reads
  // the quote as a string opener. Stated here, in a test, so the next person
  // meets it as a known limit rather than as a surprise. If this ever starts
  // passing, the scanner improved and this test should be updated, not deleted.
  withFile((f) => {
    const r = run(['REALCALL', f]);
    assert.strictEqual(
      r.code, 1,
      'if this now FINDS the call, the scanner has been improved past its ' +
        'documented blind spot: update this test to match'
    );
  }, [
    "const re = /it's/;",   // the apostrophe opens a "string" the scanner never closes
    'fs.REALCALL(p);',
  ].join('\n'));
});
