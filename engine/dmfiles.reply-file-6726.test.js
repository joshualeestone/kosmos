'use strict';
/* #6726: the Files block teaches `kosmos reply --file` on every host. A Windows board left the paragraph out until
 * #7221 landed and one real Windows run attached a file (11-05); run on a Windows host this checks that gate is gone,
 * and on a Mac or Linux host that nothing there changed.
 *   node --test engine/dmfiles.reply-file-6726.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const dmfiles = require('./dmfiles');

test('#6726: the Files block teaches kosmos reply --file, with what can be attached and what to do otherwise', () => {
  const body = dmfiles.blockBody('C:\\Users\\someone\\work\\workers\\roo\\Files');
  assert.ok(body.includes('`kosmos reply --file <path> "what it is"`'), 'the block does not teach --file');
  assert.ok(body.includes('Only a file directly in your Files folder, or inside the folder of a project'), 'the limits are missing');
  assert.ok(body.includes('refuses it, tell them where you saved it.'), 'the fallback is missing');
  // CONTROL: the rest of the block is still there, so the paragraph was added to it, not swapped in for it.
  assert.ok(body.includes('Files'), 'the block lost its folder');
});
