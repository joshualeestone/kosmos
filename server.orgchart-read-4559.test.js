'use strict';
/**
 * #4559: POST /api/orgchart/read, an org chart FILE into the New Agent preview's people.
 *
 * Boots fully sandboxed (server.board-auth-1946's harness), flips board-token enforcement on in memory,
 * and drives real HTTP. The model is faked through orgchartfile.setModelRunner, so nothing here reaches a
 * provider; the fake RECORDS the request it was handed, so the test can check what would have been sent.
 * Every name in the fixtures is synthetic (test-support/orgchart-4559).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-orgchart-read-4559-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
/* The consent names the Claude account a read would run on (orgchartfile.readAccount), so the sandbox has none:
   the answer is then the provider alone, and this file never reads the real machine's accounts. */
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
delete process.env.CLAUDE_CONFIG_DIR;
/* The VERTICAL test creates agents: Claude Code's own config is sandboxed (fixture discipline), and the binary is
   /bin/echo, so nothing it runs is a provider. Every model test here fakes the runner and availability. */
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server, boardAuthState } = require('./server');
const orgchartfile = require('./engine/orgchartfile');

const TOK = 'BOARDTOKEN_test_orgchart_4559_0123456789';
const FIX = path.join(__dirname, 'test-support', 'orgchart-4559');
const H = { 'x-kosmos-board-token': TOK };
const SCREEN = { ...H, 'sec-fetch-site': 'same-origin' };
let base;

/* The seven synthetic people and their managers, as the fixtures draw them. */
const EXPECT = [
  ['Avery Quill', 'Chief Executive', null],
  ['Bo Linden', 'Head of Sales', 'Avery Quill'],
  ['Cass Orwell', 'Head of Product', 'Avery Quill'],
  ['Dev Mariner', 'Head of Operations', 'Avery Quill'],
  ['Eli Tamsin', 'Account Executive', 'Bo Linden'],
  ['Fen Ashby', null, 'Bo Linden'],   // its title differs per fixture (CSV: "Sales Engineer, EMEA")
  ['Gus Pell', 'Office Manager', 'Dev Mariner'],
];
function assertChart(rows, label) {
  assert.equal(rows.length, 7, `${label}: seven people`);
  EXPECT.forEach(([person, title, boss], i) => {
    assert.equal(rows[i].person, person, `${label}: row ${i} person`);
    if (title) assert.equal(rows[i].title, title, `${label}: row ${i} title`);
    const got = rows[i].reportsTo == null ? null : rows[rows[i].reportsTo].person;
    assert.equal(got, boss, `${label}: ${person} reports to`);
  });
}

async function send(name, bytes, { headers = H, query = '' } = {}) {
  // A consented send hands back the reader the consent named (#4560); these tests' reader is Claude.
  const q = query && query.includes('consent=1') && !query.includes('reader=') ? query + '&reader=claude' : query;
  const res = await fetch(base + '/api/orgchart/read' + q, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-orgchart-name': encodeURIComponent(name), ...headers },
    body: bytes,
  });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, json };
}

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
  boardAuthState.on = true;
  boardAuthState.token = TOK;
  // These tests model a computer with Claude (the model runner and availability are faked per test); #4560's test
  // below switches to the real reader resolution.
  orgchartfile.setReaderForTest(() => ({ kind: 'claude' }));
});
test.after(() => {
  orgchartfile.setModelRunner(null);
  orgchartfile.setModelAvailable(null);
  orgchartfile.setReaderForTest(null);
  try { server.close(); } catch { /* ignore */ }
});

test('#4559 CONTROL: the read route is board-token gated', async () => {
  const r = await send('people.csv', fs.readFileSync(path.join(FIX, 'people.csv')), { headers: {} });
  assert.equal(r.status, 403, 'an org chart names real employees; reading one must need the board token');
});

test('#4559: a CSV (HR-export shape, managers by id) is read on the Mac into people, titles and reporting lines', async () => {
  const r = await send('people.csv', fs.readFileSync(path.join(FIX, 'people.csv')));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.source, 'file');
  assertChart(r.json.rows, 'csv');
  assert.equal(r.json.rows[5].title, 'Sales Engineer, EMEA', 'a quoted title keeps its comma');
});

test('#4559: an XLSX (first sheet by the workbook, managers by name) is read on the Mac the same way', async () => {
  const r = await send('people.xlsx', fs.readFileSync(path.join(FIX, 'people.xlsx')));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assertChart(r.json.rows, 'xlsx');
  assert.equal(r.json.rows[5].title, 'Sales Engineer & Demos', 'an escaped ampersand is decoded');
});

test('#4559: slides and old spreadsheets are refused with what to do instead; an unknown kind is a 400', async () => {
  const pptx = await send('chart.pptx', Buffer.from('PK'));
  assert.match(pptx.json.problems[0], /export the slide as a PDF/);
  const xls = await send('people.xls', Buffer.from('x'));
  assert.match(xls.json.problems[0], /\.xlsx or \.csv/);
  const odd = await send('notes.docx', Buffer.from('x'));
  assert.equal(odd.status, 400);
});

test('#4559: a picture is NOT sent without consent: the first answer names the provider that would read it', async () => {
  const sent = [];
  orgchartfile.setModelAvailable(() => true);
  orgchartfile.setModelRunner(async (line) => { sent.push(line); return { ok: true, structured: { people: [] } }; });
  const r = await send('chart.png', fs.readFileSync(path.join(FIX, 'chart.png')), { headers: SCREEN });
  assert.deepEqual(r.json, { needsConsent: true, provider: 'Anthropic (Claude)', reader: 'claude', uses: 'using your plan', keeps: require('./engine/orgchartkeys').CLAUDE_KEEPS });
  // #4660: the Claude line says what Anthropic keeps, both cases of the setting Kosmos cannot read, from the sources on the card.
  // The wording itself, not the constant: each plan's case, the de-identified rendering, and no claim that Kosmos
  // asked Anthropic not to store it (the Claude read makes no such request).
  const k = r.json.keeps;
  assert.match(k, /^On a Free, Pro or Max plan, Anthropic keeps what you send for 30 days, or, if "Help improve Claude" is on in your Claude privacy settings, for up to 5 years, with details that identify you removed, to train its models\. /);
  assert.match(k, / On a Team or Enterprise plan, it keeps it for 30 days\. Anything its safety systems flag can be kept for up to 2 years\.$/);
  assert.doesNotMatch(k, /even though Kosmos asks|anonymous|separated from your account/);
  assert.equal(sent.length, 0, 'the file went to the model before the person said yes');
});

test('#4559: the consent question needs no file: an empty body is answered with the provider', async () => {
  orgchartfile.setModelAvailable(() => true);
  const r = await send('chart.pdf', Buffer.alloc(0), { headers: SCREEN });
  assert.deepEqual(r.json, { needsConsent: true, provider: 'Anthropic (Claude)', reader: 'claude', uses: 'using your plan', keeps: require('./engine/orgchartkeys').CLAUDE_KEEPS });
});

test('#4559: with consent but not from the screen (the board token alone), the file is refused, not sent', async () => {
  const sent = [];
  orgchartfile.setModelAvailable(() => true);
  orgchartfile.setModelRunner(async (line) => { sent.push(line); return { ok: true, structured: { people: [] } }; });
  const r = await send('chart.png', fs.readFileSync(path.join(FIX, 'chart.png')), { query: '?consent=1' });
  assert.equal(r.status, 403, JSON.stringify(r.json));
  assert.equal(sent.length, 0);
});

test('#4559: with consent from the screen, the picture goes INLINE to the model and its answer is validated into the preview', async () => {
  const sent = [];
  orgchartfile.setModelAvailable(() => true);
  orgchartfile.setModelRunner(async (line) => {
    sent.push(line);
    return { ok: true, structured: { people: [
      { person: 'Avery Quill', title: 'Chief Executive', reportsTo: null, sure: true },
      { person: 'Bo Linden', title: 'Head of Sales', reportsTo: 'Avery Quill', sure: true },
      { person: 'Cass Orwell', title: 'Head of Product', reportsTo: 'Avery Quill', sure: true },
      { person: 'Dev Mariner', title: 'Head of Operations', reportsTo: 'Avery Quill', sure: true },
      { person: 'Eli Tamsin', title: 'Account Executive', reportsTo: 'Bo Linden', sure: true },
      { person: 'Fen Ashby', title: 'Sales Engineer', reportsTo: 'Bo Linden', sure: false, why: 'the line to Fen is ambiguous' },
      { person: 'Gus Pell', title: 'Office Manager', reportsTo: 'Dev Mariner', sure: true },
    ] } };
  });
  const png = fs.readFileSync(path.join(FIX, 'chart.png'));
  const r = await send('chart.png', png, { headers: SCREEN, query: '?consent=1' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.source, 'model');
  assert.equal(r.json.provider, 'Anthropic (Claude)');
  assertChart(r.json.rows, 'png');
  assert.equal(r.json.rows[5].why, 'the line to Fen is ambiguous', 'an unsure line reaches the preview as Check this');
  assert.equal(sent.length, 1);
  const req = JSON.parse(sent[0]);
  const block = req.message.content[0];
  assert.deepEqual([block.type, block.source.media_type], ['image', 'image/png']);
  assert.equal(Buffer.from(block.source.data, 'base64').equals(png), true, 'the picture itself went inline, not a path to it');
  assert.ok(!sent[0].includes(FIX) && !sent[0].includes('chart.png'), 'no path or file name reached the model');
});

test('#4559: a PDF goes as a document block', async () => {
  const sent = [];
  orgchartfile.setModelAvailable(() => true);
  orgchartfile.setModelRunner(async (line) => { sent.push(line); return { ok: true, structured: { people: [{ person: 'A', title: 'CEO', reportsTo: null, sure: true }] } }; });
  const r = await send('chart.pdf', fs.readFileSync(path.join(FIX, 'chart.pdf')), { headers: SCREEN, query: '?consent=1' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const block = JSON.parse(sent[0]).message.content[0];
  assert.deepEqual([block.type, block.source.media_type], ['document', 'application/pdf']);
});

test('#4559: with no Claude on this computer a picture is not offered, and the answer says what works instead', async () => {
  const sent = [];
  orgchartfile.setModelAvailable(() => false);
  orgchartfile.setModelRunner(async (line) => { sent.push(line); return { ok: true, structured: { people: [] } }; });
  const r = await send('chart.png', fs.readFileSync(path.join(FIX, 'chart.png')), { headers: SCREEN, query: '?consent=1' });
  assert.equal(r.json.unavailable, true);
  assert.equal(r.json.problems[0], orgchartfile.NO_MODEL);
  assert.match(r.json.problems[0], /Claude or an OpenAI key \(a Grok key reads a PNG or JPG picture\).*A CSV or Excel export works with any provider/);
  assert.equal(sent.length, 0);
});

test('#4559: a read the page stops (the request closes) aborts the model call, so the plan stops being used', { timeout: 10000 }, async () => {
  orgchartfile.setModelAvailable(() => true);
  let aborted = null;
  orgchartfile.setModelRunner((line, signal) => new Promise((ok) => {
    const t = setTimeout(() => ok({ ok: true, structured: { people: [] } }), 8000);
    signal.addEventListener('abort', () => { clearTimeout(t); aborted = true; ok({ ok: false, because: 'the read was stopped' }); });
  }));
  const ac = new AbortController();
  const pending = fetch(base + '/api/orgchart/read?consent=1&reader=claude', {
    method: 'POST', signal: ac.signal,
    headers: { 'content-type': 'application/octet-stream', 'x-orgchart-name': 'chart.png', ...SCREEN },
    body: fs.readFileSync(path.join(FIX, 'chart.png')),
  }).catch(() => null);
  await new Promise((r) => setTimeout(r, 300));
  ac.abort();
  await pending;
  for (let i = 0; i < 40 && aborted !== true; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(aborted, true, 'the model call ran on after the page stopped the read');
});

test('#4559 VERTICAL: the create the page sends (managers first, reportsTo by agent name) reaches create with each manager, through the real team route', { timeout: 30000 }, async () => {
  /* Dry run writes no profile, so this records what the real route hands create. That create writes reportsTo into
     the profile is engine/create.test.js's ("reportsTo: 'thelead'"), and that the page's orphan fix-up (a PUT of an
     empty reportsTo) clears it is server.test.js's; this is the link between them nothing else drove. */
  const create = require('./engine/create');
  const real = create.createAgent;
  const handed = [];
  create.createAgent = (opts) => { handed.push([opts.name, opts.reportsTo || null]); return real(opts); };
  /* A signed-in (synthetic) default Claude account for this test only: create refuses without one. Removed after,
     so the consent answers above keep naming the provider alone. */
  const acct = path.join(process.env.AGENT_WORKFORCE_HOME, '.claude.json');
  fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_HOME, '.claude'), { recursive: true });
  fs.writeFileSync(acct, JSON.stringify({ oauthAccount: { emailAddress: 'avery@example.com' } }));
  try {
    const members = [
      { name: 'chief-executive', role: 'own', label: 'Chief Executive' },
      { name: 'head-of-sales', role: 'own', label: 'Head of Sales', reportsTo: 'chief-executive' },
      { name: 'account-executive', role: 'own', label: 'Account Executive', reportsTo: 'head-of-sales' },
    ];
    const res = await fetch(base + '/api/team', {
      method: 'POST', headers: { 'content-type': 'application/json', ...SCREEN },
      body: JSON.stringify({ creator: 'operator', purpose: 'Imported from an org chart', members }),
    });
    const team = await res.json();
    assert.equal(team.outcome, 'created', JSON.stringify(team));
    assert.deepEqual(team.created.map((c) => c.name), ['chief-executive', 'head-of-sales', 'account-executive'], 'created keeps the order sent');
    assert.deepEqual(handed, [['chief-executive', null], ['head-of-sales', 'chief-executive'], ['account-executive', 'head-of-sales']],
      'the route dropped or reordered a reporting line on its way to create');
  } finally {
    create.createAgent = real;
    fs.rmSync(acct, { force: true });
  }
});

test('#4559: a consented send with no file is refused before it reaches the model', async () => {
  const sent = [];
  orgchartfile.setModelAvailable(() => true);
  orgchartfile.setModelRunner(async (line) => { sent.push(line); return { ok: true, structured: { people: [] } }; });
  const r = await send('chart.png', Buffer.alloc(0), { headers: SCREEN, query: '?consent=1' });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.equal(sent.length, 0, 'an empty file reached the model');
});

test('#4560: with no Claude but a key-connected provider, the consent names that provider, and a kind it cannot read is refused before the consent', async () => {
  const keys = require('./engine/orgchartkeys');
  orgchartfile.setModelAvailable(null);   // the real check: this sandbox has no Claude account
  orgchartfile.setReaderForTest(null);
  keys.setAccounts(() => [{ provider: 'xai', dir: '/nowhere', account: 'work' }]);
  try {
    const png = await send('chart.png', Buffer.alloc(0), { headers: SCREEN });
    assert.equal(png.json.needsConsent, true);
    assert.equal(png.json.provider, 'xAI Grok (work)');
    assert.equal(png.json.uses, 'billed to your xAI Grok key');
    assert.match(png.json.keeps, /xAI keeps what you send for 30 days in case of abuse, even though Kosmos asks it not to store it/);
    assert.match(png.json.reader, /^xai:[0-9a-f]{12}$/, 'an opaque id: no account path reaches the page');
    // The consent named Grok; an OpenAI key added while the box was open must not receive the file.
    const sent = [];
    orgchartfile.setModelRunner(async (line, signal, file) => { sent.push(file.reader); return { ok: true, structured: { people: [] } }; });
    keys.setAccounts(() => [{ provider: 'openai', dir: '/other', account: 'new' }, { provider: 'xai', dir: '/nowhere', account: 'work' }]);
    const moved = await send('chart.png', fs.readFileSync(path.join(FIX, 'chart.png')), { headers: SCREEN, query: '?consent=1&reader=' + png.json.reader });
    assert.equal(moved.status, 409, JSON.stringify(moved.json));
    assert.match(moved.json.error, /Who reads this file changed since you were asked/);
    assert.equal(sent.length, 0, 'the file went to a provider the person did not agree to');
    keys.setAccounts(() => [{ provider: 'xai', dir: '/nowhere', account: 'work' }]);
    const ok = await send('chart.png', fs.readFileSync(path.join(FIX, 'chart.png')), { headers: SCREEN, query: '?consent=1&reader=' + png.json.reader });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.provider, 'xAI Grok (work)');
    assert.deepEqual(sent.map((r) => r && r.provider), ['xai'], 'the read went to exactly the reader that was agreed to');
    orgchartfile.setModelRunner(null);
    const pdf = await send('chart.pdf', Buffer.alloc(0), { headers: SCREEN });
    assert.equal(pdf.json.unavailable, true, JSON.stringify(pdf.json));
    assert.match(pdf.json.problems[0], /xAI Grok cannot read a PDF sent this way\. Export the chart as a PNG or JPG picture/);
    keys.setAccounts(() => []);
    const none = await send('chart.png', Buffer.alloc(0), { headers: SCREEN });
    assert.deepEqual(none.json, { unavailable: true, problems: [orgchartfile.NO_MODEL] }, 'CONTROL: with no key account and no Claude, nothing reads it');
    keys.setAccounts(() => [{ provider: 'google', dir: '/g', account: 'work' }]);
    const gem = await send('chart.png', Buffer.alloc(0), { headers: SCREEN });
    assert.match(gem.json.problems[0], /Kosmos does not send an org chart to Gemini/, 'a Gemini-only person is told why (m3688)');
  } finally { keys.setAccounts(null); orgchartfile.setModelRunner(null); orgchartfile.setReaderForTest(() => ({ kind: 'claude' })); }
});

test('#4560: a consented send with no reader behind it is refused; a page from before #4560 (no reader id) may go on only to Claude', async () => {
  const sent = [];
  orgchartfile.setModelAvailable(() => true);
  orgchartfile.setModelRunner(async (line, signal, file) => { sent.push(file.reader); return { ok: true, structured: { people: [] } }; });
  const post = (q) => fetch(base + '/api/orgchart/read' + q, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-orgchart-name': 'chart.png', ...SCREEN }, body: fs.readFileSync(path.join(FIX, 'chart.png')) });
  try {
    orgchartfile.setReaderForTest(() => null);
    assert.equal((await post('?consent=1')).status, 409, 'no reader at all, availability faked on: refused');
    assert.equal((await post('?consent=1&reader=')).status, 409);
    orgchartfile.setReaderForTest(() => ({ kind: 'claude' }));
    assert.equal((await post('?consent=1')).status, 200, 'an old page (no reader id) and Claude: as before');
    orgchartfile.setReaderForTest(() => ({ kind: 'key', provider: 'xai', dir: '/x', account: null }));
    const old = await post('?consent=1');
    assert.equal(old.status, 409, 'an old page never showed a key provider\'s consent');
    assert.match((await old.json()).error, /This page is older than Kosmos\. Reload the New Agent screen/, 'it is told to reload, not that the reader changed');
    assert.equal(sent.length, 1, 'only the Claude send reached the runner');
  } finally { orgchartfile.setReaderForTest(() => ({ kind: 'claude' })); orgchartfile.setModelRunner(null); }
});

test('#4560: the Claude reader id pins the account the consent named; another default account is refused', async () => {
  const sent = [];
  orgchartfile.setModelAvailable(() => true);
  orgchartfile.setModelRunner(async (line, signal, file) => { sent.push(file.reader); return { ok: true, structured: { people: [] } }; });
  const post = (q) => fetch(base + '/api/orgchart/read' + q, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-orgchart-name': 'chart.png', ...SCREEN }, body: fs.readFileSync(path.join(FIX, 'chart.png')) });
  try {
    orgchartfile.setReaderForTest(() => ({ kind: 'claude', dir: '/Users/x/.claude' }));
    const ask = await send('chart.png', Buffer.alloc(0), { headers: SCREEN });
    assert.match(ask.json.reader, /^claude:[0-9a-f]{12}$/, 'the account is in the id');
    orgchartfile.setReaderForTest(() => ({ kind: 'claude', dir: '/Users/x/.claude-other' }));
    assert.equal((await post('?consent=1&reader=' + ask.json.reader)).status, 409, 'another Claude account must not receive it');
    orgchartfile.setReaderForTest(() => ({ kind: 'claude', dir: '/Users/x/.claude' }));
    assert.equal((await post('?consent=1&reader=' + ask.json.reader)).status, 200);
    assert.equal((await post('?consent=1')).status, 200, 'a page from before #4560 (no id) still reads with Claude');
    assert.equal(sent.length, 2);
  } finally { orgchartfile.setReaderForTest(() => ({ kind: 'claude' })); orgchartfile.setModelRunner(null); }
});

test('#4560: a key replaced in the same account folder while the consent box is open is another reader (409)', async () => {
  const keys = require('./engine/orgchartkeys');
  const sent = [];
  orgchartfile.setModelAvailable(null);
  orgchartfile.setReaderForTest(null);
  orgchartfile.setModelRunner(async (line, signal, file) => { sent.push(file.reader); return { ok: true, structured: { people: [] } }; });
  try {
    keys.setAccounts(() => [{ provider: 'openai', dir: '/o', account: 'work', keyTail: 'AAAA' }]);
    const ask = await send('chart.png', Buffer.alloc(0), { headers: SCREEN });
    keys.setAccounts(() => [{ provider: 'openai', dir: '/o', account: 'work', keyTail: 'BBBB' }]);
    const moved = await send('chart.png', fs.readFileSync(path.join(FIX, 'chart.png')), { headers: SCREEN, query: '?consent=1&reader=' + ask.json.reader });
    assert.equal(moved.status, 409, JSON.stringify(moved.json));
    keys.setAccounts(() => [{ provider: 'openai', dir: '/o', account: 'work', keyTail: 'AAAA' }]);
    const ok = await send('chart.png', fs.readFileSync(path.join(FIX, 'chart.png')), { headers: SCREEN, query: '?consent=1&reader=' + ask.json.reader });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(sent.length, 1);
  } finally { keys.setAccounts(null); orgchartfile.setModelRunner(null); orgchartfile.setReaderForTest(() => ({ kind: 'claude' })); }
});

test('#4560 END TO END: the route, the reader it pinned, and the provider call, with only the HTTP answer faked', async () => {
  const http = require('node:http');
  const keys = require('./engine/orgchartkeys');
  const seen = [];
  const stub = http.createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => {
    seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(raw) });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ people: [
      { person: 'Avery Quill', title: 'Chief Executive', reportsTo: null, sure: true, why: null },
      { person: 'Bo Linden', title: 'Head of Sales', reportsTo: 'Avery Quill', sure: true, why: null },
    ] }) }] }] }));
  }); });
  await new Promise((ok) => stub.listen(0, '127.0.0.1', ok));
  const saved = { x: process.env.AGENT_WORKFORCE_ORGCHART_XAI_URL, o: process.env.AGENT_WORKFORCE_ORGCHART_OPENAI_URL };
  process.env.AGENT_WORKFORCE_ORGCHART_XAI_URL = 'http://127.0.0.1:' + stub.address().port + '/xai/v1/responses';
  // OpenAI points at the same stub, so a read that re-chose its reader would land here, never on a real API.
  process.env.AGENT_WORKFORCE_ORGCHART_OPENAI_URL = 'http://127.0.0.1:' + stub.address().port + '/openai/v1/responses';
  orgchartfile.setModelAvailable(null);
  orgchartfile.setReaderForTest(null);
  orgchartfile.setModelRunner(null);   // the real dispatcher and the real key reader
  // The account list changes AFTER the route has checked the reader on the consented send (its 3rd look): an OpenAI key
  // appears first. The read must use the reader the route pinned (Grok), not look again.
  let looks = 0;
  keys.setAccounts(() => { looks += 1; return looks <= 2 ? [{ provider: 'xai', dir: '/x', account: 'work', keyTail: 'k123' }] : [{ provider: 'openai', dir: '/o', account: 'new', keyTail: 'o999' }, { provider: 'xai', dir: '/x', account: 'work', keyTail: 'k123' }]; });
  keys.setKeyFor((r) => (r.provider === 'xai' ? 'xai-TEST-KEY-4560' : 'sk-OTHER'));
  try {
    const ask = await send('chart.png', Buffer.alloc(0), { headers: SCREEN });
    assert.equal(ask.json.provider, 'xAI Grok (work)');
    const r = await send('chart.png', fs.readFileSync(path.join(FIX, 'chart.png')), { headers: SCREEN, query: '?consent=1&reader=' + ask.json.reader });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.rows.map((x) => [x.person, x.reportsTo]), [['Avery Quill', null], ['Bo Linden', 0]]);
    assert.equal(r.json.provider, 'xAI Grok (work)');
    assert.equal(seen.length, 1, 'exactly one provider call');
    assert.match(seen[0].url, /^\/xai\//, 'the read went to the pinned reader, not one chosen again after the check');
    assert.equal(seen[0].auth, 'Bearer xai-TEST-KEY-4560');
    assert.equal(seen[0].body.model, 'grok-4.7');
    assert.equal(seen[0].body.store, false);
    assert.ok(!JSON.stringify(r.json).includes('xai-TEST-KEY-4560'), 'the key reached the page');
  } finally {
    keys.setAccounts(null); keys.setKeyFor(null);
    process.env.AGENT_WORKFORCE_ORGCHART_XAI_URL = saved.x;
    process.env.AGENT_WORKFORCE_ORGCHART_OPENAI_URL = saved.o;
    stub.close();
    orgchartfile.setReaderForTest(() => ({ kind: 'claude' }));
  }
});
