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
  assert.equal(unfurl.warmImage(IMG), null, 'a second fetch was started while the first ran');
  release();
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
