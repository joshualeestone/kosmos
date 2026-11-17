'use strict';
/**
 * kosmos#8640: delete-leftovers must never offer an agent that is RUNNING, whatever the record says.
 *
 * A tester's board listed 15 live agents as removed. Every delete re-plans, and the plan refuses an agent with a live
 * pane, but it recognised a live pane only by its SESSION NAME (`<name>` or `<name>-discord`). A running agent whose
 * session was renamed (its `@kosmos_agent` claim still names it), or one a person's own tooling started in a session of
 * its own, was invisible to it, so its folder and job were offered for deletion.
 *
 * Arms: the session named for the agent (the control that already refused); `<name>-discord`; another session whose
 * pane claims the agent; a pane whose session AND claim match nothing but which works inside the agent's folder (an
 * agent a person's own tooling started: the 9-day agents on the tester's board); a tmux that cannot be asked; and the
 * negative controls, nothing running and a sibling folder sharing the name's prefix, which must still be offered.
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
test.afterEach(() => { status.setPaneSource(null); status.setPaneFolderSource(null); });

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

test('a pane in a renamed session that still claims the agent (@kosmos_agent) is not offered', () => {
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

test('a pane whose session and claim match nothing, but which works in the agent\'s folder, is running', () => {
  const dir = leftoverAgent('agent1');
  status.setPaneSource(() => fleet.line({ session: 'orchestrator', claim: '', title: '✳ Claude Code' }));
  status.setPaneFolderSource(() => `%1\torchestrator\t${dir}\n`);
  const p = mac.plan('agent1');
  assert.equal(p.ok, false, 'a live pane in agent1\'s own folder was offered for deletion');
  assert.match(p.because, /working in agent1's folder/);
  assert.doesNotMatch(p.because, /tmux/i);
  const done = mac.del('agent1');
  assert.notEqual(done.outcome, leftover.OUTCOME.DELETED, 'the delete went ahead over a running agent');
  assert.ok(fs.existsSync(nodePath.join(dir, 'CLAUDE.md')), 'the running agent lost its folder');
});

test('a pane working in a subfolder of the agent\'s folder holds it too; a sibling sharing the prefix does not', () => {
  const dir = leftoverAgent('agent2');
  status.setPaneFolderSource(() => `%2\tw\t${nodePath.join(dir, 'notes')}\n`);
  assert.equal(mac.plan('agent2').ok, false, 'a pane in agent2/notes did not hold agent2');
  leftoverAgent('agent3');
  const sibling = leftoverAgent('agent30');
  status.setPaneFolderSource(() => `%3\tw\t${sibling}\n`);
  assert.equal(mac.plan('agent3').ok, true, 'a pane in agent30 held agent3 (a prefix match, not a folder match)');
});

test('the folder check fails closed: a tmux that cannot be asked refuses the plan', () => {
  leftoverAgent('agent4');
  status.setPaneFolderSource(() => { throw new Error('tmux went away'); });
  const p = mac.plan('agent4');
  assert.equal(p.ok, false);
  assert.match(p.because, /could not check whether .* is running/);
});

test('a named world\'s claim (name+world) holds the agent too', () => {
  leftoverAgent('greed');
  status.setPaneSource(() => fleet.line({ session: 'renamed', claim: 'greed+work', title: '✳ Claude Code' }));
  assert.equal(mac.plan('greed').ok, false);
});

test('a folder listing with a line it cannot read refuses the plan (a fragment of a folder whose name held a newline)', () => {
  const dir = leftoverAgent('agent5');
  status.setPaneFolderSource(() => `%1\tw\t/somewhere/else\n${dir}/tail-of-a-split-path\n`);
  const p = mac.plan('agent5');
  assert.equal(p.ok, false, 'an unreadable pane line was dropped and the plan offered the agent');
  assert.match(p.because, /could not check whether .* is running/);
});

test('the folder match is case-blind on a Mac, and sees through a symlinked workers folder', () => {
  const dir = leftoverAgent('agent6');
  status.setPaneFolderSource(() => `%1\tw\t${dir.replace(/agent6$/, 'AGENT6')}\n`);
  assert.equal(mac.plan('agent6').ok, false, 'AGENT6 did not hold agent6 on a case-blind disk');
  const link = nodePath.join(SANDBOX, 'workers-link');
  try { fs.symlinkSync(process.env.AGENT_WORKFORCE_WORKERS, link); } catch { /* already there */ }
  const real = fs.realpathSync(dir);
  status.setPaneFolderSource(() => `%1\tw\t${real}\n`);
  assert.equal(mac.plan('agent6').ok, false, 'the real path of agent6 did not hold it');
});

test('a folder the profile records outside the workers folder holds the agent too', () => {
  leftoverAgent('agent7');
  const elsewhere = nodePath.join(SANDBOX, 'projects', 'agent7-home');
  fs.mkdirSync(elsewhere, { recursive: true });
  require('./store').writeProfile('agent7', { displayName: 'Agent 7', dir: elsewhere });
  status.setPaneFolderSource(() => `%1\tw\t${elsewhere}\n`);
  assert.equal(mac.plan('agent7').ok, false, 'a pane in agent7\'s recorded folder did not hold it');
});
