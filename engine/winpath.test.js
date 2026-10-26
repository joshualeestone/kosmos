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

/* #7249: the one classifier pins every spelling the 7221 suite uses to exactly one kind. This is
   the table the card asks for, run as a guard: if a spelling drifts to another kind, or classify
   returns a kind outside the set, it is red on every platform (so Windows CI exercises it too). */
test('#7249: classify pins every spelling the suite uses to exactly one kind', () => {
  const KINDS = ['local-volume', 'local-drive', 'share', 'no-file-namespace', 'unplaceable', 'local-other'];
  const TABLE = [
    // local-volume: a volume named without a drive letter, and its NT and Shadow Copy forms
    [String.raw`\\?\Volume{8567e582-9e23-4c72-a97e-1fbdfc2f255f}\work`, 'local-volume'],
    [String.raw`\\?\GLOBALROOT\Device\HarddiskVolume3\work`, 'local-volume'],
    [String.raw`\\?\GLOBALROOT\Device\HarddiskVolumeShadowCopy1\x`, 'local-volume'],
    [String.raw`\??\Volume{8567e582-9e23-4c72-a97e-1fbdfc2f255f}\x`, 'local-volume'],
    [String.raw`\??\GLOBALROOT\Device\HarddiskVolumeShadowCopy12\x`, 'local-volume'],
    // local-drive: the plain, long, NT and DosDevices-alias spellings of a drive letter
    [String.raw`C:\x`, 'local-drive'], [String.raw`c:/Users/a/f`, 'local-drive'],
    [String.raw`\\?\C:\Users\a\f.txt`, 'local-drive'], [String.raw`\\.\C:\work\inner`, 'local-drive'],
    [String.raw`\??\C:\x`, 'local-drive'], [String.raw`\??\Global\C:\data`, 'local-drive'],
    [String.raw`\\?\Global\C:\data`, 'local-drive'], [String.raw`\\?\GLOBALROOT\GLOBAL??\D:\x`, 'local-drive'],
    [String.raw`\\?\GLOBALROOT\??\E:\x`, 'local-drive'], [String.raw`\\?\Global\Global\C:\work\nested`, 'local-drive'],
    // share: the plain, UNC-namespace, Mup, GLOBAL?? and NT spellings
    [String.raw`\\host\share\x`, 'share'], ['//host/share/x', 'share'],
    [String.raw`\\?\UNC\host\share`, 'share'], [String.raw`\??\UNC\host\share\x`, 'share'],
    [String.raw`\\?\GLOBALROOT\Device\Mup\Host\Share\x`, 'share'], [String.raw`\??\GLOBALROOT\Device\Mup\host\share`, 'share'],
    [String.raw`\??\Global\UNC\Host\Share\x`, 'share'], [String.raw`\\?\GLOBALROOT\GLOBAL??\UNC\host\share`, 'share'],
    // no-file-namespace: a pipe, a mailslot, a DOS device namespace
    [String.raw`\\.\pipe\x`, 'no-file-namespace'], [String.raw`\\.\mailslot\m`, 'no-file-namespace'],
    [String.raw`\\.\COM1`, 'no-file-namespace'], ['\\\\.\\LPT2\\', 'no-file-namespace'],
    [String.raw`\\.\NUL`, 'no-file-namespace'], [String.raw`\??\pipe\x`, 'no-file-namespace'],
    // unplaceable: network-spelled, names no drive/volume/share
    [String.raw`\\.\Weird\x`, 'unplaceable'], [String.raw`\\?\GLOBALROOT\Device\Something`, 'unplaceable'],
    [String.raw`\??\GLOBALROOT\Device\LanmanRedirector\host\share`, 'unplaceable'],
    [String.raw`\\?\Global\GLOBALROOT\x`, 'unplaceable'],
    // local-other: names no drive at all
    [String.raw`\Users\a\Files\f.txt`, 'local-other'], [String.raw`..\other\f.txt`, 'local-other'],
    ['f.txt', 'local-other'],
  ];
  for (const [spelling, kind] of TABLE) {
    const c = winpath.classify(spelling);
    assert.ok(KINDS.includes(c.kind), spelling + ': kind ' + c.kind + ' is not one of the documented set');
    assert.equal(c.kind, kind, spelling);
  }
  // the share kind carries its server\share; a local-drive carries its letter
  assert.equal(winpath.classify(String.raw`\\?\GLOBALROOT\Device\Mup\Host\Share\x`).share, 'host\\share');
  assert.equal(winpath.classify(String.raw`\??\Global\C:\data`).drive, 'C');
  // the subtlety pinned: a DosDevices drive alias is local-drive by kind, yet networkSpelled by shape
  const alias = winpath.classify(String.raw`\??\Global\C:\data`);
  assert.equal(alias.kind, 'local-drive');
  assert.equal(alias.networkSpelled, true, 'the alias keeps the old network SHAPE, so isNetworkSpelling is unchanged');
});
