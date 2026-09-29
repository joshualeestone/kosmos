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
});
test.after(() => { keys.setAccounts(null); keys.setKeyFor(null); o.setModelAvailable(null); server.close(); });
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
        [200, { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] }, provider === 'google' ? /did not answer with the list/ : /declined to read this chart/],
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
