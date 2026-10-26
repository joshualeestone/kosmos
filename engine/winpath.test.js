'use strict';

/**
 * #7221: engine/winpath.js's WINDOWS_DEVICE_NAME is the one device-name rule engine/backuprestore.js and engine/win32zip.js
 * now share. It must stay exactly the rule backuprestore had before (literal spaces before an extension, no CLOCK$), so
 * an edit made for one caller cannot widen what a Mac backup refuses to restore. win32zip adds CLOCK$ on top, in its own
 * file. Pure: runs on every platform. The Windows attach rules built on winpath are in replyfile.win32-7221.test.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const winpath = require('./winpath');

/* backuprestore's rule as it was before #7221, kept here as the reference the shared rule must equal. */
const BACKUPRESTORE_BEFORE = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³]) *(\..*)?$/i;

const NAMES = [
  'CON', 'con', 'PRN', 'aux', 'NUL', 'nul.txt', 'nul .txt', 'con  .txt', 'CONIN$', 'conout$', 'COM0', 'COM1', 'com9',
  'COM¹', 'COM²', 'LPT³', 'LPT1', 'lpt9.log', 'CLOCK$', 'clock$.txt', 'COM10', 'LPT', 'console', 'null',
  'nul .txt', 'con　.txt', 'nul\t.txt', 'aux_notes.md', 'report.pdf', 'x.nul', '', 'nul.', 'NUL ',
];

test('#7221: the shared device-name rule refuses exactly what backuprestore refused before', () => {
  for (const name of NAMES) {
    assert.equal(winpath.WINDOWS_DEVICE_NAME.test(name), BACKUPRESTORE_BEFORE.test(name), JSON.stringify(name));
  }
});

test('#7221: the shared device-name rule carries no global or sticky flag, so sharing one object is stateless', () => {
  assert.equal(winpath.WINDOWS_DEVICE_NAME.global, false);
  assert.equal(winpath.WINDOWS_DEVICE_NAME.sticky, false);
  assert.equal(winpath.WINDOWS_DEVICE_NAME.test('NUL'), true);
  assert.equal(winpath.WINDOWS_DEVICE_NAME.test('NUL'), true, 'asked twice, the same answer');
});

test('#7221: mayHold lets an 8.3 short name in a folder stand for any one long name, and only one', () => {
  const folder = String.raw`\\127.0.0.1\C$\Users\RUNNER~1\AppData\Local\Temp\aw\s16outer\nested`;
  const real = String.raw`\\127.0.0.1\C$\Users\runneradmin\AppData\Local\Temp\aw\s16outer\nested\secret.txt`;
  assert.equal(winpath.mayHold(folder, real, real), true, 'a file under the long name the short one stands for');
  // CONTROLS: a file beside the folder, and one a level short of it, are not held
  const beside = String.raw`\\127.0.0.1\C$\Users\runneradmin\AppData\Local\Temp\aw\s16outer\mine.txt`;
  assert.equal(winpath.mayHold(folder, beside, beside), false);
  const shallow = String.raw`\\127.0.0.1\C$\Users\runneradmin\nested\secret.txt`;
  assert.equal(winpath.mayHold(folder, shallow, shallow), false);
  // the same on a drive, and with the short name on the file's side
  assert.equal(winpath.mayHold(String.raw`C:\PROGRA~1\App`, String.raw`C:\Program Files\App\x.txt`, String.raw`C:\Program Files\App\x.txt`), true);
  assert.equal(winpath.mayHold(String.raw`C:\Program Files\App`, String.raw`C:\PROGRA~1\App\x.txt`, String.raw`C:\Program Files\Other\x.txt`), true);
  assert.equal(winpath.mayHold(String.raw`C:\Program Files\App`, String.raw`C:\Program Files\Other\x.txt`, String.raw`C:\Program Files\Other\x.txt`), false);
});
