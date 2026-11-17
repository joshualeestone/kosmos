'use strict';
/**
 * kosmos#8636: the board remembers, for a day, whether a preview's picture could be fetched (imageState), apart from
 * the bytes its image cache lets go after ten minutes, and warm() fetches the picture with the page. Nothing touches the
 * network: the fetcher and resolver seams answer, and Date.now is moved by hand.
 *
 *   node --test engine/unfurl.image-8636.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const unfurl = require('./unfurl');

function answer(status, type, bytes) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? type : null) }, arrayBuffer: async () => bytes, body: null };
}
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
let calls = [];
let imageAnswer = () => answer(200, 'image/png', PNG);
const realNow = Date.now;
let shift = 0;

test.beforeEach(() => {
  unfurl.resetForTests();
  calls = [];
  shift = 0;
  Date.now = () => realNow() + shift;
  imageAnswer = () => answer(200, 'image/png', PNG);
  unfurl.setResolver(async () => [{ address: '93.184.216.34', family: 4 }]);
  unfurl.setFetcher(async (url) => {
    calls.push(String(url));
    if (url === 'https://site8636.com/') return answer(200, 'text/html', Buffer.from('<head><meta property="og:title" content="T"><meta property="og:image" content="/og.png"></head>'));
    if (url === 'https://site8636.com/og.png') return imageAnswer();
    throw new Error('no such page: ' + url);
  });
});
test.afterEach(() => { Date.now = realNow; unfurl.resetForTests(); });
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
const IMG = 'https://site8636.com/og.png';

test('never fetched is null; warm fetches the page AND its picture, after which it is good', async () => {
  assert.equal(unfurl.imageState(IMG), null);
  unfurl.warm('https://site8636.com/');
  await settle();
  assert.deepEqual(calls, ['https://site8636.com/', IMG], 'the picture was not fetched with the page');
  assert.equal(unfurl.imageState(IMG), 'good');
});

test('a picture the site answers 404 for is bad, and stays bad after the one-minute refusal cache lets it go', async () => {
  imageAnswer = () => answer(404, 'text/html', Buffer.from('nope'));
  unfurl.warm('https://site8636.com/');
  await settle();
  assert.equal(unfurl.imageState(IMG), 'bad');
  shift = 2 * 60 * 1000;
  assert.equal(unfurl.imageState(IMG), 'bad', 'the verdict went with the refusal cache, so the card would flip');
  assert.equal(calls.filter((u) => u === IMG).length, 1, 'asked again within ten minutes');
});

test('a verdict older than ten minutes is refreshed in the background while the old one still answers; after a day it is forgotten', async () => {
  unfurl.warm('https://site8636.com/');
  await settle();
  shift = 11 * 60 * 1000;
  imageAnswer = () => answer(404, 'text/html', Buffer.from('gone now'));
  assert.equal(unfurl.imageState(IMG), 'good', 'the old verdict did not answer while the new one was fetched');
  await settle();
  assert.equal(calls.filter((u) => u === IMG).length, 2, 'no refresh was started');
  assert.equal(unfurl.imageState(IMG), 'bad', 'the refresh did not replace the verdict');
  shift += 25 * 60 * 60 * 1000;
  assert.equal(unfurl.imageState(IMG), null);
});

test('an SVG or other non-raster answer counts as bad, and so does a fetch that throws', async () => {
  imageAnswer = () => answer(200, 'image/svg+xml', Buffer.from('<svg/>'));
  await unfurl.image(IMG);
  assert.equal(unfurl.imageState(IMG), 'bad');
  unfurl.resetForTests();
  unfurl.setResolver(async () => [{ address: '93.184.216.34', family: 4 }]);
  unfurl.setFetcher(async () => { throw new TypeError('fetch failed'); });
  await unfurl.image(IMG);
  assert.equal(unfurl.imageState(IMG), 'bad');
});

test('a picture over the size cap is bad, so its card shows words only instead of never appearing', async () => {
  imageAnswer = () => answer(200, 'image/png', Buffer.alloc(unfurl.IMAGE_MAX + 1));
  unfurl.warm('https://site8636.com/');
  await settle();
  assert.equal(unfurl.imageState(IMG), 'bad');
});

test('a passing failure (too slow, not reached, a 5xx) never turns a picture that loaded into bad; a real answer does', async () => {
  unfurl.warm('https://site8636.com/');
  await settle();
  assert.equal(unfurl.imageState(IMG), 'good');
  for (const passing of [() => answer(503, 'text/html', Buffer.from('busy')), () => { throw new TypeError('fetch failed'); }]) {
    shift += 11 * 60 * 1000;
    imageAnswer = passing;
    assert.equal(unfurl.imageState(IMG), 'good');   // starts the refresh
    await settle();
    assert.equal(unfurl.imageState(IMG), 'good', 'a passing failure took the picture away');
  }
  shift += 11 * 60 * 1000;
  imageAnswer = () => answer(404, 'text/html', Buffer.from('gone'));
  unfurl.imageState(IMG);
  await settle();
  assert.equal(unfurl.imageState(IMG), 'bad', 'CONTROL: a real answer still replaces it');
});

test('a poll that lands while warm is fetching the picture does not start a second fetch of it', async () => {
  let release;
  imageAnswer = () => new Promise((r) => { release = () => r(answer(200, 'image/png', PNG)); });
  unfurl.warm('https://site8636.com/');
  await settle();
  assert.equal(calls.filter((u) => u === IMG).length, 1, 'CONTROL: the picture fetch started');
  assert.equal(unfurl.imageState(IMG), null);
  const shared = unfurl.warmImage(IMG);
  assert.ok(shared && typeof shared.then === 'function', 'no running fetch was handed back');
  assert.equal(unfurl.warmImage(IMG), shared, 'a second ask got a different fetch');
  release();
  const got = await shared;
  assert.equal(got && got.ok, true, 'the shared fetch did not resolve to the picture');
  await settle();
  assert.equal(calls.filter((u) => u === IMG).length, 1);
  assert.equal(unfurl.imageState(IMG), 'good');
});

test('a first fetch that fails only for a moment is tried again after a minute, not ten', async () => {
  imageAnswer = () => answer(503, 'text/html', Buffer.from('busy'));
  unfurl.warm('https://site8636.com/');
  await settle();
  assert.equal(unfurl.imageState(IMG), 'bad');
  imageAnswer = () => answer(200, 'image/png', PNG);
  shift = 30 * 1000;
  unfurl.imageState(IMG);
  await settle();
  assert.equal(calls.filter((u) => u === IMG).length, 1, 'tried again within the minute');
  shift = 70 * 1000;
  unfurl.imageState(IMG);
  await settle();
  assert.equal(calls.filter((u) => u === IMG).length, 2, 'not tried again after a minute');
  assert.equal(unfurl.imageState(IMG), 'good');
  // CONTROL: a real answer (404) waits the full ten minutes.
  unfurl.resetForTests();
  unfurl.setResolver(async () => [{ address: '93.184.216.34', family: 4 }]);
  let n = 0;
  unfurl.setFetcher(async (url) => { if (url === IMG) n++; return answer(404, 'text/html', Buffer.from('gone')); });
  await unfurl.image(IMG);
  shift += 70 * 1000;
  unfurl.imageState(IMG);
  await settle();
  assert.equal(n, 1, 'a 404 was asked again after a minute');
});

test('a verdict in use is kept when the cap drops verdicts; the ones nobody reads go first', async () => {
  unfurl.setFetcher(async (url) => { calls.push(String(url)); return answer(200, 'image/png', PNG); });
  await unfurl.image(IMG);
  for (let i = 0; i < 1000; i++) {
    await unfurl.image('https://other8636.com/' + i + '.png');
    if (i % 100 === 0) assert.equal(unfurl.imageState(IMG), 'good', 'the verdict on screen went at ' + i);   // read: in use
  }
  assert.equal(unfurl.imageState(IMG), 'good', 'a verdict being read was dropped by the cap');
  assert.equal(unfurl.imageState('https://other8636.com/0.png'), null, 'CONTROL: an unread verdict was not dropped first');
});


test('a picture host whose name does not resolve for a moment is a passing failure: a good verdict stays, a first one retries in a minute', async () => {
  unfurl.warm('https://site8636.com/');
  await settle();
  assert.equal(unfurl.imageState(IMG), 'good');
  unfurl.setResolver(async () => { throw new Error('ENOTFOUND'); });
  shift += 11 * 60 * 1000;
  unfurl.imageState(IMG);
  await settle();
  assert.equal(unfurl.imageState(IMG), 'good', 'a DNS blip took a loaded picture away');
  unfurl.resetForTests();
  unfurl.setResolver(async () => { throw new Error('ENOTFOUND'); });
  await unfurl.image(IMG);
  assert.equal(unfurl.imageState(IMG), 'bad');
  let asked = 0;
  unfurl.setResolver(async () => { asked++; return [{ address: '93.184.216.34', family: 4 }]; });
  unfurl.setFetcher(async () => answer(200, 'image/png', PNG));
  shift += 70 * 1000;
  unfurl.imageState(IMG);
  await settle();
  assert.ok(asked >= 1, 'not tried again after a minute');
  assert.equal(unfurl.imageState(IMG), 'good');
});

test('warm releases the page\'s in-flight entry without waiting for its picture', async () => {
  let release;
  imageAnswer = () => new Promise((r) => { release = () => r(answer(200, 'image/png', PNG)); });
  unfurl.warm('https://site8636.com/');
  await settle();
  assert.equal(calls.filter((u) => u === IMG).length, 1, 'CONTROL: the picture is being fetched');
  // The page's preview is cached, so a second warm must start nothing; what matters is that it is not refused for being in flight.
  const before = calls.length;
  unfurl.resetForTests();
  unfurl.setResolver(async () => [{ address: '93.184.216.34', family: 4 }]);
  unfurl.setFetcher(async (url) => { calls.push(String(url)); return url === IMG ? new Promise(() => {}) : answer(200, 'text/html', Buffer.from('<head><meta property="og:title" content="T"><meta property="og:image" content="/og.png"></head>')); });
  unfurl.warm('https://site8636.com/');
  await settle();
  unfurl.resetForTests();   // the page cache is gone; only the in-flight entry could still stop a new warm
  unfurl.setResolver(async () => [{ address: '93.184.216.34', family: 4 }]);
  unfurl.setFetcher(async (url) => { calls.push(String(url)); return answer(200, 'text/html', Buffer.from('<title>x</title>')); });
  unfurl.warm('https://site8636.com/');
  await settle();
  assert.ok(calls.slice(before).filter((u) => u === 'https://site8636.com/').length >= 2, 'the page stayed in flight while its picture hung');
  release();
});

test('pictures over the byte budget push out older pictures only, never a page preview', async () => {
  const pages = [];
  unfurl.setFetcher(async (url) => {
    calls.push(String(url));
    if (/\/page\d+$/.test(url)) return answer(200, 'text/html', Buffer.from('<head><meta property="og:title" content="P"></head>'));
    return answer(200, 'image/png', Buffer.alloc(unfurl.IMAGE_MAX));   // 5 MB each
  });
  for (let i = 0; i < 5; i++) { const u = 'https://pages8636.com/page' + i; await unfurl.preview(u); pages.push(u); }
  for (let i = 0; i < 8; i++) await unfurl.image('https://pics8636.com/' + i + '.png');   // 40 MB, over the 32 MB budget
  for (const u of pages) assert.ok(unfurl.peek(u) && unfurl.peek(u).ok, 'a page preview was evicted for picture bytes: ' + u);
  assert.equal(await unfurl.image('https://pics8636.com/7.png').then((r) => r.ok), true, 'CONTROL: the newest picture is still cached');
  const before = calls.length;
  await unfurl.image('https://pics8636.com/0.png');
  assert.equal(calls.length, before + 1, 'CONTROL: the oldest picture was the one evicted (fetched again)');
});

test('at most four picture fetches run at once; the rest wait their turn', async () => {
  const releases = [];
  unfurl.setFetcher(async (url) => { calls.push(String(url)); return new Promise((r) => releases.push(() => r(answer(200, 'image/png', PNG)))); });
  const all = [];
  for (let i = 0; i < 7; i++) all.push(unfurl.warmImage('https://many8636.com/' + i + '.png'));
  await settle();
  assert.equal(calls.length, 4, 'more than four ran at once');
  releases.splice(0, 4).forEach((f) => f());
  await settle();
  assert.equal(calls.length, 7, 'the waiting fetches never ran');
  releases.forEach((f) => f());
  const got = await Promise.all(all);
  assert.ok(got.every((g) => g && g.ok), 'a queued fetch did not resolve to its picture');
});

test('a browser asking for a picture whose background fetch is still waiting for a slot gets it fetched at once', async () => {
  const hung = [];
  unfurl.setFetcher(async (url) => { calls.push(String(url)); if (/\/slot\d\.png$/.test(url)) return new Promise((r) => hung.push(r)); return answer(200, 'image/png', PNG); });
  for (let i = 0; i < 4; i++) unfurl.warmImage('https://slots8636.com/slot' + i + '.png');
  const queued = unfurl.warmImage(IMG);   // waits for a slot
  await settle();
  assert.equal(calls.filter((u) => u === IMG).length, 0, 'CONTROL: the background fetch is still waiting');
  const now = unfurl.warmImage(IMG, { now: true });
  const got = await Promise.race([now, new Promise((r) => setTimeout(() => r('waited'), 500))]);
  assert.notEqual(got, 'waited', 'the browser waited behind the background queue for the same picture');
  assert.equal(got && got.ok, true);
  hung.forEach((r) => r(answer(200, 'image/png', PNG)));
  assert.equal((await queued) && (await queued).ok, true, 'the queued turn did not answer with the same fetch');
  assert.equal(calls.filter((u) => u === IMG).length, 1, 'the picture was fetched twice');
});

test('at the 200-entry count cap a picture entry goes before a page preview', async () => {
  unfurl.setFetcher(async (url) => (/\/page\d+$/.test(url) ? answer(200, 'text/html', Buffer.from('<head><meta property="og:title" content="P"></head>')) : answer(200, 'image/png', PNG)));
  const pages = [];
  for (let i = 0; i < 50; i++) { const u = 'https://count8636.com/page' + i; await unfurl.preview(u); pages.push(u); }
  for (let i = 0; i < 200; i++) await unfurl.image('https://count8636.com/' + i + '.png');
  for (const u of pages) assert.ok(unfurl.peek(u), 'a page preview was dropped by the count cap for a picture: ' + u);
});

test('a read does not refresh a good verdict (the browser drawing it does); a bad one it does', async () => {
  unfurl.warm('https://site8636.com/');
  await settle();
  shift = 11 * 60 * 1000;
  const before = calls.filter((u) => u === IMG).length;
  assert.equal(unfurl.imageState(IMG, { refreshGood: false }), 'good');
  await settle();
  assert.equal(calls.filter((u) => u === IMG).length, before, 'a read refreshed a good verdict');
  imageAnswer = () => answer(404, 'text/html', Buffer.from('gone'));
  unfurl.resetForTests();
  unfurl.setResolver(async () => [{ address: '93.184.216.34', family: 4 }]);
  unfurl.setFetcher(async (url) => { calls.push(String(url)); return imageAnswer(); });
  await unfurl.image(IMG);
  shift += 11 * 60 * 1000;
  const b2 = calls.filter((u) => u === IMG).length;
  unfurl.imageState(IMG, { refreshGood: false });
  await settle();
  assert.equal(calls.filter((u) => u === IMG).length, b2 + 1, 'a stale bad verdict was not refreshed by a read');
});
