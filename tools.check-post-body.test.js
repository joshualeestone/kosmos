'use strict';
/**
 * #1491: PR and issue bodies are Josh-facing text that nothing swept.
 *
 * ⚠️ ONE ARM PER SPELLING, DELIBERATELY. A single test with all five in one
 * file passes while four patterns are broken, because the first hit satisfies
 * it. The spelling that actually reached a live pay screen was the SOURCE
 * ESCAPE, which no literal-character check can see, so "the guard is green"
 * has to mean "all five are green" and not "at least one fired".
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TOOL = path.join(__dirname, 'tools', 'check-post-body.js');

function withBody(contents, body) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'postbody-'));
  const f = path.join(d, 'body.md');
  fs.writeFileSync(f, contents);
  try {
    return body(f, spawnSync('node', [TOOL, f], { encoding: 'utf8' }));
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

const CASES = [
  ['literal em dash', 'a — b\n', /literal em dash/],
  ['HTML entity', 'a &mdash; b\n', /&mdash;/],
  ['decimal entity', 'a &#8212; b\n', /&#8212;/],
  ['hex entity', 'a &#x2014; b\n', /&#x2014;/],
  ['source escape', 'a \\u2014 b\n', /source escape/],
];

for (const [label, text, expect] of CASES) {
  test(`catches the ${label} spelling on its own`, () => {
    withBody(text, (_f, r) => {
      assert.strictEqual(r.status, 1, `${label} did not fail the check`);
      assert.match(r.stdout, expect, `${label} was not named in the output`);
    });
  });
}

test('reports the RIGHT line, so the writer can find it', () => {
  withBody('clean\nclean\na — here\nclean\n', (_f, r) => {
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout, /:3:/, `expected line 3, got:\n${r.stdout}`);
  });
});

test('a clean body passes silently, so the tool is worth putting in a chain', () => {
  withBody('A perfectly ordinary body, no dashes, no code.\n', (_f, r) => {
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '', 'a clean run must print nothing to stdout');
    assert.strictEqual(r.stderr, '', 'a clean run must print nothing to stderr');
  });
});

test('backticks ADVISE and do not block, because quoting code is correct', () => {
  // The defect is posting with --body, not having backticks. A tool that
  // refused good input would be switched off, and then it guards nothing.
  withBody('the function `cut_record_done` is named\n', (_f, r) => {
    assert.strictEqual(r.status, 0, 'backticks alone must not fail the check');
    assert.match(r.stderr, /--body-file/, 'the backtick advice must name the remedy');
    assert.match(r.stderr, /EXECUTES/, 'it must say what actually happens');
  });
});

test('an em dash still fails even when backticks are present', () => {
  withBody('the `fn` is here — and so is a dash\n', (_f, r) => {
    assert.strictEqual(r.status, 1, 'the dash must decide the exit code');
    assert.match(r.stdout, /literal em dash/);
    assert.match(r.stderr, /backtick/, 'and the backtick advice still appears');
  });
});

test('CONTROL: the checker can return clean, so a pass is not structural', () => {
  // Without this, every assertion above is equally consistent with a checker
  // that always fails.
  withBody('nothing to see here\n', (_f, r) => {
    assert.strictEqual(r.status, 0, 'the checker never passes; it cannot discriminate');
  });
});

test('a missing file is a usage error, not a silent pass', () => {
  const r = spawnSync('node', [TOOL, '/nonexistent/body.md'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2, 'an unreadable body must not look clean');
});
