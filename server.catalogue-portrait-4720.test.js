'use strict';
/**
 * #4720, through the real route: GET /api/catalogue/portrait answers a prebuilt team member's
 * portrait from the board's own address, downloaded by the board from beside the catalogue and
 * checked against the hash the signed catalogue names.
 *
 * Nothing here is faked inside the board: the catalogue address is a real local web server
 * (KOSMOS_CATALOGUE_BASE, the module's own seam), so the board's own fetch, size cap and hash
 * check all run.
 *
 *   node --test server.catalogue-portrait-4720.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-portrait-route-4720-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'kosmos-projects');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const catalogue = require('./engine/catalogue');
const { FIXTURE, storeSigned } = require('./test-support/catalogue-fixture');
require('./test-support/data-root-sandbox').assertSandboxedDataRoot(SANDBOX, [require('./engine/store').ROOT]);

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
function webp(seed) {
  const payload = Buffer.from(`portrait ${seed}`);
  const head = Buffer.alloc(16);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(8 + payload.length, 4);
  head.write('WEBP', 8, 'latin1');
  head.write('VP8L', 12, 'latin1');
  return Buffer.concat([head, payload]);
}
const LEAD = webp('the marketing lead');
const CONTENT = webp('the content writer');   // named by the catalogue, never served by the address
const WRONG = webp('somebody else');

// The catalogue's own address, stood in for by a local server: what it serves is this test's to choose.
const served = new Map();
const asked = [];
const site = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  asked.push(req.url);
  if (!served.has(p)) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': 'image/webp' });
  res.end(served.get(p));
});

let base;
test.before(async () => {
  await new Promise((done) => site.listen(0, '127.0.0.1', done));
  process.env.KOSMOS_CATALOGUE_BASE = `http://127.0.0.1:${site.address().port}/catalogue/`;
  // The held catalogue: the published fixture, with a portrait named for the marketing lead and
  // for the content writer, and none for anyone else.
  const text = fs.readFileSync(FIXTURE, 'utf8');
  const name = (body, id, image, sha) => {
    const from = `"id": "${id}",\n            "image": null,\n            "imageSha256": null,`;
    assert.equal(body.split(from).length, 2, `the fixture no longer has ${id}'s avatar in the expected shape`);
    return body.replace(from, `"id": "${id}",\n            "image": "${image}",\n            "imageSha256": "${sha}",`);
  };
  let body = name(text, 'marketing-lead', 'avatars/marketing-lead.webp', sha256(LEAD));
  body = name(body, 'marketing-content', 'avatars/marketing-content.webp', sha256(CONTENT));
  storeSigned(body, catalogue.MIN_SERIAL);
  served.set('/catalogue/avatars/marketing-lead.webp', LEAD);
  served.set('/catalogue/avatars/marketing-content.webp', WRONG);   // not the image the catalogue names
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  try { server.closeAllConnections(); server.close(); } catch { /* going away */ }
  try { site.closeAllConnections(); site.close(); } catch { /* going away */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

test('a member whose portrait the catalogue names is served as that image, from the board', async () => {
  const res = await fetch(`${base}/api/catalogue/portrait?team=marketing&slot=lead`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/webp');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('content-length'), String(LEAD.length));
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(LEAD), 'the board did not serve the portrait');
  assert.deepEqual(asked, ['/catalogue/avatars/marketing-lead.webp'], 'the board asked the catalogue address for something else');
});

test('a second ask is served from what the board kept: the catalogue address is not asked again', async () => {
  const before = asked.length;
  const res = await fetch(`${base}/api/catalogue/portrait?team=marketing&slot=lead`);
  assert.equal(res.status, 200);
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(LEAD));
  assert.equal(asked.length, before);
});

test('an image that is not the one the catalogue names is never served: 404 with the reason', async () => {
  const res = await fetch(`${base}/api/catalogue/portrait?team=marketing&slot=content`);
  assert.equal(res.status, 404);
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.match(json.because, /not the image the catalogue names/);
  // The precondition: the board did ask, and was handed an image (a 404 here for any other reason proves nothing).
  assert.ok(asked.includes('/catalogue/avatars/marketing-content.webp'), 'the board never asked for the content writer portrait');
});

test('a member with no portrait, an unknown member, an unknown team and a bare request are each a 404 with a reason', async () => {
  const before = asked.length;
  for (const [q, why] of [['team=marketing&slot=seo', /no portrait yet/], ['team=marketing&slot=nobody', /has no member/],
    ['team=nothing&slot=lead', /no prebuilt team/], ['', /no prebuilt team/]]) {
    const res = await fetch(`${base}/api/catalogue/portrait?${q}`);
    assert.equal(res.status, 404, q);
    assert.match((await res.json()).because, why, q);
  }
  assert.equal(asked.length, before, 'a request for a member with no portrait reached the catalogue address');
});

test('nothing in the request chooses the address: a path or an address as the slot downloads nothing', async () => {
  const before = asked.length;
  for (const slot of ['../../catalogue.json', 'http://127.0.0.1:9/x.webp', 'avatars/marketing-lead.webp']) {
    const res = await fetch(`${base}/api/catalogue/portrait?team=marketing&slot=${encodeURIComponent(slot)}`);
    assert.equal(res.status, 404, slot);
  }
  assert.equal(asked.length, before);
});

test('a request that came from another website is refused before the board fetches anything', async () => {
  // node:http, because fetch will not send these headers as written.
  const ask = (headers) => new Promise((done, fail) => {
    http.get(`${base}/api/catalogue/portrait?team=marketing&slot=content`, { headers }, (res) => {
      res.resume();
      res.on('end', () => done(res.statusCode));
    }).on('error', fail);
  });
  const before = asked.length;
  assert.equal(await ask({ 'sec-fetch-site': 'cross-site' }), 403);
  assert.equal(await ask({ referer: 'https://example.com/page' }), 403);
  assert.equal(asked.length, before, 'the board fetched for a request from another website');
  // The control: the same request from the board's own page is answered by the route (a 404 here, as above).
  assert.equal(await ask({ 'sec-fetch-site': 'same-origin', referer: `${base}/` }), 404);
});
