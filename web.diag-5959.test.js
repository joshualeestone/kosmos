'use strict';

/* #5959 slice 4: "Save diagnostics" sits in Settings > Advanced and is a download link to the route. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

test('#5959: the Save diagnostics link is in the Advanced section and downloads GET /api/diagnostics', () => {
  const open = PAGE.indexOf('<section class="dsec" id="s-sec-advanced"');
  assert.ok(open > 0, 'CONTROL: the Advanced section is where this test looks');
  const close = PAGE.indexOf('<div class="dremove">', open);
  assert.ok(close > open, 'CONTROL: the end of its settings boxes is found');
  const advanced = PAGE.slice(open, close);
  const link = advanced.match(/<a [^>]*id="diag-save"[^>]*>([^<]*)<\/a>/);
  assert.ok(link, 'the link is inside the Advanced section');
  assert.match(link[0], / href="\/api\/diagnostics"/);
  assert.match(link[0], / download(?=[ >])/);
  assert.equal(link[1], 'Save diagnostics');
  assert.equal((PAGE.match(/id="diag-save"/g) || []).length, 1, 'one such link on the page');
});

test('#5959: the line under it says what is in the file, that it is redacted, and that nothing is sent', () => {
  const row = PAGE.slice(PAGE.indexOf('id="diag-row"'), PAGE.indexOf('id="diag-save"'));
  assert.ok(row.length > 0, 'CONTROL: the row is found');
  assert.match(row, /taken out first/);
  assert.match(row, /no messages are in it/);
  assert.match(row, /nothing is sent anywhere/);
  assert.doesNotMatch(row, /this Mac/);
});
