"use strict";
/**
 * #2563 + #1704 PR4: the New Kosmos step, "Add my agents from" (web UI).
 *
 * Josh: "when I'm creating the new KOSMOS, I can add agents to it that are my existing
 * agents from another KOSMOS right there when I create it. Or I can just skip and not add
 * any." These run the SHIPPED functions from web/index.html against a fake document
 * (test-support/fake-dom), so what is under test is the code that ships. The load-bearing
 * behaviour: one group per Kosmos with one box per agent, the Kosmos box ticks its agents,
 * Skip clears, the create payload carries `importAgents` ONLY when something is ticked, and
 * what the import did is said rather than closed over.
 *
 *   node --test web.world-import-2563.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const { makeDom } = require('./test-support/fake-dom');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

function slice(name) {
  let at = PAGE.indexOf('async function ' + name + '(');
  if (at < 0) at = PAGE.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name + ' moved or renamed; re-anchor this test');
  return PAGE.slice(at, PAGE.indexOf('\n}\n', at) + 2);
}
const RENDER = slice('worldImportRender');
const PICKS = slice('worldImportPicks');
const CLEAR = slice('worldImportClear');
const OUTCOME = slice('worldImportOutcome');
const FETCH = slice('worldImportFetch');
const SUBMIT = slice('worldAddSubmit');
const SKIP = slice('worldAddSkip');
const AS_SENTENCE = slice('asSentence');   // the page's one sentence-dressing, which the outcome uses

const WORLDS = [
  { id: 'w1', name: 'Client work', agents: [{ name: 'ava', displayName: 'Ava', because: null }, { name: 'bo', displayName: 'bo', because: null }] },
  { id: 'w2', name: 'Side project', agents: [{ name: 'cy', displayName: 'Cy', because: null }, { name: 'x', displayName: 'x', because: 'its name cannot be used to start it in another Kosmos' }] },
  { id: 'w3', name: 'Fresh', agents: [] },
];

function render(worlds, excludeId) {
  const dom = makeDom();
  const list = dom.add('world-add-import-list');
  const wrap = dom.add('world-add-import', 'div', { hidden: true });
  // eslint-disable-next-line no-new-func
  const fns = new Function('document', `${RENDER}\n${PICKS}\n${CLEAR}\nreturn { worldImportRender, worldImportPicks, worldImportClear };`)(dom.document);
  fns.worldImportRender(worlds, list, wrap, excludeId);
  return { dom, list, wrap, fns };
}
const headBox = (group) => group.children[0].children[0];
const headText = (group) => group.children[0].children[1].textContent;
const agentBoxes = (group) => group.children[1].children.map((row) => row.children[0]);
const agentText = (group) => group.children[1].children.map((row) => row.children[1].textContent);
const box = (list, from, name) => list.querySelectorAll('.world-import-cb').find((c) => c.dataset.from === from && c.value === name);

test('an empty, missing or all-excluded list HIDES the control (the board could not answer)', () => {
  for (const empty of [[], null, undefined]) {
    const { list, wrap } = render(empty);
    assert.equal(wrap.hidden, true, 'the control did not hide for ' + JSON.stringify(empty));
    assert.equal(list.children.length, 0);
  }
  assert.equal(render([WORLDS[0]], 'w1').wrap.hidden, true, 'a list holding only the Kosmos being added to has nothing to offer');
});

test('one group per Kosmos, headed by a box that says how many agents it holds', () => {
  const { list, wrap } = render(WORLDS);
  assert.equal(wrap.hidden, false);
  const groups = list.children;
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map(headText), ['Client work (2 agents)', 'Side project (2 agents)', 'Fresh (0 agents)']);
  const head = headBox(groups[0]);
  assert.equal(head.type, 'checkbox');
  assert.equal(head.className, 'world-import-all');
  assert.equal(head.value, 'w1');
  assert.equal(headBox(groups[2]).disabled, true, 'a Kosmos with no agents offers nothing to tick');
  assert.equal(groups[0].children[0].tagName, 'LABEL', 'the head is a label wrapping its box, so its text is the box\'s name');
});

test('one box per agent: its value is the name, it knows its Kosmos, its label is the display name', () => {
  const { list } = render(WORLDS);
  const [g1, g2] = list.children;
  assert.deepEqual(agentBoxes(g1).map((b) => [b.className, b.type, b.value, b.dataset.from]),
    [['world-import-cb', 'checkbox', 'ava', 'w1'], ['world-import-cb', 'checkbox', 'bo', 'w1']]);
  assert.deepEqual(agentText(g1), ['Ava', 'bo']);
  assert.equal(g1.children[1].getAttribute('role'), 'group');
  assert.equal(g1.children[1].getAttribute('aria-label'), 'Agents in Client work');
  // An agent that cannot be added is shown, disabled, with the reason.
  assert.equal(agentBoxes(g2)[1].disabled, true);
  assert.equal(agentText(g2)[1], 'x (its name cannot be used to start it in another Kosmos)');
});

test('the Kosmos box ticks every agent it can, and shows part-ticked when only some are', () => {
  const { list } = render(WORLDS);
  const g2 = list.children[1];
  headBox(g2).click();
  assert.deepEqual(agentBoxes(g2).map((b) => b.checked), [true, false], 'the disabled agent must never be ticked');
  headBox(g2).click();
  assert.deepEqual(agentBoxes(g2).map((b) => b.checked), [false, false]);

  const g1 = list.children[0];
  agentBoxes(g1)[0].click();
  assert.equal(headBox(g1).indeterminate, true, 'one of two ticked is part-ticked');
  assert.equal(headBox(g1).checked, false);
  agentBoxes(g1)[1].click();
  assert.equal(headBox(g1).checked, true, 'all ticked ticks the Kosmos box');
  assert.equal(headBox(g1).indeterminate, false);
});

test('the Kosmos being added to is left out of its own picker', () => {
  const { list } = render(WORLDS, 'w2');
  assert.deepEqual(list.children.map(headText), ['Client work (2 agents)', 'Fresh (0 agents)']);
});

test('picks are [{from, name}] of the ticked, enabled agents; Skip\'s clear unticks everything', () => {
  const { list, fns } = render(WORLDS);
  box(list, 'w1', 'bo').click();
  box(list, 'w2', 'cy').click();
  assert.deepEqual(fns.worldImportPicks(list), [{ from: 'w1', name: 'bo' }, { from: 'w2', name: 'cy' }]);
  fns.worldImportClear(list);
  assert.deepEqual(fns.worldImportPicks(list), []);
  assert.equal(list.querySelectorAll('input[type="checkbox"]').some((c) => c.checked || c.indeterminate), false);
});

async function runFetch(fetchStub) {
  // eslint-disable-next-line no-new-func
  return new Function('fetch', `${FETCH}\n return worldImportFetch();`)(fetchStub);
}

test('worldImportFetch returns the worlds on 200 and [] on ANY failure', async () => {
  const ok = await runFetch(async () => ({ ok: true, json: async () => ({ worlds: [{ id: 'w1', name: 'A', agents: [] }, { id: 'w2', name: 'B' }] }) }));
  assert.deepEqual(ok.map((w) => w.id), ['w1', 'w2']);
  assert.deepEqual(await runFetch(async () => ({ ok: false, json: async () => ({}) })), []);
  assert.deepEqual(await runFetch(async () => ({ ok: true, json: async () => { throw new Error('bad'); } })), []);
  assert.deepEqual(await runFetch(async () => { throw new Error('network'); }), []);
  assert.deepEqual(await runFetch(async () => ({ ok: true, json: async () => ({ worlds: 'nope' }) })), []);
});

async function submit({ name = 'Gamma', tick = [], response = { ok: true, world: { id: 'gamma', name: 'Gamma' } }, skip = false } = {}) {
  const { dom, list } = render(WORLDS);
  for (const [from, agent] of tick) box(list, from, agent).click();
  const input = dom.add('world-add-name', 'input', { value: name });
  const go = dom.add('world-add-go', 'button');
  const msg = dom.add('world-add-msg');
  const cancel = dom.add('world-add-cancel', 'button', { textContent: 'Cancel' });
  const seen = { url: null, posted: null, closed: false, switched: false };
  const fetchStub = async (url, opts) => { seen.url = url; seen.posted = JSON.parse(opts.body); return { ok: true, json: async () => response }; };
  // eslint-disable-next-line no-new-func
  const fns = new Function('document', 'fetch', 'worldAddClose', 'worldsFetch', 'worldswOpen',
    `${AS_SENTENCE}\n${PICKS}\n${CLEAR}\n${OUTCOME}\n${SKIP}\n${SUBMIT}\nreturn { worldAddSubmit, worldAddSkip };`)(
    dom.document, fetchStub, () => { seen.closed = true; }, async () => {}, () => { seen.switched = true; },
  );
  if (skip) fns.worldAddSkip();
  await fns.worldAddSubmit();
  return { seen, msg, go, cancel, input, dom };
}

test('the create payload carries importAgents ONLY when an agent is ticked; nothing ticked, or Skip, is exactly { name }', async () => {
  const withPicks = await submit({ tick: [['w1', 'ava'], ['w2', 'cy']], response: { ok: true, world: { id: 'gamma', name: 'Gamma' }, imported: { copied: [], refused: [], started: [], waiting: [], later: [] } } });
  assert.equal(withPicks.seen.url, '/api/worlds');
  assert.deepEqual(withPicks.seen.posted, { name: 'Gamma', importAgents: [{ from: 'w1', name: 'ava' }, { from: 'w2', name: 'cy' }] });

  const plain = await submit({ name: 'Plain' });
  assert.deepEqual(plain.seen.posted, { name: 'Plain' });
  assert.equal(Object.prototype.hasOwnProperty.call(plain.seen.posted, 'importAgents'), false);

  const skipped = await submit({ name: 'Skipped', tick: [['w1', 'ava']], skip: true });
  assert.deepEqual(skipped.seen.posted, { name: 'Skipped' }, 'Skip must mean "add none"');
});

test('Skip hands focus to Create when it can be pressed, and to the name when it cannot', () => {
  for (const [goDisabled, want] of [[false, 'world-add-go'], [true, 'world-add-name']]) {
    const { dom } = render(WORLDS);
    dom.add('world-add-name', 'input');
    dom.add('world-add-go', 'button', { disabled: goDisabled });
    // eslint-disable-next-line no-new-func
    new Function('document', `${CLEAR}\n${SKIP}\nworldAddSkip();`)(dom.document);
    assert.equal(dom.focused().id, want);
  }
});

test('what the import did is SAID: an agent that starts when the new Kosmos opens keeps the dialog open with that sentence, and Cancel becomes Done', async () => {
  const r = await submit({ tick: [['w1', 'ava']], response: { ok: true, world: { id: 'gamma', name: 'Gamma' },
    imported: { copied: [{ from: 'w1', name: 'ava', displayName: 'Ava' }], refused: [], started: [], waiting: [], later: ['ava'] } } });
  assert.equal(r.msg.textContent, 'Your Kosmos was created. Added Ava to Gamma. Ava starts when you open Gamma.');
  assert.equal(r.seen.closed, false, 'an agent that is not running yet was closed over as if it were running');
  assert.equal(r.cancel.textContent, 'Done');
  assert.equal(r.go.disabled, true, 'a re-press would try to make the same Kosmos again');
});

test('a refused agent is named with its reason; a thrown import and an unreadable answer are said too', async () => {
  const refused = await submit({ tick: [['w1', 'ava']], response: { ok: true, world: { id: 'gamma', name: 'Gamma' },
    imported: { copied: [], refused: [{ from: 'w1', name: 'ava', because: 'Gamma already has an agent called ava' }], started: [], waiting: [], later: [] } } });
  assert.equal(refused.msg.textContent, 'Your Kosmos was created. Not added: ava, because Gamma already has an agent called ava.');

  const thrown = await submit({ tick: [['w1', 'ava']], response: { ok: true, world: {}, imported: { copied: [], refused: [], started: [], waiting: [], later: [], error: true } } });
  assert.match(thrown.msg.textContent, /created, but its agents could not be added/);

  const unknown = await submit({ tick: [['w1', 'ava']], response: { ok: true, world: {} } });
  assert.match(unknown.msg.textContent, /could not confirm whether its agents were added/);
  assert.equal(unknown.seen.closed, false);
});

test('only when every agent is starting now does the dialog close and open the switcher, as before', async () => {
  const r = await submit({ tick: [['w1', 'ava']], response: { ok: true, world: { id: 'gamma', name: 'Gamma' },
    imported: { copied: [{ from: 'w1', name: 'ava', displayName: 'Ava' }], refused: [], started: ['ava'], waiting: [], later: [] } } });
  assert.equal(r.seen.closed, true);
  assert.equal(r.seen.switched, true);
});

test('the step keeps Josh\'s wording and layout, and Skip is always there', () => {
  const modal = PAGE.slice(PAGE.indexOf('<div class="rm-back" id="world-add-modal"'), PAGE.indexOf('<div class="rm-back" id="world-rename-modal"'));
  assert.match(modal, /<h2 class="rm-title" id="world-add-t">New Kosmos<\/h2>/);
  assert.match(modal, /id="world-add-import-lab">Add my agents from</);
  assert.match(modal, /Bring copies of another Kosmos's agents into this one\. They stay in the original too\./);
  assert.match(modal, /<button class="btn" id="world-add-skip" type="button">Skip<\/button>/);
  assert.doesNotMatch(modal.match(/id="world-add-skip"[^>]*>/)[0], /disabled/, 'Skip must never be disabled');
  assert.match(modal, /id="world-add-import-list" role="group" aria-labelledby="world-add-import-lab"/);
  assert.match(PAGE, /getElementById\('world-add-skip'\)\.addEventListener\('click', worldAddSkip\)/, 'Skip is not wired');
});
