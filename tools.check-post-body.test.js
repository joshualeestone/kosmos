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
  // Leading-zero numeric entities render as the em dash exactly the same, and a
  // pattern pinned to the un-padded form was a false negative on the gate path.
  ['zero-padded decimal entity', 'a &#08212; b\n', /&#8212;/],
  ['zero-padded hex entity', 'a &#x02014; b\n', /&#x2014;/],
  ['many-zero decimal entity', 'a &#0008212; b\n', /&#8212;/],
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

test('$(...) and ${...} advise like backticks, since --body executes them the same way', () => {
  // A body with no backticks but a command substitution / parameter expansion
  // is equally destroyed by `--body "..."`, and the advice used to miss it.
  withBody('run $(whoami) in ${HOME}\n', (_f, r) => {
    assert.strictEqual(r.status, 0, 'command substitution alone must not fail the check');
    assert.match(r.stderr, /--body-file/, 'the advice must name the remedy');
    assert.match(r.stderr, /\$\(/, 'the advice must name the $(...) form, not only backticks');
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

// The rest of the exit-2 contract, so a refactor cannot silently turn a usage
// error into a clean 0. Each of these must NOT read as a passing (clean) body.
test('a directory argument is a usage error, not a silent pass', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'postbody-dir-'));
  try {
    const r = spawnSync('node', [TOOL, d], { encoding: 'utf8' });
    assert.strictEqual(r.status, 2, 'a directory (EISDIR) must not look clean');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('no argument is a usage error', () => {
  const r = spawnSync('node', [TOOL], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2, 'no file argument must be a usage error');
});

test('more than one argument is a usage error', () => {
  const r = spawnSync('node', [TOOL, 'a.md', 'b.md'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 2, 'more than one argument must be a usage error');
});
