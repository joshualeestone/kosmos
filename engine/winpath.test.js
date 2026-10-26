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
