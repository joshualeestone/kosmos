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
  assert.match(row, /Your messages are not collected, though a log line can quote a few words of one\./);
  assert.match(row, /nothing is sent anywhere/);
  assert.doesNotMatch(row, /this Mac/);
});

test('#5959: a click also looks at the route with ?check=1 and says a refusal under the link', () => {
  const at = PAGE.indexOf("closest('#diag-save')");
  assert.ok(at > 0, 'the page listens for the link');
  const body = PAGE.slice(at, at + 900);
  assert.match(body, /fetch\('\/api\/diagnostics\?check=1'/);
  assert.match(body, /getElementById\('diag-note'\)/);
  assert.match(body, /'Not saved: '/);
  assert.match(PAGE, /<p class="dhint" id="diag-note" role="status"/);
});
