'use strict';
/**
 * #5977 slice 3: engine/qwenlocal.js, Qwen on this computer through Ollama. The network is replaced through
 * setTransport, so no test reaches a real Ollama. Each state and step is run with a control.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const local = require('./qwenlocal');
const { LOCAL } = require('./qwenaccounts');

test.afterEach(() => local.resetForTest());

function ollama(names, extra) {
  const calls = [];
  local.setTransport(async (p, o) => {
    calls.push({ p, method: (o && o.method) || 'GET', body: o && o.body });
    if (extra && extra[p]) return extra[p](o);
    if (p === '/api/tags') return { status: 200, body: { models: names.map((name) => ({ name })) } };
    return { status: 404, body: null };
  });
  return calls;
}

test('status: each state from what Ollama lists, and reading it changes nothing', async () => {
  let calls = ollama([]);
  assert.equal((await local.status()).state, local.STATE.NEEDS_DOWNLOAD);
  calls = ollama(['qwen2.5:7b']);
  assert.equal((await local.status()).state, local.STATE.NEEDS_MODEL);
  calls = ollama(['qwen2.5:7b', 'kosmos-qwen2.5-7b-16k:latest']);
  assert.equal((await local.status()).state, local.STATE.READY);
  calls = ollama(['kosmos-qwen2.5-7b-16k']);
  assert.equal((await local.status()).state, local.STATE.READY, 'the bare name counts as :latest');
  assert.deepEqual(calls.map((c) => c.method), ['GET'], 'a status read only ever GETs');
  local.setTransport(async () => ({ unreachable: true }));
  assert.equal((await local.status()).state, local.STATE.NO_OLLAMA);
  local.setTransport(async () => ({ status: 200, body: { nope: true } }));
  assert.equal((await local.status()).state, local.STATE.UNKNOWN, 'an unreadable answer is unknown, never a guess');
});

test('the names are the engine\'s own: the 16k model is LOCAL.model, made from LOCAL.baseModel', () => {
  assert.equal(local.MODEL + ':latest', LOCAL.model);
  assert.equal(local.BASE, LOCAL.baseModel);
  assert.equal(local.OLLAMA, 'http://localhost:11434');
});

test('makeModel asks Ollama for the 16k copy of the base, and says so when it is refused', async () => {
  const calls = ollama([], { '/api/create': async () => ({ status: 200, body: { status: 'success' } }) });
  const made = await local.makeModel();
  assert.equal(made.ok, true);
  const c = calls.find((x) => x.p === '/api/create');
  assert.equal(c.method, 'POST');
  assert.deepEqual(c.body, { model: local.MODEL, from: LOCAL.baseModel, parameters: { num_ctx: LOCAL.contextWindow }, stream: false });
  ollama([], { '/api/create': async () => ({ status: 500, body: { error: 'raw ollama text /Users/someone' } }) });
  const bad = await local.makeModel();
  assert.equal(bad.ok, false);
  assert.doesNotMatch(bad.because, /raw ollama text|Users/, 'no raw error text reaches the page');
});

test('startDownload pulls the base, reports progress, makes the 16k model, and refuses a second one meanwhile', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const calls = ollama([], {
    '/api/pull': async (o) => {
      o.onLine({ status: 'pulling', total: 4700, completed: 1200 });
      await gate;
      o.onLine({ status: 'success' });
      return { status: 200, body: { status: 'success' } };
    },
    '/api/create': async () => ({ status: 200, body: { status: 'success' } }),
  });
  assert.deepEqual(local.startDownload(), { started: true });
  await new Promise((r) => setImmediate(r));
  const mid = local.pullProgress();
  assert.equal(mid.running, true);
  assert.equal(mid.total, 4700);
  assert.equal(mid.completed, 1200);
  assert.equal(local.startDownload().started, false, 'one download at a time');
  release();
  for (let i = 0; i < 20 && local.pullProgress().running; i += 1) await new Promise((r) => setTimeout(r, 5));
  const end = local.pullProgress();
  assert.equal(end.running, false);
  assert.equal(end.ok, true);
  assert.deepEqual(calls.filter((c) => c.method === 'POST').map((c) => c.p), ['/api/pull', '/api/create'], 'the model is made after the download');
  assert.deepEqual(calls.find((c) => c.p === '/api/pull').body, { model: LOCAL.baseModel, stream: true });
});

test('a download that fails says so and makes no model', async () => {
  const calls = ollama([], { '/api/pull': async () => ({ status: 200, body: { error: 'disk full at /Users/someone' } }) });
  local.startDownload();
  for (let i = 0; i < 20 && local.pullProgress().running; i += 1) await new Promise((r) => setTimeout(r, 5));
  const end = local.pullProgress();
  assert.equal(end.ok, false);
  assert.doesNotMatch(end.because, /disk full|Users/);
  assert.equal(calls.some((c) => c.p === '/api/create'), false, 'CONTROL: no model from a failed download');
});

test('progress sums Ollama\'s layers, so a small last layer cannot reset it to 0.0 GB', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  ollama([], {
    '/api/pull': async (o) => {
      o.onLine({ status: 'pulling a', digest: 'sha256:a', total: 4600, completed: 4600 });
      o.onLine({ status: 'pulling b', digest: 'sha256:b', total: 100, completed: 40 });
      o.onLine({ status: 'pulling b', digest: 'sha256:b', total: 100, completed: 30 });   // never backwards
      await gate;
      return { status: 200, body: { status: 'success' } };
    },
    '/api/create': async () => ({ status: 200, body: { status: 'success' } }),
  });
  local.startDownload();
  await new Promise((r) => setImmediate(r));
  const p = local.pullProgress();
  assert.equal(p.total, 4700);
  assert.equal(p.completed, 4640);
  release();
  for (let i = 0; i < 20 && local.pullProgress().running; i += 1) await new Promise((r) => setTimeout(r, 5));
});

test('a failed download\'s reason is dropped once the base is on this computer some other way', async () => {
  ollama([], { '/api/pull': async () => ({ unreachable: true }) });
  local.startDownload();
  for (let i = 0; i < 20 && local.pullProgress().running; i += 1) await new Promise((r) => setTimeout(r, 5));
  assert.equal(local.pullProgress().ok, false);
  ollama([]);
  await local.status();
  assert.notEqual(local.pullProgress(), null, 'CONTROL: still missing, the reason stays');
  ollama(['qwen2.5:7b']);
  await local.status();
  assert.equal(local.pullProgress(), null, 'the person pulled it in a terminal: the old failure is not shown');
});
