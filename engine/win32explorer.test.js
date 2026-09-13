'use strict';
/**
 * win32-board-copy: the one Explorer launcher.
 *
 * 🛑 NO TEST HERE MAY OPEN A REAL WINDOW. Every arm that reaches a launch injects the
 * runner; the one arm that does not proves the live-execution gate throws inside a
 * test process instead of spawning. Targets are Windows paths with an injected
 * existence check, so a Mac asserts the same arms a Windows box does.
 *
 *   node --test engine/win32explorer.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const explorer = require('./win32explorer');

const FOLDER = 'C:\\Users\\someone\\Kosmos\\Projects\\Brief';
const FILE = 'C:\\Users\\someone\\Kosmos\\Projects\\Brief\\notes.docx';
const DIRECTORY = { isDirectory: () => true, isFile: () => false };
const REGULAR_FILE = { isDirectory: () => false, isFile: () => true };

function withWorld({ stat, runnerResult = { ok: true } }, body) {
  const calls = [];
  explorer.setRunner((exe, args) => { calls.push({ exe, args }); return runnerResult; });
  explorer.setStatForTests(stat || (() => DIRECTORY));
  try {
    return body(calls);
  } finally {
    explorer.setRunner(null);
    explorer.setStatForTests(null);
  }
}

test('a real folder is handed to explorer.exe as ONE argument, never through a shell', () => {
  withWorld({}, (calls) => {
    assert.deepEqual(explorer.openFolder(FOLDER), { ok: true });
    assert.equal(calls.length, 1);
    assert.match(calls[0].exe, /\\explorer\.exe$/i, 'the launcher is not explorer.exe');
    assert.deepEqual(calls[0].args, [FOLDER], 'the folder did not arrive as one argument');
  });
});

test('a forward-slash spelling is normalized before Explorer sees it', () => {
  withWorld({}, (calls) => {
    assert.equal(explorer.openFolder('C:/Users/someone/Kosmos').ok, true);
    assert.deepEqual(calls[0].args, ['C:\\Users\\someone\\Kosmos']);
  });
});

test('a UNC share is a real Windows folder too', () => {
  withWorld({}, (calls) => {
    assert.equal(explorer.openFolder('\\\\fileserver\\team\\Kosmos').ok, true);
    assert.deepEqual(calls[0].args, ['\\\\fileserver\\team\\Kosmos']);
  });
});

test('ARGUMENT INJECTION: anything Explorer could read as a switch, or that is not an absolute path, is refused before any launch', () => {
  const shapes = [
    '/select,C:\\Windows\\System32\\calc.exe',
    '/e,C:\\',
    '/root,C:\\Users',
    '-help',
    'relative\\folder',
    '\\rooted-without-a-drive',
    'C:\\Users\\someone\\" /select,"C:\\Windows',
    'C:\\Users\\someone\\Kos\nmos',
    'ms-settings:privacy',
    'shell:startup',
    'https://example.com',
    '',
    null,
    undefined,
    42,
  ];
  withWorld({}, (calls) => {
    for (const shape of shapes) {
      const out = explorer.openFolder(shape);
      assert.equal(out.ok, false, `accepted ${JSON.stringify(shape)}`);
      assert.equal(typeof out.because, 'string');
    }
    assert.equal(calls.length, 0, 'a refused target still reached Explorer');
  });
  /* CONTROL: the same world launches for a real folder, so the refusals above are the
     validation and not a runner that never answers. */
  withWorld({}, (calls) => {
    assert.equal(explorer.openFolder(FOLDER).ok, true);
    assert.equal(calls.length, 1);
  });
});

test('a folder that is gone, or is a file, is refused with a sentence and no launch', () => {
  withWorld({ stat: () => { throw Object.assign(new Error('nope'), { code: 'ENOENT' }); } }, (calls) => {
    assert.deepEqual(explorer.openFolder(FOLDER), { ok: false, because: 'that folder is not there any more' });
    assert.equal(calls.length, 0);
  });
  withWorld({ stat: () => REGULAR_FILE }, (calls) => {
    assert.deepEqual(explorer.openFolder(FOLDER), { ok: false, because: 'that is not a folder' });
    assert.equal(calls.length, 0);
  });
});

test('openFile opens a regular file and refuses a folder', () => {
  withWorld({ stat: () => REGULAR_FILE }, (calls) => {
    assert.deepEqual(explorer.openFile(FILE), { ok: true });
    assert.deepEqual(calls[0].args, [FILE]);
  });
  withWorld({ stat: () => DIRECTORY }, (calls) => {
    assert.equal(explorer.openFile(FOLDER).ok, false);
    assert.equal(calls.length, 0);
  });
});

test('Settings pages are a closed list: the sleep page opens, anything else is refused', () => {
  withWorld({}, (calls) => {
    assert.deepEqual(explorer.openSettingsPage('sleep'), { ok: true });
    assert.deepEqual(calls[0].args, ['ms-settings:powersleep']);
    for (const other of ['privacy', 'ms-settings:privacy', '__proto__', 'constructor', '']) {
      assert.equal(explorer.openSettingsPage(other).ok, false, `opened ${other}`);
    }
    assert.equal(calls.length, 1, 'a page outside the list reached Explorer');
  });
});

test('THE LIVE GATE: with no runner and no production opt-in, a test process throws instead of spawning Explorer', () => {
  explorer.setStatForTests(() => DIRECTORY);
  try {
    assert.throws(() => explorer.openFolder(FOLDER), /tried to execute .*explorer\.exe.* for real inside a test/i);
    assert.throws(() => explorer.openSettingsPage('sleep'), /for real inside a test/i);
  } finally {
    explorer.setStatForTests(null);
  }
});

test('the launch never waits on an exit code: success is answered from the spawn itself (source-pinned)', () => {
  /* Explorer exits 1 when the window opened. A launcher that used execFileSync or read
     the exit status would report every success as a failure, which is exactly what
     this module exists to avoid, so the shape is pinned. */
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'win32explorer.js'), 'utf8');
  assert.match(src, /spawn\(exe, args, \{ detached: true, stdio: 'ignore', windowsHide: false, shell: false \}\)/);
  assert.match(src, /child\.unref\(\);\s*return \{ ok: true \};/);
  assert.doesNotMatch(src, /execFileSync|spawnSync|\.on\('exit'|\.on\('close'/, 'the launcher waits on Explorer\'s exit status');
});
