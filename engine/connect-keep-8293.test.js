'use strict';
/* kosmos#8293: connecting a Claude agent keeps the account and model it last ran on, read from what Claude left on disk. */
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* Real path: the Mac's temp dir is itself behind a link, which would add a third spelling to the link test below. */
const SB = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connect8293-')));
const HOME = path.join(SB, 'home');
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SB, 'launch');
fs.mkdirSync(path.join(HOME, '.claude', 'projects'), { recursive: true });
fs.mkdirSync(process.env.AGENT_WORKFORCE_WORKERS, { recursive: true });
fs.writeFileSync(path.join(HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'main@example.com' } }));

const ACCT_B = path.join(HOME, '.claude-account-b');
const ACCT_C = path.join(HOME, '.claude-account-c');
for (const dir of [ACCT_B, ACCT_C]) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: `${path.basename(dir)}@example.com` } }));
  /* As on a fleet machine: the transcripts of every account live in one place, through a link. */
  fs.symlinkSync(path.join(HOME, '.claude', 'projects'), path.join(dir, 'projects'));
}

const create = require('./create');
create.setDryRun(true);
const discover = require('./discover');
const status = require('./status');

let seen = null;
const realInstall = create.installJob;
test.beforeEach(() => {
  status.setPaneSource(() => '');
  seen = null;
  create.installJob = (name, opts) => { seen = opts; return { ok: true, started: true }; };
});
test.afterEach(() => { status.setPaneSource(null); create.installJob = realInstall; });
test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

const assistant = (model, extra) => JSON.stringify({ type: 'assistant', cwd: '', message: { model }, ...extra });

function agent(name, { session = 'sess-1', lines, cwd } = {}) {
  const dir = path.join(SB, 'theirs', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `# You are ${name[0].toUpperCase()}${name.slice(1)}\n`);
  const folder = path.join(HOME, '.claude', 'projects', dir.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(folder, { recursive: true });
  const body = [JSON.stringify({ type: 'user', cwd: cwd || dir }), ...(lines || [assistant('claude-haiku-5-5')])];
  fs.writeFileSync(path.join(folder, `${session}.jsonl`), body.join('\n') + '\n');
  return dir;
}
const ranOn = (account, session = 'sess-1', sub = 'session-env') => fs.mkdirSync(path.join(account, sub, session), { recursive: true });
const cleanRan = () => { for (const a of [ACCT_B, ACCT_C, path.join(HOME, '.claude')]) for (const s of ['session-env', 'file-history']) fs.rmSync(path.join(a, s), { recursive: true, force: true }); };
test.beforeEach(cleanRan);

test('keeps the account that ran the session, and its model, with nothing to say', () => {
  const dir = agent('keepb');
  ranOn(ACCT_B);
  const out = discover.connect(dir, {});
  assert.equal(out.ok, true, out.because);
  assert.deepEqual(seen, { configDir: ACCT_B, model: 'claude-haiku-5-5' });
  assert.equal(out.unknownLastRun, undefined);
});

test('file-history answers when session-env is gone', () => {
  const dir = agent('keepfh');
  ranOn(ACCT_C, 'sess-1', 'file-history');
  discover.connect(dir, {});
  assert.equal(seen.configDir, ACCT_C);
});

test('an agent that ran on the main account stays on it, known, not guessed', () => {
  const dir = agent('keepmain');
  ranOn(path.join(HOME, '.claude'));
  const out = discover.connect(dir, {});
  assert.equal(out.ok, true, out.because);
  assert.equal('configDir' in seen, false);
  assert.equal(seen.model, 'claude-haiku-5-5');
  assert.equal(out.unknownLastRun, undefined);
});

test('no account holds the session: the main account, and it says so', () => {
  const dir = agent('nobody');
  const out = discover.connect(dir, {});
  assert.equal(out.ok, true, out.because);
  assert.deepEqual(seen, {});
  assert.match(out.unknownLastRun, /could not tell which Claude account.*default model/);
});

test('two accounts hold the session: not guessed between them', () => {
  const dir = agent('twoacct');
  ranOn(ACCT_B);
  ranOn(ACCT_C);
  const out = discover.connect(dir, {});
  assert.equal('configDir' in seen, false);
  assert.match(out.unknownLastRun, /could not tell which Claude account/);
});

test('the newest session decides, not an older one on another account', () => {
  const dir = agent('moved', { session: 'old' });
  ranOn(ACCT_B, 'old');
  const folder = path.join(HOME, '.claude', 'projects', dir.replace(/[^a-zA-Z0-9]/g, '-'));
  const newer = path.join(folder, 'new.jsonl');
  fs.writeFileSync(newer, [JSON.stringify({ type: 'user', cwd: dir }), assistant('claude-opus-5-5')].join('\n') + '\n');
  const later = new Date(Date.now() + 60000);
  fs.utimesSync(newer, later, later);
  ranOn(ACCT_C, 'new');
  discover.connect(dir, {});
  assert.deepEqual(seen, { configDir: ACCT_C, model: 'claude-opus-5-5' });
});

test('the model is the main conversation\'s latest, past synthetic and sidechain rows', () => {
  const dir = agent('modelpick', { lines: [assistant('claude-opus-5-5'), assistant('claude-haiku-5-5', { isSidechain: true }), assistant('<synthetic>')] });
  ranOn(ACCT_B);
  discover.connect(dir, {});
  assert.equal(seen.model, 'claude-opus-5-5');
});

test('a model id that cannot go in a job is not kept, and it says so', () => {
  const dir = agent('badmodel', { lines: [assistant('claude bad; rm')] });
  ranOn(ACCT_B);
  const out = discover.connect(dir, {});
  assert.equal(seen.configDir, ACCT_B);
  assert.equal('model' in seen, false);
  assert.match(out.unknownLastRun, /a model Kosmos cannot start here/);
});

test('a transcript with no model row says it could not tell', () => {
  const dir = agent('nomodel', { lines: [JSON.stringify({ type: 'user', cwd: '' })] });
  ranOn(ACCT_B);
  const out = discover.connect(dir, {});
  assert.equal(seen.configDir, ACCT_B);
  assert.match(out.unknownLastRun, /could not tell which Claude model/);
});

test('a model from a compatible endpoint is not written into a job that has no such endpoint', () => {
  const dir = agent('deepseek', { lines: [assistant('deepseek-chat')] });
  ranOn(ACCT_B);
  const out = discover.connect(dir, {});
  assert.equal('model' in seen, false);
  assert.match(out.unknownLastRun, /a model Kosmos cannot start here/);
});

test('a failed read is said, not treated as never having run', () => {
  const dir = agent('readfail');
  ranOn(ACCT_B);
  const accounts = require('./accounts');
  const real = accounts.list;
  accounts.list = () => { throw new Error('boom'); };
  try {
    const out = discover.connect(dir, {});
    assert.equal(out.ok, true, out.because);
    assert.deepEqual(seen, {});
    assert.match(out.unknownLastRun, /could not tell which Claude account/);
  } finally { accounts.list = real; }
});

test('a folder that never ran has nothing to keep and nothing to say', () => {
  const dir = path.join(SB, 'theirs', 'neverran');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# You are Neverran\n');
  const out = discover.connect(dir, {});
  assert.equal(out.ok, true, out.because);
  assert.deepEqual(seen, {});
  assert.equal(out.unknownLastRun, undefined);
});

test('the job that gets written carries the account and the model', () => {
  const dir = agent('realjob');
  ranOn(ACCT_B);
  create.installJob = realInstall;
  /* Out of dry run so the plist is really written, into this sandbox; the injected runner takes every launchctl call. */
  const bin = path.join(SB, 'fake-claude');
  fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = bin;
  create.setRunner(() => ({ ok: true, stdout: '' }));
  create.setDryRun(false);
  try {
    const out = discover.connect(dir, {});
    assert.equal(out.ok, true, out.because);
    const job = create.readJob('realjob');
    assert.equal(job.configDir, ACCT_B);
    assert.equal(job.model, 'claude-haiku-5-5');
  } finally { create.setDryRun(true); create.setRunner(null); delete process.env.AGENT_WORKFORCE_CLAUDE_BIN; }
});

test('company policy is asked about the model that will run', () => {
  const dir = agent('policed');
  ranOn(ACCT_B);
  const real = create.policyAllows;
  const asked = [];
  create.policyAllows = (provider, model) => { asked.push(model); return model === 'claude-haiku-5-5' ? { ok: true } : { ok: false, because: 'choose one' }; };
  try {
    const out = discover.connect(dir, {});
    assert.equal(out.ok, true, out.because);
    assert.deepEqual(asked, ['claude-haiku-5-5']);
    assert.equal(seen.model, 'claude-haiku-5-5');
  } finally { create.policyAllows = real; }
});

test('a policy that does not list the model refuses, before anything is written', () => {
  const dir = agent('policedout');
  ranOn(ACCT_B);
  const real = create.policyAllows;
  create.policyAllows = () => ({ ok: false, because: 'not this one' });
  try {
    const out = discover.connect(dir, {});
    assert.equal(out.ok, false);
    assert.equal(out.because, 'not this one');
    assert.equal(seen, null);
  } finally { create.policyAllows = real; }
});

test('the Found row\'s sentence and the engine\'s field use one name (source text only; no check runs that arm)', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  assert.match(page, /said\.textContent = out\.unknownLastRun \? \('Added, but ' \+ out\.unknownLastRun \+ '\.'\) : '';/);
  const engine = fs.readFileSync(path.join(__dirname, 'discover.js'), 'utf8');
  assert.match(engine, /\{ unknownLastRun \}/);
});

test('a transcript from another folder with the same encoded name is not this agent\'s', () => {
  const dir = agent('sharedname', { cwd: '/some/other/place' });
  ranOn(ACCT_B);
  const out = discover.connect(dir, {});
  assert.equal('configDir' in seen, false);
  assert.equal('model' in seen, false);
  assert.equal(out.unknownLastRun, undefined);
});

test('a folder connected by one spelling keeps what ran under the other', () => {
  const dir = agent('linkedreal');
  ranOn(ACCT_B);
  const link = path.join(SB, 'linkedalias');
  fs.symlinkSync(dir, link);
  assert.equal(discover.lastRunOf(link).account && discover.lastRunOf(link).account.dir, ACCT_B);
  assert.equal(discover.lastRunOf(link).model, 'claude-haiku-5-5');
  /* The transcript records the link while the folder is connected by its real path. */
  const viaLink = agent('realname', { session: 'sess-2', cwd: path.join(SB, 'aliasrun') });
  fs.symlinkSync(viaLink, path.join(SB, 'aliasrun'));
  ranOn(ACCT_C, 'sess-2');
  assert.equal(discover.lastRunOf(viaLink).account.dir, ACCT_C);
});

test('a newer transcript from another folder does not hide this agent\'s own', () => {
  const dir = agent('hiddenown', { session: 'mine' });
  ranOn(ACCT_B, 'mine');
  const folder = path.join(HOME, '.claude', 'projects', dir.replace(/[^a-zA-Z0-9]/g, '-'));
  const other = path.join(folder, 'theirs.jsonl');
  fs.writeFileSync(other, JSON.stringify({ type: 'user', cwd: '/some/other/place' }) + '\n');
  const later = new Date(Date.now() + 60000);
  fs.utimesSync(other, later, later);
  discover.connect(dir, {});
  assert.equal(seen.configDir, ACCT_B);
});

test('a transcript whose folder cannot be read is said, not treated as never having run', () => {
  const dir = agent('nocwd', { lines: [] });
  const folder = path.join(HOME, '.claude', 'projects', dir.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.writeFileSync(path.join(folder, 'sess-1.jsonl'), JSON.stringify({ type: 'summary' }) + '\n');
  ranOn(ACCT_B);
  const out = discover.connect(dir, {});
  assert.deepEqual(seen, {});
  assert.match(out.unknownLastRun, /could not tell which Claude account/);
});

test('a Codex folder is left exactly as before', () => {
  const dir = path.join(SB, 'theirs', 'codexone');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# You are Codexone\n');
  const out = discover.connect(dir, {});
  assert.equal(out.ok, true, out.because);
  assert.deepEqual(seen, { runner: 'codex' });
  assert.equal(out.unknownLastRun, undefined);
});
