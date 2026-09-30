'use strict';
/**
 * #4720: a prebuilt team member's portrait is downloaded from beside the catalogue, used only
 * when it is exactly the image the signed catalogue names, and kept in the data folder.
 *
 *   node --test engine/catalogue.portrait-4720.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-portrait-'));
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

// These tests hand portrait() their own fetcher; one asserts the default address, so the harness's
// dead-port pin (tools/run-tests.sh) is taken off here.
delete process.env.KOSMOS_CATALOGUE_BASE;
const catalogue = require('./catalogue');
const { FIXTURE, storeSigned } = require('../test-support/catalogue-fixture');
// setup() deletes the stored catalogue's folder, so the data root must be this test's sandbox.
require('../test-support/data-root-sandbox').assertSandboxedDataRoot(SANDBOX, [require('./store').ROOT]);

const TEXT = fs.readFileSync(FIXTURE, 'utf8');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** The smallest file the WebP test accepts, made different per `seed`. */
function webp(seed, extra = 0) {
  const payload = Buffer.concat([Buffer.from(`portrait ${seed} `), Buffer.alloc(extra, 7)]);
  const head = Buffer.alloc(16);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(8 + payload.length, 4);
  head.write('WEBP', 8, 'latin1');
  head.write('VP8L', 12, 'latin1');
  return Buffer.concat([head, payload]);
}

/** Store the fixture with marketing/lead's avatar fields set as given (JSON values), signed. */
function setup(image, imageSha256) {
  fs.rmSync(path.dirname(catalogue.cacheFile()), { recursive: true, force: true });
  const from = '"id": "marketing-lead",\n            "image": null,\n            "imageSha256": null,';
  assert.equal(TEXT.split(from).length, 2, 'the fixture no longer has the marketing lead avatar in the expected shape');
  const to = `"id": "marketing-lead",\n            "image": ${JSON.stringify(image)},\n            "imageSha256": ${JSON.stringify(imageSha256)},`;
  storeSigned(TEXT.replace(from, to), catalogue.MIN_SERIAL);
  // The precondition every test below rests on: the catalogue with these fields is the one held.
  const held = catalogue.team('marketing');
  assert.ok(held, 'the altered catalogue was not accepted');
  assert.equal(held.members.find((m) => m.slot === 'lead').avatar.image, image);
}

/** A fetch that answers from `answers` in turn (the last one repeats) and records each address. */
function server(...answers) {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    const a = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (a instanceof Error) throw a;
    if (typeof a === 'number') return new Response('nope', { status: a });
    return new Response(a, { status: 200 });
  };
  return { fetcher, calls };
}

const IMG = webp('one');
const PATH = 'avatars/marketing-lead.webp';

test('a member with no portrait in the catalogue has none, and nothing is downloaded', async () => {
  setup(null, null);
  const { fetcher, calls } = server(IMG);
  const r = await catalogue.portrait('marketing', 'lead', { fetcher });
  assert.equal(r.ok, false);
  assert.match(r.because, /no portrait yet/);
  assert.equal(calls.length, 0);
});

test('the portrait the catalogue names is downloaded from beside it, returned, and kept under its hash', async () => {
  setup(PATH, sha256(IMG));
  const { fetcher, calls } = server(IMG);
  const r = await catalogue.portrait('marketing', 'lead', { fetcher });
  assert.equal(r.ok, true, JSON.stringify(r.because));
  assert.equal(r.type, 'image/webp');
  assert.ok(r.bytes.equals(IMG), 'the bytes returned are not the portrait');
  assert.deepEqual(calls, ['https://installkosmos.com/catalogue/avatars/marketing-lead.webp']);
  assert.ok(fs.readFileSync(catalogue.portraitFile(sha256(IMG))).equals(IMG), 'the portrait was not kept');
});

test('a portrait already kept is not downloaded again', async () => {
  setup(PATH, sha256(IMG));
  const first = server(IMG);
  assert.equal((await catalogue.portrait('marketing', 'lead', { fetcher: first.fetcher })).ok, true);
  const second = server(new Error('must not be asked'));
  const r = await catalogue.portrait('marketing', 'lead', { fetcher: second.fetcher });
  assert.equal(r.ok, true);
  assert.ok(r.bytes.equals(IMG));
  assert.equal(second.calls.length, 0);
});

test('an image that is not the one the catalogue names is refused after one ask past the caches, and is not kept', async () => {
  setup(PATH, sha256(IMG));
  const other = webp('someone else');
  const { fetcher, calls } = server(other);
  const r = await catalogue.portrait('marketing', 'lead', { fetcher });
  assert.equal(r.ok, false);
  assert.match(r.because, /not the image the catalogue names/);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /^https:\/\/installkosmos\.com\/catalogue\/avatars\/marketing-lead\.webp\?fresh=\d+$/);
  assert.equal(fs.existsSync(catalogue.portraitFile(sha256(IMG))), false);
  assert.equal(fs.existsSync(catalogue.portraitFile(sha256(other))), false);
});

test('a cache still holding the last portrait under the same name is asked past, and the right one is used', async () => {
  setup(PATH, sha256(IMG));
  const { fetcher, calls } = server(webp('the old one'), IMG);
  const r = await catalogue.portrait('marketing', 'lead', { fetcher });
  assert.equal(r.ok, true, JSON.stringify(r.because));
  assert.ok(r.bytes.equals(IMG));
  assert.equal(calls.length, 2);
});

test('a failed download is not asked for again inside a minute, unless forced', async () => {
  setup(PATH, sha256(IMG));
  const down = server(new Error('network down'));
  const r1 = await catalogue.portrait('marketing', 'lead', { fetcher: down.fetcher });
  assert.equal(r1.ok, false);
  assert.match(r1.because, /network down/);
  assert.equal(down.calls.length, 1);
  const up = server(IMG);
  const r2 = await catalogue.portrait('marketing', 'lead', { fetcher: up.fetcher });
  assert.equal(r2.ok, false, 'a second ask inside the minute downloaded again');
  assert.equal(up.calls.length, 0);
  const r3 = await catalogue.portrait('marketing', 'lead', { fetcher: up.fetcher, force: true });
  assert.equal(r3.ok, true);
  assert.equal(up.calls.length, 1);
});

test('a file with the named hash that is not a WebP image is refused', async () => {
  const text = Buffer.from('<html>this is not a picture</html>');
  setup(PATH, sha256(text));
  const { fetcher } = server(text);
  const r = await catalogue.portrait('marketing', 'lead', { fetcher });
  assert.equal(r.ok, false);
  assert.equal(fs.existsSync(catalogue.portraitFile(sha256(text))), false);
});

test('a portrait larger than the published cap is refused even when its hash matches', async () => {
  const big = webp('big', catalogue.PORTRAIT_MAX_BYTES);
  assert.ok(big.length > catalogue.PORTRAIT_MAX_BYTES);
  setup(PATH, sha256(big));
  const { fetcher } = server(big);
  const r = await catalogue.portrait('marketing', 'lead', { fetcher });
  assert.equal(r.ok, false);
  assert.match(r.because, /larger than/);
  // The control: one byte under the cap, same shape, is taken.
  const fits = webp('fits', catalogue.PORTRAIT_MAX_BYTES - 16 - 'portrait fits '.length);
  assert.equal(fits.length, catalogue.PORTRAIT_MAX_BYTES);
  setup(PATH, sha256(fits));
  assert.equal((await catalogue.portrait('marketing', 'lead', { fetcher: server(fits).fetcher })).ok, true);
});

test('a portrait path outside avatars/<id>.webp is never fetched', async () => {
  for (const bad of ['avatars/../catalogue.json', '../avatars/marketing-lead.webp', 'https://example.com/avatars/marketing-lead.webp',
    '/avatars/marketing-lead.webp', 'avatars/marketing-lead.png', 'avatars/Marketing-Lead.webp', 'avatars/a/b.webp', 'avatars/marketing-lead.webp?x=1', 7]) {
    setup(bad, sha256(IMG));
    const { fetcher, calls } = server(IMG);
    const r = await catalogue.portrait('marketing', 'lead', { fetcher });
    assert.equal(r.ok, false, `${bad} was used`);
    assert.match(r.because, /cannot use/);
    assert.equal(calls.length, 0, `${bad} was fetched`);
  }
});

test('a portrait with no usable hash is never fetched', async () => {
  for (const bad of [null, '', 'abc', sha256(IMG).toUpperCase(), sha256(IMG) + '0', 12]) {
    setup(PATH, bad);
    const { fetcher, calls } = server(IMG);
    const r = await catalogue.portrait('marketing', 'lead', { fetcher });
    assert.equal(r.ok, false, `hash ${JSON.stringify(bad)} was accepted`);
    assert.equal(calls.length, 0);
  }
});

test('a kept portrait damaged on disk is downloaded again, not served', async () => {
  setup(PATH, sha256(IMG));
  assert.equal((await catalogue.portrait('marketing', 'lead', { fetcher: server(IMG).fetcher })).ok, true);
  fs.writeFileSync(catalogue.portraitFile(sha256(IMG)), 'damaged');
  const again = server(IMG);
  const r = await catalogue.portrait('marketing', 'lead', { fetcher: again.fetcher });
  assert.equal(r.ok, true);
  assert.ok(r.bytes.equals(IMG), 'the damaged copy was served');
  assert.equal(again.calls.length, 1);
  assert.ok(fs.readFileSync(catalogue.portraitFile(sha256(IMG))).equals(IMG));
});

test('keeping a new portrait removes kept ones the catalogue no longer names, and only those', async () => {
  setup(PATH, sha256(IMG));
  const dir = path.dirname(catalogue.portraitFile(sha256(IMG)));
  fs.mkdirSync(dir, { recursive: true });
  const stale = path.join(dir, `${'a'.repeat(64)}.webp`);
  const underWay = path.join(dir, `${'b'.repeat(64)}.webp.123.tmp`);
  fs.writeFileSync(stale, 'an old portrait');
  fs.writeFileSync(underWay, 'another download being written');
  assert.equal((await catalogue.portrait('marketing', 'lead', { fetcher: server(IMG).fetcher })).ok, true);
  assert.equal(fs.existsSync(stale), false, 'a portrait no member names was left behind');
  assert.equal(fs.existsSync(underWay), true, 'a download under way was removed');
  assert.equal(fs.existsSync(catalogue.portraitFile(sha256(IMG))), true);
});

test('six asks at once for one portrait are one download', async () => {
  setup(PATH, sha256(IMG));
  const { fetcher, calls } = server(IMG);
  const all = await Promise.all(Array.from({ length: 6 }, () => catalogue.portrait('marketing', 'lead', { fetcher })));
  assert.ok(all.every((r) => r.ok && r.bytes.equals(IMG)));
  assert.equal(calls.length, 1);
});

test('an unknown team or member is answered, not thrown', async () => {
  setup(PATH, sha256(IMG));
  const { fetcher, calls } = server(IMG);
  assert.match((await catalogue.portrait('no-such-team', 'lead', { fetcher })).because, /no prebuilt team/);
  assert.match((await catalogue.portrait('marketing', 'no-such-seat', { fetcher })).because, /has no member/);
  assert.match((await catalogue.portrait(undefined, undefined, { fetcher })).because, /no prebuilt team/);
  assert.equal(calls.length, 0);
});

test('a test run that names no address and hands in no fetcher downloads nothing', async () => {
  setup(PATH, sha256(IMG));
  assert.ok(process.env.NODE_TEST_CONTEXT, 'this arm only means something under node --test');
  const real = globalThis.fetch;
  let asked = 0;
  globalThis.fetch = async () => { asked += 1; return new Response(IMG, { status: 200 }); };
  try {
    const r = await catalogue.portrait('marketing', 'lead');
    assert.equal(r.ok, false);
    assert.equal(asked, 0);
  } finally { globalThis.fetch = real; }
});

test('the address is the one the catalogue itself is read from', async () => {
  setup(PATH, sha256(IMG));
  process.env.KOSMOS_CATALOGUE_BASE = 'http://127.0.0.1:9/somewhere';
  try {
    const { fetcher, calls } = server(IMG);
    assert.equal((await catalogue.portrait('marketing', 'lead', { fetcher })).ok, true);
    assert.deepEqual(calls, ['http://127.0.0.1:9/somewhere/avatars/marketing-lead.webp']);
  } finally { delete process.env.KOSMOS_CATALOGUE_BASE; }
});
