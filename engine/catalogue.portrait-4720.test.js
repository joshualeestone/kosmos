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

/** Store the fixture with marketing/lead's avatar fields set as given (JSON values), signed.
 *  `others` names more members' portraits: { '<avatar id>': [image, imageSha256] }. */
function setup(image, imageSha256, others = {}) {
  fs.rmSync(path.dirname(catalogue.cacheFile()), { recursive: true, force: true });
  SIGNER = storeSigned(named(image, imageSha256, others), catalogue.MIN_SERIAL);
  // The precondition every test below rests on: the catalogue with these fields is the one held.
  const held = catalogue.team('marketing');
  assert.ok(held, 'the altered catalogue was not accepted');
  assert.equal(held.members.find((m) => m.slot === 'lead').avatar.image, image);
}

let SIGNER = null;   // the key the held catalogue was signed with, for republish()

/** The fixture's text with these members' avatar fields set. */
function named(image, imageSha256, others = {}) {
  let text = TEXT;
  for (const [id, [img, sha]] of Object.entries({ 'marketing-lead': [image, imageSha256], ...others })) {
    const from = `"id": "${id}",\n            "image": null,\n            "imageSha256": null,`;
    assert.equal(text.split(from).length, 2, `the fixture no longer has ${id}'s avatar in the expected shape`);
    text = text.replace(from, `"id": "${id}",\n            "image": ${JSON.stringify(img)},\n            "imageSha256": ${JSON.stringify(sha)},`);
  }
  return text;
}

/** Replace the held catalogue the way a real publish does (a newer signed download), without
 *  touching what the process holds about portraits. `step` orders the publishes in one test. */
async function republish(step, image, imageSha256, others = {}) {
  const body = named(image, imageSha256, others).replace(/"serial": \d+/, `"serial": ${catalogue.MIN_SERIAL + step}`);
  const sig = crypto.sign(null, Buffer.from(body), SIGNER).toString('base64');
  const st = await catalogue.refresh({ force: true, fetcher: async (url) => new Response(url.endsWith('.sig') ? sig : body, { status: 200 }) });
  assert.equal(st.serial, catalogue.MIN_SERIAL + step, `the republished catalogue was not taken: ${st.error}`);
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
  const writer = webp('the content writer');
  setup(PATH, sha256(IMG), { 'marketing-content': ['avatars/marketing-content.webp', sha256(writer)] });
  const dir = path.dirname(catalogue.portraitFile(sha256(IMG)));
  fs.mkdirSync(dir, { recursive: true });
  // Another member's portrait, already kept: the catalogue still names it, so it stays.
  fs.writeFileSync(catalogue.portraitFile(sha256(writer)), writer);
  const stale = path.join(dir, `${'a'.repeat(64)}.webp`);
  const underWay = path.join(dir, `${'b'.repeat(64)}.webp.123.tmp`);
  fs.writeFileSync(stale, 'an old portrait');
  fs.writeFileSync(underWay, 'another download being written');
  assert.equal((await catalogue.portrait('marketing', 'lead', { fetcher: server(IMG).fetcher })).ok, true);
  assert.equal(fs.existsSync(stale), false, 'a portrait no member names was left behind');
  assert.equal(fs.existsSync(underWay), true, 'a download under way was removed');
  assert.equal(fs.existsSync(catalogue.portraitFile(sha256(writer))), true, 'a portrait another member still names was removed');
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

test('a portrait that verified but cannot be saved is still used, and is downloaded once, not on every ask', async () => {
  setup(PATH, sha256(IMG));
  // A file where the portraits folder should be: every save fails.
  const dir = path.dirname(catalogue.portraitFile(sha256(IMG)));
  fs.writeFileSync(dir, 'in the way');
  const { fetcher, calls } = server(IMG);
  for (let i = 0; i < 4; i += 1) {
    const r = await catalogue.portrait('marketing', 'lead', { fetcher });
    assert.equal(r.ok, true, `ask ${i + 1}: ${r.because}`);
    assert.ok(r.bytes.equals(IMG));
  }
  assert.equal(fs.statSync(dir).isFile(), true, 'the precondition: nothing could be saved');
  assert.equal(calls.length, 1, 'a portrait that could not be saved was downloaded again');
});

test('each part of the WebP test is needed: a wrong size field, a wrong first chunk and a wrong form are each refused', async () => {
  const wrongSize = Buffer.from(IMG); wrongSize.writeUInt32LE(IMG.length, 4);             // claims 8 bytes more than it has
  const hidden = Buffer.concat([IMG, Buffer.from('<script>something after the image</script>')]);   // size field stops short
  const wrongChunk = Buffer.from(IMG); wrongChunk.write('EXIF', 12, 'latin1');
  const wrongForm = Buffer.from(IMG); wrongForm.write('WAVE', 8, 'latin1');
  const notRiff = Buffer.from(IMG); notRiff.write('RIFX', 0, 'latin1');
  // `marksOnly` is 16 bytes carrying every mark and no image (the builder's floor is 20);
  // `tiny` is shorter than the size field itself: refused as not the image, not by an error reading it.
  const marksOnly = Buffer.alloc(16);
  marksOnly.write('RIFF', 0, 'latin1'); marksOnly.writeUInt32LE(8, 4); marksOnly.write('WEBP', 8, 'latin1'); marksOnly.write('VP8L', 12, 'latin1');
  for (const [what, bytes] of Object.entries({ wrongSize, hidden, wrongChunk, wrongForm, notRiff, marksOnly, short: IMG.subarray(0, 12), tiny: Buffer.from('RIFF') })) {
    setup(PATH, sha256(bytes));
    const r = await catalogue.portrait('marketing', 'lead', { fetcher: server(bytes).fetcher });
    assert.equal(r.ok, false, `${what} was taken as a portrait`);
    assert.match(r.because, /not the image the catalogue names/, what);
  }
});

test('an answer that declares itself larger than the cap is refused before it is read', async () => {
  setup(PATH, sha256(IMG));
  let read = false;
  const fetcher = async () => {
    const res = new Response(IMG, { status: 200, headers: { 'content-length': String(catalogue.PORTRAIT_MAX_BYTES + 1) } });
    Object.defineProperty(res, 'body', { get() { read = true; return null; } });
    return res;
  };
  const r = await catalogue.portrait('marketing', 'lead', { fetcher });
  assert.equal(r.ok, false);
  assert.match(r.because, /larger than/);
  assert.equal(read, false, 'the body was read although the answer declared itself too large');
});

test('after the minute has passed a failed portrait is asked for again', async (t) => {
  setup(PATH, sha256(IMG));
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const down = server(new Error('network down'));
  assert.equal((await catalogue.portrait('marketing', 'lead', { fetcher: down.fetcher })).ok, false);
  const up = server(IMG);
  t.mock.timers.tick(59 * 1000);
  assert.equal((await catalogue.portrait('marketing', 'lead', { fetcher: up.fetcher })).ok, false, 'asked again inside the minute');
  assert.equal(up.calls.length, 0);
  t.mock.timers.tick(2 * 1000);
  assert.equal((await catalogue.portrait('marketing', 'lead', { fetcher: up.fetcher })).ok, true, 'never asked again after the minute');
  assert.equal(up.calls.length, 1);
});

test('two members sharing one image under two names: one name failing does not answer for the other', async () => {
  setup(PATH, sha256(IMG), { 'marketing-content': ['avatars/marketing-content.webp', sha256(IMG)] });
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    return url.includes('marketing-content.webp') ? new Response(IMG, { status: 200 }) : new Response('nope', { status: 404 });
  };
  const lead = await catalogue.portrait('marketing', 'lead', { fetcher });
  assert.equal(lead.ok, false);
  const content = await catalogue.portrait('marketing', 'content', { fetcher });
  assert.equal(content.ok, true, `the content writer was answered with the lead's failure: ${content.because}`);
  assert.ok(calls.some((u) => u.endsWith('/avatars/marketing-content.webp')), 'the content writer address was never asked');
  // And once one name has delivered the image, the other member has it too: it is the same image.
  assert.equal((await catalogue.portrait('marketing', 'lead', { fetcher })).ok, true);
});

test('the cap is the catalogue builder\'s own: 512 KiB', () => {
  assert.equal(catalogue.PORTRAIT_MAX_BYTES, 524288);
});

test('a catalogue replaced while a portrait downloads does not cost the portrait just kept', async () => {
  setup(PATH, sha256(IMG));
  // The newer catalogue names no portrait at all, and arrives while the image is on its way.
  const fetcher = async () => { await republish(1, null, null); return new Response(IMG, { status: 200 }); };
  const r = await catalogue.portrait('marketing', 'lead', { fetcher });
  assert.equal(r.ok, true, r.because);
  assert.equal(catalogue.team('marketing').members.find((m) => m.slot === 'lead').avatar.image, null, 'the precondition: the catalogue was replaced');
  assert.ok(fs.readFileSync(catalogue.portraitFile(sha256(IMG))).equals(IMG), 'the portrait just kept was pruned away');
});

test('a portrait held in memory is dropped once the catalogue no longer names it', async () => {
  const next = webp('the next lead');
  setup(PATH, sha256(IMG));
  fs.writeFileSync(path.dirname(catalogue.portraitFile(sha256(IMG))), 'in the way');   // every save fails
  assert.equal((await catalogue.portrait('marketing', 'lead', { fetcher: server(IMG).fetcher })).ok, true);
  const down = server(new Error('network down'));
  // The control: while the catalogue names it, it is served from memory with the network down.
  assert.equal((await catalogue.portrait('marketing', 'lead', { fetcher: down.fetcher })).ok, true);
  // The catalogue moves on to another image; downloading that one prunes the first.
  await republish(1, PATH, sha256(next));
  assert.equal((await catalogue.portrait('marketing', 'lead', { fetcher: server(next).fetcher })).ok, true);
  // Back to naming the first: it has to be downloaded again, so with the network down there is none.
  await republish(2, PATH, sha256(IMG));
  const r = await catalogue.portrait('marketing', 'lead', { fetcher: down.fetcher, force: true });
  assert.equal(r.ok, false, 'a portrait the catalogue had stopped naming was still held');
});
