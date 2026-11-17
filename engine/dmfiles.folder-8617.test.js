'use strict';
/**
 * #8617 (feedback, two installs): an agent's Files folder is made when the agent is, and for an agent made before
 * that, when the files block is written (the boot sweep), instead of waiting for the agent's first save.
 * Pins: only the one folder is made, never its parents; a folder already there is kept; a file or a link named
 * Files is never replaced or followed; the sweep makes it for an existing agent without changing the verdict.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-dmfiles-8617-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const dmfiles = require('./dmfiles');
const projects = require('./projects');

test.after(() => { fleet.restore(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

function agentFile(name, text) {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), text);
  return dir;
}
const tied = (sessionName) => ({ sessionName, name: sessionName, isNamedOurs: true });

test('#8617: ensureFolder makes the Files folder once, and keeps one already there with its files', () => {
  const own = agentFile('maker', 'You are maker.\n');
  const dir = dmfiles.filesDir('maker');
  assert.equal(fs.existsSync(dir), false, 'PRECONDITION');
  assert.deepEqual(dmfiles.ensureFolder('maker'), { ok: true, created: true, because: null });
  assert.ok(fs.lstatSync(dir).isDirectory());
  assert.equal(path.dirname(dir), own);
  fs.writeFileSync(path.join(dir, 'report.txt'), 'kept');
  assert.deepEqual(dmfiles.ensureFolder('maker'), { ok: true, created: false, because: null });
  assert.equal(fs.readFileSync(path.join(dir, 'report.txt'), 'utf8'), 'kept', 'a folder already there is left as it is');
});

test('#8617: an agent with no folder of its own gets none (the parent is never made)', () => {
  const dir = dmfiles.filesDir('ghost');
  const r = dmfiles.ensureFolder('ghost');
  assert.equal(r.ok, false);
  assert.equal(fs.existsSync(path.dirname(dir)), false, 'its own folder was made');
});

/* Symlinks need elevation on Windows; this file is not in the Windows run, and the guard keeps it portable if added. */
test('#8617: a file or a link already called Files is never replaced, and nothing is made through a link', { skip: process.platform === 'win32' && 'symlinks need elevation on Windows' }, () => {
  agentFile('hasfile', 'x\n');
  fs.writeFileSync(dmfiles.filesDir('hasfile'), 'a file');
  const f = dmfiles.ensureFolder('hasfile');
  assert.equal(f.ok, false);
  assert.equal(fs.readFileSync(dmfiles.filesDir('hasfile'), 'utf8'), 'a file', 'the file was replaced');
  // A link to a real folder elsewhere: not ours, so not used, and nothing is made in its target.
  agentFile('haslink', 'x\n');
  const elsewhere = path.join(SANDBOX, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.symlinkSync(elsewhere, dmfiles.filesDir('haslink'));
  const l = dmfiles.ensureFolder('haslink');
  assert.equal(l.ok, false);
  assert.match(l.because, /link/);
  assert.ok(fs.lstatSync(dmfiles.filesDir('haslink')).isSymbolicLink(), 'the link was replaced');
  // A dangling link: mkdir would refuse anyway; it stays a link and nothing is made where it points.
  agentFile('dangling', 'x\n');
  const nowhere = path.join(SANDBOX, 'nowhere');
  fs.symlinkSync(nowhere, dmfiles.filesDir('dangling'));
  assert.equal(dmfiles.ensureFolder('dangling').ok, false);
  assert.equal(fs.existsSync(nowhere), false, 'a folder was made through the link');
});

test('#8617: the sweep (tellAgent) makes the folder for an agent made before this, and its verdict is unchanged', () => {
  agentFile('older', 'You are older.\n');
  const dir = dmfiles.filesDir('older');
  assert.equal(fs.existsSync(dir), false, 'PRECONDITION: an agent made before #8617 has no Files');
  const told = dmfiles.syncEveryone([tied('older')]);
  assert.equal(told.length, 1);
  assert.equal(told[0].state, projects.TOLD.TOLD, told[0].because);
  assert.ok(fs.lstatSync(dir).isDirectory(), 'the sweep did not make the folder');
  // A Files that cannot be made does not turn the block's verdict into a failure.
  agentFile('blocked', 'You are blocked.\n');
  fs.writeFileSync(dmfiles.filesDir('blocked'), 'a file');
  const t2 = dmfiles.syncEveryone([tied('blocked')]);
  assert.equal(t2[0].state, projects.TOLD.TOLD, 'the block still landed');
  assert.match(t2[0].folder || '', /not a folder/, 'the reason the folder could not be made is not carried for the boot line');
  assert.equal(told[0].folder, undefined, 'CONTROL: a folder that was made carries no note');
  assert.equal(fs.readFileSync(dmfiles.filesDir('blocked'), 'utf8'), 'a file', 'the sweep replaced the file called Files');
});

test('#8617 CONTROL: a refused tell (not on the roster) makes no folder', () => {
  agentFile('stranger', 'You are stranger.\n');
  const t = dmfiles.tellAgent('stranger', []);
  assert.equal(t.state, projects.TOLD.COULD_NOT, 'PRECONDITION: refused');
  assert.equal(fs.existsSync(dmfiles.filesDir('stranger')), false, 'a folder was made for an agent the sweep refused');
});

test('#8617: a connected agent (its folder is the person\'s own) gets no Files folder from Kosmos; CONTROL: a plain one does', () => {
  const store = require('./store');
  const theirs = fs.mkdtempSync(path.join(SANDBOX, 'their-repo-'));
  fs.writeFileSync(path.join(theirs, 'CLAUDE.md'), 'You are linked.\n');
  store.writeProfile('linked', { dir: theirs });
  assert.equal(path.dirname(dmfiles.filesDir('linked')), theirs, 'PRECONDITION: its Files would be in the person\'s folder');
  const r = dmfiles.ensureFolder('linked');
  assert.equal(r.ok, false);
  assert.match(r.because, /folder you brought in/);
  const told = dmfiles.syncEveryone([tied('linked')]);
  assert.equal(told[0].state, projects.TOLD.TOLD, 'the block is still written');
  assert.equal(told[0].folder, undefined, 'a connected agent is not a failure to report');
  assert.equal(fs.existsSync(path.join(theirs, 'Files')), false, 'Kosmos added a Files folder to the person\'s own folder');
  agentFile('plainone', 'You are plain.\n');
  assert.equal(dmfiles.ensureFolder('plainone').created, true, 'CONTROL: an agent in its own Kosmos folder gets one');
});

test('#8617: the sweep makes the folder whether the block was just written or already current', () => {
  agentFile('current', 'You are current.\n');
  dmfiles.syncEveryone([tied('current')]);
  fs.rmdirSync(dmfiles.filesDir('current'));
  const again = dmfiles.syncEveryone([tied('current')]);
  assert.equal(again[0].changed, false, 'PRECONDITION: the block was already current');
  assert.ok(fs.lstatSync(dmfiles.filesDir('current')).isDirectory(), 'an unchanged block made no folder');
});
