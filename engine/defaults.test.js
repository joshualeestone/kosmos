'use strict';

/**
 * The operating defaults' own suite (#539). This file is cited by
 * defaults.js's no-em-dash comment and did not exist until the doctrine
 * seam landed; the first test below makes that comment true instead of
 * aspirational.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const defaults = require('./defaults');

test('the composed block carries no em dash, because it teaches that rule', () => {
  assert.ok(!defaults.block().includes('—'),
    'the block contains an em dash while instructing agents never to use one');
  assert.ok(!defaults.block().includes('–'), 'an en dash is the same rule in a thinner coat');
});

test('appendTo refuses to add the block twice, keyed on the sentence a person is least likely to reformat', () => {
  const once = defaults.appendTo('# My agent\n');
  assert.equal(defaults.appendTo(once), once);
});

/* ⚠️ THE PAIRING GUARD (#539). The doctrine version is only meaningful if it
   moves WITH the text: editing BLOCK without bumping quietly tells every
   agent it is current, and bumping without editing banners the whole fleet
   over nothing. So the fingerprint of the composed block is pinned against
   the version, and whichever half moves alone reds here with instructions.
   When you change the block ON PURPOSE: bump DOCTRINE_VERSION, add a line
   to its log, and update the fingerprint below to the one this failure
   prints. That is the whole ceremony, and it is deliberately one line of
   friction. */
test('the doctrine version and the block text move together', () => {
  const print = crypto.createHash('sha256').update(defaults.block()).digest('hex').slice(0, 16);
  const PINNED = { 3: '78435e4dc9286b30' };
  assert.ok(PINNED[defaults.DOCTRINE_VERSION],
    `DOCTRINE_VERSION ${defaults.DOCTRINE_VERSION} has no pinned fingerprint: add {${defaults.DOCTRINE_VERSION}: '${print}'} here and a line to the version log in defaults.js`);
  assert.equal(print, PINNED[defaults.DOCTRINE_VERSION],
    `the block's text changed but DOCTRINE_VERSION did not: bump it, log it, and pin the new fingerprint '${print}'`);
});

test('sections are DERIVED from the block: they re-join to it byte-for-byte', () => {
  const rejoined = defaults.sections().map((s) => s.text).join('\n');
  assert.equal(rejoined, defaults.block());
  assert.ok(defaults.sections().length >= 10, 'the block lost most of its sections');
  assert.equal(defaults.sections()[0].heading, '## How you work, whatever the job');
});

test('missingFrom names what a file lacks, and a complete file lacks nothing', () => {
  const full = defaults.appendTo('# My agent\n');
  assert.deepEqual(defaults.missingFrom(full), []);
  const none = defaults.missingFrom('# My agent\n\nJust my own words.\n');
  assert.equal(none.length, defaults.sections().length, 'a block-less file is not missing every section');
  /* A file with SOME sections: the person kept two, the refresh offers the
     rest and never the two they have -- heading-match presence, which the
     consent dialog makes safe by showing exactly what would be added. */
  const partial = '# My agent\n\n## How you work, whatever the job\n\nedited by hand\n\n### Never wait silently\n\nmy version\n';
  const missing = defaults.missingFrom(partial);
  assert.ok(!missing.some((s) => s.heading === '### Never wait silently'), 'a section the person carries was offered again');
  assert.ok(!missing.some((s) => s.heading === '## How you work, whatever the job'));
  assert.ok(missing.some((s) => s.heading === '### When you have been wrong'), 'an absent section was not offered');
});
