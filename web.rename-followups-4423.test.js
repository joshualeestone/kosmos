'use strict';
require('./test-support/tmpscope');   // #4273: this file's temp dirs are removed when it exits

/**
 * #4423 (follow-up to #4421): the page surfaces that kept an OLD name, or showed the internal id, after a rename,
 * each run with the page's REAL functions (lifted from web/index.html) on real fleet cards:
 *   - the agent page's title line and Reports-to menu follow the fresh card every poll (followCard), the menu only
 *     while it still shows the saved choice and is not focused;
 *   - a pending "Replying to" strip, in a DM and in a room, names the sender as they are called NOW;
 *   - the reactions tooltip names reactors by their card, not their session id;
 *   - a former project member's picture falls back to the board's card (source pin).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const page = require('./test-support/page');
const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-rename-followups-4423-web-')));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
const fleet = require('./test-support/fleet');

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));

function cardOf(key, opts) {
  const board = fleet.install([fleet.agent(key, { state: 'idle', ...opts })]);
  try { return board.agents.find((c) => c.sessionName === key); } finally { board.restore(); }
}
/* In this order: a displayName writes the agent's own name file, so the id-named card comes first. */
const APRIL_OLD = cardOf('april', {});
const APRIL = cardOf('april', { displayName: 'April Ludgate' });
const LEAD = cardOf('lead-a', { displayName: 'Leslie Knope' });

test('#4423 fixture: real cards, before and after a rename', () => {
  assert.equal(APRIL_OLD.name, 'april');
  assert.equal(APRIL.name, 'April Ludgate');
});

function followWorld({ selValue = '', shown = selValue, focused = false } = {}) {
  const sel = { value: selValue, dataset: { shown } };
  const doc = { getElementById: (id) => (id === 'd-reports' ? sel : null), get activeElement() { return focused ? sel : null; } };
  const metas = []; const reports = [];
  const src = 'let CURRENT = null;\n' + page.lift(SCRIPT, 'followCard') + '\nreturn { set: (c) => { CURRENT = c; }, followCard };';
  // eslint-disable-next-line no-new-func
  const w = new Function('document', 'paintDetailMeta', 'paintReportsTo', src)(doc, (a) => metas.push(a), (a) => reports.push(a));
  return { ...w, metas, reports, sel };
}

test('#4423: the title line follows the card every poll, and the Reports-to menu too while untouched', () => {
  const fresh = { ...LEAD, profile: { ...(LEAD.profile || {}), reportsTo: 'april' } };
  const w = followWorld({ selValue: 'april' });
  w.set({ ...LEAD });
  w.followCard(fresh);
  assert.deepEqual(w.metas, [fresh], 'the title line was not repainted from the fresh card');
  assert.deepEqual(w.reports, [fresh], 'the Reports-to menu (which names the other agents) was not repainted');
});

test('#4423: a Reports-to choice somebody picked and has not saved is theirs: no repaint', () => {
  const fresh = { ...LEAD, profile: { ...(LEAD.profile || {}), reportsTo: 'april' } };
  const picked = followWorld({ selValue: '', shown: 'april' });   // they chose "You"; the menu last showed april
  picked.set({ ...LEAD });
  picked.followCard(fresh);
  assert.deepEqual(picked.reports, [], 'an unsaved choice was put back to the saved one');
  const focused = followWorld({ selValue: 'april', focused: true });
  focused.set({ ...LEAD });
  focused.followCard(fresh);
  assert.deepEqual(focused.reports, [], 'the menu was repainted under somebody\'s cursor');
  assert.equal(picked.metas.length + focused.metas.length, 2, 'the title line still follows');
});

test('#4423: a pending DM reply names the sender as they are called NOW, and redraws when that changes', () => {
  const el = { dataset: {}, hidden: true, innerHTML: '' };
  const doc = { getElementById: (id) => (id === 'd-reply' ? el : null) };
  const src = 'let LAST = [];\nlet CURRENT = null;\nlet DM_ROWS_NAME = "";\nconst DM_REPLY = {};\n'
    + page.liftAll(SCRIPT, ['esc', 'tskAgentName', 'dmWho', 'dmReplyPaint'])
    + '\nreturn { setLast: (l) => { LAST = l; }, set: (c) => { CURRENT = c; }, reply: (a, r) => { DM_REPLY[a] = r; }, dmReplyPaint };';
  // eslint-disable-next-line no-new-func
  const w = new Function('document', src)(doc);
  w.set({ ...LEAD });   // the open agent; the reply is to a message from somebody else
  w.reply('lead-a', { at: 't1', from: 'april', who: 'april', words: 'the layout' });
  w.setLast([APRIL_OLD]);
  w.dmReplyPaint('lead-a');
  assert.match(el.innerHTML, /Replying to <b>april<\/b>/, 'fixture: the strip before the rename');
  w.setLast([APRIL]);
  w.dmReplyPaint('lead-a');
  assert.match(el.innerHTML, /Replying to <b>April Ludgate<\/b>/, 'the strip kept the name taken at the Reply click');
});

test('#4423: a pending room reply names the sender as they are called NOW', () => {
  const el = { hidden: true, innerHTML: '' };
  const doc = { getElementById: (id) => (id === 'pj-reply' ? el : null) };
  const src = 'let LAST = [];\nconst PJ_REPLY = {};\n' + page.liftAll(SCRIPT, ['esc', 'tskAgentName', 'pjNameOf', 'pjReplyPaint'])
    + '\nreturn { reply: (p, r) => { PJ_REPLY[p] = r; }, pjReplyPaint };';
  let project = { id: 'p1', agents: [APRIL_OLD] };
  // eslint-disable-next-line no-new-func
  const w = new Function('document', 'pjById', src)(doc, () => project);
  w.reply('p1', { id: 'm1', from: 'april', who: 'april', words: 'the layout', mention: null });
  project = { id: 'p1', agents: [APRIL] };   // the projects poll brought the new name
  w.pjReplyPaint('p1');
  assert.match(el.innerHTML, /Replying to <b>April Ludgate<\/b>/, 'the room strip kept the name taken at the Reply click');
});

test('#4423: the reactions tooltip names reactors by their card, not their session id, and keeps "you"', () => {
  const src = 'let LAST = [];\n' + page.liftConst(SCRIPT, 'RXN_DEFAULTS') + '\n' + page.liftAll(SCRIPT, ['esc', 'tskAgentName', 'rxnsInner'])
    + '\nreturn { setLast: (l) => { LAST = l; }, rxnsInner };';
  // eslint-disable-next-line no-new-func
  const w = new Function(src)();
  w.setLast([APRIL]);
  const html = w.rxnsInner([{ emoji: '👍', count: 2, who: ['you', 'april'], mine: true }], false);
  assert.match(html, /title="you, April Ludgate"/, 'the tooltip showed a session id: ' + html);
});

test('#4423: a former project member\'s picture falls back to the board\'s card (its photo)', () => {
  const row = page.lift(SCRIPT, 'pjRoomRow');
  assert.match(row, /\(p\.agents \|\| \[\]\)\.find\(\(a\) => a\.sessionName === m\.from\)\s*\n?\s*\|\| \(\(typeof LAST !== 'undefined'/,
    'a former member\'s photo is looked up among current members only again');
});

test('#4423: the menu follows while it shows what it was painted with, even when the record names an agent not listed', () => {
  /* The record says "gone-agent" (removed), so the menu showed "You"; comparing with the record would have read that as
     an unsaved pick and stopped the menu following for good. */
  const fresh = { ...LEAD, profile: { ...(LEAD.profile || {}), reportsTo: 'gone-agent' } };
  const w = followWorld({ selValue: '', shown: '' });
  w.set({ ...LEAD });
  w.followCard(fresh);
  assert.deepEqual(w.reports, [fresh], 'a menu showing "You" for a record naming a removed agent stopped following');
});

test('#4423: the Reports-to menu is rewritten only when what it would write changed (not every poll)', () => {
  let writes = 0;
  const sel = { dataset: {}, value: '', set innerHTML(v) { writes += 1; this._h = v; }, get innerHTML() { return (this._h || '').replace(/ selected>/g, ' selected="">'); } };
  const wrap = { hidden: true };
  const doc = { getElementById: (id) => (id === 'd-reports' ? sel : id === 'd-reports-wrap' ? wrap : null) };
  const src = 'let LAST = [];\nlet YOU_NAME = "Josh";\n' + page.liftAll(SCRIPT, ['esc', 'paintReportsTo'])
    + '\nreturn { setLast: (l) => { LAST = l; }, paintReportsTo };';
  // eslint-disable-next-line no-new-func
  const w = new Function('document', src)(doc);
  w.setLast([{ ...LEAD }, { ...APRIL }]);   // plain copies: paintReportsTo reads isGuide, which cards do not carry
  const me = { ...LEAD, profile: { reportsTo: 'april' } };
  w.paintReportsTo(me);
  w.paintReportsTo(me);   // the browser reads `selected` back differently, which used to rewrite every time
  assert.equal(writes, 1, 'the menu was rebuilt although nothing it shows changed');
  w.setLast([{ ...LEAD }, { ...APRIL, name: 'April Renamed' }]);
  w.paintReportsTo(me);
  assert.equal(writes, 2, 'a renamed agent in the list did not rewrite the menu');
});

test('#4423: the room repaints a pending reply on its own poll (paintRoom calls pjReplyPaint)', () => {
  const room = page.lift(SCRIPT, 'paintRoom');
  assert.match(room, /^\s*pjReplyPaint\(PJ_CURRENT\);/m, 'the room poll no longer repaints the pending reply strip');
});
