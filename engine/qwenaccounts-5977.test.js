'use strict';
/**
 * #5977: Qwen accounts. An account is ~/.kosmos-qwen-<label> holding kosmos-endpoint.json (mode 600). These pin what
 * is stored, what is listed, the live check's verdicts, and the guards on forgetting and removing an account.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-qwen-5977-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
const qwen = require('./qwenaccounts');

test.after(() => { qwen.setFetcher(null); try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const GOOD = { baseUrl: 'http://localhost:11434/v1/', model: 'kosmos-qwen2.5-7b-16k:latest', contextWindow: 16384 };
let n = 0;
function account(ep) {
  const dir = nodePath.join(SANDBOX, qwen.DIR_PREFIX + 'a' + (++n));
  qwen.storeEndpoint(dir, ep || GOOD);
  return dir;
}
function answering(reply) {
  const calls = [];
  qwen.setFetcher(async (url, init) => {
    calls.push({ url, auth: init.headers.authorization });
    if (reply === 'throw') throw new Error('ECONNREFUSED 127.0.0.1:11434 with a path /Users/someone in it');
    return reply;
  });
  return calls;
}
const models = (...ids) => ({ status: 200, body: { object: 'list', data: ids.map((id) => ({ id })) } });

test('endpointProblem accepts the tested default and refuses what cannot work, in words a person can act on', () => {
  assert.equal(qwen.endpointProblem(GOOD), null);
  assert.equal(qwen.endpointProblem({ ...GOOD, baseUrl: 'https://qwen.example.com/v1', key: 'sk-abc123' }), null);
  assert.match(qwen.endpointProblem({ ...GOOD, baseUrl: 'notaurl' }), /address of an OpenAI-compatible endpoint/);
  assert.match(qwen.endpointProblem({ ...GOOD, baseUrl: 'file:///etc/passwd' }), /http:\/\/ or https:\/\//);
  assert.match(qwen.endpointProblem({ ...GOOD, baseUrl: 'http://u:p@localhost:11434/v1' }), /key box, not in the address/);
  assert.match(qwen.endpointProblem({ ...GOOD, baseUrl: 'http://localhost:11434/v1?x=1' }), /\? or #/);
  assert.match(qwen.endpointProblem({ ...GOOD, model: 'bad model; rm -rf' }), /model name/);
  assert.match(qwen.endpointProblem({ ...GOOD, model: '' }), /model name/);
  // The measured floor: below 16k the request is pushed out of the window.
  assert.match(qwen.endpointProblem({ ...GOOD, contextWindow: 4096 }), /from 16384 up/);
  assert.match(qwen.endpointProblem({ ...GOOD, contextWindow: '16384' }), /whole number/);
  assert.match(qwen.endpointProblem({ ...GOOD, key: 'two words' }), /no spaces/);
});

test('storeEndpoint writes a mode-600 file, normalized, and readEndpoint reads it back', () => {
  const dir = account({ ...GOOD, key: 'sk-secret-9876' });
  const st = fs.statSync(qwen.endpointFile(dir));
  assert.equal(st.mode & 0o777, 0o600);
  const got = qwen.readEndpoint(dir);
  assert.equal(got.kind, 'ok');
  assert.equal(got.endpoint.baseUrl, 'http://localhost:11434/v1', 'the trailing slash is dropped');
  assert.equal(got.endpoint.key, 'sk-secret-9876');
  assert.equal(qwen.isEndpointHome(dir), true);
  // CONTROL: no key stored means no key field, not an empty one.
  assert.equal('key' in qwen.readEndpoint(account()).endpoint, false);
});

test('storeEndpoint refuses a bad endpoint and a symlinked account folder', () => {
  assert.throws(() => qwen.storeEndpoint(nodePath.join(SANDBOX, qwen.DIR_PREFIX + 'bad'), { ...GOOD, contextWindow: 4096 }), /16384/);
  assert.equal(fs.existsSync(nodePath.join(SANDBOX, qwen.DIR_PREFIX + 'bad')), false, 'nothing is created for a refused endpoint');
  const real = fs.mkdtempSync(nodePath.join(SANDBOX, 'elsewhere-'));
  const link = nodePath.join(SANDBOX, qwen.DIR_PREFIX + 'linked');
  fs.symlinkSync(real, link);
  assert.throws(() => qwen.storeEndpoint(link, GOOD), /must not be a symlink/);
  assert.deepEqual(fs.readdirSync(real), [], 'nothing was written through the link');
  fs.unlinkSync(link);
});

test('readEndpoint keeps absent, unreadable and invalid apart', () => {
  const dir = nodePath.join(SANDBOX, qwen.DIR_PREFIX + 'shapes');
  fs.mkdirSync(dir);
  assert.equal(qwen.readEndpoint(dir).kind, 'absent');
  assert.equal(qwen.isEndpointHome(dir), false);
  fs.writeFileSync(qwen.endpointFile(dir), '{not json');
  assert.equal(qwen.readEndpoint(dir).kind, 'unreadable');
  fs.writeFileSync(qwen.endpointFile(dir), JSON.stringify({ ...GOOD, contextWindow: 2048 }));
  const inv = qwen.readEndpoint(dir);
  assert.equal(inv.kind, 'invalid');
  assert.match(inv.because, /16384/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('list shows every account folder with an endpoint file, and nothing else', () => {
  const dir = account({ ...GOOD, key: 'sk-a-longer-tail-WXYZ' });
  fs.mkdirSync(nodePath.join(SANDBOX, qwen.DIR_PREFIX + 'empty'));          // no endpoint file: not an account
  fs.mkdirSync(nodePath.join(SANDBOX, '.kosmos-qwenx-near'));               // not the prefix
  const rows = qwen.list();
  const row = rows.find((r) => r.dir === dir);
  assert.ok(row, 'the account is listed');
  assert.equal(row.provider, 'alibaba');
  assert.equal(row.providerName, 'Qwen');
  assert.equal(row.authMode, 'endpoint');
  assert.equal(row.keyTail, 'WXYZ');
  assert.equal(row.local, true);
  assert.equal(row.model, GOOD.model);
  assert.equal(JSON.stringify(rows).includes('sk-a-longer-tail-WXYZ'), false, 'the key itself is never in a row');
  assert.equal(rows.some((r) => r.dir.endsWith('empty')), false);
  assert.equal(rows.some((r) => r.dir.includes('qwenx')), false);
});

test('validateLive: the endpoint lists the model, or does not, or refuses the key, or cannot be reached', async () => {
  let calls = answering(models('kosmos-qwen2.5-7b-16k:latest', 'qwen2.5:7b'));
  let v = await qwen.validateLive(qwen.readEndpoint(account()).endpoint);
  assert.equal(v.state, 'connected');
  assert.equal(calls[0].url, 'http://localhost:11434/v1/models');
  assert.equal(calls[0].auth, undefined, 'no key, no authorization header');

  // A model named with or without :latest matches the other spelling.
  answering(models('kosmos-qwen2.5-7b-16k'));
  assert.equal((await qwen.validateLive({ ...GOOD, baseUrl: 'http://localhost:11434/v1' })).state, 'connected');

  answering(models('qwen2.5:7b'));
  v = await qwen.validateLive({ ...GOOD, baseUrl: 'http://localhost:11434/v1' });
  assert.equal(v.state, 'none');
  assert.match(v.because, /does not have the model kosmos-qwen2\.5-7b-16k:latest/);

  calls = answering({ status: 401, body: null });
  v = await qwen.validateLive({ ...GOOD, baseUrl: 'https://q.example.com/v1', key: 'sk-k' });
  assert.equal(v.state, 'none');
  assert.equal(calls[0].auth, 'Bearer sk-k');

  answering({ status: 500, body: null });
  assert.equal((await qwen.validateLive({ ...GOOD, baseUrl: 'http://localhost:11434/v1' })).state, 'unknown');
  answering({ status: 200, body: { nope: 1 } });
  assert.equal((await qwen.validateLive({ ...GOOD, baseUrl: 'http://localhost:11434/v1' })).state, 'unknown');

  answering('throw');
  v = await qwen.validateLive({ ...GOOD, baseUrl: 'http://localhost:11434/v1' });
  assert.equal(v.state, 'unknown', 'Ollama not running is "could not check", never a guessed none');
  assert.match(v.because, /Ollama on this computer/);
  assert.equal(/ECONNREFUSED|\/Users\//.test(v.because), false, 'no raw error text reaches the sentence');
});

test('checkLive reads the account: absent is none, unreadable is unknown, invalid is none with the reason', async () => {
  answering(models(GOOD.model));
  assert.equal((await qwen.checkLive(account())).state, 'connected');
  const dir = nodePath.join(SANDBOX, qwen.DIR_PREFIX + 'check');
  fs.mkdirSync(dir);
  assert.equal((await qwen.checkLive(dir)).state, 'none');
  fs.writeFileSync(qwen.endpointFile(dir), '{');
  assert.equal((await qwen.checkLive(dir)).state, 'unknown');
  fs.writeFileSync(qwen.endpointFile(dir), JSON.stringify({ ...GOOD, model: '' }));
  const v = await qwen.checkLive(dir);
  assert.equal(v.state, 'none');
  assert.match(v.because, /model name/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('forget renames an account aside, and remove deletes it; both refuse what is not ours or is in use', () => {
  const a = account();
  assert.match(qwen.forgetAccount(a, ['scout']).because, /scout is set up to run on this account/);
  assert.equal(fs.existsSync(a), true);
  const f = qwen.forgetAccount(a, []);
  assert.equal(f.forgotten, true);
  assert.equal(fs.existsSync(a), false);
  assert.ok(nodePath.basename(f.movedTo).startsWith(qwen.FORGOTTEN_PREFIX));
  assert.equal(qwen.list().some((r) => r.dir === a), false, 'a forgotten account is no longer listed');
  assert.equal(qwen.forgetAccount(a, []).forgotten, false, 'already gone');

  const b = account();
  assert.equal(qwen.removeAccount(b, []).removed, true);
  assert.equal(fs.existsSync(b), false);

  // Not ours: outside the home, the wrong prefix, a name-shaped folder with no endpoint, a symlink.
  assert.match(qwen.removeAccount('/tmp/' + qwen.DIR_PREFIX + 'x', []).because, /not a Qwen account/);
  const other = nodePath.join(SANDBOX, '.grok-x'); fs.mkdirSync(other);
  assert.match(qwen.removeAccount(other, []).because, /not a Qwen account/);
  assert.equal(fs.existsSync(other), true);
  const bare = nodePath.join(SANDBOX, qwen.DIR_PREFIX + 'bare'); fs.mkdirSync(bare);
  assert.match(qwen.removeAccount(bare, []).because, /not a Qwen account/);
  assert.equal(fs.existsSync(bare), true);
  const real = account();
  const link = nodePath.join(SANDBOX, qwen.DIR_PREFIX + 'ln'); fs.symlinkSync(real, link);
  assert.match(qwen.removeAccount(link, []).because, /not a Qwen account/);
  assert.equal(fs.existsSync(real), true, 'the link target is untouched');
});

test('review 1: an address with a quote, backslash, space or control character is refused as written; a model cannot start with -', () => {
  for (const bad of ['http://localhost:11434/v1"x', 'http://localhost:11434/v1\\', ' http://localhost:11434/v1', 'http://localhost:11434/v1\t', 'http://local\nhost:11434/v1']) {
    assert.match(qwen.endpointProblem({ ...GOOD, baseUrl: bad }), /space, quote, backslash or control character/, JSON.stringify(bad));
  }
  assert.match(qwen.endpointProblem({ ...GOOD, model: '--help' }), /model name/);
  assert.equal(qwen.endpointProblem({ ...GOOD, model: 'qwen2.5:7b' }), null, 'CONTROL: an ordinary model name passes');
});

test('review 1: isQwenHome is true for a folder named like a Qwen account even with no endpoint file; isEndpointHome needs a regular file', () => {
  const named = nodePath.join(SANDBOX, qwen.DIR_PREFIX + 'lost');
  fs.mkdirSync(named);
  assert.equal(qwen.isQwenHome(named), true);
  assert.equal(qwen.isEndpointHome(named), false);
  const other = nodePath.join(SANDBOX, '.codex-other'); fs.mkdirSync(other);
  assert.equal(qwen.isQwenHome(other), false, 'CONTROL: an OpenAI home is not Qwen');
  const real = account();
  const linked = nodePath.join(SANDBOX, '.codex-linked'); fs.mkdirSync(linked);
  fs.symlinkSync(qwen.endpointFile(real), qwen.endpointFile(linked));
  assert.equal(qwen.isEndpointHome(linked), false, 'a link at the endpoint file is not an endpoint home');
});

test('review 1: launchArgs refuses a linked endpoint file and a missing one, with a sentence', () => {
  const named = nodePath.join(SANDBOX, qwen.DIR_PREFIX + 'gone'); fs.mkdirSync(named);
  assert.match(qwen.launchArgs(named).because, /no endpoint set up/);
  const real = account();
  const linked = nodePath.join(SANDBOX, qwen.DIR_PREFIX + 'linkfile'); fs.mkdirSync(linked);
  fs.symlinkSync(qwen.endpointFile(real), qwen.endpointFile(linked));
  assert.match(qwen.launchArgs(linked).because, /endpoint file is a link/);
  assert.equal(qwen.launchArgs(real).ok, true, 'CONTROL: the real account launches');
});

test('review 1: the live check answers a listing from a recent answer, and a person\'s own check always asks', async () => {
  qwen.resetLiveCacheForTest();
  const dir = account();
  let asked = 0;
  qwen.setFetcher(async () => { asked += 1; return models(GOOD.model); });
  await qwen.checkLive(dir, { cached: true });
  await qwen.checkLive(dir, { cached: true });
  assert.equal(asked, 1, 'the second listing read was answered from the first');
  await qwen.checkLive(dir);
  assert.equal(asked, 2, 'a check without cached asks the endpoint');
});
