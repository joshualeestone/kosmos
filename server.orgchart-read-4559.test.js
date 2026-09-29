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
  const res = await fetch(base + '/api/orgchart/read' + query, {
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
});
test.after(() => {
  orgchartfile.setModelRunner(null);
  orgchartfile.setModelAvailable(null);
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
  assert.deepEqual(r.json, { needsConsent: true, provider: 'Anthropic (Claude)' });
  assert.equal(sent.length, 0, 'the file went to the model before the person said yes');
});

test('#4559: the consent question needs no file: an empty body is answered with the provider', async () => {
  orgchartfile.setModelAvailable(() => true);
  const r = await send('chart.pdf', Buffer.alloc(0), { headers: SCREEN });
  assert.deepEqual(r.json, { needsConsent: true, provider: 'Anthropic (Claude)' });
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
  assert.match(r.json.problems[0], /needs a Claude connection right now\. A CSV or Excel export works with any provider/);
  assert.equal(sent.length, 0);
});
