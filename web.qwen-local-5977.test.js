'use strict';
/**
 * #5977 slice 3: the Qwen add flow's "on this computer" panel. Runs the page's own acctQwenShow, acctQwenLocalPaint
 * and button handler against a fake page, fake server and fake clock, so what the person reads, what is sent, and
 * whether polling stops are all checked. The visit counter (ACCT_QWEN_GEN) is the page's own, not a constant.
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

function harness(answers, opts) {
  const els = {};
  const listeners = {};
  let focused = null;
  /* Round 2: like a browser, disabling (or hiding) the focused element drops focus to the page, so a test of focus
     can fail. */
  const el = (id) => (els[id] = els[id] || {
    id, hidden: id === 'acct-qwen-local' || id === 'acct-qwen-local-bar', textContent: '', value: '',
    _disabled: false,
    get disabled() { return this._disabled; },
    set disabled(v) { this._disabled = !!v; if (v && focused === id) focused = null; },
    attrs: {},
    addEventListener: (ev, fn) => { listeners[id + ':' + ev] = fn; },
    setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; },
    focus() { focused = id; },
    contains(x) { return !!x && (x === this || (id === 'acct-qwen-local-row' && (x.id === 'acct-qwen-local-go' || x.id === 'acct-qwen-local-no'))); },
  });
  el('acct-qwen-flow').hidden = false;
  el('acct-qwen-url').value = 'http://localhost:11434/v1';
  el('acct-qwen-model').value = 'kosmos-qwen2.5-7b-16k:latest';
  const sent = [];
  const pending = [];   // fetches can be held, to land out of order
  let hold = false;
  const fetch = (url, init) => {
    sent.push({ url, method: (init && init.method) || 'GET', body: init && init.body });
    const a = answers[url];
    const v = typeof a === 'function' ? a(init) : a;
    const res = { ok: v.status < 300, status: v.status, json: async () => v.body };
    if (!hold) return Promise.resolve(res);
    return new Promise((r) => pending.push(() => r(res)));
  };
  const timers = [];
  const setTimeout = (fn, ms) => { const h = { fn, ms, cleared: false }; timers.push(h); return h; };
  const clearTimeout = (h) => { if (h) h.cleared = true; };
  const document = { getElementById: el, get activeElement() { return focused ? els[focused] : null; } };
  const src = [
    'let ACCT_QWEN_GEN = 0;',
    'const onWindows = () => ' + JSON.stringify(!!(opts && opts.windows)) + ';',
    slice('function acctQwenShow(on)', '\n}'),
    slice('const QWEN_LOCAL_MODEL =', ';'),
    slice('let ACCT_QWEN_LOCAL_ASK =', ';'),
    slice('let ACCT_QWEN_LOCAL_TIMER =', ';'),
    slice('let ACCT_QWEN_LOCAL_SEQ =', ';'),
    slice('let ACCT_QWEN_LOCAL_RUNNING =', ';'),
    slice('let ACCT_QWEN_LOCAL_LOCKED =', ';'),
    slice('function acctQwenIsLocalSetup()', '\n}'),
    slice('function acctQwenGb(n)', '}'),
    slice('function acctQwenLocalHideRow(row, t)', '\n}'),
    slice('async function acctQwenLocalPaint()', '\n}'),
    slice("document.getElementById('acct-qwen-local-go').addEventListener('click'", '\n});'),
    'return { show: acctQwenShow, paint: acctQwenLocalPaint, ask: () => ACCT_QWEN_LOCAL_ASK };',
  ].join('\n');
  // eslint-disable-next-line no-new-func
  const api = new Function('document', 'fetch', 'setTimeout', 'clearTimeout', src)(document, fetch, setTimeout, clearTimeout);
  return {
    api, els, el, sent, timers, click: () => listeners['acct-qwen-local-go:click'](),
    holdFetches: (on) => { hold = on; }, release: (i) => pending.splice(i, 1)[0](),
    live: () => timers.filter((x) => !x.cleared),
    fire: async () => { const due = timers.filter((x) => !x.cleared && !x.fired); for (const x of due) { x.fired = true; x.fn(); } await flush(); await flush(); },
    focused: () => focused, setFocus: (id) => { focused = id; },
  };
}
const flush = () => new Promise((r) => setImmediate(r));

test('needs_download: names the size, the confirm cannot be double-clicked, and only the second press sends', async () => {
  let state = { state: 'needs_download', download: null };
  const h = harness({
    '/api/accounts/qwen/local': () => ({ status: 200, body: state }),
    '/api/accounts/qwen/local/download': () => { state = { state: 'needs_download', download: { running: true, completed: 470e6, total: 4.7e9 } }; return { status: 202, body: { started: true } }; },
  });
  h.api.show(true); await flush(); await flush();
  assert.equal(h.els['acct-qwen-local'].hidden, false);
  assert.equal(h.els['acct-qwen-local-go'].textContent, 'Download Qwen');
  h.setFocus('acct-qwen-local-go');   // the keyboard user pressed it
  await h.click();
  assert.match(h.els['acct-qwen-local-t'].textContent, /about 4\.7 GB/);
  assert.equal(h.els['acct-qwen-local-go'].textContent, 'Start the download');
  assert.equal(h.els['acct-qwen-local-go'].attrs['aria-disabled'], 'true', 'the confirm says it takes no press yet');
  assert.equal(h.focused(), 'acct-qwen-local-go', 'the lock does not drop focus (round 2)');
  await h.click(); await flush();
  assert.equal(h.sent.some((x) => x.method === 'POST'), false, 'a double click does not confirm');
  const lock = h.timers.find((x) => x.ms === 700);
  assert.ok(lock, 'the confirm unlocks after a moment');
  lock.fired = true; lock.fn();
  assert.equal(h.els['acct-qwen-local-go'].attrs['aria-disabled'], undefined);
  await h.click(); await flush(); await flush();
  const post = h.sent.find((x) => x.method === 'POST');
  assert.equal(post.url, '/api/accounts/qwen/local/download');
  assert.deepEqual(JSON.parse(post.body), { confirm: true });
  assert.match(h.els['acct-qwen-local-t'].textContent, /Downloading Qwen \(about 4\.7 GB\)/);
  assert.equal(h.els['acct-qwen-local-bar'].hidden, false);
  assert.equal(h.els['acct-qwen-local-bar'].value, 470e6);
  assert.equal(h.els['acct-qwen-local-bar'].attrs['aria-valuetext'], '0.5 of 4.7 GB');
  assert.equal(h.focused(), 'acct-qwen-local-t', 'focus is not dropped when its button disappears');
  assert.equal(h.live().filter((x) => x.ms === 2000).length, 1, 'one poll');
});

test('polling: one chain however often it is painted, and putting the step away stops it', async () => {
  const h = harness({ '/api/accounts/qwen/local': { status: 200, body: { state: 'needs_download', download: { running: true, completed: 1, total: 10 } } } });
  h.api.show(true); await flush(); await flush();
  await h.api.paint(); await h.api.paint(); await flush();
  assert.equal(h.live().filter((x) => x.ms === 2000).length, 1, 'repaints replace the poll, never add one');
  h.el('acct-qwen-key').value = 'sk-something';
  h.api.show(false);
  assert.equal(h.live().filter((x) => x.ms === 2000).length, 0, 'the poll stops when the step is put away');
  assert.equal(h.els['acct-qwen-key'].value, '', 'a typed key does not stay in a hidden field');
  assert.equal(h.els['acct-qwen-local'].hidden, true);
});

test('a missed poll during a download is retried, not shown as "could not check"', async () => {
  let fail = false;
  const h = harness({ '/api/accounts/qwen/local': () => (fail ? { status: 500, body: null } : { status: 200, body: { state: 'needs_download', download: { running: true, completed: 5, total: 10 } } }) });
  h.api.show(true); await flush(); await flush();
  const said = h.els['acct-qwen-local-t'].textContent;
  fail = true;
  await h.fire();
  assert.equal(h.els['acct-qwen-local-t'].textContent, said, 'the download line stays');
  assert.equal(h.live().filter((x) => x.ms === 2000 && !x.fired).length, 1, 'and it asks again');
});

test('the newest answer wins, and a field changed during a check is honoured', async () => {
  const h = harness({ '/api/accounts/qwen/local': { status: 200, body: { state: 'needs_download' } } });
  h.api.show(true); await flush(); await flush();
  h.holdFetches(true);
  const p = h.api.paint();
  h.els['acct-qwen-url'].value = 'https://qwen.example.com/v1';   // changed while the check is out
  h.release(0); await p; await flush();
  assert.equal(h.els['acct-qwen-local'].hidden, true, 'a late answer must not show the panel for a server that is not local');
});

test('the panel is only for Ollama on this computer with Kosmos\'s model', async () => {
  const h = harness({ '/api/accounts/qwen/local': { status: 200, body: { state: 'needs_download' } } });
  const shown = async (url, model) => {
    h.els['acct-qwen-url'].value = url; h.els['acct-qwen-model'].value = model || 'kosmos-qwen2.5-7b-16k:latest';
    await h.api.paint(); await flush();
    return h.els['acct-qwen-local'].hidden === false;
  };
  h.api.show(true); await flush(); await flush();
  assert.equal(await shown('https://qwen.example.com/v1'), false);
  assert.equal(await shown('http://localhost:8080/v1'), false, 'another port is not Ollama');
  assert.equal(await shown('http://localhost/v1'), false, 'no port is 80, not Ollama (round 2)');
  assert.equal(await shown('http://localhost:11434/v1', 'llama3'), false, 'another model is the person\'s own');
  assert.equal(await shown('http://[::1]:11434/v1'), true, 'every spelling of this computer');
  assert.equal(await shown('http://127.0.0.1:11434/v1'), true);
  assert.equal(await shown('http://localhost:11434/v1'), true, 'CONTROL: the default shows it');
});

test('needs_model: one press makes the model, then says it is set up; no Ollama offers nothing', async () => {
  let state = { state: 'needs_model' };
  const h = harness({
    '/api/accounts/qwen/local': () => ({ status: 200, body: state }),
    '/api/accounts/qwen/local/model': () => { state = { state: 'ready' }; return { status: 200, body: { ok: true } }; },
  });
  h.api.show(true); await flush(); await flush();
  assert.equal(h.els['acct-qwen-local-go'].textContent, 'Set up Qwen');
  assert.match(h.els['acct-qwen-local-t'].textContent, /Nothing is downloaded/);
  await h.click(); await flush(); await flush();
  assert.equal(h.sent.filter((x) => x.method === 'POST').map((x) => x.url).join(), '/api/accounts/qwen/local/model');
  assert.equal(h.els['acct-qwen-local-t'].textContent, 'Qwen is set up on this computer.');
  state = { state: 'no_ollama', because: 'Ollama is not running on this computer, or is not installed.' };
  await h.api.paint(); await flush();
  assert.match(h.els['acct-qwen-local-t'].textContent, /Ollama is not running/);
  assert.equal(h.els['acct-qwen-local-row'].hidden, true);
});

test('opening, closing and succeeding all put the Qwen step away (its key and its poll)', () => {
  const body = (sig) => slice(sig, '\n}').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.match(body('function openAcctAdd(ev)'), /acctQwenShow\(false\)/, 'opening the dialog leaves an old Qwen step up');
  assert.match(body('function closeAcctAdd()'), /acctQwenShow\(false\)/, 'closing the dialog leaves the Qwen step (and its poll) running');
  assert.match(body('function acctShowSuccess(accountLabel, goldBox)'), /'acct-qwen-flow'/, 'the success panel shows above a still-visible Qwen form');
  assert.match(body('function acctShowSuccess(accountLabel, goldBox)'), /'acct-apikey-flow'/, 'CONTROL: the sibling flow is in the same list');
});

test('two checks in flight: the older answer, landing last, does not overwrite the newer', async () => {
  let state = { state: 'needs_download' };
  const h = harness({ '/api/accounts/qwen/local': () => ({ status: 200, body: state }) });
  h.api.show(true); await flush(); await flush();
  h.holdFetches(true);
  const older = h.api.paint();            // asked while it still needed the download
  state = { state: 'ready' };
  const newer = h.api.paint();            // asked after it was set up
  h.release(1); await newer; await flush();
  assert.equal(h.els['acct-qwen-local-t'].textContent, 'Qwen is set up on this computer.');
  h.release(0); await older; await flush();
  assert.equal(h.els['acct-qwen-local-t'].textContent, 'Qwen is set up on this computer.', 'a stale answer repainted the panel');
});

test('round 2: on Windows the panel never shows (Kosmos cannot start a Qwen agent there yet)', async () => {
  const h = harness({ '/api/accounts/qwen/local': { status: 200, body: { state: 'needs_download' } } }, { windows: true });
  h.api.show(true); await flush(); await flush();
  assert.equal(h.els['acct-qwen-local'].hidden, true);
  assert.equal(h.sent.length, 0, 'nothing is even asked');
});

test('round 2: a download already running (another tab) shows its progress instead of a dead button', async () => {
  let state = { state: 'needs_download' };
  const h = harness({
    '/api/accounts/qwen/local': () => ({ status: 200, body: state }),
    '/api/accounts/qwen/local/download': () => { state = { state: 'needs_download', download: { running: true, completed: 1, total: 10 } }; return { status: 409, body: { started: false, because: 'Qwen is already downloading' } }; },
  });
  h.api.show(true); await flush(); await flush();
  await h.click(); const lock = h.timers.find((x) => x.ms === 700); lock.fired = true; lock.fn();
  await h.click(); await flush(); await flush();
  assert.match(h.els['acct-qwen-local-t'].textContent, /Downloading Qwen/);
  assert.equal(h.els['acct-qwen-local-bar'].hidden, false);
});

test('round 2: a request answered after the step was put away writes nothing into it', async () => {
  const h = harness({
    '/api/accounts/qwen/local': { status: 200, body: { state: 'needs_model' } },
    '/api/accounts/qwen/local/model': { status: 400, body: { ok: false, because: 'late refusal' } },
  });
  h.api.show(true); await flush(); await flush();
  h.holdFetches(true);
  const p = h.click();
  h.api.show(false);
  h.release(0); await p; await flush();
  assert.doesNotMatch(h.els['acct-qwen-local-t'].textContent, /late refusal/i);   // the page capitalises a reason
});
