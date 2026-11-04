'use strict';

/**
 * kosmos#7978 item 1: the words for what an agent's processes hold. The agent's page says the numbers; the card says
 * something only when it is out of the ordinary, so a figure on a card means look at this. Unknown says nothing.
 *
 *   node --test web.machinecost-7978.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(PAGE);

/* liftAll takes functions; the page's own thresholds are read from it, so the edges below test what ships. */
const limit = (name) => Number(new RegExp('const ' + name + ' = (\\d+);').exec(SCRIPT)[1]);
const { machineSize, machineCpuWords, machineLine, machineFlag, machineFlagHtml } = new Function('esc', 'MACHINE_BIG_MB', 'MACHINE_BUSY_CPU', 'MACHINE_LEFT_MIN_MB',
  page.liftAll(SCRIPT, ['machineSize', 'machineCpuWords', 'machineLine', 'machineFlag', 'machineFlagHtml'])
  + '\nreturn { machineSize, machineCpuWords, machineLine, machineFlag, machineFlagHtml };')((x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;'), limit('MACHINE_BIG_MB'), limit('MACHINE_BUSY_CPU'), limit('MACHINE_LEFT_MIN_MB'));

const usual = { memMb: 480, cpuPct: 12, processes: 6, leftMemMb: 0, top: { name: 'node', memMb: 300, cpuPct: 10, days: 0, pid: 11, wasLeft: false }, left: null };
const leftover = { memMb: 7136, cpuPct: 112, processes: 7, leftMemMb: 6656, top: { name: 'bash', memMb: 6656, cpuPct: 100, days: 14, pid: 4242, wasLeft: true }, left: { name: 'bash', memMb: 6656, cpuPct: 100, days: 14, pid: 4242 } };

test('sizes and processors read as a person says them', () => {
  assert.equal(machineSize(480), '480 MB');
  assert.equal(machineSize(1024), '1 GB');
  assert.equal(machineSize(6656), '6.5 GB');
  assert.equal(machineCpuWords(12), '12% of one processor');
  assert.equal(machineCpuWords(100), 'about one processor');
  assert.equal(machineCpuWords(112), 'about one processor');
  assert.equal(machineCpuWords(240), 'about 2 processors');
});

test('the agent\'s page says the numbers and the largest process, and says this computer\'s memory, not the Memory panel\'s', () => {
  assert.equal(machineLine({ machine: usual }), 'Uses 480 MB of this computer\u2019s memory and 12% of one processor. Largest: node, 300 MB.');
});

test('one process needs no "largest"', () => {
  assert.equal(machineLine({ machine: { ...usual, processes: 1 } }), 'Uses 480 MB of this computer\u2019s memory and 12% of one processor.');
});

test('what is left running gets its own sentence, with its age and process, and ends on what the person can do', () => {
  assert.equal(machineLine({ machine: leftover }), 'Uses 7 GB of this computer\u2019s memory and about one processor. Still running after what started it ended: bash, 6.5 GB, for 14 days (process 4242). Kosmos does not stop it for you: ask this agent to end process 4242, or restart your computer.');
});

test('a leftover smaller than what runs now is still named, so the card and the page agree', () => {
  const m = { memMb: 1100, cpuPct: 0, processes: 2, leftMemMb: 400, top: { name: 'claude', memMb: 700, cpuPct: 0, days: 0, pid: 10, wasLeft: false }, left: { name: 'node', memMb: 400, cpuPct: 0, days: 0, pid: 50 } };
  assert.equal(machineFlag({ machine: m }), '400 MB left running');
  assert.match(machineLine({ machine: m }), /Still running after what started it ended: node, 400 MB \(process 50\)\./);
  assert.doesNotMatch(machineLine({ machine: m }), /Largest/);
});

test('found by its folder, it says probably, because that is weaker than a name', () => {
  const m = { memMb: 700, cpuPct: 0, processes: 2, leftMemMb: 300, top: null, left: { name: 'zsh', memMb: 300, cpuPct: 0, days: 1, pid: 9, how: 'folder' } };
  assert.match(machineLine({ machine: m }), /Probably this agent.s, since it sits in its folder, and still running after what started it ended: zsh, 300 MB, for a day \(process 9\)/);
  assert.doesNotMatch(machineLine({ machine: leftover }), /Probably/, 'control: named outright it does not');
});

test('unknown says nothing, never a guessed zero', () => {
  for (const a of [{}, { machine: null }, { machine: 'x' }, { machine: { cpuPct: 1 } }, null]) {
    assert.equal(machineLine(a), '');
    assert.equal(machineFlag(a), '');
  }
  assert.match(machineLine({ machine: { ...usual, memMb: 0, processes: 1 } }), /Uses 0 MB/, 'control: a real zero is a reading');
});

test('the card stays quiet for an ordinary agent, at each edge', () => {
  assert.equal(machineFlag({ machine: usual }), '');
  assert.equal(machineFlag({ machine: { ...usual, memMb: 4095 } }), '');
  assert.equal(machineFlag({ machine: { ...usual, memMb: 4096 } }), 'Using 4 GB');
  assert.equal(machineFlag({ machine: { ...usual, cpuPct: 89 } }), '');
  assert.equal(machineFlag({ machine: { ...usual, cpuPct: 90 } }), 'Using 90% of one processor');
  assert.equal(machineFlag({ machine: { ...usual, leftMemMb: 199 } }), '');
  assert.equal(machineFlag({ machine: { ...usual, leftMemMb: 200 } }), '200 MB left running');
});

test('left running outranks the other two on a card', () => {
  assert.equal(machineFlag({ machine: { memMb: 9000, cpuPct: 300, leftMemMb: 6656 } }), '6.5 GB left running');
});

test('the card\'s line is escaped markup, and absent when quiet', () => {
  assert.equal(machineFlagHtml({ machine: usual }), '');
  assert.equal(machineFlagHtml({ machine: { ...usual, memMb: 8192 } }), '<span class="amachine">Using 8 GB</span>');
});

test('the page wires every place: the running and the not-running card and list row, and the agent\'s own line, as text', () => {
  assert.ok(SCRIPT.includes('<div class="amodel">${esc(tileModelLine(a))}${machineFlagHtml(a)}</div>'), 'running card');
  assert.ok(/acard off notrunning[\s\S]{0,4000}machineFlag\(a\) \? '<div class="amodel">' \+ machineFlagHtml\(a\)/.test(SCRIPT), 'not-running card');
  assert.ok(SCRIPT.includes('lrowTask(taskLine(a, { card: true }))}${machineFlag(a) ?'), 'running list row');
  assert.ok(/lrow off notrunning[\s\S]{0,4000}<div class="ltask">\$\{machineFlagHtml\(a\)\}<\/div>/.test(SCRIPT), 'not-running list row');
  assert.ok(SCRIPT.includes('dmachine.textContent = machineLine(a); dmachine.hidden = !dmachine.textContent;'));
  assert.ok(PAGE.includes('<p class="dhint" id="d-machine" hidden></p>'));
});

test('the status route offers it by the raw session, for a row of ours and for a not-running row', () => {
  const server = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');
  assert.ok(server.includes('machine: a.isNamedOurs ? machinecost.read(a.session) : null,'), 'a sample is keyed by the raw session, not sessionName');
  assert.ok(!server.includes('machinecost.read(a.sessionName)'));
  assert.ok(server.includes('machine: machinecost.readAgent(k.name, (s) => launchidentity.agentNameFromSession(s, launchidentity.currentWorldId())),'));
});
