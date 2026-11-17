'use strict';
/**
 * kosmos#8640: delete-leftovers must never offer an agent that is RUNNING, whatever the record says.
 *
 * A tester's board listed 15 live agents as removed. Every delete re-plans, and the plan refuses an agent with a live
 * pane, but it recognised a live pane only by a tmux SESSION NAMED EXACTLY FOR THE AGENT. A running agent in a session
 * named otherwise (the legacy `<name>-discord`, or a relaunch that put it somewhere else and tied it by its
 * `@kosmos_agent` claim) was invisible to it, so its folder and job were offered for deletion.
 *
 * Arms: the session named for the agent (the control that already refused); `<name>-discord`; another session whose
 * pane claims the agent; and the negative control, nothing running, which must still be offered.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'delete-leftover-running-8640-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(SANDBOX, 'LaunchAgents', 'systemd', 'user');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_TRASH = nodePath.join(SANDBOX, 'Trash');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const create = require('./create');
const remove = require('./remove');
const status = require('./status');
const leftover = require('./delete-leftover');
const fleet = require('../test-support/fleet');

leftover.setRunner(() => ({ ok: true, stdout: '' }));
remove.setRunner(() => ({ ok: true, stdout: '' }));

const mac = {
  plan: (name, o) => leftover.plan(name, { platform: 'darwin', ...(o || {}) }),
  del: (name, o) => leftover.del(name, { unchecked: true, platform: 'darwin', ...(o || {}) }),
};

function leftoverAgent(name) {
  const dir = create.workerDir(name);
  fs.mkdirSync(nodePath.join(dir, 'notes'), { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'CLAUDE.md'), 'work\n');
  fs.writeFileSync(nodePath.join(dir, 'notes', '1.md'), 'more work\n');
  fs.mkdirSync(nodePath.dirname(create.plistPath(name)), { recursive: true });
  fs.writeFileSync(create.plistPath(name), '<plist/>');
  return dir;
}

test.beforeEach(() => { fs.mkdirSync(process.env.AGENT_WORKFORCE_TRASH, { recursive: true }); status.setPaneSource(() => ''); });
test.afterEach(() => { status.setPaneSource(null); });

test('control: a pane in the session named for the agent refuses (it already did)', () => {
  leftoverAgent('wrath');
  status.setPaneSource(() => fleet.line({ session: 'wrath', claim: 'wrath', title: '✳ Claude Code' }));
  const p = mac.plan('wrath');
  assert.equal(p.ok, false);
  assert.match(p.because, /is running/);
});

test('a running agent in its <name>-discord session is not offered, and its folder survives a delete', () => {
  const dir = leftoverAgent('envy');
  status.setPaneSource(() => fleet.line({ session: 'envy-discord', claim: '', title: '✳ Claude Code' }));
  const p = mac.plan('envy');
  assert.equal(p.ok, false, 'a live envy-discord pane was offered for deletion');
  assert.match(p.because, /is running/);
  const done = mac.del('envy');
  assert.notEqual(done.outcome, leftover.OUTCOME.DELETED, 'the delete went ahead over a running agent');
  assert.ok(fs.existsSync(nodePath.join(dir, 'CLAUDE.md')), 'the running agent lost its folder');
});

test('a pane in another session that claims the agent (@kosmos_agent) is not offered', () => {
  const dir = leftoverAgent('lust');
  status.setPaneSource(() => fleet.line({ session: 'relaunched-3', claim: 'lust', title: '✳ Claude Code' }));
  const p = mac.plan('lust');
  assert.equal(p.ok, false, 'a pane claiming lust was offered for deletion');
  assert.match(p.because, /is running/);
  const done = mac.del('lust');
  assert.notEqual(done.outcome, leftover.OUTCOME.DELETED);
  assert.ok(fs.existsSync(nodePath.join(dir, 'CLAUDE.md')));
});

test('the claim and the -discord session match case-blind on a Mac, as the session name already does', () => {
  leftoverAgent('hawkeye');
  status.setPaneSource(() => fleet.line({ session: 'x', claim: 'Hawkeye', title: '✳ Claude Code' }));
  assert.equal(mac.plan('hawkeye').ok, false);
  status.setPaneSource(() => fleet.line({ session: 'Hawkeye-discord', claim: '', title: '✳ Claude Code' }));
  assert.equal(mac.plan('hawkeye').ok, false);
});

test('negative control: with nothing running the leftover is still offered, and an unrelated pane does not hold it', () => {
  leftoverAgent('juan');
  status.setPaneSource(() => '');
  assert.equal(mac.plan('juan').ok, true, 'a really removed agent is no longer offered');
  status.setPaneSource(() => fleet.line({ session: 'juanita', claim: 'juanita', title: '✳ Claude Code' }));
  assert.equal(mac.plan('juan').ok, true, 'a pane for a different agent held this one');
  status.setPaneSource(() => fleet.line({ session: 'juan-discord-old', claim: '', title: '✳ Claude Code' }));
  assert.equal(mac.plan('juan').ok, true, 'a session that only starts with the name held this one');
});
