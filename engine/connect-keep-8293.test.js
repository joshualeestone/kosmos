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
process.env.AGENT_WORKFORCE_HOME = HOME;   // a release cut sets this, and engine/accounts.js prefers it to HOME
process.env.USERPROFILE = HOME;   // kosmos#8378: os.homedir() reads USERPROFILE on Windows, where HOME is not asked
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
  const dir = agent('badmodel', { lines: [assistant('claude-bad;rm')] });
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
  /* kosmos#8378: a stub this platform counts as runnable, and on Windows a stand-in Task Scheduler for the job
     (test-support/runnerstub.js, test-support/jobfixture.js). */
  const bin = require('../test-support/runnerstub').writeRunnerStub(SB, 'fake-claude');
  require('../test-support/jobfixture').useJobStore();
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

test('kosmos#8305: a model off the company list starts on one the list allows, and the row says which', () => {
  const dir = agent('moved8305');
  ranOn(ACCT_B);
  const usual = create.modelsFor('anthropic').find((m) => m.key === create.defaultModelKeyFor('anthropic'));
  const real = create.policyAllows;
  create.policyAllows = (provider, model) => (model === usual.arg ? { ok: true } : { ok: false, because: 'choose one' });
  try {
    const out = discover.connect(dir, {});
    assert.equal(out.ok, true, out.because);
    assert.equal(seen.model, usual.arg);
    assert.equal(seen.configDir, ACCT_B, 'the account it ran on is kept');
    assert.match(out.unknownLastRun, new RegExp('policy does not allow the model it was using, so it will start on ' + usual.label));
  } finally { create.policyAllows = real; }
});

test('kosmos#8305: with no model known for it, a listing policy still connects it, on an allowed model', () => {
  const dir = agent('moved8305b', { lines: [JSON.stringify({ type: 'user', cwd: '' })] });
  ranOn(ACCT_B);
  const usual = create.modelsFor('anthropic').find((m) => m.key === create.defaultModelKeyFor('anthropic'));
  const real = create.policyAllows;
  create.policyAllows = (provider, model) => (model === usual.arg ? { ok: true } : { ok: false, because: 'choose one' });
  try {
    const out = discover.connect(dir, {});
    assert.equal(out.ok, true, out.because);
    assert.equal(seen.model, usual.arg);
    assert.match(out.unknownLastRun, /policy lists the models it can use/);
  } finally { create.policyAllows = real; }
});
test('kosmos#8305: with the account unknown too, the row says both', () => {
  const dir = agent('moved8305d');
  const usual = create.modelsFor('anthropic').find((m) => m.key === create.defaultModelKeyFor('anthropic'));
  const real = create.policyAllows;
  create.policyAllows = (provider, model) => (model === usual.arg ? { ok: true } : { ok: false, because: 'choose one' });
  try {
    const out = discover.connect(dir, {});
    assert.equal(out.ok, true, out.because);
    assert.match(out.unknownLastRun, /could not tell which Claude account.*main one, and your company/);
    assert.match(out.unknownLastRun, new RegExp('will start on ' + usual.label));
  } finally { create.policyAllows = real; }
});
test('kosmos#8305: a refusal never tells the row to choose, when it has no chooser', () => {
  const dir = agent('moved8305e');
  ranOn(ACCT_B);
  const real = create.policyAllows;
  create.policyAllows = () => ({ ok: false, because: "your company's policy allows only some models on Claude: choose one of them" });
  try {
    const out = discover.connect(dir, {});
    assert.equal(out.ok, false);
    assert.match(out.because, /lists no model Kosmos can start/);
    assert.doesNotMatch(out.because, /choose/);
    assert.equal(seen, null, 'nothing was written');
  } finally { create.policyAllows = real; }
});
test('kosmos#8305: past the usual default, the least costly on the menu comes first', () => {
  const dir = agent('moved8305c');
  ranOn(ACCT_B);
  const menu = create.modelsFor('anthropic');
  const usualKey = create.defaultModelKeyFor('anthropic');
  const others = menu.filter((m) => m.key !== usualKey);
  const list = [others[0].arg, others[others.length - 1].arg];
  const real = create.policyAllows;
  create.policyAllows = (provider, model) => (list.includes(model) ? { ok: true } : { ok: false, because: 'choose one' });
  try {
    const out = discover.connect(dir, {});
    assert.equal(out.ok, true, out.because);
    assert.equal(seen.model, others[others.length - 1].arg);
  } finally { create.policyAllows = real; }
});

test('a policy that allows nothing on the menu refuses, before anything is written', () => {
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

test('the Found row\'s sentence and the engine\'s field use one name (source text; web.found-undo runs both arms)', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  assert.match(page, /said\.textContent = foundAddedWords\(out\);/);
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

test('an unreadable newer transcript does not hide this agent\'s own', () => {
  const dir = agent('unreadnewer', { session: 'mine' });
  ranOn(ACCT_B, 'mine');
  const folder = path.join(HOME, '.claude', 'projects', dir.replace(/[^a-zA-Z0-9]/g, '-'));
  const blank = path.join(folder, 'blank.jsonl');
  fs.writeFileSync(blank, JSON.stringify({ type: 'summary' }) + '\n');
  const later = new Date(Date.now() + 60000);
  fs.utimesSync(blank, later, later);
  discover.connect(dir, {});
  assert.equal(seen.configDir, ACCT_B);
});

test('a recent off-menu model is kept; an old one is not, and it says why', () => {
  const recent = agent('offmenurecent', { lines: [assistant('claude-opus-4-8')] });
  ranOn(ACCT_B);
  const out1 = discover.connect(recent, {});
  assert.equal(seen.model, 'claude-opus-4-8');
  assert.equal(out1.unknownLastRun, undefined);
  const old = agent('offmenuold', { session: 'sess-old', lines: [assistant('claude-opus-3-0')] });
  ranOn(ACCT_B, 'sess-old');
  const folder = path.join(HOME, '.claude', 'projects', old.replace(/[^a-zA-Z0-9]/g, '-'));
  const longAgo = new Date(Date.now() - 40 * 24 * 3600 * 1000);
  fs.utimesSync(path.join(folder, 'sess-old.jsonl'), longAgo, longAgo);
  const out2 = discover.connect(old, {});
  assert.equal(seen.configDir, ACCT_B);
  assert.equal('model' in seen, false);
  assert.match(out2.unknownLastRun, /may have been retired/);
  const menu = agent('onmenuold', { session: 'sess-menu', lines: [assistant('claude-haiku-5-5')] });
  ranOn(ACCT_B, 'sess-menu');
  const f3 = path.join(HOME, '.claude', 'projects', menu.replace(/[^a-zA-Z0-9]/g, '-'), 'sess-menu.jsonl');
  fs.utimesSync(f3, longAgo, longAgo);
  discover.connect(menu, {});
  assert.equal(seen.model, 'claude-haiku-5-5');
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
