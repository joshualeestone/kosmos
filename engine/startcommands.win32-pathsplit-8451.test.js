'use strict';
/* kosmos#8451 item 1: the folders a PATH= value in a hook line may put in front, for a deny guard (naming one too many is
   harmless, missing one is a hole). Hooks run in a POSIX shell (Git Bash on Windows, measured with Claude Code 2.1.319),
   so ':' splits the value. Measured in Git Bash: a drive path in the value, typed or from a variable such as
   CLAUDE_PROJECT_DIR, is split on its colon there too; ~ and $HOME reach bash as /c/..., so the home folder is searched
   whole; a one-letter first folder is that drive. The splitter is pure and runs on every platform with the Windows rule
   chosen explicitly; the end-to-end reads run only on Windows, where the path module resolves drive paths. */
const test = require('node:test');
const assert = require('node:assert');
const sc = require('./startcommands');

test('#8451: off Windows a PATH value splits on every colon, exactly as before', () => {
  assert.deepEqual(sc.splitPathValue('/H/bin:/x:\u0000PATH', false, '/H'), ['/H/bin', '/x', '\u0000PATH']);
  assert.deepEqual(sc.splitPathValue('C:\\H/bin:x', false, 'C:\\H'), ['C', '\\H/bin', 'x'], 'no home rule off Windows');
  assert.deepEqual(sc.splitPathValue('a::b:', false), 'a::b:'.split(':'));
});

test('#8451: on Windows every plain piece is kept, a piece at the home is also named whole, and /c/ is C:', () => {
  const w = (v) => sc.splitPathValue(v, true, 'C:\\H');
  assert.deepEqual(w('C:\\H/bin:\u0000PATH'), ['C', '\\H/bin', '\u0000PATH', 'C:\\H/bin'], 'the home piece whole, plus the plain split');
  assert.deepEqual(w('/x:C:\\H/bin:C:\\H:\u0000PATH'), ['X:/', 'C', '\\H/bin', 'C', '\\H', '\u0000PATH', 'C:\\H/bin', 'C:\\H'], 'the home after a colon too; /x is the X: drive root (cygpath -w)');
  assert.deepEqual(w('c:\\h/bin'), ['c', '\\h/bin', 'c:\\h/bin'], 'the home matched without regard to case');
  assert.deepEqual(w('C:\\Homer/bin'), ['C', '\\Homer/bin'], 'C:\\Homer is not the home C:\\H: a whole folder name only');
  assert.deepEqual(w('C:/tools:x'), ['C', '/tools', 'x'], 'a typed drive path splits, as Git Bash splits it (measured)');
  assert.deepEqual(w('D:\\H/bin'), ['D', '\\H/bin'], 'another drive is not the home');
  // A bare drive is its root, D:/: a bare D: would be the current folder on D: once resolved (review 2).
  assert.deepEqual(w('/c/tools:/d:/e/:\u0000PATH'), ['C:/tools', 'D:/', 'E:/', '\u0000PATH'], 'Git Bash drive form, and a bare drive');
  assert.deepEqual(w('/cc/x:/c2/y'), ['/cc/x', '/c2/y'], 'only a single-letter first folder is a drive');
  assert.deepEqual(sc.splitPathValue('C:\\H/bin', true, ''), ['C', '\\H/bin'], 'no home known: plain split');
  assert.deepEqual(sc.splitPathValue('C:\\H/bin', true, 'relative'), ['C', '\\H/bin'], 'a home that is not a drive path: plain split');
  assert.deepEqual(sc.splitPathValue('C:\\H\\/bin', true, 'C:\\H\\'), ['C', '\\H\\/bin', 'C:\\H\\/bin'], 'a home given with a trailing slash');
  for (const v of ['a::b:', ':a', 'a', '']) assert.deepEqual(w(v), v.split(':'), 'same pieces as split for ' + JSON.stringify(v));
});

const WIN_ONLY = process.platform !== 'win32' && 'Windows only: it resolves Windows drive paths, which only the Windows path module does';

test('#8451: on Windows a PATH= value names the home folder whole AND every folder Git Bash would split it into', { skip: WIN_ONLY }, () => {
  // The bug: with the home on another drive than the folder the command runs in, the plain split read \H/bin on the
  // agent folder's drive (C:\H\bin), so the real home folder, D:\H\bin, the one Git Bash searches, was never named.
  const v0 = { HOME: 'D:\\H', PATH: '\u0000PATH' };
  const other = (c) => sc.pathsOfWords(sc.shellWords(c, v0), 'C:\\A', v0).runPaths;
  assert.ok(other('PATH=~/bin:$PATH myhook').includes('D:\\H\\bin\\myhook'), '~ names the home folder on its own drive');
  assert.ok(other('PATH="$HOME/.bun/bin:$PATH" bun run x.ts').includes('D:\\H\\.bun\\bin\\bun'), '$HOME too');
  // Below, the agent folder sits under the home, as it does on a real box.
  const v = { HOME: 'D:\\H', PATH: '\u0000PATH', CLAUDE_PROJECT_DIR: 'D:\\H\\work\\A' };
  const cwd = 'D:\\H\\work\\A';
  const paths = (c) => sc.pathsOfWords(sc.shellWords(c, v), cwd, v).runPaths;
  assert.ok(paths('PATH=~/bin:$PATH myhook').includes('D:\\H\\bin\\myhook'), '~ after =');
  assert.ok(paths('export PATH=/x:~/bin:$PATH; myhook').includes('D:\\H\\bin\\myhook'), '~ after :');
  assert.ok(paths('export PATH=/x:~/bin:$PATH; myhook').includes('X:\\myhook'), '/x is the X: drive');
  assert.ok(paths('PATH="$HOME/.bun/bin:$PATH" bun run x.ts').includes('D:\\H\\.bun\\bin\\bun'), '$HOME');
  assert.deepEqual(paths('PATH=/c/tools:$PATH lint'), ['C:\\tools\\lint'], 'Git Bash /c/ form');
  // Review 2: a bare drive on the agent folder's OWN drive is that drive's root, not the agent folder.
  assert.deepEqual(paths('PATH=/d:$PATH myhook'), ['D:\\myhook'], 'a bare /d is D:\\, even from a folder on D:');
  assert.deepEqual(paths('PATH=/c:$PATH myhook'), ['C:\\myhook'], 'and /c is C:\\, wherever the process runs');
  assert.deepEqual(paths('export PATH=tools:$PATH; lint'), [cwd + '\\tools\\lint'], 'a relative folder is still the agent folder');
  // A typed drive path: Git Bash splits C:/t into a folder named C where the command runs and /t, the T: drive.
  assert.deepEqual(paths('PATH=C:/t:$PATH lint'), [cwd + '\\C\\lint', 'T:\\lint']);
  // Review 1: a variable holding a Windows path under the home is split by Git Bash (measured: it ran <cwd>/C/myhook for a
  // home on C:), so the folder named after the drive letter where the command runs must still be named: it is the
  // script an agent could plant in its own folder.
  assert.ok(paths('PATH="$CLAUDE_PROJECT_DIR/bin:$PATH" myhook').includes(cwd + '\\D\\myhook'), 'a variable under the home still splits');
  assert.ok(paths('PATH=~/bin:$PATH myhook').includes(cwd + '\\D\\myhook'), 'and the plain split of the home is named too (harmless)');
});
