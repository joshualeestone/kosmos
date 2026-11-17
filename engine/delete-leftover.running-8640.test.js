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

test('control: a running agent in its <name>-discord session is not offered (the roster already mapped it), and its folder survives a delete', () => {
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
  assert.match(p.because, /open and working in agent1's folder right now \(it shows as "orchestrator"\)/);
  assert.doesNotMatch(p.because, /tmux|session/i);
  const done = mac.del('agent1');
  assert.notEqual(done.outcome, leftover.OUTCOME.DELETED, 'the delete went ahead over a running agent');
  assert.ok(fs.existsSync(nodePath.join(dir, 'CLAUDE.md')), 'the running agent lost its folder');
});

test('a pane working in a subfolder of the agent\'s folder holds it too; a sibling sharing the prefix does not', () => {
  const dir = leftoverAgent('agent2');
  status.setPaneFolderSource(() => `%2\tw\t${nodePath.join(dir, 'notes')}\n`);
  const p2 = mac.plan('agent2');
  assert.equal(p2.ok, false, 'a pane in agent2/notes did not hold agent2');
  assert.match(p2.because, /working in agent2's folder/);
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

test('the claim must be THIS world\'s key: in the default world a name+world claim is another world\'s agent', () => {
  leftoverAgent('greed');
  status.setPaneSource(() => fleet.line({ session: 'renamed', claim: 'greed+work', title: '✳ Claude Code' }));
  assert.equal(mac.plan('greed').ok, true, 'another world\'s claim held this world\'s greed');
  status.setPaneSource(() => fleet.line({ session: 'renamed', claim: 'greed', title: '✳ Claude Code' }));
  assert.equal(mac.plan('greed').ok, false);
});

test('a folder listing with a line it cannot read refuses the plan (a fragment of a folder whose name held a newline)', () => {
  const dir = leftoverAgent('agent5');
  status.setPaneFolderSource(() => `%1\tw\t/somewhere/else\n${dir}/tail-of-a-split-path\n`);
  const p = mac.plan('agent5');
  assert.equal(p.ok, false, 'an unreadable pane line was dropped and the plan offered the agent');
  assert.match(p.because, /Something open on this computer could not be read/);
  assert.doesNotMatch(p.because, /Try again in a moment/);
});

test('the folder match is case-blind on a Mac, and matches the folder\'s real path (on a Mac /var is /private/var)', () => {
  const dir = leftoverAgent('agent6');
  status.setPaneFolderSource(() => `%1\tw\t${dir.replace(/agent6$/, 'AGENT6')}\n`);
  const p6 = mac.plan('agent6');
  assert.equal(p6.ok, false, 'AGENT6 did not hold agent6 on a case-blind disk');
  assert.match(p6.because, /working in agent6's folder/);
  const real = fs.realpathSync(dir);
  status.setPaneFolderSource(() => `%1\tw\t${real}\n`);
  assert.equal(mac.plan('agent6').ok, false, 'the real path of agent6 did not hold it');
});

test('a pane with no folder (a dead pane, or a root process tmux may not look into) holds nothing and refuses nothing', () => {
  leftoverAgent('agent8');
  status.setPaneFolderSource(() => '%1\tother\t/elsewhere\n%2\tdead\t\n');
  assert.equal(mac.plan('agent8').ok, true, 'an empty-folder pane made every delete refuse');
});


test('a recorded folder outside where Kosmos keeps agents is not matched against panes: the plan says where it is instead', () => {
  leftoverAgent('agent10');
  const broad = nodePath.join(SANDBOX, 'projects');
  fs.mkdirSync(nodePath.join(broad, 'some-project'), { recursive: true });
  require('./store').writeProfile('agent10', { displayName: 'Agent 10', dir: broad });
  status.setPaneFolderSource(() => `%1\tw\t${nodePath.join(broad, 'some-project')}\n`);
  const p = mac.plan('agent10');
  assert.equal(p.ok, false);
  assert.doesNotMatch(p.because, /working in/, 'a pane anywhere under a broad recorded folder held the agent');
  assert.match(p.because, /not where Kosmos keeps agents/);
});

test('a pane in the workers folder itself holds no agent (a boundary, not an ancestor match)', () => {
  leftoverAgent('agent11');
  status.setPaneFolderSource(() => `%1\tw\t${process.env.AGENT_WORKFORCE_WORKERS}\n`);
  assert.equal(mac.plan('agent11').ok, true);
});

/* The production half of paneFolders: a real tmux PROGRAM is run (the repo's fake, test-support/fake-tmux.sh), with no
   pane source injected, so shDetail, the listing format and the parser are exercised as on a Mac. */
test('production read: the fake tmux reports a pane in the agent\'s folder, and the plan refuses', () => {
  const dir = leftoverAgent('agent12');
  const panes = nodePath.join(SANDBOX, 'fake-panes.txt');
  const folders = nodePath.join(SANDBOX, 'fake-folders.txt');
  fs.writeFileSync(panes, '');
  fs.writeFileSync(folders, `%7\tsomething-else\t${dir}\n`);
  const saved = { bin: process.env.AGENT_WORKFORCE_TMUX_BIN, p: process.env.AGENT_WORKFORCE_FAKE_PANES, f: process.env.AGENT_WORKFORCE_FAKE_PANE_FOLDERS };
  process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, '..', 'test-support', 'fake-tmux.sh');
  process.env.AGENT_WORKFORCE_FAKE_PANES = panes;
  process.env.AGENT_WORKFORCE_FAKE_PANE_FOLDERS = folders;
  status.setPaneSource(null);
  try {
    const p = mac.plan('agent12');
    assert.equal(p.ok, false, 'the folder read through a real tmux program did not see the pane: ' + p.because);
    assert.match(p.because, /open and working in agent12's folder/);
    fs.writeFileSync(folders, '');
    assert.equal(mac.plan('agent12').ok, true, 'with no pane in the folder the leftover was not offered');
  } finally {
    for (const [k, v] of [['AGENT_WORKFORCE_TMUX_BIN', saved.bin], ['AGENT_WORKFORCE_FAKE_PANES', saved.p], ['AGENT_WORKFORCE_FAKE_PANE_FOLDERS', saved.f]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('production read: a tmux that answers the folder read with an error refuses the plan', () => {
  leftoverAgent('agent13');
  const stub = nodePath.join(SANDBOX, 'tmux-folders-fail.sh');
  // Lists panes for the roster read; fails the folder read the way a broken tmux does (non-zero, not "no server").
  fs.writeFileSync(stub, '#!/bin/sh\ncase "$*" in *pane_current_path*) case "$1" in -u) ;; *) echo "no -u" >&2; exit 3 ;; esac; echo "protocol version mismatch" >&2; exit 1 ;; esac\nexit 0\n');
  fs.chmodSync(stub, 0o755);
  const saved = process.env.AGENT_WORKFORCE_TMUX_BIN;
  process.env.AGENT_WORKFORCE_TMUX_BIN = stub;
  status.setPaneSource(null);
  try {
    const p = mac.plan('agent13');
    assert.equal(p.ok, false, 'a failed folder read let the plan offer the agent');
    assert.match(p.because, /could not check whether .* is running/);
  } finally { if (saved === undefined) delete process.env.AGENT_WORKFORCE_TMUX_BIN; else process.env.AGENT_WORKFORCE_TMUX_BIN = saved; }
});

// kosmos#8644 item 1: planAsync reads the folder listing off the board's thread and hands it to plan(); the same answers.
test('kosmos#8644: planAsync refuses a pane in the agent\'s folder with plan()\'s own sentence', async () => {
  const dir = leftoverAgent('async1');
  status.setPaneSource(() => fleet.line({ session: 'orchestrator', claim: '', title: '✳ Claude Code' }));
  status.setPaneFolderSource(() => `%1\torchestrator\t${dir}\n`);
  const p = await leftover.planAsync('async1', { platform: 'darwin' });
  assert.equal(p.ok, false, 'planAsync offered a running agent\'s folder');
  assert.equal(p.because, mac.plan('async1').because, 'planAsync and plan() said different things');
});

test('kosmos#8644: planAsync still fails closed when the folder listing cannot be read', async () => {
  leftoverAgent('async2');
  status.setPaneFolderSource(() => { throw new Error('tmux went away'); });
  const p = await leftover.planAsync('async2', { platform: 'darwin' });
  assert.equal(p.ok, false, 'an unreadable listing let planAsync offer the delete');
  assert.match(p.because, /could not check whether .* is running/);
});

test('kosmos#8644: planAsync never makes the synchronous folder read (the board-thread wait it removes)', async () => {
  leftoverAgent('async3');
  status.setPaneFolderSource(() => '');
  const sync = status.paneFolders;
  let syncCalls = 0;
  status.paneFolders = () => { syncCalls += 1; throw new Error('the board thread was asked'); };
  try {
    const p = await leftover.planAsync('async3', { platform: 'darwin' });
    assert.equal(syncCalls, 0, 'planAsync made the synchronous tmux read');
    assert.equal(p.ok, true, 'with nothing running and the listing read off-thread, the plan should go ahead: ' + p.because);
    // CONTROL: plan() alone still makes the synchronous read (and here meets the stand-in that throws).
    const q = mac.plan('async3');
    assert.equal(syncCalls, 1, 'CONTROL: plan() did not read the folders itself');
    assert.equal(q.ok, false, 'CONTROL: the throwing stand-in did not refuse plan()');
  } finally { status.paneFolders = sync; }
});
