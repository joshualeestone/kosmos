'use strict';
/**
 * #4479 (an external tester, 2026-09-28): Settings said "11 agents are set up to start at login, but turned off:
 * alexis, eric, larry, and 8 more", names he did not recognise. launchd's disabled-overrides list keeps entries
 * for agents whose plist is gone, and the row printed raw job names. Now a disabled job counts only when its agent
 * exists (its plist is present) and is named by the name the person sees.
 *
 * The card's fixture: 1 live, disabled, renamed agent; 2 stale overrides (no plist); 1 removed agent. Run through
 * the DEFAULT reads (a sandboxed LaunchAgents folder with real plist files, and real profiles), not only the seams.
 */
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-autostart-4479-'));
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
fs.mkdirSync(process.env.AGENT_WORKFORCE_LAUNCH, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const machine = require('./machine');
const create = require('./create');
const store = require('./store');

const DARWIN = { platform: 'darwin' };
const printDisabled = (names) => (bin, args) => (bin === '/bin/launchctl' && args[0] === 'print-disabled'
  ? { ok: true, stdout: names.map((n) => '\t"' + create.serviceLabel(n) + '" => disabled\n').join('') + '\t"com.kosmos.board" => enabled\n' }
  : { ok: true, stdout: '' });

// alexis: live (plist present), renamed (shown as Morpheus). eric, larry: stale overrides (no plist).
// oldone: removed through Kosmos, its plist still there, so only the removed list can hide it.
fs.writeFileSync(create.plistPath('alexis'), '<plist/>');
fs.writeFileSync(create.plistPath('oldone'), '<plist/>');
store.writeProfile('alexis', { displayName: 'Morpheus' });
const FIXTURE = ['alexis', 'eric', 'larry', 'oldone'];
const REMOVED = { ok: true, names: ['oldone'] };

test('#4479 the card\'s fixture shows exactly one agent, by the name the person sees', () => {
  const got = machine.agentAutostartCheck(printDisabled(FIXTURE), { ...DARWIN, removed: REMOVED });
  assert.equal(got.state, machine.STATE.ATTENTION);
  assert.equal(got.title, 'An agent is set up to start at login, but turned off');
  assert.match(got.detail, /^Morpheus has its login job switched off right now/);
  assert.doesNotMatch(got.detail, /alexis|eric|larry|oldone/, 'a job name, or a leftover with no agent, was shown');
});

test('#4479 CONTROL: counting every override by its job name (the old rule) shows 3', () => {
  const got = machine.agentAutostartCheck(printDisabled(FIXTURE), { ...DARWIN, removed: REMOVED, live: () => true, shownName: (n) => n });
  assert.equal(got.title, '3 agents are set up to start at login, but turned off');
  assert.match(got.detail, /^alexis, eric, larry have their/);
});

test('#4479 only leftovers (no plist) is the all-clear, not a warning', () => {
  const got = machine.agentAutostartCheck(printDisabled(['eric', 'larry']), { ...DARWIN, removed: { ok: true, names: [] } });
  assert.equal(got.state, machine.STATE.OK);
});

test('#4479 a live agent with no display name recorded is named by its job name', () => {
  fs.writeFileSync(create.plistPath('plainjob'), '<plist/>');
  try {
    const got = machine.agentAutostartCheck(printDisabled(['plainjob']), { ...DARWIN, removed: { ok: true, names: [] } });
    assert.match(got.detail, /^plainjob has its/);
  } finally { fs.rmSync(create.plistPath('plainjob'), { force: true }); }
});

test('#4479 an agent with no recorded display name is named as the board names it, from its identity line', () => {
  fs.writeFileSync(create.plistPath('neojob'), '<plist/>');
  fs.mkdirSync(create.workerDir('neojob'), { recursive: true });
  fs.writeFileSync(path.join(create.workerDir('neojob'), 'CLAUDE.md'), 'You are **Neo**, the one.\n\n## Who you are\nThe one.\n');
  try {
    const got = machine.agentAutostartCheck(printDisabled(['neojob']), { ...DARWIN, removed: { ok: true, names: [] } });
    assert.match(got.detail, /^Neo has its/, 'the row named an agent differently from the board: ' + got.detail);
  } finally { fs.rmSync(create.plistPath('neojob'), { force: true }); }
});

test('#4479 a plist check that cannot look (not "not there") counts the agent as live, the safe direction', () => {
  const presence = create.jobPresence;
  create.jobPresence = () => 'unknown';
  try {
    const got = machine.agentAutostartCheck(printDisabled(['eric']), { ...DARWIN, removed: { ok: true, names: [] } });
    assert.equal(got.state, machine.STATE.ATTENTION, 'an unreadable check hid a possibly live agent');
    assert.match(got.detail, /^eric has its/);
  } finally { create.jobPresence = presence; }
});

test('#4479 the row is still left out on Windows', () => {
  assert.equal(machine.agentAutostartCheck(printDisabled(FIXTURE), { platform: 'win32', removed: REMOVED }), null);
});
