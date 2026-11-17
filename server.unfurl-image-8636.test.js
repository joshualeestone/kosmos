'use strict';
/*
 * kosmos#8636 (Josh 11-17: a link preview's picture "keeps not rendering", a broken "?" box 17 minutes on): a card in
 * the thread the agent page polls carries a picture only once the board has fetched it. One that cannot be fetched (the
 * site answers 404 for its own og:image, as name.com did when measured) gives a card with its words and NO picture,
 * never a broken box; one that can comes with the card on its first appearance. The card never flips between the two
 * when the board's image cache lets the bytes go. Nothing touches the network: engine/unfurl's own fetch seam answers.
 *
 *   node --test server.unfurl-image-8636.test.js
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ogimage-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ogimage-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ogimage-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ogimage-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ogimage-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const unfurl = require('./engine/unfurl');
const fleet = require('./test-support/fleet');
const chat = require('./engine/chat');

const base = () => `http://127.0.0.1:${server.address().port}`;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
function answer(status, type, bytes) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? type : null) }, arrayBuffer: async () => bytes, body: null };
}
const pageWith = (title, image) => answer(200, 'text/html', Buffer.from('<head><meta property="og:title" content="' + title + '"><meta property="og:image" content="' + image + '"></head>'));
let calls = [];
let seq = 0;
let AGENT = null;

test.before(async () => {
  await start(0);
  AGENT = fleet.install([fleet.agent('ava', { state: 'idle' })]).agents[0].name;
});
test.after(() => {
  unfurl.resetForTests();
  try { fleet.restore(); } catch { /* best effort */ }
  try { server.closeAllConnections(); server.close(); } catch { /* best effort */ }
});
test.beforeEach(() => {
  unfurl.resetForTests();
  calls = [];
  unfurl.setResolver(async () => [{ address: '93.184.216.34', family: 4 }]);
  unfurl.setFetcher(async (url) => {
    calls.push(String(url));
    if (url === 'https://good8636.com/') return pageWith('Good page', '/og.png');
    if (url === 'https://good8636.com/og.png') return answer(200, 'image/png', PNG);
    if (url === 'https://broken8636.com/') return pageWith('Broken picture', '/_nuxt/ogimage.jpeg');
    if (url === 'https://broken8636.com/_nuxt/ogimage.jpeg') return answer(404, 'text/html', Buffer.from('not found'));
    throw new Error('no such page in the fixture: ' + url);
  });
});

/* A message in the agent's direct thread, read back through the route the page polls until a read carries the card
   (up to five seconds, so a loaded runner is not a red) and then `after` more times; every read is returned. */
async function postAndReadAll(text, after) {
  seq += 1;
  chat.appendMessage(chat.DIRECT, AGENT, { text, at: new Date(Date.now() + seq).toISOString(), delivery: { state: chat.DELIVERY.PLACED } });
  const seen = [];
  const read = async () => (await (await fetch(base() + '/api/agent/' + encodeURIComponent(AGENT) + '/thread')).json()).messages.find((x) => x.text === text);
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    const r = await read();
    seen.push(r);
    if (r && r.preview) break;
    await new Promise((res) => setTimeout(res, 20));
  }
  for (let i = 0; i < after; i += 1) { seen.push(await read()); await new Promise((res) => setTimeout(res, 10)); }
  return seen;
}

test('a picture the site cannot serve gives a card with its words and no picture, never a broken box', async () => {
  const reads = await postAndReadAll('see https://broken8636.com/ now', 10);
  const withCard = reads.filter((r) => r && r.preview);
  assert.ok(withCard.length > 0, 'CONTROL: the card appeared at all');
  for (const r of withCard) {
    assert.equal(r.preview.title, 'Broken picture');
    assert.equal(r.preview.image, '', 'a picture the site answers 404 for was put on the card');
  }
  assert.ok(calls.includes('https://broken8636.com/_nuxt/ogimage.jpeg'), 'the picture was never tried');
});

test('a picture that can be fetched comes with the card on its first appearance, and the card never shows without it', async () => {
  const reads = await postAndReadAll('see https://good8636.com/ now', 10);
  const withCard = reads.filter((r) => r && r.preview);
  assert.ok(withCard.length > 0, 'CONTROL: the card appeared at all');
  for (const r of withCard) assert.match(r.preview.image, /^\/api\/unfurl\/image\?url=https%3A%2F%2Fgood8636\.com%2Fog\.png$/, 'a card came without its picture');
  // And the picture is then served from the board's memory, with no second fetch of the site's image.
  const before = calls.filter((u) => u.endsWith('/og.png')).length;
  const img = await fetch(base() + withCard[0].preview.image);
  assert.equal(img.status, 200);
  assert.equal((await img.arrayBuffer()).byteLength, PNG.length);
  assert.equal(calls.filter((u) => u.endsWith('/og.png')).length, before, 'the picture was fetched again from the site');
});

test('the direct preview route leaves out a picture that cannot be fetched, and keeps one that can', async () => {
  const ask = async (u) => (await fetch(base() + '/api/unfurl?url=' + encodeURIComponent(u), { headers: { 'sec-fetch-site': 'same-origin' } })).json();
  const broken = await ask('https://broken8636.com/');
  assert.equal(broken.ok, true);
  assert.equal(broken.title, 'Broken picture');
  assert.equal(broken.image, '');
  const good = await ask('https://good8636.com/');
  assert.match(good.image, /^\/api\/unfurl\/image\?url=/, 'CONTROL: a picture that loads is kept');
});
