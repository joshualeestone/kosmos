'use strict';
/* #6726: the Files block teaches `kosmos reply --file` on every platform. A Windows board left the paragraph out until
 * #7221 landed and one real Windows run attached a file (11-05). The paragraph is fixed when engine/dmfiles.js loads,
 * so each platform is rendered in a child node that loads the module with process.platform set to it, on any host:
 * every CI run checks the Windows text and the Mac text.
 *   node --test engine/dmfiles.reply-file-6726.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DMFILES = path.join(__dirname, 'dmfiles.js');
/* The block as `platform` renders it. The platform is set only while the module loads, then put back. */
function blockOn(platform) {
  const js = [
    // What dmfiles requires, first and under the real platform: the store behind them refuses a data root built for
    // another platform's home layout. Only dmfiles itself then loads under the platform asked about.
    'for (const m of ["store.js", "projects.js", "instructions.js"]) require(require("node:path").join(require("node:path").dirname(process.argv[1]), m));',
    'const real = Object.getOwnPropertyDescriptor(process, "platform");',
    'Object.defineProperty(process, "platform", { value: process.argv[2], configurable: true });',
    'let d; try { d = require(process.argv[1]); } finally { Object.defineProperty(process, "platform", real); }',
    'process.stdout.write(d.blockBody("C:/Users/someone/work/workers/roo/Files"));',
  ].join('\n');
  return execFileSync(process.execPath, ['-e', js, DMFILES, platform], { encoding: 'utf8' });
}
const TEACH = '`kosmos reply --file <path> "what it is"`';
const TILDE = 'turn ~ into your home folder.';
const ELSEWHERE = 'When the conversation is about one of your projects';   // a line from outside the attach paragraph

test('#6726: on Windows the Files block teaches kosmos reply --file, and says ~ is not expanded in PowerShell', () => {
  const win = blockOn('win32');
  assert.ok(win.includes(TEACH), 'the Windows block does not teach --file');
  assert.ok(win.includes('Only a file directly in your Files folder, or inside the folder of a project'), 'the limits are missing');
  assert.ok(win.includes(TILDE), 'the Windows block does not say ~ is not expanded');
  assert.ok(win.includes(ELSEWHERE), 'CONTROL: the rest of the block is missing, so this is not the block');
});

test('#6726: on a Mac the Files block teaches --file without the Windows sentence', () => {
  const mac = blockOn('darwin');
  assert.ok(mac.includes(TEACH), 'the Mac block lost --file');
  assert.ok(!mac.includes(TILDE), 'the Windows sentence reached the Mac block');
  assert.ok(mac.includes(ELSEWHERE), 'CONTROL: the rest of the block is missing, so this is not the block');
});
