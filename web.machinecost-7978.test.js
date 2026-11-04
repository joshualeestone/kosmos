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

const usual = { memMb: 480, cpuPct: 12, processes: 6, leftMemMb: 0, top: { name: 'node', memMb: 300, cpuPct: 10, days: 0, left: false, pid: 11 } };

test('sizes and processors read as a person says them', () => {
  assert.equal(machineSize(480), '480 MB');
  assert.equal(machineSize(1024), '1 GB');
  assert.equal(machineSize(6656), '6.5 GB');
  assert.equal(machineCpuWords(12), '12% of one processor');
  assert.equal(machineCpuWords(100), 'about 1 processor');
  assert.equal(machineCpuWords(240), 'about 2.4 processors');
});

test('the agent\'s page says the numbers and the largest process', () => {
  assert.equal(machineLine({ machine: usual }), 'Using 480 MB of memory and 12% of one processor on this computer. Largest: node, 300 MB.');
});

test('one process needs no "largest"', () => {
  assert.equal(machineLine({ machine: { ...usual, processes: 1 } }), 'Using 480 MB of memory and 12% of one processor on this computer.');
});

test('what was left behind is named, with its age and process, and says nothing here stops it', () => {
  const m = { memMb: 7136, cpuPct: 112, processes: 7, leftMemMb: 6656, top: { name: 'bash', memMb: 6656, cpuPct: 100, days: 14, left: true, pid: 4242 } };
  const line = machineLine({ machine: m });
  assert.match(line, /^Using 7 GB of memory and about 1\.1 processors on this computer\./);
  assert.match(line, /Left behind by an earlier run: bash, 6\.5 GB, running for 14 days \(process 4242\)\./);
  assert.match(line, /Kosmos only shows this; it is still running\./);
  assert.doesNotMatch(line, /Probably/);
});

test('found by its folder, it says probably, because that is weaker than a name', () => {
  const m = { memMb: 700, cpuPct: 0, processes: 2, leftMemMb: 300, top: { name: 'zsh', memMb: 300, cpuPct: 0, days: 1, left: true, pid: 9, how: 'folder' } };
  assert.match(machineLine({ machine: m }), /Probably left behind by an earlier run, since it sits in this agent.s folder: zsh, 300 MB, running for a day \(process 9\)/);
});

test('unknown says nothing, never a guessed zero', () => {
  for (const a of [{}, { machine: null }, { machine: 'x' }, { machine: { cpuPct: 1 } }, null]) {
    assert.equal(machineLine(a), '');
    assert.equal(machineFlag(a), '');
  }
  assert.match(machineLine({ machine: { ...usual, memMb: 0, processes: 1 } }), /Using 0 MB/, 'control: a real zero is a reading');
});

test('the card stays quiet for an ordinary agent, at each edge', () => {
  assert.equal(machineFlag({ machine: usual }), '');
  assert.equal(machineFlag({ machine: { ...usual, memMb: 4095 } }), '');
  assert.equal(machineFlag({ machine: { ...usual, memMb: 4096 } }), 'Using 4 GB');
  assert.equal(machineFlag({ machine: { ...usual, cpuPct: 89 } }), '');
  assert.equal(machineFlag({ machine: { ...usual, cpuPct: 90 } }), 'Using 90% of one processor');
  assert.equal(machineFlag({ machine: { ...usual, leftMemMb: 199 } }), '');
  assert.equal(machineFlag({ machine: { ...usual, leftMemMb: 200 } }), '200 MB left behind');
});

test('left behind outranks the other two on a card', () => {
  assert.equal(machineFlag({ machine: { memMb: 9000, cpuPct: 300, leftMemMb: 6656 } }), '6.5 GB left behind');
});

test('the card\'s line is escaped markup, and absent when quiet', () => {
  assert.equal(machineFlagHtml({ machine: usual }), '');
  assert.equal(machineFlagHtml({ machine: { ...usual, memMb: 8192 } }), '<span class="amachine">Using 8 GB</span>');
});

test('the page wires both: the card\'s model row and the agent\'s own line, as text', () => {
  assert.ok(SCRIPT.includes('<div class="amodel">${esc(tileModelLine(a))}${machineFlagHtml(a)}</div>'));
  assert.ok(SCRIPT.includes("dmachine.textContent = machineLine(a); dmachine.hidden = !dmachine.textContent;"));
  assert.ok(PAGE.includes('<p class="dhint" id="d-machine" hidden></p>'));
});

test('the status route offers it only for an agent of ours, from the last sample', () => {
  const server = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');
  assert.ok(server.includes('machine: a.isNamedOurs ? machinecost.read(a.sessionName) : null,'));
});
