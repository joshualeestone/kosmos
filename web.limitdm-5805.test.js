'use strict';
/* #5805 slice 2b: only the DM thread composer (which shows a held row and Send now anyway) is held; the terminal
 * composer and the assistant bar post with anyway: true, typed straight in as before, since they have no held state.
 *   node --test web.limitdm-5805.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

test('#5805 2b review 2: every non-automatic POST to a thread route says whether it may be held', () => {
  const posts = [...PAGE.matchAll(/encodeURIComponent\(([A-Za-z.]+)\) \+ '\/thread', \{[\s\S]{0,400}?body: JSON\.stringify\(([^)]*)\)/g)].map((m) => m[2]);
  assert.ok(posts.length >= 3, 'CONTROL: the thread POSTs were not found: ' + posts.length);
  const anyway = posts.filter((b) => /anyway: true/.test(b));
  assert.equal(anyway.length, 2, 'the terminal composer and the assistant bar must send anyway: true: ' + JSON.stringify(posts));
});
