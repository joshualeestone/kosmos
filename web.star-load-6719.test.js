'use strict';

/**
 * #6719 review 7: the stars' reload keeps the last set when the board says it could not read its stars file
 * ({ names: [], ok: false }), rather than unpinning every agent; and an agent with no session name gets no star,
 * since a press could only be refused. Runs the page's real loadStars and starBtn.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync(require.resolve('./web/index.html'), 'utf8');
function slice(start, end) {
  const from = PAGE.indexOf(start);
  const to = PAGE.indexOf(end, from);
  assert.ok(from > -1 && to > from, `${start} moved; re-anchor`);
  return PAGE.slice(from, to);
}
const LOAD = slice('async function loadStars() {', '/* Drawn at once');
const BTN = slice('function starBtn(a) {', '/* A repaint rebuilds');

function page(answer) {
  // eslint-disable-next-line no-new-func
  return new Function('fetch', [
    "let AGENT_STARS = new Set(['renet']); let BOARD_STARS = new Set(['renet']); let STARS_SEQ = 0; let STARS_WRITING = 0;",
    'let PAINTS = 0; const repaintAgentOrder = () => { PAINTS += 1; };',
    "const esc = (s) => String(s); const STAR_SVG = '';",
    LOAD, BTN,
    'return { loadStars, starBtn, stars: () => [...AGENT_STARS].sort(), board: () => [...BOARD_STARS].sort(), paints: () => PAINTS };',
  ].join('\n'))(async () => ({ ok: true, json: async () => answer }));
}

test('#6719 review 7: an unreadable stars file (ok false) leaves the stars as they were', async () => {
  const p = page({ names: [], ok: false });
  await p.loadStars();
  assert.deepEqual(p.stars(), ['renet'], 'the page unpinned its stars on a read the board said had failed');
  assert.deepEqual(p.board(), ['renet'], 'a failed read replaced the confirmed stars a failed save goes back to');
  assert.equal(p.paints(), 0);
});

test('#6719 review 7 CONTROL: a good read with no stars does clear them', async () => {
  const p = page({ names: [], ok: true });
  await p.loadStars();
  assert.deepEqual(p.stars(), []);
  assert.deepEqual(p.board(), []);
  assert.equal(p.paints(), 1);
});

test('#6719 review 7: an agent with no session name has no star; one with a name has one', () => {
  const p = page({ names: [], ok: true });
  assert.equal(p.starBtn({ name: 'Echo' }), '');
  assert.equal(p.starBtn({ name: 'Echo', sessionName: '' }), '');
  assert.match(p.starBtn({ name: 'Renet', sessionName: 'renet' }), /data-star="renet"[^>]*aria-label="Unstar Renet"/);
});
