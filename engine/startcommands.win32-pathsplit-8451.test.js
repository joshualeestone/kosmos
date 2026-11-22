'use strict';
/* kosmos#8451 item 1: a PATH= value in a hook line is split on ':' (hooks run in a POSIX shell, Git Bash on Windows,
   measured with Claude Code 2.1.319). Measured in Git Bash: a typed drive path (C:/x) is split on its colon there too,
   but ~ and $HOME reach bash as /c/..., so the home Kosmos expands as C:\H keeps its drive colon, and /c/x is C:/x.
   The splitter is pure and runs on every platform with the Windows rule chosen explicitly; the end-to-end reads run
   only on Windows, where the path module resolves drive paths. */
const test = require('node:test');
const assert = require('node:assert');
const sc = require('./startcommands');

test('#8451: off Windows a PATH value splits on every colon, exactly as before', () => {
  assert.deepEqual(sc.splitPathValue('/H/bin:/x:\u0000PATH', false, '/H'), ['/H/bin', '/x', '\u0000PATH']);
  assert.deepEqual(sc.splitPathValue('C:\\H/bin:x', false, 'C:\\H'), ['C', '\\H/bin', 'x'], 'no home rule off Windows');
  assert.deepEqual(sc.splitPathValue('a::b:', false), 'a::b:'.split(':'));
});

test('#8451: on Windows the expanded home keeps its drive colon, a typed drive path does not, /c/ is C:', () => {
  const w = (v) => sc.splitPathValue(v, true, 'C:\\H');
  assert.deepEqual(w('C:\\H/bin:\u0000PATH'), ['C:\\H/bin', '\u0000PATH'], 'an expanded ~ stays whole');
  // Git Bash maps any one-letter top folder to that drive (cygpath -w /x gives X:\, measured), so /x is X:.
  assert.deepEqual(w('/x:C:\\H/bin:C:\\H:\u0000PATH'), ['X:', 'C:\\H/bin', 'C:\\H', '\u0000PATH'], 'the home after a colon too');
  assert.deepEqual(w('c:\\h/bin'), ['c:\\h/bin'], 'the home matched without regard to case');
  assert.deepEqual(w('C:/tools:x'), ['C', '/tools', 'x'], 'a typed drive path splits, as Git Bash splits it (measured)');
  assert.deepEqual(w('D:\\H/bin'), ['D', '\\H/bin'], 'another drive is not the home');
  assert.deepEqual(w('/c/tools:/d:\u0000PATH'), ['C:/tools', 'D:', '\u0000PATH'], 'Git Bash drive form, and a bare drive');
  assert.deepEqual(w('/cc/x:/c2/y'), ['/cc/x', '/c2/y'], 'only a single-letter first folder is a drive');
  assert.deepEqual(sc.splitPathValue('C:\\H/bin', true, ''), ['C', '\\H/bin'], 'no home known: plain split');
  assert.deepEqual(sc.splitPathValue('C:\\H/bin', true, 'relative'), ['C', '\\H/bin'], 'a home that is not a drive path: plain split');
  for (const v of ['a::b:', ':a', 'a', '']) assert.deepEqual(w(v), v === '' ? [] : v.split(':'), 'same pieces as split for ' + JSON.stringify(v));
});

const WIN_ONLY = process.platform !== 'win32' && 'Windows only: it resolves Windows drive paths, which only the Windows path module does';

test('#8451: on Windows, PATH=~/bin:$PATH names the program in the home folder, not a junk path from the drive colon', { skip: WIN_ONLY }, () => {
  const v = { HOME: 'C:\\H', PATH: '\u0000PATH' };
  const paths = (c) => sc.pathsOfWords(sc.shellWords(c, v), 'C:\\A', v);
  assert.deepEqual(paths('PATH=~/bin:$PATH myhook').runPaths, ['C:\\H\\bin\\myhook'], '~ after =');
  assert.deepEqual(paths('export PATH=/x:~/bin:$PATH; myhook').runPaths, ['X:\\myhook', 'C:\\H\\bin\\myhook'], '~ after :, and /x is the X: drive');
  assert.deepEqual(paths('PATH="$HOME/.bun/bin:$PATH" bun run x.ts').runPaths.filter((p) => p.endsWith('bun')), ['C:\\H\\.bun\\bin\\bun']);
  assert.deepEqual(paths('PATH=/c/tools:$PATH lint').runPaths, ['C:\\tools\\lint'], 'Git Bash /c/ form');
  assert.deepEqual(paths('export PATH=tools:$PATH; lint').runPaths, ['C:\\A\\tools\\lint'], 'a relative folder is still the agent folder');
  // A typed drive path: Git Bash splits C:/t into a folder named C where the command runs and /t, the T: drive
  // (both measured), so those two are named, never C:\t.
  assert.deepEqual(paths('PATH=C:/t:$PATH lint').runPaths, ['C:\\A\\C\\lint', 'T:\\lint']);
  // Control, the bug: before the fix the home's drive colon was cut, so the home's own folder was never named.
  assert.ok(!paths('PATH=~/bin:$PATH myhook').runPaths.includes('C:\\A\\C\\myhook'), 'no junk path from the home drive letter');
});
