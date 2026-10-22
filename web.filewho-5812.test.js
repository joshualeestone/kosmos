'use strict';
/* #5812: a project's Files row says which agent changed the file last when the board names one (pjDocMeta, lifted).
 *   node --test web.filewho-5812.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));
const meta = new Function(page.lift(SCRIPT, 'pjSize') + '\n' + page.lift(SCRIPT, 'pjDocMeta') + '\n' + page.lift(SCRIPT, 'fileFingerprint') + '\nreturn pjDocMeta;')();

test('#5812: a row with a writer says "changed by"; one without says nothing about who', () => {
  const modified = '2026-10-10T20:00:00Z';
  const day = new Date(modified).toLocaleDateString();
  const without = meta({ name: 'a.md', size: 2048, modified });
  assert.match(without, new RegExp(' · ' + day.replace(/[/.]/g, '\\$&') + '$'));
  assert.doesNotMatch(without, /changed by/);
  assert.equal(meta({ name: 'a.md', size: 2048, modified, changedBy: 'Mona Lisa' }), without + ' · changed by Mona Lisa');
  assert.equal(meta({ name: 'a.md', size: 2048, modified, changedBy: '' }), without, 'an empty writer was shown');
});

test('#5812: the Files page paints its rows with pjDocMeta', () => {
  const body = page.lift(SCRIPT, 'pjDocsPaintPage');
  assert.match(body, /w\.textContent = pjDocMeta\(f\);/);
});
