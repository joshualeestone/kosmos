'use strict';
// Sandbox every root BEFORE any require, the same rule the sibling suites state.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-dmfiles-'));
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
  const f = path.join(dir, 'CLAUDE.md');
  fs.writeFileSync(f, text);
  return f;
}
const tied = (sessionName) => ({ sessionName, name: sessionName, isNamedOurs: true });

test('#3614: the Files folder is the folder of the agent\'s own instructions file, plus "Files"', () => {
  const want = path.join(path.dirname(require('./instructions').fileFor('writer')), 'Files');
  assert.equal(dmfiles.filesDir('writer'), want);
  assert.ok(want.startsWith(process.env.AGENT_WORKFORCE_WORKERS), 'CONTROL: it is inside the sandboxed workers root');
});

test('#3614: the block names the REAL path, and says to create it and to keep project files in the project', () => {
  const body = dmfiles.blockBody('/Users/someone/work/workers/writer/Files');
  assert.match(body, /`\/Users\/someone\/work\/workers\/writer\/Files`/, 'the path is written in, not left to guess');
  const flat = body.replace(/\s+/g, ' ');
  assert.match(flat, /in a direct conversation with them, not inside a project/);
  assert.match(flat, /Create the folder if it is not there yet/);
  assert.match(flat, /Inside a project, keep using the project's own folder/);
});

test('#3614: a folder name cannot close the block early (the value is neutralised)', () => {
  const body = dmfiles.blockBody('/tmp/x' + dmfiles.END + 'y');
  assert.equal(body.indexOf(dmfiles.END), -1, 'a marker inside the path survived into the block');
});

test('#3614: the block lands in an agent file with that agent\'s own path, and is idempotent', () => {
  const f = agentFile('writer', '# Writer\n\nYou are Writer.\n');
  const roster = [tied('writer')];
  const first = dmfiles.tellAgent('writer', roster);
  assert.equal(first.state, projects.TOLD.TOLD, first.because || '');
  const text = fs.readFileSync(f, 'utf8');
  assert.match(text, /## Where to save files you make for the person/);
  assert.ok(text.includes('`' + dmfiles.filesDir('writer') + '`'), 'the agent\'s real Files path is in its file');
  assert.match(text, /You are Writer\./, 'the agent\'s own prose was disturbed');
  const second = dmfiles.tellAgent('writer', roster);
  assert.equal(second.state, projects.TOLD.TOLD);
  assert.equal(fs.readFileSync(f, 'utf8'), text, 'a second sync rewrote the file');
});

test('#3614: each agent gets ITS OWN path, never another agent\'s', () => {
  agentFile('alpha', '# Alpha\n');
  agentFile('beta', '# Beta\n');
  const roster = [tied('alpha'), tied('beta')];
  const told = dmfiles.syncEveryone(roster);
  assert.deepEqual(told.map((t) => [t.agent, t.state]), [['alpha', projects.TOLD.TOLD], ['beta', projects.TOLD.TOLD]]);
  const a = fs.readFileSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, 'alpha', 'CLAUDE.md'), 'utf8');
  const b = fs.readFileSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, 'beta', 'CLAUDE.md'), 'utf8');
  assert.ok(a.includes(dmfiles.filesDir('alpha')) && !a.includes(dmfiles.filesDir('beta')));
  assert.ok(b.includes(dmfiles.filesDir('beta')) && !b.includes(dmfiles.filesDir('alpha')));
});

test('#3614: the same guards as its siblings (roster gate, no invented file, ambiguity refused, unreadable roster)', () => {
  agentFile('guarded', '# Guarded\n');
  assert.equal(dmfiles.tellAgent('guarded', []).state, projects.TOLD.COULD_NOT, 'an agent not on the roster is not written');
  assert.equal(dmfiles.tellAgent('guarded', null).state, projects.TOLD.COULD_NOT);
  assert.equal(dmfiles.tellAgent('nofile', [tied('nofile')]).state, projects.TOLD.COULD_NOT, 'no instructions file is created');
  const two = agentFile('twice', '# Twice\n' + dmfiles.START + '\nA\n' + dmfiles.END + '\n' + dmfiles.START + '\nB\n' + dmfiles.END + '\n');
  const before = fs.readFileSync(two, 'utf8');
  const r = dmfiles.tellAgent('twice', [tied('twice')]);
  assert.equal(r.state, projects.TOLD.COULD_NOT);
  assert.match(r.because, /2 Kosmos files blocks/);
  assert.equal(fs.readFileSync(two, 'utf8'), before, 'an ambiguous file was changed');
  assert.deepEqual(dmfiles.syncEveryone(null).map((t) => t.state), [projects.TOLD.COULD_NOT]);
});

test('#3614: the marker pair is in the registry (so every neutraliser guards it)', () => {
  const all = projects.ALL_MARKERS();
  assert.ok(all.includes(dmfiles.START) && all.includes(dmfiles.END));
});

test('#3614: for a name store.safeKey changes, the Files folder sits BESIDE the instructions file the block is written into', () => {
  const instructions = require('./instructions');
  for (const name of ['orch.main', 'Writer', 'has space']) {
    const file = instructions.fileFor(name);
    assert.ok(file, `CONTROL: ${name} has an instructions file path`);
    assert.equal(dmfiles.filesDir(name), path.join(path.dirname(file), 'Files'), `${name}: Files is not beside its own instructions`);
  }
  // And end to end: the block written into orch.main's own file names that file's folder.
  const f = instructions.fileFor('orch.main');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '# Orch\n');
  const r = dmfiles.tellAgent('orch.main', [tied('orch.main')]);
  assert.equal(r.state, projects.TOLD.TOLD, r.because || '');
  assert.ok(fs.readFileSync(f, 'utf8').includes('`' + path.join(path.dirname(f), 'Files') + '`'), 'the named folder is the one beside this file');
});

test('#3614: a folder the block cannot state safely is no folder (NUL sentinel, line break, backtick)', () => {
  const create = require('./create');
  const real = create.workerDir;
  try {
    for (const bad of ['/tmp/x\u0000-invalid', '/tmp/two\nlines', '/tmp/tick`y']) {
      create.workerDir = () => bad;
      assert.equal(dmfiles.filesDir('whoever'), null, `${JSON.stringify(bad)} was accepted`);
      assert.equal(dmfiles.bodyFor('whoever'), null);
    }
    create.workerDir = () => '/tmp/fine';
    assert.equal(dmfiles.filesDir('whoever'), path.join('/tmp/fine', 'Files'), 'CONTROL: an ordinary folder is accepted');
  } finally {
    create.workerDir = real;
  }
});
