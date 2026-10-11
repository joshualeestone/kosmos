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
