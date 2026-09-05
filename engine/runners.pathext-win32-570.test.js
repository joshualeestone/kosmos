'use strict';
/* #570: `isRunnable` answered FALSE for a runner that Windows can launch.
   Claude's canonical rung is `<home>/.local/bin/claude` with no suffix; the file
   on a Windows box is `claude.exe`, so `statSync` on the canonical string threw
   and the gate refused. Measured on the Windows box: `resolveBin('claude').present`
   was false while `spawnSync` on that exact string ran Claude and printed
   2.1.261 -- win32 appends a PATHEXT suffix when resolving an image, for an
   ABSOLUTE path and not only for a bare PATH name. The spawn was fine; the gate
   in front of it was not, and creation refused with "we could not find Claude
   Code on this computer".

   ⚠️ WHAT THIS FILE HAS TO PROVE IS THE NARROWNESS, not the lookup. Adding
   places to look for a runner is exactly how the #133 folder-sails-through trap
   gets reopened, so the tests below pin that a suffixed candidate still has to
   BE A FILE, that an explicit extension is never traded for a sibling's, and
   that POSIX gained no new candidates at all. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const runners = require('./runners');
const { pathextCandidates, isRunnable } = runners;

const WINEXT = '.COM;.EXE;.BAT;.CMD';

test('#570: win32 offers the suffixed names for a path with no extension', () => {
  const got = pathextCandidates('C:\\Users\\a\\.local\\bin\\claude', 'win32', { PATHEXT: WINEXT });
  assert.deepEqual(got, [
    'C:\\Users\\a\\.local\\bin\\claude',
    'C:\\Users\\a\\.local\\bin\\claude.COM',
    'C:\\Users\\a\\.local\\bin\\claude.EXE',
    'C:\\Users\\a\\.local\\bin\\claude.BAT',
    'C:\\Users\\a\\.local\\bin\\claude.CMD',
  ], 'the bare path must stay FIRST and the suffixes must be additions, not replacements');
});

test('#570: an explicit extension is never traded for a sibling', () => {
  // An operator who names a file means that file. Widening this would let
  // AGENT_WORKFORCE_CLAUDE_BIN=...\claude.txt silently resolve to claude.exe.
  assert.deepEqual(pathextCandidates('C:\\bin\\claude.exe', 'win32', { PATHEXT: WINEXT }),
    ['C:\\bin\\claude.exe']);
  assert.deepEqual(pathextCandidates('C:\\bin\\claude.txt', 'win32', { PATHEXT: WINEXT }),
    ['C:\\bin\\claude.txt']);
});

test('#570: POSIX gains NO candidates -- the mac path is untouched', () => {
  for (const platform of ['darwin', 'linux']) {
    assert.deepEqual(pathextCandidates('/Users/josh/.local/bin/claude', platform, { PATHEXT: WINEXT }),
      ['/Users/josh/.local/bin/claude'],
      `${platform} grew a PATHEXT candidate; this branch is win32-only`);
  }
});

test('#570: a stripped environment still gets the documented Windows default', () => {
  const got = pathextCandidates('C:\\bin\\claude', 'win32', {});
  assert.ok(got.includes('C:\\bin\\claude.EXE'),
    'with no PATHEXT set there is no .EXE candidate, so a real install would read absent');
});

test('#570: the #133 trap stays shut -- a suffixed DIRECTORY is not runnable', () => {
  // The defect this whole rule exists for: something at the path that cannot be
  // launched must not read as present, and that must hold for the names we added.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pathext-570-'));
  const base = path.join(dir, 'claude');
  fs.mkdirSync(base + '.exe');          // a FOLDER named claude.exe
  assert.equal(isRunnable(base), false,
    'a directory at a suffixed candidate read as a runnable runner -- #133 reopened');
  assert.equal(isRunnable(base + '.exe'), false,
    'a directory read as runnable when named explicitly');
});

test('#570: a real file at the suffixed name IS found from the bare path', () => {
  // The positive arm, and the control for the test above: same shape, a file
  // instead of a directory, so the assertion above cannot pass vacuously.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pathext-570-'));
  const base = path.join(dir, 'claude');
  fs.writeFileSync(base + '.exe', 'binary', { mode: 0o755 });
  const expected = process.platform === 'win32';
  assert.equal(isRunnable(base), expected,
    expected
      ? 'win32 did not find claude.exe from the bare path -- the fix is not working'
      : 'POSIX found a .exe sibling for a bare path; that branch must be win32-only');
});
