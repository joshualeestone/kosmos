'use strict';

/**
 * #6214: the page's Stop the move. Lifts the page's real stopAccountMove and offerStopMove and drives them against
 * stated answers, with a small stand-in for the few DOM calls they make, so what is asserted is the request sent, the
 * one button offered, and the sentence the person reads after it. The places that offer it (the moving row in
 * Settings, and the refusals from Update, Roll back, Restart Kosmos and a Kosmos switch) are checked in the source,
 * because running them needs most of the page.
 */

const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
/* The board's REAL cards (fixture-discipline): sandbox the roots before requiring the fleet. */
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'stopmove-6214-'));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');
const fleet = require('./test-support/fleet');

const BOARD = fleet.install(['al', 'bo', 'cy', 'di'].map((n) => fleet.agent(n, { displayName: n[0].toUpperCase() + n[1] })));
const CARDS = BOARD.agents;
test.after(() => { try { BOARD.restore(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const HTML = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(HTML);
const SOURCE = page.liftAll(SCRIPT, ['stopAccountMove', 'offerStopMove']);

/* Just the DOM the two functions use: a parent with ordered children, sibling links, attributes and click. */
function el(tag) {
  const n = {
    tagName: tag.toUpperCase(), type: '', textContent: '', disabled: false, attrs: {}, listeners: {}, parentNode: null,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    hasAttribute(k) { return k in this.attrs; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    get nextElementSibling() { const p = this.parentNode; if (!p) return null; return p.kids[p.kids.indexOf(this) + 1] || null; },
    get nextSibling() { return this.nextElementSibling; },   // no text nodes in this stand-in
    remove() { const p = this.parentNode; if (p) { p.kids.splice(p.kids.indexOf(this), 1); this.parentNode = null; } },
    async click() { for (const fn of this.listeners.click || []) await fn(); },
  };
  return n;
}
function parent() {
  return {
    kids: [],
    append(c) { c.parentNode = this; this.kids.push(c); return c; },
    insertBefore(c, ref) { c.parentNode = this; const i = ref ? this.kids.indexOf(ref) : -1; if (i < 0) this.kids.push(c); else this.kids.splice(i, 0, c); },
  };
}

function load(answers, LAST = []) {
  const asked = [];
  const fetch = async (url, init) => {
    asked.push({ url, method: (init && init.method) || 'GET' });
    const a = answers.shift();
    if (!a) throw new Error(`no answer scripted for ${url}`);
    if (a.throws) throw new Error('Failed to fetch');
    if (a.aborts) { const e = new Error('The operation was aborted.'); e.name = 'AbortError'; throw e; }
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => { if (a.badJson) throw new Error('not json'); return a.body; } };
  };
  const document = { createElement: (t) => el(t) };
  // eslint-disable-next-line no-new-func
  const fns = new Function('fetch', 'document', 'LAST', `${SOURCE}\nreturn { stopAccountMove, offerStopMove };`)(fetch, document, LAST);
  return { ...fns, asked };
}

test('#6214: stopAccountMove posts to the stop route and says whose restart it waits for', async () => {
  const { stopAccountMove, asked } = load([{ status: 200, body: { id: 'm1', stopped: true, waitingFor: 'bo', agents: [] } }]);
  assert.deepEqual(await stopAccountMove(), { ok: true, said: '', waitingFor: 'bo' });
  assert.deepEqual(asked, [{ url: '/api/agents/account-moves/stop', method: 'POST' }]);
});

test('#6214: the restart it waits for is named as the person knows the agent, not by its session', async () => {
  const bo = CARDS.find((c) => c.name === 'Bo');
  assert.ok(bo && bo.sessionName && bo.sessionName !== 'Bo', 'PRECONDITION: the fleet card has a session name unlike its name');
  const { stopAccountMove } = load([{ status: 200, body: { stopped: true, waitingFor: bo.sessionName } }], CARDS);
  assert.equal((await stopAccountMove()).waitingFor, 'Bo');
  const unknown = load([{ status: 200, body: { stopped: true, waitingFor: 'zz' } }], CARDS);
  assert.equal((await unknown.stopAccountMove()).waitingFor, 'zz', 'an agent not on the board keeps the board\'s word');
});

test('#6214: a refused stop says the board\'s own words; a board that does not answer is said plainly', async () => {
  let f = load([{ status: 409, body: { outcome: 'refused', because: 'No account move is running.' } }]);
  assert.deepEqual(await f.stopAccountMove(), { ok: false, said: 'No account move is running.' });
  f = load([{ status: 500, badJson: true }]);
  assert.deepEqual(await f.stopAccountMove(), { ok: false, said: 'The move could not be stopped. Try again in a moment.' });
  f = load([{ aborts: true }]);
  assert.deepEqual(await f.stopAccountMove(), { ok: false, said: 'Kosmos took too long to answer, so the move may already be stopping. Check Settings, AI Models in a moment.' },
    'a stop that ran out of time is never said as failed (the board answers after the put-backs)');
  f = load([{ throws: true }]);
  assert.deepEqual(await f.stopAccountMove(), { ok: false, said: 'The move could not be stopped: Kosmos did not answer. Try again in a moment.' });
});

test('#6214: a refusal offers one Stop the move button, and pressing it says the move is stopping', async () => {
  const { offerStopMove } = load([{ status: 200, body: { stopped: true, waitingFor: 'bo' } }]);
  const box = parent();
  const say = box.append(el('p'));
  const after = box.append(el('span'));
  say.hidden = true;   // hidden since the refusal (the Update dialog was closed and opened again)
  offerStopMove(say, say);
  offerStopMove(say, say);
  assert.equal(box.kids.length, 3, 'offered twice, drawn once');
  const b = box.kids[1];
  assert.equal(b.textContent, 'Stop the move');
  assert.equal(b.type, 'button');
  assert.ok(b.hasAttribute('data-stop-move-offer'));
  assert.equal(box.kids[2], after, 'the button goes right after the sentence, not at the end');
  await b.click();
  assert.equal(box.kids.includes(b), false, 'a stop that worked takes its button away');
  assert.equal(say.hidden, false, 'the sentence was written into a hidden line');
  assert.ok(say.hasAttribute('data-stop-move-said'), 'the answer is not marked, so the toast repaint can erase it at once');
  assert.equal(say.textContent, 'The move will stop once bo has finished restarting. Kosmos puts the agents it had not reached back on their old account where it can, and Settings, AI Models shows which account each agent is on. Try again once the move has ended.');
});

test('#6214: with no restart under way the sentence names nobody; a refused press keeps the button to try again', async () => {
  let f = load([{ status: 200, body: { stopped: true } }]);
  let box = parent(); let say = box.append(el('p'));
  f.offerStopMove(say, say);
  await box.kids[1].click();
  assert.equal(say.textContent, 'The move will stop. Kosmos puts the agents it had not reached back on their old account where it can, and Settings, AI Models shows which account each agent is on. Try again once the move has ended.');

  f = load([{ status: 409, body: { outcome: 'refused', because: 'No account move is running.' } }]);
  box = parent(); say = box.append(el('p'));
  f.offerStopMove(say, say);
  const b = box.kids[1];
  await b.click();
  assert.equal(box.kids.includes(b), true);
  assert.equal(b.disabled, false);
  assert.equal(b.textContent, 'Stop the move');
  assert.equal(say.textContent, 'No account move is running.');
});

test('#6214: offerStopMove with nowhere to put the button does nothing (no throw)', () => {
  const { offerStopMove } = load([]);
  assert.doesNotThrow(() => offerStopMove(null, null));
  assert.doesNotThrow(() => offerStopMove(el('p'), null), 'an element not in the page');
});

test('#6214: the moving row draws Stop the move, and each board-restart refusal offers it when the board says moveStoppable', () => {
  const row = page.lift(SCRIPT, 'acctUsageHtml');
  assert.match(row, /\+ \(busy && st\.onBoard \? '<button type="button" data-acct-move-stop' \+ \(st\.stopping \? ' disabled' : ''\) \+ '>' \+ \(st\.stopping \? 'Stopping…' : 'Stop the move'\) \+ '<\/button>' : ''\)/,
    'the moving row does not draw the stop button (only while the board has the move)');
  const paint = page.lift(SCRIPT, 'paintAccounts');
  assert.match(paint, /for \(const stopBtn of box\.querySelectorAll\('\[data-acct-move-stop\]'\)\) stopBtn\.addEventListener\('click', \(\) => acctStopClick\(stopBtn\)\);/,
    'the painted stop button does not stop the move');
  /* Pressing Move does not repaint the row, so the handler draws the stop itself once the board has the move (its first
     progress answer): without this the button would only appear at the next repaint, and a stop sent before the board
     had the move would be told none is running. */
  assert.match(paint, /const cur = ACCT_MOVE\.get\(from\); if \(cur && cur\.moving\) \{ cur\.progress = t; cur\.onBoard = true; \}/,
    'a repaint never learns the board has the move');
  assert.match(paint, /if \(b\) b\.textContent = t;\n(?:[^\n]*\n){3}\s+if \(b && !\(b\.nextElementSibling && b\.nextElementSibling\.hasAttribute\('data-acct-move-stop'\)\)\) \{\n\s+const stopBtn = document\.createElement\('button'\);\n\s+stopBtn\.type = 'button'; stopBtn\.setAttribute\('data-acct-move-stop', ''\); stopBtn\.textContent = 'Stop the move';\n\s+stopBtn\.addEventListener\('click', \(\) => acctStopClick\(stopBtn\)\);\n\s+b\.after\(stopBtn\);/,
    'the move does not offer the stop once the board has it');
  const restart = page.lift(SCRIPT, 'engineRestartClick');
  assert.match(restart, /if \(r\.status === 409 && out && out\.moveStoppable && \(small \|\| title\)\) \{/, 'Restart Kosmos does not offer the stop');
  /* At narrow widths the toast hides its small line: the title says it, and the stop answers there (round 6). */
  assert.match(restart, /const shown = small && getComputedStyle\(small\)\.display !== 'none' \? small : title;/);
  assert.match(restart, /offerStopMove\(btn \|\| shown, shown\);/);
  /* The 15 s repaint waits while an offer is on screen, so a press still out is not answered into a removed node. */
  assert.match(restart, /if \(sl\.querySelector\('\[data-stop-move-offer\]'\) && \+\+holds < 20\) \{ setTimeout\(release, ENGINE_SAID_HOLD_MS\); return; \}/);
  assert.match(restart, /if \(answered\) \{ answered\.removeAttribute\('data-stop-move-said'\); setTimeout\(release, ENGINE_SAID_HOLD_MS\); return; \}/,
    'the stop\'s answer can be repainted away the moment it is written');
  const sw = page.lift(SCRIPT, 'worldswSwitch');
  assert.match(sw, /else if \(res\.status === 409\) \{\n\s+say\([^\n]+\);\n\s+if \(body && body\.moveStoppable\) offerStopMove\(bmsg, bmsg\);/,
    'a Kosmos switch does not offer the stop');
  const ucAt = SCRIPT.indexOf("document.getElementById('uc-go').addEventListener('click'");
  assert.ok(ucAt > 0, 'the Update dialog button is not in the page');
  const uc = SCRIPT.slice(ucAt, ucAt + 4000);
  assert.match(uc, /if \(res && res\.status === 409 && body && body\.moveStoppable\) offerStopMove\(err, err\);/, 'Update and Roll back do not offer the stop');
  /* A fresh press of each refused action takes the old offer away (it would outlive the move otherwise). */
  assert.match(page.lift(SCRIPT, 'openUpdConfirm'), /clearStopMoveOffers\(\);/, 'a reopened Update dialog shows the old offer with no sentence');
  assert.match(page.lift(SCRIPT, 'closeUpdConfirm'), /clearStopMoveOffers\(\);/, 'a closed Update dialog keeps the old offer');
  assert.match(uc.slice(0, uc.indexOf('go.disabled = true;')), /clearStopMoveOffers\(\);/, 'a fresh Update press leaves the old offer behind');
  assert.match(restart.slice(0, 600), /clearStopMoveOffers\(\);/, 'a fresh Restart Kosmos press leaves the old offer behind');
  assert.match(sw.slice(0, 300), /if \(WORLDSW_SWITCHING\) return;\n\s+clearStopMoveOffers\(\);/, 'a fresh switch leaves the old offer behind');
  assert.match(page.lift(SCRIPT, 'clearStopMoveOffers'), /for \(const b of document\.querySelectorAll\('\[data-stop-move-offer\]'\)\) b\.remove\(\);/);
  assert.match(page.lift(SCRIPT, 'clearStopMoveOffers'), /for \(const e of document\.querySelectorAll\('\[data-stop-move-said\]'\)\) e\.removeAttribute\('data-stop-move-said'\);/);
});

test('#6214: after a stop, the row says who moved, who was put back and who could not be, in the board\'s own words', async () => {
  const MOVE = page.lift(SCRIPT, 'moveAccountAgents');
  const answers = [
    { status: 202, body: { id: 'm9', done: false, agents: ['al', 'bo', 'cy', 'di'].map((name) => ({ name, outcome: 'pending' })) } },
    { status: 200, body: { id: 'm9', done: true, stopped: true, agents: [
      { name: 'al', outcome: 'changed', because: 'Al runs on new now.' },
      { name: 'bo', outcome: 'stopped', because: 'you stopped the move before their turn. They stay on old@example.com.' },
      { name: 'cy', outcome: 'stopped', because: 'you stopped the move before their turn, and their account had been changed since the move saved it, so we left it as it is now.' },
      { name: 'di', outcome: 'partial', because: 'We saved new@example.com, but you stopped the move before its turn and we could not put it back on its old account (that account is signed out). It is still on the old account until it restarts.' },
    ] } },
  ];
  const fetch = async () => { const a = answers.shift(); return { ok: a.status < 300, status: a.status, json: async () => a.body }; };
  const LAST = CARDS;
  const fast = (fn, ms) => setTimeout(fn, ms >= 10e3 ? ms : 0);
  // eslint-disable-next-line no-new-func
  const move = new Function('fetch', 'LAST', 'setTimeout', `${MOVE}\nreturn moveAccountAgents;`)(fetch, LAST, fast);
  const note = await move('/acct/old', '/acct/new', ['al', 'bo', 'cy', 'di'], null, new Set());
  assert.equal(note, 'Moved 1 agent. It restarts on the new account. '
    + 'Not restarted yet (Di): We saved new@example.com, but you stopped the move before its turn and we could not put it back on its old account (that account is signed out). It is still on the old account until it restarts. '
    + 'Not moved (Bo): you stopped the move before their turn. They stay on old@example.com. '
    + 'Not moved (Cy): you stopped the move before their turn, and their account had been changed since the move saved it, so we left it as it is now.');
});

test('#6214: the row\'s stop marks the move as stopping; a refusal puts the button back and says why', async () => {
  const SRC = page.lift(SCRIPT, 'acctStopClick');
  const run = async (answer) => {
    const ACCT_MOVE = new Map([['/acct/old', { moving: true, said: '' }], ['/acct/idle', { moving: false, said: 'x' }]]);
    const drawn = el('button'); drawn.textContent = 'Stop the move';
    const panel = { textContent: 'before' };
    const document = { querySelectorAll: () => [drawn], getElementById: (id) => (id === 'set-accounts-msg' ? panel : null) };
    const later = [];
    const fake = { setTimeout: (fn) => later.push(fn), acctCancelSay: () => {}, stopAccountMove: async () => answer };
    // eslint-disable-next-line no-new-func
    const click = new Function('ACCT_MOVE', 'document', 'setTimeout', 'acctCancelSay', 'stopAccountMove', `${SRC}\nreturn acctStopClick;`)(
      ACCT_MOVE, document, fake.setTimeout, fake.acctCancelSay, fake.stopAccountMove);
    const pressed = el('button');
    const p = click(pressed);
    assert.equal(pressed.disabled, true); assert.equal(pressed.textContent, 'Stopping…');
    assert.equal(ACCT_MOVE.get('/acct/old').stopping, true, 'a repaint mid-request draws it as stopping');
    assert.equal(ACCT_MOVE.get('/acct/idle').stopping, undefined, 'a row that is not moving is not marked');
    await p;
    later.forEach((fn) => fn());
    return { ACCT_MOVE, drawn, panel };
  };
  let r = await run({ ok: true, said: '', waitingFor: 'al' });
  assert.equal(r.ACCT_MOVE.get('/acct/old').stopping, true, 'a stop that worked stays stopping until the move ends');
  assert.equal(r.panel.textContent, 'before', 'the row\'s own sentence reports the end, nothing is said here');
  r = await run({ ok: false, said: 'No account move is running.' });
  assert.equal(r.ACCT_MOVE.get('/acct/old').stopping, false);
  assert.equal(r.drawn.disabled, false); assert.equal(r.drawn.textContent, 'Stop the move', 'the button drawn now is put back');
  assert.equal(r.panel.textContent, 'No account move is running.');
});
