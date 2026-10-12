'use strict';
/**
 * #5977 slice 3: the Qwen add flow's "on this computer" panel. Runs the page's own acctQwenLocalPaint and its button
 * handler against a fake page and a fake server, so what the person reads and what is sent are both checked.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

function slice(startSig, endSig) {
  const at = PAGE.indexOf(startSig);
  assert.notEqual(at, -1, startSig + ' is gone from the page');
  const end = PAGE.indexOf(endSig, at);
  assert.ok(end > at, 'the end of ' + startSig + ' moved; re-anchor');
  return PAGE.slice(at, end + endSig.length);
}

function harness(answers) {
  const els = {};
  const listeners = {};
  const el = (id) => (els[id] = els[id] || {
    id, hidden: id === 'acct-qwen-local', disabled: false, textContent: '', value: '',
    addEventListener: (ev, fn) => { listeners[id + ':' + ev] = fn; },
  });
  el('acct-qwen-flow').hidden = false;
  el('acct-qwen-url').value = 'http://localhost:11434/v1';
  el('acct-qwen-model').value = 'kosmos-qwen2.5-7b-16k:latest';
  const sent = [];
  const fetch = async (url, init) => {
    sent.push({ url, method: (init && init.method) || 'GET', body: init && init.body });
    const a = answers[url];
    const v = typeof a === 'function' ? a(init) : a;
    return { ok: v.status < 300, status: v.status, json: async () => v.body };
  };
  const timers = [];
  const src = [
    slice('const QWEN_LOCAL_MODEL =', ';'),
    'let ACCT_QWEN_LOCAL_ASK = \'\';',
    slice('function acctQwenIsLocalSetup()', '\n}'),
    slice('function acctQwenGb(n)', '}'),
    slice('async function acctQwenLocalPaint()', '\n}'),
    slice("document.getElementById('acct-qwen-local-go').addEventListener('click'", '\n});'),
    'return { paint: acctQwenLocalPaint, ask: () => ACCT_QWEN_LOCAL_ASK };',
  ].join('\n');
  // eslint-disable-next-line no-new-func
  const api = new Function('document', 'fetch', 'setTimeout', 'ACCT_QWEN_GEN', src)(
    { getElementById: el }, fetch, (fn) => { timers.push(fn); }, 1);
  return { api, els, sent, click: () => listeners['acct-qwen-local-go:click'](), timers };
}
const flush = () => new Promise((r) => setImmediate(r));

test('needs_download: names the size, and starts nothing until the second press', async () => {
  let state = { state: 'needs_download', download: null };
  const h = harness({
    '/api/accounts/qwen/local': () => ({ status: 200, body: state }),
    '/api/accounts/qwen/local/download': () => { state = { state: 'needs_download', download: { running: true, completed: 470e6, total: 4.7e9 } }; return { status: 202, body: { started: true } }; },
  });
  await h.api.paint();
  assert.equal(h.els['acct-qwen-local'].hidden, false);
  assert.equal(h.els['acct-qwen-local-go'].textContent, 'Download Qwen');
  await h.click();
  assert.match(h.els['acct-qwen-local-t'].textContent, /about 4\.7 GB/);
  assert.equal(h.els['acct-qwen-local-go'].textContent, 'Start the download');
  assert.equal(h.sent.some((x) => x.method === 'POST'), false, 'the first press only asks');
  await h.click(); await flush(); await flush();
  const post = h.sent.find((x) => x.method === 'POST');
  assert.equal(post.url, '/api/accounts/qwen/local/download');
  assert.deepEqual(JSON.parse(post.body), { confirm: true });
  assert.match(h.els['acct-qwen-local-t'].textContent, /Downloading Qwen: 10% \(0\.5 of 4\.7 GB\)/);
  assert.equal(h.timers.length, 1, 'progress is read again');
});

test('needs_model: one press makes the model, then says it is set up', async () => {
  let state = { state: 'needs_model' };
  const h = harness({
    '/api/accounts/qwen/local': () => ({ status: 200, body: state }),
    '/api/accounts/qwen/local/model': () => { state = { state: 'ready' }; return { status: 200, body: { ok: true } }; },
  });
  await h.api.paint();
  assert.equal(h.els['acct-qwen-local-go'].textContent, 'Set up Qwen');
  assert.match(h.els['acct-qwen-local-t'].textContent, /Nothing is downloaded/);
  await h.click(); await flush(); await flush();
  assert.equal(h.sent.filter((x) => x.method === 'POST').map((x) => x.url).join(), '/api/accounts/qwen/local/model');
  assert.equal(h.els['acct-qwen-local-t'].textContent, 'Qwen is set up on this computer.');
});

test('the panel is only for this computer and Kosmos\'s model; a named server is the person\'s own', async () => {
  const h = harness({ '/api/accounts/qwen/local': { status: 200, body: { state: 'needs_download' } } });
  h.els['acct-qwen-url'].value = 'https://qwen.example.com/v1';
  await h.api.paint();
  assert.equal(h.els['acct-qwen-local'].hidden, true);
  assert.equal(h.sent.length, 0, 'no question is even asked');
  h.els['acct-qwen-url'].value = 'http://localhost:11434/v1';
  h.els['acct-qwen-model'].value = 'llama3';
  await h.api.paint();
  assert.equal(h.els['acct-qwen-local'].hidden, true, 'another model is the person\'s own too');
  h.els['acct-qwen-model'].value = 'kosmos-qwen2.5-7b-16k:latest';
  await h.api.paint();
  assert.equal(h.els['acct-qwen-local'].hidden, false, 'CONTROL: the default shows it');
});

test('no Ollama: says so, offers no button', async () => {
  const h = harness({ '/api/accounts/qwen/local': { status: 200, body: { state: 'no_ollama', because: 'Ollama is not running on this computer, or is not installed.' } } });
  await h.api.paint();
  assert.match(h.els['acct-qwen-local-t'].textContent, /Ollama is not running/);
  assert.equal(h.els['acct-qwen-local-row'].hidden, true);
});
