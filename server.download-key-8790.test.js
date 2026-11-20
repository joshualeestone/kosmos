'use strict';
/**
 * kosmos#8790: download keys, through the real dispatch. A browser that sends no Sec-Fetch-Site (Safari before 16.4)
 * gets no board token from a Kosmos+ connector on a navigation, so the page mints a key with its marked fetch and
 * opens the download with ?bdl=<key>. Boots a fully sandboxed board and turns its token on in memory (the
 * server.board-nonce-1979 posture). The pure store is in engine.boardauth-dlkey-8790.test.js.
 *
 *   node --test server.download-key-8790.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-dlkey-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
const GATE_LOG = path.join(SANDBOX, 'gate.log');
process.env.KOSMOS_INSTALL_GATE_LOG = GATE_LOG;

const { start, server, boardAuthState, safeLogUrl } = require('./server');
const boardauth = require('./engine/boardauth');

const TOK = 'DLKEY8790_test_0123456789abcdefgh';
const FILE = '/api/agent/max/files/download?name=a.txt';
let base;

test.before(async () => {
  fs.mkdirSync(path.join(SANDBOX, 'workers', 'max', 'Files'), { recursive: true });
  fs.writeFileSync(path.join(SANDBOX, 'workers', 'max', 'Files', 'a.txt'), 'the file\n');
  fs.writeFileSync(path.join(SANDBOX, 'workers', 'max', 'Files', 'b.txt'), 'another file\n');
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = TOK;
});
test.after(() => { try { server.close(); } catch { /* closed */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

async function mint(p, headers = { 'x-kosmos-board-token': TOK }) {
  const res = await fetch(base + '/api/download-key', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers), body: JSON.stringify({ path: p }) });
  const text = await res.text();
  let json = {}; try { json = JSON.parse(text); } catch { /* leave {} */ }
  return { code: res.status, key: json.key, cache: res.headers.get('cache-control'), text };
}
async function get(p, method = 'GET', headers = {}) {
  const res = await fetch(base + p, { method, headers, redirect: 'manual' });
  const body = await res.text().catch(() => '');
  return { code: res.status, body, setCookie: res.headers.get('set-cookie') };
}
const withKey = (p, k) => p + (p.includes('?') ? '&' : '?') + 'bdl=' + k;

test('kosmos#8790: CONTROL: with no credential the download is refused', async () => {
  assert.equal((await get(FILE)).code, 403);
});

test('kosmos#8790: a key minted with the board token opens its download once; a second use refuses', async () => {
  const m = await mint(FILE);
  assert.equal(m.code, 200, m.text);
  assert.match(String(m.key), /^[0-9a-f]{64}$/);
  assert.match(String(m.cache), /no-store/, 'the mint is answered no-store');
  const one = await get(withKey(FILE, m.key));
  assert.equal(one.code, 200);
  assert.equal(one.body, 'the file\n');
  assert.equal(one.setCookie, null, 'a key sets no cookie and starts no session');
  assert.equal((await get(withKey(FILE, m.key))).code, 204, 'single use');
});

test('kosmos#8790: another path or query refuses, and does not burn the key', async () => {
  const m = await mint(FILE);
  assert.equal((await get(withKey('/api/agent/max/files/download?name=b.txt', m.key))).code, 204, 'another query');
  assert.equal((await get(withKey('/api/agent/max/files/download-folder?dir=', m.key))).code, 204, 'another route');
  assert.equal((await get(withKey('/api/status', m.key))).code, 403, 'not a download route');
  assert.equal((await get(withKey(FILE + '&check=1', m.key))).code, 403, 'the ?check=1 look opens nothing with a key (and keeps its words)');
  assert.equal((await get(withKey(FILE, m.key))).code, 200, 'the download itself still opens');
});

test('kosmos#8790: a HEAD with a key refuses and does not burn it', async () => {
  const m = await mint(FILE);
  assert.equal((await get(withKey(FILE, m.key), 'HEAD')).code, 403);
  assert.equal((await get(withKey(FILE, m.key))).code, 200, 'the GET after it still opens');
});

test('kosmos#8790: after the minute a key refuses', async () => {
  let now = Date.now();
  boardauth._setNonceClock(() => now);
  try {
    const m = await mint(FILE);
    now += boardauth.DL_KEY_TTL_MS + 1;
    assert.equal((await get(withKey(FILE, m.key))).code, 204);
  } finally { boardauth._setNonceClock(null); }
});

test('kosmos#8790: minting needs the board token itself: no credential, a session cookie alone, or a key refuses', async () => {
  assert.equal((await mint(FILE, {})).code, 403, 'no credential');
  const signIn = await get('/?token=' + TOK);
  const sid = ((signIn.setCookie || '').match(/kosmos_board=([0-9a-f]{64})/) || [])[1];
  assert.ok(sid, 'a sign-in gives a session cookie');
  assert.equal((await get('/api/status', 'GET', { cookie: 'kosmos_board=' + sid })).code, 200, 'CONTROL: the session is live');
  assert.equal((await mint(FILE, { cookie: 'kosmos_board=' + sid })).code, 403, 'a session cookie alone');
  const m = await mint(FILE);
  const res = await fetch(base + withKey('/api/download-key', m.key), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: FILE }) });
  await res.text();
  assert.equal(res.status, 403, 'a key cannot mint its successor');
});

test('kosmos#8790: only a download route can be minted for', async () => {
  for (const p of ['/api/status', '/api/agent/max/files/preview?name=a.txt', 'https://elsewhere.example/api/diagnostics', '/api/attachment/0123/preview', FILE + '&check=1']) {
    const m = await mint(p);
    assert.equal(m.code, 400, p + ' ' + m.text);
    assert.equal(m.key, undefined);
  }
  for (const p of [FILE, '/api/agent/max/files/download-folder?dir=', '/api/project/p1/file-download?name=x', '/api/agent/max/export', '/api/attachment/0123456789abcdef01234567', '/api/diagnostics']) {
    assert.equal((await mint(p)).code, 200, p);
  }
});

test('kosmos#8790: the key never reaches a log: the gate log and the shared redaction', async () => {
  const m = await mint(FILE);
  await get(withKey('/api/status', m.key));   // refused at the gate, so logged
  const logged = fs.existsSync(GATE_LOG) ? fs.readFileSync(GATE_LOG, 'utf8') : '';
  assert.ok(logged.includes('/api/status'), 'CONTROL: the gate log recorded the refused request: ' + logged);
  assert.ok(!logged.includes(m.key), 'the key is in the gate log');
  assert.equal(safeLogUrl('/api/diagnostics?bdl=' + m.key + '&x=1'), '/api/diagnostics?bdl=REDACTED&x=1');
  assert.equal(safeLogUrl('/api/diagnostics?x=1&BDL=' + m.key), '/api/diagnostics?x=1&BDL=REDACTED');
});

test('kosmos#8790: a query spelled two ways (a space as %20 or +) is one address to the key', async () => {
  fs.writeFileSync(path.join(SANDBOX, 'workers', 'max', 'Files', 'a b.txt'), 'spaced\n');
  const m = await mint('/api/agent/max/files/download?name=a%20b.txt');
  const r = await get(withKey('/api/agent/max/files/download?name=a+b.txt', m.key));
  assert.equal(r.code, 200, 'the page opens the + spelling of the address it asked a key for');
  assert.equal(r.body, 'spaced\n');
});

test('kosmos#8790: the page keys exactly the routes the board accepts a key on', () => {
  const read = (file, name) => {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const at = src.indexOf('const ' + name + ' = [');
    assert.ok(at > -1, name + ' is gone from ' + file);
    return src.slice(at, src.indexOf('];', at)).split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
  };
  const board = read('server.js', 'DL_KEY_ROUTES');
  assert.equal(board.length, 5, 'CONTROL: the board lists five routes');
  assert.deepEqual(read(path.join('web', 'index.html'), 'DL_KEY_LINK_ROUTES'), board);
});

test('kosmos#8790: a key never rides beside another credential: a wrong token with it refuses; a live session opens on its own and spends no key', async () => {
  const m = await mint(FILE);
  assert.equal((await get(withKey(FILE, m.key), 'GET', { 'x-kosmos-board-token': 'not-the-token-0123456789abcdef' })).code, 204, 'a wrong token header and a key');
  const signIn = await get('/?token=' + TOK);
  const sid = ((signIn.setCookie || '').match(/kosmos_board=([0-9a-f]{64})/) || [])[1];
  assert.ok(sid);
  const both = await get(withKey(FILE, m.key), 'GET', { cookie: 'kosmos_board=' + sid });
  assert.equal(both.code, 200, 'CONTROL: a live session opens it on its own');
  assert.equal((await get(withKey(FILE, m.key))).code, 200, 'and the key was not spent by that request (the session opened it, not the key)');
});

test('kosmos#8790: only a literal bdl= counts: an encoded name opens nothing', async () => {
  const m = await mint(FILE);
  assert.equal((await get(FILE + '&%62dl=' + m.key)).code, 403, '%62dl');
  assert.equal((await get(FILE + '&BDL=' + m.key)).code, 403, 'another case');
  assert.equal((await get(withKey(FILE, m.key))).code, 200, 'CONTROL: the literal name opens it');
});

test('kosmos#8790: a browser that sends Sec-Fetch-Site is told it needs no key, and none is made', async () => {
  const res = await fetch(base + '/api/download-key', { method: 'POST', headers: { 'content-type': 'application/json', 'x-kosmos-board-token': TOK, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ path: FILE }) });
  const b = await res.json();
  assert.equal(res.status, 200);
  assert.equal(b.key, null);
  assert.equal(b.needed, false);
});

test('kosmos#8790: a keyed download the board refuses is answered 204 with nothing to save (old Safari sends no Sec-Fetch-Mode)', async () => {
  const gone = '/api/agent/max/files/download?name=not-there.txt';
  const m = await mint(gone);
  assert.equal(m.code, 200);
  const r = await get(withKey(gone, m.key));
  assert.equal(r.code, 204, 'not a JSON body a browser could save as the file');
  assert.equal(r.body, '');
});

test('kosmos#8790: a key on a request that carries any Sec-Fetch-Site refuses, and the key is not spent', async () => {
  const m = await mint(FILE);
  assert.equal((await get(withKey(FILE, m.key), 'GET', { 'sec-fetch-site': 'cross-site' })).code, 204, 'cross-site');
  assert.equal((await get(withKey(FILE, m.key), 'GET', { 'sec-fetch-site': 'same-site' })).code, 204, 'same-site');
  assert.equal((await get(withKey(FILE, m.key), 'GET', { 'sec-fetch-site': 'same-origin' })).code, 204, 'same-origin: a current browser is never given a key, so a copied one opens nothing there');
  assert.equal((await get(withKey(FILE, m.key), 'GET', { 'sec-fetch-site': 'none' })).code, 204, 'none (typed into the address bar)');
  assert.equal((await get(withKey(FILE, m.key))).code, 200, 'CONTROL: with no Sec-Fetch-Site (old Safari) it opens, unspent until now');
});

test('kosmos#8790: the page\'s one look at load says whether keys are needed, and needs the board token', async () => {
  const ask = async (headers) => {
    const res = await fetch(base + '/api/download-key', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers), body: JSON.stringify({ ask: true }) });
    const text = await res.text();
    let b = {}; try { b = JSON.parse(text); } catch { /* leave {} */ }
    return { code: res.status, b };
  };
  const old = await ask({ 'x-kosmos-board-token': TOK });
  assert.equal(old.code, 200);
  assert.deepEqual([old.b.needed, old.b.key], [true, null], 'no Sec-Fetch-Site: keys are needed, and the look makes none');
  const cur = await ask({ 'x-kosmos-board-token': TOK, 'sec-fetch-site': 'same-origin' });
  assert.deepEqual([cur.b.needed, cur.b.key], [false, null]);
  assert.equal((await ask({})).code, 403, 'no credential');
});

test('kosmos#8790: a refused keyed download answers 204 with nothing to save; the same refusal without a key is the JSON 403', async () => {
  const m = await mint(FILE);
  assert.equal((await get(withKey(FILE, m.key))).code, 200, 'CONTROL: the key opens it once');
  const spent = await get(withKey(FILE, m.key));
  assert.equal(spent.code, 204, 'a spent key: nothing for WebKit to save as the file');
  assert.equal(spent.body, '');
  assert.equal((await get(withKey(FILE, 'f'.repeat(64)))).code, 204, 'a key the board never made (or forgot in a restart)');
  const plain = await get(FILE);
  assert.equal(plain.code, 403, 'no key at all: the gate\'s own refusal, as before');
  assert.equal((await get(withKey(FILE + '&check=1', m.key))).code, 403, 'a ?check=1 look keeps its words');
  const att = '/api/attachment/0123456789abcdef01234567';
  const a = await mint(att);
  const r = await get(withKey(att, a.key));
  assert.equal(r.code, 204, 'an attachment that is gone, opened with a key: nothing to save either');
});
