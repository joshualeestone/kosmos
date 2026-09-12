'use strict';
/**
 * #1704 PR3: the switch dialog asks, each time, whether to pause the Kosmos's agents
 * or keep them running (Josh). These run the SHIPPED functions from web/index.html
 * against a fake document, so the code under test is the code that ships.
 *
 *   node --test web.world-switch-agents-1704.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

function slice(name) {
  let at = PAGE.indexOf('async function ' + name + '(');
  if (at < 0) at = PAGE.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name + ' moved or renamed; re-anchor this test');
  return PAGE.slice(at, PAGE.indexOf('\n}\n', at) + 2);
}
const CONFIRM = slice('worldswConfirmSwitch');
const CHOICE = slice('worldswAgentsChoice');
const CHANGED = slice('worldswAgentsChoiceChanged');
const GO = slice('worldswSwitchGo');
const SWITCH = slice('worldswSwitch');
const NOTE = slice('worldswNotPausedNote');

const MODAL = PAGE.slice(PAGE.indexOf('<div class="rm-back" id="world-switch-modal"'), PAGE.indexOf('<div class="rm-back" id="mem-modal"'));

test('the dialog keeps Josh\'s title and adds exactly two labelled radios, neither preselected, in a named group', () => {
  assert.match(MODAL, /<h2 class="rm-title" id="world-switch-t">Restart Kosmos in order to switch to a different Kosmos<\/h2>/,
    'Josh\'s title changed');
  assert.match(MODAL, /<fieldset[^>]*>\s*<legend class="vh">[^<]+<\/legend>/, 'the radios need a named group (fieldset + legend)');
  const radios = MODAL.match(/<input type="radio"[^>]*>/g) || [];
  assert.equal(radios.length, 2);
  assert.equal(radios.some((r) => /\bchecked\b/.test(r)), false, 'a default would answer Josh\'s question for the person');
  // Each label WRAPS its input, so the text is the radio's accessible name.
  assert.match(MODAL, /<label[^>]*><input type="radio" name="world-switch-agents" id="world-switch-pause" value="pause"> Pause this Kosmos's agents<\/label>/);
  assert.match(MODAL, /<label[^>]*><input type="radio" name="world-switch-agents" id="world-switch-keep" value="keep"> Keep them running<\/label>/);
  assert.match(MODAL, /id="world-switch-go" type="button" disabled>Restart Kosmos</, 'Restart must start disabled');
});

test('the dialog\'s focus trap treats the radio group as a stop, so Tab cannot leave through it', () => {
  assert.ok(/\['world-switch-modal', \['world-switch-pause', 'world-switch-cancel', 'world-switch-go'\], 'world-switch-cancel'\]/.test(PAGE),
    'the switch dialog\'s Tab trap does not list the pause/keep radio group, so Tab can leave the dialog through it');
});

function fakeDialog() {
  const radios = [
    { name: 'world-switch-agents', value: 'pause', checked: false },
    { name: 'world-switch-agents', value: 'keep', checked: false },
  ];
  const els = {
    'world-switch-t': { textContent: '' },
    'world-switch-modal': { hidden: true },
    'world-switch-cancel': { focused: false, focus() { this.focused = true; } },
    'world-switch-go': { disabled: false },
    'worldsw-btn': { focus() {} },
  };
  const document = {
    getElementById: (id) => els[id],
    querySelectorAll: (sel) => {
      assert.equal(sel, 'input[name="world-switch-agents"]');
      return radios;
    },
    querySelector: (sel) => {
      assert.equal(sel, 'input[name="world-switch-agents"]:checked');
      return radios.find((r) => r.checked) || null;
    },
  };
  return { radios, els, document };
}

function runDialog(steps) {
  const { radios, els, document } = fakeDialog();
  const switched = [];
  const src = `let WORLDSW_SWITCHING = false; let WORLD_SWITCH_ID = null; let WORLD_SWITCH_NAME = null;
${CHOICE}
${CHANGED}
${CONFIRM}
${GO}
return { worldswConfirmSwitch, worldswAgentsChoiceChanged, worldswSwitchGo };`;
  // eslint-disable-next-line no-new-func
  const fns = new Function('document', 'worldswSwitch', src)(document, (...a) => { switched.push(a); });
  steps({ fns, radios, els, switched });
}

test('Restart is disabled until a choice is made, and a reopened dialog asks again', () => {
  runDialog(({ fns, radios, els, switched }) => {
    radios[1].checked = true;                      // a leftover answer from a previous opening
    els['world-switch-go'].disabled = false;
    fns.worldswConfirmSwitch('w2', 'Side Project');
    assert.equal(els['world-switch-modal'].hidden, false);
    assert.equal(radios.some((r) => r.checked), false, 'the last answer was carried into a new question');
    assert.equal(els['world-switch-go'].disabled, true, 'Restart must wait for a choice');
    assert.equal(els['world-switch-cancel'].focused, true, 'Cancel keeps the initial focus');
    assert.match(els['world-switch-t'].textContent, /different Kosmos Side Project$/, 'Josh\'s title still carries the name');

    fns.worldswSwitchGo();                          // a programmatic click on the disabled button
    assert.deepEqual(switched, [], 'no switch without a choice');
    assert.equal(els['world-switch-modal'].hidden, false);

    radios[0].checked = true;
    fns.worldswAgentsChoiceChanged();
    assert.equal(els['world-switch-go'].disabled, false, 'a choice enables Restart');
    fns.worldswSwitchGo();
    assert.deepEqual(switched, [['w2', 'Side Project', 'pause']], 'the choice rides into the switch');
    assert.equal(els['world-switch-modal'].hidden, true);
  });
});

async function runSwitch(agents, responseBody) {
  const els = {
    'worldsw-restart': { hidden: true },
    'worldsw-restart-msg': { textContent: '' },
  };
  const posted = [];
  const fetchStub = async (url, opts) => {
    posted.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => responseBody };
  };
  const src = `let WORLDSW_SWITCHING = false;
${NOTE}
${SWITCH}
return worldswSwitch(_id, _name, _agents);`;
  // eslint-disable-next-line no-new-func
  await new Function('document', 'fetch', 'worldsFetch', 'worldswFocusTrigger', 'worldswReconnect', '_id', '_name', '_agents', src)(
    { getElementById: (id) => els[id] }, fetchStub, async () => {}, () => {}, async () => {}, 'w2', 'Side Project', agents,
  );
  return { posted, msg: els['worldsw-restart-msg'].textContent };
}

test('the POST carries the choice; a call with none sends the old body', async () => {
  const manual = { ok: true, world: { id: 'w2', name: 'Side Project' }, restartRequired: true, restarting: false };
  const withChoice = await runSwitch('keep', manual);
  assert.deepEqual(withChoice.posted, [{ url: '/api/worlds/active', body: { id: 'w2', agents: 'keep' } }]);
  const without = await runSwitch(undefined, manual);
  assert.deepEqual(without.posted[0].body, { id: 'w2' }, 'no choice must mean the pre-choice body, which the server reads as keep');
});

test('agents that could not be paused are named in the status line, ahead of the switch guidance', async () => {
  const r = await runSwitch('pause', {
    ok: true, world: { id: 'w2', name: 'Side Project' }, restartRequired: true, restarting: false,
    agents: 'pause', paused: ['bo'], notPaused: [{ name: 'ava', because: 'we could not stop ava, so it keeps running' }],
  });
  assert.match(r.msg, /^Still running, could not be paused: ava\. Kosmos could not restart itself/);

  const clean = await runSwitch('pause', {
    ok: true, world: { id: 'w2', name: 'Side Project' }, restartRequired: true, restarting: false,
    agents: 'pause', paused: ['bo'], notPaused: [],
  });
  assert.match(clean.msg, /^Kosmos could not restart itself/, 'nothing to report means no extra sentence');
});
