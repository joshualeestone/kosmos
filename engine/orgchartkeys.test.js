'use strict';
// First, for its side effect: every temp dir this file makes lands in its own, removed at exit (#4273).
require('../test-support/tmpscope');
/**
 * #4560: the org chart reader over a KEY-connected OpenAI, Gemini or Grok. Every request goes to a stub HTTP server
 * on 127.0.0.1 (the provider URLs are overridden), so no real key is spent. The stub RECORDS what arrives, so the
 * tests read the exact bytes a provider would get: the file inline, the model, the schema, store:false, no tool
 * field anywhere, and the key only in its header. Synthetic names only (test-support/orgchart-4559).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// No Claude here, whatever this machine has: an empty home has no Claude account, so currentReader() goes to keys.
process.env.AGENT_WORKFORCE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4560-home-'));
delete process.env.CLAUDE_CONFIG_DIR;

const keys = require('./orgchartkeys');
const o = require('./orgchartfile');

const FIX = path.join(__dirname, '..', 'test-support', 'orgchart-4559');
const PNG = fs.readFileSync(path.join(FIX, 'chart.png'));
const PDF = fs.readFileSync(path.join(FIX, 'chart.pdf'));
const KEY = 'sk-TEST-4560-DO-NOT-LEAK-7f3a9c';
const PEOPLE = { people: [
  { person: 'Avery Quill', title: 'Chief Executive', reportsTo: null, sure: true, why: null },
  { person: 'Bo Linden', title: 'Head of Sales', reportsTo: 'Avery Quill', sure: true, why: null },
  { person: 'Eli Tamsin', title: 'Account Executive', reportsTo: 'Bo Linden', sure: false, why: 'the line is faint' },
] };

/* Each provider's success body, in the shape its docs show (see orgchartkeys.js). */
const ANSWER = {
  openai: () => ({ status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(PEOPLE) }] }] }),
  xai: () => ({ status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(PEOPLE) }] }] }),
  google: () => ({ object: 'interaction', status: 'completed', steps: [{ type: 'thought' }, { type: 'model_output', content: [{ type: 'text', text: JSON.stringify(PEOPLE) }] }] }),
};

let seen = [];
let reply = null;   // (req) -> { status, body, delay }
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', async () => {
    seen.push({ url: req.url, headers: req.headers, raw });
    const r = reply ? reply(req) : { status: 500, body: {} };
    if (r.delay) await new Promise((ok) => setTimeout(ok, r.delay));
    if (res.destroyed) return;
    res.writeHead(r.status, { 'content-type': 'application/json' });
    res.end(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
  });
});
let base;
test.before(async () => {
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = 'http://127.0.0.1:' + server.address().port;
  process.env.AGENT_WORKFORCE_ORGCHART_OPENAI_URL = base + '/openai/v1/responses';
  process.env.AGENT_WORKFORCE_ORGCHART_GEMINI_URL = base + '/google/v1beta/interactions';
  process.env.AGENT_WORKFORCE_ORGCHART_XAI_URL = base + '/xai/v1/responses';
  keys.setKeyFor(() => KEY);
  // Every provider's request shape is tested, Gemini's included for the day it is switched on; the ruling that
  // keeps it off (m3688) has its own test below, with the real switch.
  keys.setEnabled({ openai: true, google: true, xai: true });
});
test.after(() => { keys.setAccounts(null); keys.setKeyFor(null); keys.setEnabled(null); keys.setTimeoutMs(null); o.setModelAvailable(null); server.close(); });
test.beforeEach(() => { seen = []; reply = null; });

const only = (provider) => keys.setAccounts(() => [{ provider, dir: '/tmp/x', account: 'work' }]);

/* Every key anywhere in a JSON value, so a `tools` nested at any depth is found. */
function allKeys(v, out = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); allKeys(x, out); }
  return out;
}

const CASES = [
  ['openai', 'chart.png', PNG], ['openai', 'chart.pdf', PDF],
  ['google', 'chart.png', PNG], ['google', 'chart.pdf', PDF],
  ['xai', 'chart.png', PNG],
];
for (const [provider, name, bytes] of CASES) {
  test(`#4560 ${provider} ${name}: the request is the documented one, the file inline, store:false, no tools, the key only in its header; the answer reaches the preview`, async () => {
    only(provider);
    reply = () => ({ status: 200, body: ANSWER[provider]() });
    const r = await o.readWithModel(name, bytes);
    assert.deepEqual(r.rows.map((x) => [x.person, x.reportsTo]), [['Avery Quill', null], ['Bo Linden', 0], ['Eli Tamsin', 1]], JSON.stringify(r));
    assert.equal(r.rows[2].why, 'the line is faint');
    assert.equal(seen.length, 1);
    const req = seen[0];
    const body = JSON.parse(req.raw);
    const p = keys.PROVIDERS[provider];
    assert.equal(body.model, p.model);
    assert.equal(body.store, false, 'every provider stores a request by default; an org chart names real people');
    if (provider !== 'google') assert.equal(body.max_output_tokens, keys.MAX_OUTPUT_TOKENS, 'the read is billed to the key: its output is capped');
    for (const k of ['tools', 'functions', 'tool_choice', 'function_call']) assert.ok(!allKeys(body).has(k), `a ${k} field was sent`);
    // The key: in the one header the provider reads, and nowhere else (not the URL, not the body).
    if (provider === 'google') assert.equal(req.headers['x-goog-api-key'], KEY);
    else assert.equal(req.headers.authorization, 'Bearer ' + KEY);
    assert.ok(!req.url.includes(KEY) && !req.raw.includes(KEY), 'the key left its header');
    // The file itself, inline.
    const b64 = bytes.toString('base64');
    assert.ok(req.raw.includes(b64), 'the file did not go inline');
    if (provider === 'google') {
      assert.equal(body.response_format.mime_type, 'application/json');
      assert.deepEqual(body.response_format.schema, keys.STRICT_SCHEMA);
      assert.equal(body.input[0].type, name.endsWith('.pdf') ? 'document' : 'image');
      assert.equal(body.input[0].data, b64);
    } else {
      assert.deepEqual(body.text.format, { type: 'json_schema', name: 'org_chart', schema: keys.STRICT_SCHEMA, strict: true });
      const file = body.input[0].content[0];
      if (name.endsWith('.pdf')) assert.deepEqual([file.type, file.file_data], ['input_file', 'data:application/pdf;base64,' + b64]);
      else assert.deepEqual([file.type, file.image_url], ['input_image', 'data:image/png;base64,' + b64]);
    }
  });
}

test('#4560: the strict schema is #4559\'s, with every property required and nothing extra allowed', () => {
  const item = keys.STRICT_SCHEMA.properties.people.items;
  assert.deepEqual(Object.keys(item.properties).sort(), Object.keys(o.SCHEMA.properties.people.items.properties).sort());
  assert.deepEqual(item.required.slice().sort(), Object.keys(item.properties).sort());
  assert.equal(item.additionalProperties, false);
  assert.equal(keys.STRICT_SCHEMA.additionalProperties, false);
});

test('#4560: what a provider cannot read is said before anything is sent (Grok and a PDF, WebP or GIF; Gemini and a GIF)', async () => {
  only('xai');
  assert.match(o.readerProblem('chart.pdf'), /xAI Grok cannot read a PDF sent this way\. Export the chart as a PNG or JPG picture/);
  assert.match(o.readerProblem('chart.webp'), /cannot read this kind of picture/);
  assert.match(o.readerProblem('chart.gif'), /cannot read this kind of picture/);
  assert.equal(o.readerProblem('chart.png'), null);
  const r = await o.readWithModel('chart.pdf', PDF);
  assert.match(r.problems[0], /cannot read a PDF/);
  assert.equal(seen.length, 0, 'a file the provider cannot take was sent');
  only('google');
  assert.match(o.readerProblem('chart.gif'), /Google Gemini cannot read this kind of picture/);
  assert.equal(o.readerProblem('chart.pdf'), null);
  only('openai');
  for (const n of ['chart.png', 'chart.jpg', 'chart.webp', 'chart.gif', 'chart.pdf']) assert.equal(o.readerProblem(n), null, n);
});

test('#4560: the consent names the key provider and account; with none, Claude\'s words and NO_MODEL stand', () => {
  only('google');
  assert.equal(o.providerLabel(), 'Google Gemini (work)');
  keys.setAccounts(() => [{ provider: 'openai', dir: '/tmp/x', account: null }]);
  assert.equal(o.providerLabel(), 'OpenAI');
  keys.setAccounts(() => []);
  assert.equal(o.modelAvailable(), false);
  assert.equal(o.providerLabel(), o.PROVIDER);
});

test('#4560: the reader is the first KEY account in Settings order (OpenAI, Gemini, Grok), the default first; a sign-in is skipped', () => {
  const mods = {
    openai: { list: () => [{ dir: '/o/sub', authMode: 'chatgpt', isDefault: true }, { dir: '/o/k2', authMode: 'apikey', isDefault: false, label: 'side' }] },
    google: { list: () => [{ dir: '/g/k', authMode: 'apikey', isDefault: true }] },
    xai: { list: () => [{ dir: '/x/k', authMode: 'apikey', isDefault: false, name: 'Team' }, { dir: '/x/d', authMode: 'apikey', isDefault: true }] },
  };
  assert.deepEqual(keys.accountsFrom(mods).map((a) => [a.provider, a.dir]), [['openai', '/o/k2'], ['google', '/g/k'], ['xai', '/x/d'], ['xai', '/x/k']]);
  keys.setAccounts(() => keys.accountsFrom(mods));
  assert.deepEqual(keys.chooseReader(), { provider: 'openai', dir: '/o/k2', account: 'side' });
  keys.setAccounts(() => keys.accountsFrom({ ...mods, openai: { list: () => [{ dir: '/o/sub', authMode: 'chatgpt', isDefault: true }] } }));
  assert.equal(keys.chooseReader().provider, 'google', 'a ChatGPT sign-in is not a key');
  keys.setAccounts(() => keys.accountsFrom({ openai: { list: () => { throw new Error('boom'); } }, google: { list: () => [] }, xai: { list: () => [] } }));
  assert.equal(keys.chooseReader(), null, 'an unreadable account list is no reader, not a crash');
});

test('#4560: refusals are plain sentences; the key never appears in anything returned or logged, even when a provider echoes it', async () => {
  const logged = [];
  const saved = { e: console.error, w: console.warn, l: console.log };
  console.error = (...a) => logged.push(a.join(' ')); console.warn = console.error; console.log = console.error;
  const results = [];
  try {
    for (const provider of ['openai', 'google', 'xai']) {
      only(provider);
      const cases = [
        [401, { error: { code: 'invalid_api_key', message: 'Incorrect API key provided: ' + KEY } }, /did not accept this key/],
        [404, { error: { code: 'model_not_found', message: 'The model does not exist or you do not have access. key=' + KEY } }, new RegExp('cannot use ' + keys.PROVIDERS[provider].model.replace('.', '\\.'))],
        [403, { error: { status: 'PERMISSION_DENIED', message: KEY } }, /cannot use/],
        [429, { error: { code: 'rate_limit_exceeded' } }, /busy or this key has reached its limit/],
        [500, 'upstream said ' + KEY, /could not read the chart \(500\)/],
        [502, { error: { code: 'bad_gateway', message: 'upstream saw ' + KEY } }, /could not read the chart \(502, bad_gateway\)/],
        [200, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, /did not finish reading the chart \(incomplete\)/],
        [200, { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }, provider === 'google' ? /finished without the list we asked for/ : /declined to read this chart/],
        [200, { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'not json ' + KEY }] }], steps: [{ type: 'model_output', content: [{ type: 'text', text: 'not json ' + KEY }] }] }, /did not answer with the list we asked for/],
      ];
      for (const [status, body, want] of cases) {
        reply = () => ({ status, body });
        const r = await o.readWithModel('chart.png', PNG);
        results.push(JSON.stringify(r));
        assert.match(r.problems[0], want, provider + ' ' + status + ': ' + r.problems[0]);
      }
    }
    // Unreachable: the provider URL points at a closed port; the network error's text is not passed on.
    only('openai');
    const saved2 = process.env.AGENT_WORKFORCE_ORGCHART_OPENAI_URL;
    process.env.AGENT_WORKFORCE_ORGCHART_OPENAI_URL = 'http://127.0.0.1:9/v1/responses?leak=' + KEY;
    const r = await o.readWithModel('chart.png', PNG);
    process.env.AGENT_WORKFORCE_ORGCHART_OPENAI_URL = saved2;
    results.push(JSON.stringify(r));
    assert.match(r.problems[0], /we could not reach OpenAI/);
  } finally { console.error = saved.e; console.warn = saved.w; console.log = saved.l; }
  for (const s of results.concat(logged)) assert.ok(!s.includes(KEY), 'the key leaked: ' + s.slice(0, 200));
  assert.ok(results.length >= 25, 'CONTROL: the cases ran (' + results.length + ')');
});

test('#4560: a stopped read aborts the request (the plan stops being used)', { timeout: 10000 }, async () => {
  only('openai');
  reply = () => ({ status: 200, body: ANSWER.openai(), delay: 3000 });
  const ctl = new AbortController();
  const pending = o.readWithModel('chart.png', PNG, { signal: ctl.signal });
  await new Promise((ok) => setTimeout(ok, 200));
  ctl.abort();
  const r = await pending;
  assert.match(r.problems[0], /the read was stopped/);
});

test('#4560: readApiKey reads each provider\'s stored key, and nothing for a sign-in', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4560-keys-'));
  const gem = require('./geminiaccounts'); const grok = require('./grokaccounts'); const oa = require('./openaiaccounts');
  fs.writeFileSync(gem.keyFile(dir), ' AIza-test-gem \n');
  fs.writeFileSync(grok.keyFile(dir), 'xai-test-grok\n');
  assert.equal(gem.readApiKey(dir), 'AIza-test-gem');
  assert.equal(grok.readApiKey(dir), 'xai-test-grok');
  const odir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4560-oa-'));
  fs.writeFileSync(path.join(odir, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-test-oa' }));
  assert.equal(oa.readApiKey(odir), 'sk-test-oa');
  fs.writeFileSync(path.join(odir, 'auth.json'), JSON.stringify({ tokens: { id_token: 'x' } }));
  assert.equal(oa.readApiKey(odir), null, 'a ChatGPT sign-in has no key to send');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-4560-none-'));
  assert.equal(gem.readApiKey(empty), null);
  assert.equal(grok.readApiKey(empty), null);
  assert.equal(oa.readApiKey(empty), null);
});

test('#4560 ruling m3688: Gemini is OFF for org charts; a Gemini-only person is told why; OpenAI and Grok are on', async () => {
  keys.setEnabled(null);   // the ruling as shipped
  try {
    assert.deepEqual(keys.ENABLED_DEFAULT, { openai: true, google: false, xai: true });
    keys.setAccounts(() => [{ provider: 'google', dir: '/g', account: 'work' }]);
    assert.equal(keys.chooseReader(), null, 'a Gemini key must not be chosen');
    assert.equal(o.modelAvailable(), false);
    assert.match(keys.offReason(), /Kosmos does not send an org chart to Gemini: Google's terms say not to send personal information on a free Gemini key/);
    const r = await keys.read({ provider: 'google', dir: '/g' }, 'p', 'chart.png', 'image/png', PNG);
    assert.equal(r.ok, false);
    assert.equal(seen.length, 0, 'nothing may be sent to a switched-off provider');
    keys.setAccounts(() => [{ provider: 'google', dir: '/g' }, { provider: 'xai', dir: '/x', account: null }]);
    assert.equal(keys.chooseReader().provider, 'xai', 'Gemini is skipped for the next key provider');
    keys.setAccounts(() => [{ provider: 'openai', dir: '/o' }]);
    assert.equal(keys.offReason(), null, 'CONTROL: no switched-off provider, no reason');
  } finally { keys.setEnabled({ openai: true, google: true, xai: true }); }
});

test('#4560: the retention line names what the reading provider keeps, from its docs (Liu Kang m3686)', () => {
  assert.match(keys.keeps({ provider: 'openai' }), /OpenAI keeps what you send for up to 30 days to check for abuse, even though Kosmos asks it not to store it/);
  assert.match(keys.keeps({ provider: 'xai' }), /xAI keeps what you send for 30 days in case of abuse/);
  assert.match(keys.keeps({ provider: 'google' }), /55 days/);
  assert.equal(keys.keeps(null), null);
});

test('#4560: the timeout, and a Stop, hold through the whole answer, not only its headers', { timeout: 15000 }, async () => {
  only('openai');
  // Headers now, the body never finishes: the answer trickles and stalls.
  const stall = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"status":"compl'); }); });
  await new Promise((ok) => stall.listen(0, '127.0.0.1', ok));
  const saved = process.env.AGENT_WORKFORCE_ORGCHART_OPENAI_URL;
  process.env.AGENT_WORKFORCE_ORGCHART_OPENAI_URL = 'http://127.0.0.1:' + stall.address().port + '/v1/responses';
  try {
    keys.setTimeoutMs(600);
    // Raced against 5 s, so a read that ignores its timeout FAILS here (cleanly) rather than hanging the test.
    const hung = (p) => Promise.race([p, new Promise((ok) => setTimeout(() => ok('hung'), 5000))]);
    const r = await hung(o.readWithModel('chart.png', PNG));
    assert.notEqual(r, 'hung', 'the stalled body was not cut off by the timeout');
    assert.match(r.problems[0], /reading the file took too long/);
    keys.setTimeoutMs(60000);
    const ctl = new AbortController();
    const pending = o.readWithModel('chart.png', PNG, { signal: ctl.signal });
    await new Promise((ok) => setTimeout(ok, 300));
    ctl.abort();
    const s = await hung(pending);
    assert.notEqual(s, 'hung', 'a Stop during the body did not end the read');
    assert.match(s.problems[0], /the read was stopped/);
  } finally { keys.setTimeoutMs(null); process.env.AGENT_WORKFORCE_ORGCHART_OPENAI_URL = saved; stall.closeAllConnections(); stall.close(); }
});

test('#4560: an answer over the cap is refused as it arrives; a finished answer with no text says so', async () => {
  only('xai');
  reply = () => ({ status: 200, body: 'x'.repeat(keys.MAX_ANSWER_BYTES + 10) });
  const big = await o.readWithModel('chart.png', PNG);
  assert.match(big.problems[0], /answer was too large to read/);
  reply = () => ({ status: 200, body: { status: 'completed', output: [{ type: 'reasoning' }] } });
  const empty = await o.readWithModel('chart.png', PNG);
  assert.match(empty.problems[0], /finished without the list we asked for/);
});

test('#4560: a redirect is refused, never followed: the key and the file reach no other host', async () => {
  const other = [];
  const second = http.createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => { other.push({ headers: req.headers, raw }); res.writeHead(200); res.end('{}'); }); });
  await new Promise((ok) => second.listen(0, '127.0.0.1', ok));
  try {
    for (const provider of ['openai', 'google', 'xai']) {
      only(provider);
      reply = () => ({ status: 307, body: {} });
      // The stub answers 307 with a Location on another host.
      const orig = server.listeners('request')[0];
      server.removeAllListeners('request');
      server.on('request', (req, res) => { req.resume(); res.writeHead(307, { location: 'http://127.0.0.1:' + second.address().port + '/steal' }); res.end(); });
      try {
        const r = await o.readWithModel('chart.png', PNG);
        assert.equal(r.rows.length, 0);
        assert.ok(r.problems[0] && !r.problems[0].includes(KEY), provider + ': ' + r.problems[0]);
      } finally { server.removeAllListeners('request'); server.on('request', orig); }
    }
    assert.equal(other.length, 0, 'a redirect was followed: ' + JSON.stringify(other.map((x) => Object.keys(x.headers))));
  } finally { second.close(); }
});

test('#4560: a URL override is honoured only for https or this computer, so a key never goes out in the clear', () => {
  const name = 'AGENT_WORKFORCE_ORGCHART_TEST_URL';
  const def = 'https://api.example.com/v1';
  process.env[name] = 'http://evil.example.com/v1'; assert.equal(keys.urlFrom(name, def), def);
  process.env[name] = 'https://proxy.example.com/v1'; assert.equal(keys.urlFrom(name, def), 'https://proxy.example.com/v1');
  process.env[name] = 'http://127.0.0.1:9/v1'; assert.equal(keys.urlFrom(name, def), 'http://127.0.0.1:9/v1');
  process.env[name] = 'not a url'; assert.equal(keys.urlFrom(name, def), def);
  delete process.env[name]; assert.equal(keys.urlFrom(name, def), def);
});
