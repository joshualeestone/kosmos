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
    sent.push({ body, answer: (names) => resolve({ ok: true, json: async () => ({ names, ok: true }) }),
      fail: () => resolve({ ok: false, json: async () => ({ error: 'no' }) }),
      refuse: (status, error) => resolve({ ok: false, status, json: async () => ({ error }) }) });
  });
  const msg = { textContent: '', hidden: true };
  const doc = { getElementById: (id) => (id === 'board-msg' ? msg : null) };
  // eslint-disable-next-line no-new-func
  const api = new Function('fetch', 'document', [
    'let AGENT_STARS = new Set(); let BOARD_STARS = new Set(); let STARS_SEQ = 0; let STARS_WRITING = 0;',
    "const STAR_MSG = { saved: 's', removed: 'r', full: 'f', stuck: 'k', refused: 'x' };",
    'let THROWS = 0; const repaintAgentOrder = () => { if (THROWS > 0) { THROWS -= 1; throw new Error(\'render\'); } };',
    PAGE.slice(from, to),
    'return { toggleStar, stars: () => [...AGENT_STARS].sort(), writing: () => STARS_WRITING, throwNext: (n) => { THROWS = n; } };',
  ].join('\n'))(fetch, doc);
  return { api, sent, msg };
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

test('#6719 review 4: two stars saved side by side keep both, whichever answer comes back last', async () => {
  const { api, sent } = page();
  const p1 = api.toggleStar('renet');
  const p2 = api.toggleStar('angel');
  await tick();
  sent[1].answer(['angel']);            // the board did angel's first, so its answer has no renet
  await tick();
  assert.deepEqual(api.stars(), ['angel', 'renet'], 'angel\'s answer took renet\'s star off while renet\'s save was in flight');
  sent[0].answer(['angel', 'renet']);   // then renet's
  await Promise.all([p1, p2]);
  assert.deepEqual(api.stars(), ['angel', 'renet'], 'an older answer for another star dropped one the board kept');
});

test('#6719 review 4: a save that throws does not stop the next press on that star, nor leave a write counted', async () => {
  const { api, sent } = page();
  const p1 = api.toggleStar('renet');   // star
  await tick();
  api.throwNext(1);                     // the repaint after the board's answer throws
  sent[0].answer(['renet']);
  await p1;
  const p2 = api.toggleStar('renet');   // unstar
  await tick();
  assert.equal(sent.length, 2, 'a press after a save that threw was never sent');
  sent[1].answer([]);
  await p2;
  assert.equal(api.writing(), 0, 'a write that threw stayed counted, so the 30 s reload never runs again');
  assert.deepEqual(api.stars(), []);
});

test('#6719 review 5: when every save fails, the star goes back to what the board last confirmed, not to an unsaved press', async () => {
  const { api, sent, msg } = page();     // the board holds no stars
  const p1 = api.toggleStar('renet');   // star
  const p2 = api.toggleStar('renet');   // unstar, at once
  await tick();
  sent[0].fail();
  await tick(); await tick();
  sent[1].fail();
  await Promise.all([p1, p2]);
  assert.deepEqual(api.stars(), [], 'a star the board never held was put back');
  assert.equal(msg.hidden, true, 'it said a star could not be removed when the board shows what was asked for');
});

test('#6719 review 5 CONTROL: a failed star on an agent the board does not hold goes back, and says so', async () => {
  const { api, sent, msg } = page();
  const p1 = api.toggleStar('renet');
  await tick();
  sent[0].fail();
  await p1;
  assert.deepEqual(api.stars(), []);
  assert.equal(msg.hidden, false);
  assert.equal(msg.textContent, 's');
});

test('#6719 review 8: a repaint that throws after a good answer is not taken for a failed save', async () => {
  const { api, sent, msg } = page();
  const p1 = api.toggleStar('renet');
  await tick();
  api.throwNext(1);                     // the repaint after the board's answer throws
  sent[0].answer(['renet']);
  await p1;
  assert.deepEqual(api.stars(), ['renet'], 'a saved star was put back because the repaint after it threw');
  assert.equal(msg.hidden, true, 'a saved star said it could not be saved');
});

test('#6719 review 8: a refusal no retry can fix says what is wrong, not "try again"; review 10: another 5xx still says try again', async () => {
  for (const [status, error, line] of [[400, 'too many starred agents', 'f'], [500, 'we could not save that star', 'k'], [400, 'not an agent name', 'x'], [500, 'Bad Gateway', 's'], [502, 'Bad Gateway', 's']]) {
    const { api, sent, msg } = page();
    const p1 = api.toggleStar('renet');
    await tick();
    sent[0].refuse(status, error);
    await p1;
    assert.deepEqual(api.stars(), []);
    assert.equal(msg.textContent, line, `${status} ${error} showed the wrong line`);
  }
});

test('#6719 review 11: a press whose repaint throws still sends its save', async () => {
  const { api, sent } = page();
  api.throwNext(1);                     // the press's own repaint throws
  const p1 = api.toggleStar('renet');
  await tick();
  assert.equal(sent.length, 1, 'the save never went because the press\'s repaint threw');
  sent[0].answer(['renet']);
  await p1;
  assert.deepEqual(api.stars(), ['renet']);
  assert.equal(api.writing(), 0);
});
