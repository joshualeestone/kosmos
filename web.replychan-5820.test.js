'use strict';

/**
 * kosmos#5820: the agent page says where an agent says it answers the person (card.replyChannel, #5805 part 2) and
 * offers Clear. The REAL paintDetailState, lifted from web/index.html (the slicer and stubs of
 * web.pill-remembered-3958.test.js), run over cards from a fixture board. The click and its route are measured in
 * server.reply-channel-clear-5820.test.js (the route) and the design-shots screen agent-replychan-5820, whose verify
 * presses Clear in a real browser and checks the line goes and the answer is said.
 *
 *   node --test web.replychan-5820.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const SANDBOX = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'replychan-5820-')));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
const fleet = require('./test-support/fleet');

const RAW = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

function pageFnSource(name) {
  const start = RAW.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' vanished from web/index.html');
  let depth = 0;
  for (let k = RAW.indexOf('{', start); k < RAW.length; k += 1) {
    if (RAW[k] === '{') depth += 1;
    else if (RAW[k] === '}') { depth -= 1; if (depth === 0) return RAW.slice(start, k + 1); }
  }
  throw new Error('unbalanced ' + name);
}

/* One page: the same element map across paints, as the real page keeps its elements. */
function page() {
  const els = {};
  const doc = { getElementById: (id) => (els[id] = els[id] || { className: '', innerHTML: '', textContent: '', hidden: true, disabled: false, dataset: {} }) };
  // eslint-disable-next-line no-new-func
  const paint = new Function('document', 'DM_SPOKE_AT', 'LAST_AT', [
    'const esc = (s) => String(s);',
    'const stateCopyOf = (a) => ({ label: a.state });',
    'const cardStOf = (a) => ({ st: a.state });',
    'const glyphOf = () => "";',
    'const taskLine = () => "";',
    pageFnSource('workingSampleIsStale'),
    pageFnSource('paintDetailState'),
    'return paintDetailState;',
  ].join('\n'))(doc, new Map(), 0);
  return { els, paint };
}

function cards() {
  const board = fleet.install([fleet.agent('ada', { state: 'idle' }), fleet.agent('bo', { state: 'idle' })]);
  const by = (n) => board.agents.find((x) => x.name === n);
  assert.ok(by('ada') && by('bo'), 'the fixture gave no cards');
  return { ada: by('ada'), bo: by('bo') };
}

test('#5820: an agent with a declared channel shows the line naming it, and Clear is armed for that agent', () => {
  try {
    const { ada } = cards();
    const { els, paint } = page();
    paint({ ...ada, replyChannel: 'the Discord channel' });
    assert.equal(els['d-replychan'].hidden, false, 'the line is hidden on an agent that declared a channel');
    assert.equal(els['d-replychan-text'].textContent,
      ada.name + ' says it answers you on the Discord channel, so Kosmos does not send it the reminder to answer your first message here.');
    assert.equal(els['d-replychan-clear'].dataset.agent, ada.sessionName, 'Clear would act on another agent');
    assert.equal(els['d-replychan-clear'].disabled, false);
  } finally { fleet.restore(); }
});

test('#5820: no declared channel, no line; and moving to another agent re-arms Clear and drops the last answer', () => {
  try {
    const { ada, bo } = cards();
    const { els, paint } = page();
    paint(bo);
    assert.equal(els['d-replychan'].hidden, true, 'a line shows for an agent that declared nothing');
    // CONTROL: the same page does show it for a declaring card, so the hidden above is not a paint that never ran.
    paint({ ...ada, replyChannel: 'Slack' });
    assert.equal(els['d-replychan'].hidden, false);
    // A Clear on ada left its answer and a disabled button; the next agent's paint must not inherit either.
    els['d-replychan-msg'].textContent = 'We could not clear it. Try again.';
    els['d-replychan-msg'].dataset.agent = ada.sessionName;
    els['d-replychan-clear'].disabled = true;
    paint({ ...bo, replyChannel: 'Discord' });
    assert.equal(els['d-replychan-clear'].dataset.agent, bo.sessionName);
    assert.equal(els['d-replychan-clear'].disabled, false, 'Clear stayed disabled from the last agent');
    assert.equal(els['d-replychan-msg'].textContent, '', 'the last agent\'s message stayed on this one');
    // The message sits outside the line, so it must also go on an agent with NO channel (the line stays hidden there).
    els['d-replychan-msg'].textContent = 'Cleared. Kosmos will remind ada to answer your first message here again.';
    els['d-replychan-msg'].dataset.agent = ada.sessionName;
    paint(bo);
    assert.equal(els['d-replychan-msg'].textContent, '', 'ada\'s Cleared message stayed on bo\'s page');
    // CONTROL: on ada's own page the answer stays.
    els['d-replychan-msg'].textContent = 'Cleared.';
    els['d-replychan-msg'].dataset.agent = ada.sessionName;
    paint(ada);
    assert.equal(els['d-replychan-msg'].textContent, 'Cleared.', 'the answer was wiped on the agent it was for');
    // And the declaration going away (cleared, here or by the agent) takes the line off on the next paint.
    paint(bo);
    assert.equal(els['d-replychan'].hidden, true, 'a cleared channel still shows');
  } finally { fleet.restore(); }
});

test('#5820: a channel typed with a full stop does not read "on Discord., so"', () => {
  try {
    const { ada } = cards();
    const { els, paint } = page();
    paint({ ...ada, replyChannel: 'Discord.' });
    assert.match(els['d-replychan-text'].textContent, / on Discord, so /);
  } finally { fleet.restore(); }
});

test('#5820: a "Cleared" never stands beside a line that shows a channel (a stale poll, or a new declaration)', () => {
  try {
    const { ada } = cards();
    const { els, paint } = page();
    paint(ada);   // the page's elements exist once a paint has asked for them
    els['d-replychan-msg'].textContent = 'Cleared. Kosmos will remind ada to answer your first message here again.';
    els['d-replychan-msg'].dataset.agent = ada.sessionName;
    paint({ ...ada, replyChannel: 'Discord' });
    assert.equal(els['d-replychan'].hidden, false);
    assert.equal(els['d-replychan-msg'].textContent, '', 'Cleared stood beside a shown channel');
    // CONTROL: a failure message for the same agent stays beside the line (it is about that line).
    els['d-replychan-msg'].textContent = 'We could not clear it. Try again.';
    els['d-replychan-msg'].dataset.agent = ada.sessionName;
    paint({ ...ada, replyChannel: 'Discord' });
    assert.equal(els['d-replychan-msg'].textContent, 'We could not clear it. Try again.');
  } finally { fleet.restore(); }
});

/* The page with REPLYCHAN_CLEARED present (the page's own global), for the stale-poll guard. */
function pageWithCleared(cleared) {
  const els = {};
  const doc = { getElementById: (id) => (els[id] = els[id] || { className: '', innerHTML: '', textContent: '', hidden: true, disabled: false, dataset: {} }) };
  // eslint-disable-next-line no-new-func
  const paint = new Function('document', 'DM_SPOKE_AT', 'LAST_AT', 'REPLYCHAN_CLEARED', [
    // The page's own window, not a copy: STATUS_POLL_TIMEOUT_MS and the var line, verbatim.
    RAW.match(/^const STATUS_POLL_TIMEOUT_MS = [^;\n]*;/m)[0],
    RAW.match(/^var REPLYCHAN_STALE_MS = [^;\n]*;/m)[0],
    'const esc = (s) => String(s);',
    'const stateCopyOf = (a) => ({ label: a.state });',
    'const cardStOf = (a) => ({ st: a.state });',
    'const glyphOf = () => "";',
    'const taskLine = () => "";',
    pageFnSource('workingSampleIsStale'),
    pageFnSource('paintDetailState'),
    'return paintDetailState;',
  ].join('\n'))(doc, new Map(), 0, cleared);
  return { els, paint };
}

test('#5820: a poll that started before a Clear does not paint the channel back; a real one after the window does', () => {
  try {
    const { ada } = cards();
    const cleared = new Map([[ada.sessionName, Date.now()]]);
    const { els, paint } = pageWithCleared(cleared);
    paint(ada);
    els['d-replychan-msg'].textContent = 'Cleared. Kosmos will remind ada to answer your first message here again.';
    els['d-replychan-msg'].dataset.agent = ada.sessionName;
    paint({ ...ada, replyChannel: 'Discord' });   // the stale poll
    assert.equal(els['d-replychan'].hidden, true, 'a stale poll painted the cleared channel back');
    assert.match(els['d-replychan-msg'].textContent, /^Cleared\./, 'a stale poll wiped the Cleared answer');
    // CONTROL: once the window has passed, a channel on the card is a real declaration and shows.
    const windowMs = paintWindow();
    assert.ok(windowMs >= 10000, 'the window is shorter than a status poll can take: ' + windowMs);
    cleared.set(ada.sessionName, Date.now() - windowMs - 1000);
    paint({ ...ada, replyChannel: 'Discord' });
    assert.equal(els['d-replychan'].hidden, false, 'a real declaration after the window stayed hidden');
  } finally { fleet.restore(); }
});

/* The REAL detailReplyChanClear, with fetch and the page's CURRENT stubbed. `current` is read on every call, so a test
   can move the page to another agent while the request is in flight. */
function clearHandler({ answer, current }) {
  const els = {};
  const doc = { getElementById: (id) => (els[id] = els[id] || { textContent: '', hidden: false, disabled: false, dataset: {}, focus() { els.focused = id; } }) };
  const cleared = new Map();
  // eslint-disable-next-line no-new-func
  const fn = new Function('document', 'fetch', 'REPLYCHAN_CLEARED', 'getCurrent', [
    'const CURRENT_GET = getCurrent;',
    // The slicer starts at `function`, so the `async` before it is put back.
    'async ' + pageFnSource('detailReplyChanClear').replace(/\bCURRENT\b/g, 'CURRENT_GET()'),
    'return detailReplyChanClear;',
  ].join('\n'))(doc, answer, cleared, current);
  return { els, cleared, run: (name) => { const b = doc.getElementById('d-replychan-clear'); b.dataset.agent = name; return fn({ currentTarget: b }); } };
}
const res = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('#5820: Clear that worked hides the line, remembers the clear, says so and takes focus', async () => {
  try {
    const { ada } = cards();
    const h = clearHandler({ answer: res(200, { ok: true, channel: null }), current: () => ada });
    await h.run(ada.sessionName);
    assert.equal(h.els['d-replychan'].hidden, true);
    assert.ok(h.cleared.has(ada.sessionName), 'the clear was not remembered, so a stale poll would paint it back');
    assert.match(h.els['d-replychan-msg'].textContent, new RegExp('^Cleared\\. Kosmos will remind ' + ada.name + ' '));
    assert.equal(h.els.focused, 'd-replychan-msg', 'focus did not move to the answer');
  } finally { fleet.restore(); }
});

test('#5820: Clear that failed says why, keeps the line and re-arms the button', async () => {
 try {
  const { ada } = cards();
  const h = clearHandler({ answer: res(500, { ok: false, because: 'Kosmos could not clear it just now' }), current: () => ada });
  await h.run(ada.sessionName);
  assert.equal(h.els['d-replychan-clear'].disabled, false, 'the button stayed disabled after a failure');
  assert.equal(h.els['d-replychan-msg'].textContent, 'We could not clear it: Kosmos could not clear it just now. Try again.');
  assert.equal(h.els['d-replychan'], undefined, 'a failed clear touched the line (it must stay as painted)');
  assert.equal(h.cleared.has(ada.sessionName), false, 'a failed clear was remembered as a clear');
 } finally { fleet.restore(); }
});

test('#5820: an answer that arrives after the person moved to another agent says nothing there and re-arms the button', async () => {
  try {
    const { ada, bo } = cards();
    let cur = ada;
    const h = clearHandler({ answer: async () => { cur = bo; return { ok: false, status: 500, json: async () => ({}) }; },
      current: () => cur });
    await h.run(ada.sessionName);
    assert.equal(h.els['d-replychan-msg'].textContent, '', 'ada\'s answer was written on bo\'s page');
    assert.equal(h.els['d-replychan-clear'].disabled, false, 'the button stayed disabled for when the person comes back');
  } finally { fleet.restore(); }
});

/* The page's stale window as the page computes it. */
function paintWindow() {
  // eslint-disable-next-line no-new-func
  return new Function([RAW.match(/^const STATUS_POLL_TIMEOUT_MS = [^;\n]*;/m)[0], RAW.match(/^var REPLYCHAN_STALE_MS = [^;\n]*;/m)[0], 'return REPLYCHAN_STALE_MS;'].join('\n'))();
}

test('#5820: a Clear that worked is remembered even when its answer arrives after the person moved away', async () => {
  try {
    const { ada, bo } = cards();
    let cur = ada;
    const h = clearHandler({ answer: async () => { cur = bo; return { ok: true, status: 200, json: async () => ({ ok: true, channel: null }) }; },
      current: () => cur });
    await h.run(ada.sessionName);
    assert.ok(h.cleared.has(ada.sessionName), 'coming back to ada would paint the cleared channel from a stale card');
    assert.equal(h.els['d-replychan-msg'].textContent, '', 'ada\'s answer was written on bo\'s page');
  } finally { fleet.restore(); }
});
