'use strict';
/**
 * #514: the separate verb that frees a name. Sandboxed on every root, the
 * same way remove.test.js is: this module MOVES OR DELETES FOLDERS, and an
 * unsandboxed run would do it to somebody's real agents.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'delete-leftover-'));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_TRASH = nodePath.join(SANDBOX, 'Trash');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const create = require('./create');
const remove = require('./remove');
const status = require('./status');
const leftover = require('./delete-leftover');
const fleet = require('../test-support/fleet');

const BINS = { claudeBin: '/bin/echo', tmuxBin: '/bin/echo' };
const calls = [];
leftover.setRunner((file, args) => { calls.push([file, args]); return { ok: true, stdout: '' }; });
remove.setRunner(() => ({ ok: true, stdout: '' }));

function leftoverAgent(name, { files = 3, job = true } = {}) {
  const dir = create.workerDir(name);
  fs.mkdirSync(nodePath.join(dir, 'notes'), { recursive: true });
  for (let i = 0; i < files; i += 1) fs.writeFileSync(nodePath.join(dir, i ? `notes/${i}.md` : 'CLAUDE.md'), `work ${i}\n`);
  if (job) {
    fs.mkdirSync(nodePath.dirname(create.plistPath(name)), { recursive: true });
    fs.writeFileSync(create.plistPath(name), '<plist/>');
  }
  return name;
}
function quiet() { status.setPaneSource(() => ''); }
function createAgain(name) {
  create.setRunner(() => ({ ok: true, stdout: '' }));
  create.setDryRun(false);
  quiet();
  const r = create.createAgent({ ...BINS, name, role: 'pm' });
  create.setRunner(null);
  return r;
}
test.beforeEach(() => { fs.mkdirSync(process.env.AGENT_WORKFORCE_TRASH, { recursive: true }); calls.length = 0; quiet(); });
test.afterEach(() => { status.setPaneSource(null); });

test('the plan counts what a person would lose, in words, and offers the Trash when it can take the files', () => {
  leftoverAgent('april');
  const p = leftover.plan('april', { now: Date.now() });
  assert.equal(p.ok, true, p.because);
  assert.equal(p.folder.files, 3);
  assert.equal(p.toTrash, true);
  assert.equal(p.typeToConfirm, null, 'the Trash path asked for the name to be typed');
  assert.match(p.loses[0], /^Its folder: 3 files, \d+ bytes, last changed a moment ago$/);
  assert.match(p.loses[1], /auto-start file/);
  assert.match(p.verb, /^Move 3 files to the Trash$/);
  assert.match(p.reassurance, /Trash, where you can get it back/);
  assert.match(p.reassurance, /the name april is free/);
});

test('a running agent is not a leftover, and nothing of it is offered', () => {
  leftoverAgent('busy');
  status.setPaneSource(() => fleet.line({ session: 'busy', claim: 'busy', title: '✳ Claude Code' }));
  const p = leftover.plan('busy');
  assert.equal(p.ok, false);
  assert.match(p.because, /is running/);
});

test('the done-when: delete, and the name passes create again; the files are in the Trash, not gone', () => {
  leftoverAgent('may');
  /* A removed record too, the realistic shape: removed from the board,
     folder left behind, name refused. */
  const done = leftover.del('may');
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  assert.equal(done.toTrash, true);
  assert.ok(!fs.existsSync(create.workerDir('may')), 'the folder survived');
  assert.ok(!fs.existsSync(create.plistPath('may')), 'the job file survived');
  const inTrash = fs.readdirSync(process.env.AGENT_WORKFORCE_TRASH).filter((n) => n.startsWith('may (Kosmos '));
  assert.equal(inTrash.length, 1, 'the folder is not in the Trash');
  assert.ok(fs.existsSync(nodePath.join(process.env.AGENT_WORKFORCE_TRASH, inTrash[0], 'CLAUDE.md')), 'the work did not travel with the folder');
  assert.ok(calls.some((c) => c[0] === 'launchctl' && c[1][0] === 'bootout'), 'the job was not booted out before its file went');
  const again = createAgain('may');
  assert.equal(again.outcome, create.OUTCOME.CREATED, `the name is still refused: ${again.because}`);
});

test('without a Trash the plan says for good, asks for the name, and refuses an untyped delete with nothing changed', () => {
  fs.rmSync(process.env.AGENT_WORKFORCE_TRASH, { recursive: true, force: true });
  leftoverAgent('june');
  const p = leftover.plan('june');
  assert.equal(p.toTrash, false);
  assert.equal(p.typeToConfirm, 'june');
  assert.match(p.reassurance, /cannot be undone/);
  assert.match(p.verb, /^Delete 3 files for good$/);
  const refused = leftover.del('june', { typed: 'jane' });
  assert.equal(refused.outcome, leftover.OUTCOME.REFUSED);
  assert.ok(fs.existsSync(create.workerDir('june')), 'a refused delete deleted');
  const done = leftover.del('june', { typed: 'june' });
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  assert.ok(!fs.existsSync(create.workerDir('june')));
  assert.ok(!fs.existsSync(create.plistPath('june')));
});

test('a folder that is a link, or nothing left at all, is refused in words', () => {
  fs.mkdirSync(nodePath.join(SANDBOX, 'elsewhere'), { recursive: true });
  fs.mkdirSync(create.WORKERS_DIR, { recursive: true });
  fs.symlinkSync(nodePath.join(SANDBOX, 'elsewhere'), create.workerDir('linky'));
  const p = leftover.plan('linky');
  assert.equal(p.ok, false);
  assert.match(p.because, /link to somewhere else/);
  assert.ok(fs.existsSync(nodePath.join(SANDBOX, 'elsewhere')));
  const none = leftover.plan('nobody');
  assert.equal(none.ok, false);
  assert.match(none.because, /nothing of nobody is left/);
});

test('a removed agent stops being hidden once its files are gone, so the board can show a new one by that name', () => {
  quiet();
  leftoverAgent('july', { job: false });
  const rec = remove.remove('july');
  assert.notEqual(rec.outcome, remove.OUTCOME.REFUSED, rec.because);
  assert.equal(remove.isHidden('july'), true, 'the fixture is not on the removed list');
  const done = leftover.del('july');
  assert.equal(done.outcome, leftover.OUTCOME.DELETED, done.because);
  assert.equal(remove.isHidden('july'), false, 'the removed record outlived the files');
});
