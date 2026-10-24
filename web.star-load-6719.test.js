'use strict';

/**
 * #6719 review 7: the stars' reload keeps the last set when the board says it could not read its stars file
 * ({ names: [], ok: false }), rather than unpinning every agent; and an agent with no session name gets no star,
 * since a press could only be refused. Runs the page's real loadStars and starBtn.
 */
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
/* The board's REAL cards (fixture-discipline): sandbox the roots before requiring the fleet. */
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'star-load-6719-'));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('./test-support/fleet');
const BOARD = fleet.install([fleet.agent('renet', { displayName: 'Renet' })]);
test.after(() => { try { BOARD.restore(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const PAGE = fs.readFileSync(require.resolve('./web/index.html'), 'utf8');
function slice(start, end) {
  const from = PAGE.indexOf(start);
  const to = PAGE.indexOf(end, from);
  assert.ok(from > -1 && to > from, `${start} moved; re-anchor`);
  return PAGE.slice(from, to);
}
const LOAD = slice('async function loadStars() {', '/* Drawn at once');
const BTN = slice('function starBtn(a) {', '/* A repaint rebuilds');

function page(answer, line = '') {
  const msg = { textContent: line, hidden: !line };
  // eslint-disable-next-line no-new-func
  const api = new Function('fetch', 'document', [
    "let AGENT_STARS = new Set(['renet']); let BOARD_STARS = new Set(['renet']); let STARS_SEQ = 0; let STARS_WRITING = 0;",
    'let PAINTS = 0; const repaintAgentOrder = () => { PAINTS += 1; };',
    "const esc = (s) => String(s); const STAR_SVG = ''; const STAR_MSG = { saved: 's', removed: 'r', full: 'f', stuck: 'k', refused: 'x' };",
    LOAD, BTN,
    'return { loadStars, starBtn, stars: () => [...AGENT_STARS].sort(), board: () => [...BOARD_STARS].sort(), paints: () => PAINTS };',
  ].join('\n'))(async () => ({ ok: true, json: async () => answer }), { getElementById: (id) => (id === 'board-msg' ? msg : null) });
  api.msg = msg;
  return api;
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
  // A real card, then the same card with only its session name gone or blank (as another computer's agent arrives).
  const renet = BOARD.agents.find((a) => a.sessionName === 'renet');
  assert.ok(renet, 'the fleet did not produce the renet card');
  const none = { ...renet }; delete none.sessionName;
  const blank = { ...renet }; blank.sessionName = '';
  assert.equal(p.starBtn(none), '');
  assert.equal(p.starBtn(blank), '');
  assert.match(p.starBtn(renet), /data-star="renet"[^>]*aria-label="Unstar Renet"/);
});

test('#6719 review 11: a good read clears a star\'s failed-save line; another receipt is left alone (CONTROL)', async () => {
  const stale = page({ names: ['renet'], ok: true }, 's');
  await stale.loadStars();
  assert.equal(stale.msg.hidden, true, 'a try-again line stayed on the board after the board answered');
  const other = page({ names: ['renet'], ok: true }, 'We could not open Renet.');
  await other.loadStars();
  assert.equal(other.msg.hidden, false, 'the stars reload cleared a line that was not its own');
  const failed = page({ names: [], ok: false }, 's');
  await failed.loadStars();
  assert.equal(failed.msg.hidden, false, 'a read the board said failed cleared the line');
});
