'use strict';
/*
 * kosmos#7689: a route that writes its head and THEN runs work that can throw ends the whole board, because the request
 * handler has no catch around it and the process has no unhandled-rejection handler. The fix is to render first and
 * write the head with the finished body. This file makes each render throw, as the card asks, and asserts the route
 * answers with an error of its own (no head was out), nothing escaped, and the board still answers.
 *
 * The four instances the sweep found (card comment, 10-31): sendJson (fixed by #7686), sendDiagnostics (pinned in
 * server.headers-twice-7686.test.js), and the two `?as=text` routes below.
 *
 *   node --test server.head-then-throw-7689.test.js
 */
require('./test-support/tmpscope');

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-7689-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

/* Every rejection and exception nobody handled, recorded rather than left to end the process (#7686's harness). */
const unhandled = [];
process.on('unhandledRejection', (e) => { unhandled.push(e); });
process.on('uncaughtException', (e) => { unhandled.push(e); });

const { start, server, boardAuthState, keepAgentReply } = require('./server');
const fleet = require('./test-support/fleet');
const chat = require('./engine/chat');
const sendertoken = require('./engine/sendertoken');
const records = require('./engine/records');
const { assertSandboxedDataRoot } = require('./test-support/data-root-sandbox');
assertSandboxedDataRoot(SANDBOX, [require('./engine/store').ROOT, chat.threadFile(chat.DIRECT, 'leo')]);

const WHO = 'leo';
let base;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  boardAuthState.token = 'BOARDTOKEN_7689_0123456789abcdef';
  boardAuthState.on = false;
  const t0 = Date.now() - 60 * 60000;
  chat.appendMessage(chat.DIRECT, WHO, { text: 'Please check the invoice from Monday', at: new Date(t0).toISOString(), delivery: { state: chat.DELIVERY.PLACED } });
  keepAgentReply(WHO, 'On it.', new Date(t0 + 1000).toISOString());
});
test.after(() => {
  try { server.closeAllConnections(); server.close(); } catch { /* best effort */ }
  assert.deepEqual(unhandled.map((e) => String(e && (e.code || e.message))), [], 'an exception or rejection escaped during this file');
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** GET; the status and body, 'cut' when the connection ended without a full answer, or 'hung' when nothing ended it
 *  within 10 s (before #7689 the records render threw inside res.end with its head out, so that answer never ended). */
async function get(p, headers = {}) {
  try {
    const res = await fetch(base + p, { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(10000) });
    const text = await res.text();
    return { code: res.status, text, type: res.headers.get('content-type') || '' };
  } catch (e) { return { code: e && e.name === 'TimeoutError' ? 'hung' : 'cut', text: '', type: '' }; }
}
const escaped = (before) => unhandled.slice(before).map((e) => String(e && (e.code || e.message)));

test('#7689: a records-as-text render that throws answers 500 with no head out, and the board keeps answering', async () => {
  const realList = records.list;
  const realRender = records.renderList;
  records.list = () => ({ label: 'records', staleDays: 30, rows: [], stale: 0 });   // the route's own read, so the render is the only step that can fail
  try {
    // CONTROL: with the real render, the route answers 200 text, so the failure below is the only difference.
    const ok = await get('/api/project/p7689/records?as=text');
    assert.equal(ok.code, 200, 'CONTROL: the records text route did not answer 200: ' + ok.text);
    assert.match(ok.type, /^text\/plain/, 'CONTROL: not the text arm');

    let thrown = 0;
    records.renderList = () => { thrown += 1; throw new TypeError('simulated render failure'); };
    const before = unhandled.length;
    const r = await get('/api/project/p7689/records?as=text');
    await wait(50);   // let a rejection surface before reading the record
    assert.equal(thrown, 1, 'CONTROL: the render was never reached, so this test proves nothing');
    assert.deepEqual(escaped(before), [], 'a rejection escaped the records route (before #7689 the render ran after its head)');
    assert.equal(r.code, 500, 'the failed render answered ' + r.code + ', not the route\'s 500');
    assert.equal(JSON.parse(r.text).error, 'we could not show its records as text');
  } finally { records.list = realList; records.renderList = realRender; }
  // And the board still answers.
  records.list = () => ({ label: 'records', staleDays: 30, rows: [], stale: 0 });
  try {
    assert.equal((await get('/api/project/p7689/records?as=text')).code, 200, 'the board stopped answering after the records failure');
  } finally { records.list = realList; }
});

test('#7689: an inbox-as-text build that throws answers 500 with no head out, and the board keeps answering', async () => {
  const board = fleet.install([fleet.agent(WHO, { state: 'idle' })]);
  const tok = sendertoken.mint(WHO).token;
  const realSplit = RegExp.prototype[Symbol.split];
  try {
    const h = { 'x-kosmos-agent-token': tok };
    // CONTROL: the text arm answers 200 with the rows, so the failure below is the only difference.
    const ok = await get('/api/inbox?as=text', h);
    assert.equal(ok.code, 200, 'CONTROL: the inbox text route did not answer 200: ' + ok.text);
    assert.match(ok.text, /the person: Please check the invoice from Monday/, 'CONTROL: the rows were not built');

    /* The failure, in the rows' text build: a message's text is split on INBOX_BREAK (a regex), so fail the first
       regex split whose caller is the server's inbox route, once, so nothing else the board does takes the throw. */
    let thrown = 0;
    RegExp.prototype[Symbol.split] = function (...args) {
      if (thrown === 0 && /server\.js/.test(new Error().stack) && this.source.includes('\\u2028')) {   // INBOX_BREAK's own source
        thrown += 1;
        throw new RangeError('simulated failure while building the rows');
      }
      return realSplit.apply(this, args);
    };
    const before = unhandled.length;
    let r;
    try { r = await get('/api/inbox?as=text', h); } finally { RegExp.prototype[Symbol.split] = realSplit; }
    await wait(50);
    assert.equal(thrown, 1, 'CONTROL: the rows\' split was never reached, so this test proves nothing');
    assert.deepEqual(escaped(before), [], 'a rejection escaped the inbox route');
    // Before #7689 the 200 head was out, so this was a cut (since #7686) and, before that, the board ended.
    assert.equal(r.code, 500, 'the failed build answered ' + r.code + ', not the route\'s 500');
    assert.equal(r.text, 'Kosmos could not read your messages just now\n');
    // And the board still answers.
    assert.equal((await get('/api/inbox?as=text', h)).code, 200, 'the board stopped answering after the inbox failure');
  } finally { RegExp.prototype[Symbol.split] = realSplit; sendertoken.revoke(WHO); board.restore(); }
});
