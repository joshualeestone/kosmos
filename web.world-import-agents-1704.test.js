'use strict';
/**
 * #1704 PR4: the settings cog next to EVERY Kosmos, and the "add agents from another
 * Kosmos" pane it opens (Josh: "I can always get back to that pane if I go to the little
 * settings cog next to that particular KOSMOS and add agents from another KOSMOS").
 *
 * These run the SHIPPED functions from web/index.html against a fake document
 * (test-support/fake-dom). The New Kosmos step's own picker is web.world-import-2563.
 *
 *   node --test web.world-import-agents-1704.test.js
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
const SW_RENDER = slice('worldswRender');
const RENDER = slice('worldImportRender');
const PICKS = slice('worldImportPicks');
const CLEAR = slice('worldImportClear');
const OUTCOME = slice('worldImportOutcome');
const OPEN = slice('worldRenameOpen');
const SET_RENDER = slice('worldSettingsRender');
const WAIT_NOTE = slice('worldSettingsWaitingNote');
const SEL_CHANGED = slice('worldSettingsSelectionChanged');
const SET_SKIP = slice('worldSettingsSkip');
const SET_ADD = slice('worldSettingsAddSubmit');
const CLOSE = slice('worldRenameClose');
const AS_SENTENCE = slice('asSentence');   // the page's one sentence-dressing, which these use

const MODAL = PAGE.slice(PAGE.indexOf('<div class="rm-back" id="world-rename-modal"'), PAGE.indexOf('<div class="rm-back" id="world-switch-modal"'));
const WAITING = 'Agents do not run in a named Kosmos yet, so it waits there and starts on its own once they can.';

test('the cog is on EVERY row, Kosmos 1 included, labelled as settings, and opens that Kosmos\'s pane', () => {
  const dom = makeDom();
  dom.add('worldsw', 'div', { hidden: true });
  dom.add('worldsw-name', 'span');
  const list = dom.add('worldsw-list');
  dom.add('worldsw-btn', 'button');
  const opened = [];
  // eslint-disable-next-line no-new-func
  new Function('document', 'worldswConfirmSwitch', 'worldRenameOpen', '_d', `${SW_RENDER}\nworldswRender(_d);`)(
    dom.document, () => {}, (id, name) => opened.push([id, name]),
    { worlds: [{ id: 'default', name: 'Kosmos 1' }, { id: 'alpha', name: 'Alpha' }], activeWorldId: 'default' },
  );
  const cogs = list.children.map((entry) => entry.children.find((c) => c.className === 'worldsw-cog'));
  assert.equal(cogs.length, 2);
  assert.ok(cogs.every(Boolean), 'a Kosmos has no cog');
  assert.deepEqual(cogs.map((c) => c.getAttribute('aria-label')), ['Settings for Kosmos 1', 'Settings for Alpha']);
  for (const c of cogs) c.click();
  assert.deepEqual(opened, [['default', 'Kosmos 1'], ['alpha', 'Alpha']]);
});

function settingsDom() {
  const dom = makeDom();
  for (const [id, tag, props] of [
    ['world-rename-modal', 'div', { hidden: true }], ['world-rename-t', 'h2'], ['world-rename-section'],
    ['world-rename-name', 'input'], ['world-rename-go', 'button'], ['world-rename-msg'],
    ['world-set-import', 'div', { hidden: true }], ['world-set-import-list'], ['world-set-import-none', 'p', { hidden: true }],
    ['world-set-waiting', 'p', { hidden: true }], ['world-set-add', 'button', { disabled: true }],
    ['world-rename-cancel', 'button'], ['worldsw-btn', 'button'],
  ]) dom.add(id, tag || 'div', props || {});
  return dom;
}
function settingsFns(dom, { worlds, fetchStub }) {
  // eslint-disable-next-line no-new-func
  return new Function('document', 'worldswClose', 'worldImportFetch', 'fetch', `let WORLD_RENAME_ID = null;
let WORLD_SETTINGS_NAME = null;
let worldSettingsGen = 0;
${AS_SENTENCE}
${RENDER}
${PICKS}
${CLEAR}
${OUTCOME}
${OPEN}
${SET_RENDER}
${WAIT_NOTE}
${SEL_CHANGED}
${SET_SKIP}
${SET_ADD}
${CLOSE}
return { worldRenameOpen, worldSettingsSelectionChanged, worldSettingsSkip, worldSettingsAddSubmit, worldRenameClose };`)(
    dom.document, () => {}, async () => (typeof worlds === 'function' ? worlds() : worlds),
    fetchStub || (async () => ({ ok: true, json: async () => ({}) })),
  );
}
const tick = () => new Promise((r) => setImmediate(r));
const LIST = [
  { id: 'default', name: 'Kosmos 1', agents: [{ name: 'ava', displayName: 'Ava', because: null }], waiting: [] },
  { id: 'alpha', name: 'Alpha', agents: [{ name: 'bo', displayName: 'Bo', because: null }], waiting: [{ name: 'cy', because: WAITING }] },
];

test('Kosmos 1\'s settings: no rename (its name is fixed), focus on Close, and the picker lists only the OTHER Kosmoses', async () => {
  const dom = settingsDom();
  const fns = settingsFns(dom, { worlds: LIST });
  fns.worldRenameOpen('default', 'Kosmos 1');
  const $ = (id) => dom.document.getElementById(id);
  assert.equal($('world-rename-modal').hidden, false);
  assert.equal($('world-rename-t').textContent, 'Kosmos 1 settings');
  assert.equal($('world-rename-section').hidden, true, 'the default Kosmos offered a rename');
  assert.equal(dom.focused().id, 'world-rename-cancel');
  await tick();
  assert.equal($('world-set-import').hidden, false, 'the pane never showed the picker');
  const heads = $('world-set-import-list').children.map((g) => g.children[0].children[1].textContent);
  assert.deepEqual(heads, ['Alpha (1 agent)'], 'a Kosmos was offered as a source for itself');
});

test('a named Kosmos\'s settings: rename is there with the name focused, and what waits in it is said', async () => {
  const dom = settingsDom();
  const fns = settingsFns(dom, { worlds: LIST });
  fns.worldRenameOpen('alpha', 'Alpha');
  const $ = (id) => dom.document.getElementById(id);
  assert.equal($('world-rename-section').hidden, false);
  assert.equal($('world-rename-name').value, 'Alpha');
  assert.equal(dom.focused().id, 'world-rename-name');
  await tick();
  assert.equal($('world-set-waiting').hidden, false);
  assert.equal($('world-set-waiting').textContent, 'Waiting to start here: cy. ' + WAITING);
});

test('Add agents stays disabled until an agent is ticked; Skip clears the ticks and hands focus to Close', async () => {
  const dom = settingsDom();
  const fns = settingsFns(dom, { worlds: LIST });
  const $ = (id) => dom.document.getElementById(id);
  // The page wires the list's change events to this; the wiring itself is asserted below.
  $('world-set-import-list').addEventListener('change', fns.worldSettingsSelectionChanged);
  fns.worldRenameOpen('alpha', 'Alpha');
  await tick();
  assert.equal($('world-set-add').disabled, true);
  const ava = $('world-set-import-list').querySelectorAll('.world-import-cb').find((c) => c.value === 'ava');
  ava.click();
  assert.equal($('world-set-add').disabled, false, 'a tick did not enable Add');
  fns.worldSettingsSkip();
  assert.equal(ava.checked, false);
  assert.equal($('world-set-add').disabled, true);
  assert.equal(dom.focused().id, 'world-rename-cancel');
});

test('Add agents posts {id, importAgents} to /api/worlds/import and says what happened', async () => {
  const dom = settingsDom();
  const posted = [];
  const fetchStub = async (url, opts) => {
    posted.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({ ok: true, world: { id: 'alpha', name: 'Alpha' },
      imported: { copied: [{ from: 'default', name: 'ava', displayName: 'Ava' }], refused: [], started: [], waiting: [{ name: 'ava', because: WAITING }], later: [] } }) };
  };
  const fns = settingsFns(dom, { worlds: LIST, fetchStub });
  fns.worldRenameOpen('alpha', 'Alpha');
  await tick();
  const $ = (id) => dom.document.getElementById(id);
  $('world-set-import-list').querySelectorAll('.world-import-cb').find((c) => c.value === 'ava').click();
  await fns.worldSettingsAddSubmit();
  assert.deepEqual(posted, [{ url: '/api/worlds/import', body: { id: 'alpha', importAgents: [{ from: 'default', name: 'ava' }] } }]);
  assert.equal($('world-rename-msg').textContent, 'Added Ava to Alpha. Waiting: Ava. ' + WAITING);
});

test('a list that comes back after the pane closed draws nothing into it', async () => {
  const dom = settingsDom();
  let release;
  const late = new Promise((r) => { release = r; });
  const fns = settingsFns(dom, { worlds: () => late });
  fns.worldRenameOpen('alpha', 'Alpha');
  fns.worldRenameClose();
  release(LIST);
  await tick();
  assert.equal(dom.document.getElementById('world-set-import-list').children.length, 0);
  assert.equal(dom.focused().id, 'worldsw-btn', 'closing returns focus to the switcher');
});

test('the outcome sentence: started, later, waiting (grouped by reason) and refused', () => {
  // eslint-disable-next-line no-new-func
  const worldImportOutcome = new Function(`${AS_SENTENCE}\n${OUTCOME}\nreturn worldImportOutcome;`)();
  assert.equal(worldImportOutcome({
    copied: [{ name: 'ava', displayName: 'Ava' }, { name: 'bo', displayName: 'Bo' }, { name: 'cy', displayName: 'Cy' }],
    started: ['ava'], later: ['bo'], waiting: [{ name: 'cy', because: 'kosmos is not allowed to start agents from here, so it has not been started yet' }],
    refused: [{ name: 'dee', because: 'it was removed from Kosmos 1' }],
  }, 'Alpha'),
  'Added Ava, Bo, Cy to Alpha. Ava is starting now. Bo starts when you open Alpha. '
  + 'Waiting: Cy. Kosmos is not allowed to start agents from here, so it has not been started yet. '
  + 'Not added: dee, because it was removed from Kosmos 1.');
});

test('the pane\'s markup: a real dialog, a labelled picker, Skip and Add, and rename inside its own section', () => {
  assert.match(MODAL, /role="dialog" aria-modal="true" aria-labelledby="world-rename-t"/);
  assert.match(MODAL, /<div id="world-rename-section">[\s\S]*id="world-rename-name"[\s\S]*id="world-rename-go"[\s\S]*<\/div>\s*<div class="field world-import" id="world-set-import" hidden>/);
  assert.match(MODAL, /id="world-set-import-lab">Add agents from another Kosmos</);
  assert.match(MODAL, /id="world-set-import-list" role="group" aria-labelledby="world-set-import-lab"/);
  assert.match(MODAL, /<button class="btn" id="world-set-skip" type="button">Skip<\/button>/);
  assert.match(MODAL, /<button class="btn uprime" id="world-set-add" type="button" disabled>Add agents<\/button>/);
  assert.match(MODAL, /id="world-rename-cancel" type="button">Close</);
  for (const wire of [
    /getElementById\('world-set-skip'\)\.addEventListener\('click', worldSettingsSkip\)/,
    /getElementById\('world-set-add'\)\.addEventListener\('click', worldSettingsAddSubmit\)/,
    /getElementById\('world-set-import-list'\)\.addEventListener\('change', worldSettingsSelectionChanged\)/,
  ]) assert.match(PAGE, wire, 'the pane is not wired: ' + wire);
});

test('the pane gets a real Tab trap: every enabled, shown control in it, home on Close', () => {
  assert.match(PAGE, /\['world-rename-modal', null, 'world-rename-cancel'\]/, 'the settings dialog has no Tab trap');
  assert.match(PAGE, /!\(stopIds === null && el\.closest\('\[hidden\]'\)\)/, 'the trap would stop on a hidden rename field');
});
