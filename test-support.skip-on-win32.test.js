'use strict';
/* kosmos#8378: skipOnWin32 skips only on Windows, always with a reason, and refuses a skip with none. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { skipOnWin32 } = require('./test-support/skip-on-win32');

test('on Windows it is the reason, so node:test skips and prints why', () => {
  assert.equal(skipOnWin32('it spawns bash', 'win32'), 'it spawns bash');
  assert.equal(skipOnWin32('  it needs tmux  ', 'win32'), 'it needs tmux');
});

test('on the Mac and Linux it is false, so the test runs', () => {
  assert.equal(skipOnWin32('it spawns bash', 'darwin'), false);
  assert.equal(skipOnWin32('it spawns bash', 'linux'), false);
});

test('with no reason it throws, on every platform', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    for (const bad of [undefined, null, '', '   ', 42, {}]) {
      assert.throws(() => skipOnWin32(bad, platform), /needs a reason/, `${platform} ${JSON.stringify(bad)}`);
    }
  }
});

test('it reads the real platform when none is passed', () => {
  assert.equal(skipOnWin32('x'), process.platform === 'win32' ? 'x' : false);
});
