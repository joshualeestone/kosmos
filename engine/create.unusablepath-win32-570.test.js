'use strict';
/* #570: `unusablePath` refused EVERY path that can exist on Windows. Its reject
   set carried a backslash -- a POSIX-only hazard -- and every absolute Windows
   path is full of them, so the rule answered TRUE for the runner, for tmux and
   for the agents folder alike. Measured on the Windows box: createAgent refused
   with "we cannot use that path for Claude Code" even with the runner present
   and runnable, and machine.installedCheck (which applies the same rule) told a
   Windows user to reinstall "to a folder with no quotes, backslashes or line
   breaks in its name" -- a folder Windows cannot have.

   ⚠️ THE POINT OF THIS FILE IS THAT BOTH BRANCHES ARE ASSERTED FROM A MAC. The
   defect survived because `unusablePath` read `process.platform` directly, so
   its win32 answer could not be written down anywhere the suite actually runs.
   The platform is injected now, and these tests pin the win32 branch explicitly
   rather than trusting the machine underneath them. A test that can only fail on
   hardware nobody in CI has is not a guard.

   ⚠️ AND THE NARROWING IS PINNED IN BOTH DIRECTIONS. Widening this to "win32
   accepts anything" would trade a refused platform for an unguarded one, so the
   quote/newline refusals are asserted ON win32, not merely on POSIX. */
const test = require('node:test');
const assert = require('node:assert/strict');

const create = require('./create');
const { unusablePath } = create;

test('#570: a normal Windows path is USABLE (the defect: it was not)', () => {
  for (const p of [
    'C:\\Users\\joshu\\.local\\bin\\claude.exe',
    'C:\\Users\\joshu\\.local\\bin\\claude',
    'C:\\Users\\joshu\\work\\workers\\ada',
    'C:\\Program Files\\Kosmos\\runtime\\node.exe',
  ]) {
    assert.equal(unusablePath(p, 'win32'), false,
      `win32 refused ${p} -- the backslash rule is rejecting the path separator again`);
  }
});

test('#570: win32 still refuses the hazards that are NOT the separator', () => {
  // The narrowing removed exactly one character from the class, and these are
  // the ones whose refusal the docblock actually argues for.
  for (const [label, p] of [
    ['a double quote', 'C:\\Users\\a"b\\claude.exe'],
    ['a single quote', "C:\\Users\\a'b\\claude.exe"],
    ['a newline', 'C:\\Users\\a\nb\\claude.exe'],
    ['a carriage return', 'C:\\Users\\a\rb\\claude.exe'],
    ['a dollar sign', 'C:\\Users\\a$b\\claude.exe'],
    ['a backtick', 'C:\\Users\\a`b\\claude.exe'],
  ]) {
    assert.equal(unusablePath(p, 'win32'), true,
      `win32 accepted a path carrying ${label} -- the narrowing went too far`);
  }
});

test('#570: the POSIX branch is BYTE-FOR-BYTE unchanged, backslash included', () => {
  // The Mac path is what ships today; the fix must be invisible to it.
  assert.equal(unusablePath('/Users/josh/.local/bin/claude', 'darwin'), false,
    'the ordinary mac runner path became unusable');
  assert.equal(unusablePath('/opt/homebrew/bin/tmux', 'darwin'), false,
    'the ordinary mac tmux path became unusable');
  assert.equal(unusablePath('/Users/a\\b/claude', 'darwin'), true,
    'POSIX stopped refusing a backslash -- on POSIX it is not a separator and the rule still holds');
  for (const p of ['/tmp/a"b', "/tmp/a'b", '/tmp/a\nb', '/tmp/a\rb', '/tmp/a$b', '/tmp/a`b']) {
    assert.equal(unusablePath(p, 'darwin'), true, `POSIX stopped refusing ${JSON.stringify(p)}`);
  }
});

test('#570: linux keeps the POSIX rule (the branch is win32, not "not-darwin")', () => {
  assert.equal(unusablePath('/home/josh/.local/bin/claude', 'linux'), false);
  assert.equal(unusablePath('/home/a\\b/claude', 'linux'), true,
    'linux followed the win32 branch -- the test is platform === win32, not a negation of darwin');
});

test('#570: the default platform argument is the running one', () => {
  // Every caller in the tree calls this with one argument; the injected platform
  // exists for the suite, and must not change what production resolves to.
  const p = process.platform === 'win32' ? 'C:\\Users\\a\\b' : '/Users/a/b';
  assert.equal(unusablePath(p), unusablePath(p, process.platform),
    'the defaulted call disagreed with the explicit one');
});
