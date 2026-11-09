'use strict';
/* kosmos#8293: connecting a Claude agent keeps the account and model it last ran on, read from what Claude left on disk. */
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-connect8293-'));
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
  assert.equal('configDir' in seen, false);
  assert.match(out.unknownLastRun, /could not tell which Claude account/);
  assert.doesNotMatch(out.unknownLastRun, /model/);
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
  assert.match(out.unknownLastRun, /could not tell which model/);
});

test('a company policy that refuses the model is not bypassed', () => {
  const dir = agent('policed');
  ranOn(ACCT_B);
  const real = create.policyAllows;
  create.policyAllows = (provider, model) => (model ? { ok: false, because: 'no' } : { ok: true });
  try {
    const out = discover.connect(dir, {});
    assert.equal(out.ok, true, out.because);
    assert.equal('model' in seen, false);
    assert.equal(seen.configDir, ACCT_B);
  } finally { create.policyAllows = real; }
});

test('a transcript from another folder with the same encoded name is not this agent\'s', () => {
  const dir = agent('sharedname', { cwd: '/some/other/place' });
  ranOn(ACCT_B);
  const out = discover.connect(dir, {});
  assert.equal('configDir' in seen, false);
  assert.equal('model' in seen, false);
  assert.match(out.unknownLastRun, /account/);
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
