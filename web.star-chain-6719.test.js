'use strict';

/**
 * #6719 review 3: two quick presses on one star are saved one at a time, in press order. Sent as two concurrent PUTs
 * they could reach the board in either order, so the file kept the first press's answer while the page showed the
 * second's, and the next reload put the star back. Runs the page's real toggleStar and saveStar against a fetch that
 * answers only when the test says, so the order the PUTs START in is what is measured.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync(require.resolve('./web/index.html'), 'utf8');
const from = PAGE.indexOf('const STAR_CHAIN = new Map();');
const to = PAGE.indexOf('let AGENT_SORT = ', from);
assert.ok(from > -1 && to > from, 'toggleStar / saveStar moved; re-anchor');

function page() {
  const sent = [];
  const fetch = (url, init) => new Promise((resolve) => {
    const body = JSON.parse(init.body);
    sent.push({ body, answer: (names) => resolve({ ok: true, json: async () => ({ names, ok: true }) }) });
  });
  const doc = { getElementById: () => null };
  // eslint-disable-next-line no-new-func
  const api = new Function('fetch', 'document', [
    'let AGENT_STARS = new Set(); let STARS_SEQ = 0; let STARS_WRITING = 0;',
    "const STAR_MSG = { saved: 's', removed: 'r' };",
    'const repaintAgentOrder = () => {};',
    PAGE.slice(from, to),
    'return { toggleStar, stars: () => [...AGENT_STARS], writing: () => STARS_WRITING };',
  ].join('\n'))(fetch, doc);
  return { api, sent };
}
const tick = () => new Promise((r) => setImmediate(r));

test('#6719: a second press on the same star waits for the first save before it is sent', async () => {
  const { api, sent } = page();
  const p1 = api.toggleStar('renet');   // star
  const p2 = api.toggleStar('renet');   // unstar, at once
  await tick();
  assert.equal(sent.length, 1, 'the second save was sent while the first was still in flight');
  assert.deepEqual(sent[0].body, { name: 'renet', on: true });
  sent[0].answer(['renet']);
  await tick(); await tick();
  assert.equal(sent.length, 2, 'the second save never went once the first answered');
  assert.deepEqual(sent[1].body, { name: 'renet', on: false });
  sent[1].answer([]);
  await Promise.all([p1, p2]);
  assert.deepEqual(api.stars(), [], 'the page does not show the last press');
  assert.equal(api.writing(), 0, 'a write was left counted as in flight');
});

test('#6719 CONTROL: presses on two different stars are not held behind each other', async () => {
  const { api, sent } = page();
  const p1 = api.toggleStar('renet');
  const p2 = api.toggleStar('angel');
  await tick();
  assert.equal(sent.length, 2, 'a different agent\'s star waited for another\'s save');
  sent[0].answer(['renet']); sent[1].answer(['renet', 'angel']);
  await Promise.all([p1, p2]);
});
