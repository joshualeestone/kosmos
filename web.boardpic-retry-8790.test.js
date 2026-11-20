'use strict';
/**
 * kosmos#8790: a browser that sends no Sec-Fetch-Site (Safari before 16.4) is refused the board's own pictures by the
 * computer's connector, because an image load cannot carry X-Kosmos-Board-Page. The page retries such a picture ONCE
 * through its own fetch (which adds the header) and shows it from that reply. Runs the page's real handler, lifted from
 * web/index.html, against fake elements and a fetch that records what it was asked. The page's location is fixed at
 * http://board.test here.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const { scriptOf, liftAll, liftConst } = require('./test-support/page');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = scriptOf(PAGE);

function el(tag, attrs) {
  const a = Object.assign({}, attrs);
  const fired = [];
  return {
    nodeType: 1, tagName: tag, fired,
    getAttribute: (k) => (k in a ? a[k] : null),
    setAttribute: (k, v) => { a[k] = String(v); },
    dispatchEvent: (ev) => { fired.push(ev.type); return true; },
    attrs: a,
  };
}
function errorEvent(target) {
  const ev = { target, stopped: false, stopImmediatePropagation() { this.stopped = true; } };
  return ev;
}

function page(reply) {
  const asked = [];
  const revoked = [];
  let n = 0;
  const ctx = {
    location: { href: 'http://board.test/board', origin: 'http://board.test' },
    URL: Object.assign(function (u, b) { return new URL(u, b); }, {
      createObjectURL: () => 'blob:http://board.test/' + (++n),
      revokeObjectURL: (u) => revoked.push(u),
    }),
    Event: function (type) { this.type = type; },
    fetch: (u) => { asked.push(u); return Promise.resolve(reply(u)); },
    document: { addEventListener() {} },
  };
  ctx.URL.prototype = URL.prototype;
  vm.runInNewContext(liftConst(SCRIPT, 'BOARD_PIC_BLOBS') + '\n' + liftAll(SCRIPT, ['boardPicUrl', 'boardPicShow', 'boardPicFailed'])
    + '\nthis.boardPicFailed = boardPicFailed; this.BOARD_PIC_BLOBS = BOARD_PIC_BLOBS;', ctx);
  return { ctx, asked, revoked };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const pic = () => ({ ok: true, blob: () => Promise.resolve({ type: 'image/webp' }) });
const refused = () => ({ ok: false, status: 401, blob: () => Promise.resolve({ type: 'application/json' }) });

test('kosmos#8790: a failed board picture is fetched once through the page fetch and shown from the reply', async () => {
  const p = page(pic);
  const img = el('IMG', { src: '/api/agent/max/avatar?v=3' });
  const ev = errorEvent(img);
  p.ctx.boardPicFailed(ev);
  assert.equal(ev.stopped, true, 'not failed yet: the other error listeners wait for the retry');
  await settle();
  assert.deepEqual(p.asked, ['http://board.test/api/agent/max/avatar?v=3']);
  assert.match(img.attrs.src, /^blob:/);
  assert.deepEqual(img.fired, []);
});

test('kosmos#8790: an SVG <image> avatar is retried by its href', async () => {
  const p = page(pic);
  const im = el('image', { href: '/api/agent/max/avatar' });
  p.ctx.boardPicFailed(errorEvent(im));
  await settle();
  assert.match(im.attrs.href, /^blob:/);
});

test('kosmos#8790: when the retry is refused too, the error is raised again and passes untouched the second time', async () => {
  const p = page(refused);
  const img = el('IMG', { src: '/api/link-preview/image/abc' });
  p.ctx.boardPicFailed(errorEvent(img));
  await settle();
  assert.deepEqual(img.fired, ['error'], 'the failure reaches every other listener (kosmos#8636 takes the box away)');
  assert.equal(img.attrs.src, '/api/link-preview/image/abc', 'the picture is left as it was');
  const again = errorEvent(img);
  p.ctx.boardPicFailed(again);
  assert.equal(again.stopped, false, 'retried once already: this failure is real and is not stopped');
  assert.equal(p.asked.length, 1, 'and it is not fetched a second time');
});

test('kosmos#8790: a reply that is not a picture counts as a failure', async () => {
  const p = page(() => ({ ok: true, blob: () => Promise.resolve({ type: 'text/html' }) }));
  const img = el('IMG', { src: '/api/you/avatar?v=1' });
  p.ctx.boardPicFailed(errorEvent(img));
  await settle();
  assert.deepEqual(img.fired, ['error']);
  assert.equal(img.attrs.src, '/api/you/avatar?v=1');
});

test('kosmos#8790: pictures from another origin, non-/api/ paths and non-pictures are not touched', async () => {
  const p = page(pic);
  for (const e of [
    el('IMG', { src: 'https://other.kosmos.test/api/agent/max/avatar' }),
    el('IMG', { src: '/brand/logo.png' }),
    el('IMG', { src: 'blob:http://board.test/9' }),
    el('IMG', {}),
    el('VIDEO', { src: '/api/files/x.mp4' }),
  ]) {
    const ev = errorEvent(e);
    p.ctx.boardPicFailed(ev);
    assert.equal(ev.stopped, false);
  }
  p.ctx.boardPicFailed({ target: null, stopImmediatePropagation() { throw new Error('touched'); } });
  await settle();
  assert.deepEqual(p.asked, []);
});

test('kosmos#8790: a picture changed while its retry ran keeps the new one; a new address is retried again', async () => {
  const p = page(pic);
  const img = el('IMG', { src: '/api/agent/max/avatar?t=1' });
  p.ctx.boardPicFailed(errorEvent(img));
  img.attrs.src = '/api/agent/max/avatar?t=2';
  await settle();
  assert.equal(img.attrs.src, '/api/agent/max/avatar?t=2', 'the old reply is not shown over the new picture');
  const ev = errorEvent(img);
  p.ctx.boardPicFailed(ev);
  assert.equal(ev.stopped, true, 'the new address gets its own one retry');
  await settle();
  assert.match(img.attrs.src, /^blob:/);
});

test('kosmos#8790: the same picture on many rows is fetched once, and the store is bounded', async () => {
  const p = page(pic);
  const a = el('IMG', { src: '/api/agent/max/avatar?v=1' });
  p.ctx.boardPicFailed(errorEvent(a));
  await settle();
  const b = el('IMG', { src: '/api/agent/max/avatar?v=1' });
  p.ctx.boardPicFailed(errorEvent(b));
  assert.equal(b.attrs.src, a.attrs.src, 'shown at once from the first reply');
  assert.equal(p.asked.length, 1);
  for (let i = 0; i < 305; i++) p.ctx.boardPicFailed(errorEvent(el('IMG', { src: '/api/agent/a' + i + '/avatar' })));
  await settle();
  assert.equal(p.ctx.BOARD_PIC_BLOBS.size, 300);
  assert.equal(p.revoked.length, 6);
});

test('kosmos#8790: the handler is registered in the capture phase, before kosmos#8636 takes a failed preview away', () => {
  const mine = SCRIPT.indexOf("document.addEventListener('error', boardPicFailed, true);");
  const lpv = SCRIPT.indexOf("document.addEventListener('error', lpvImageFailed, true);");
  assert.ok(mine > -1, 'the picture retry is not registered');
  assert.ok(lpv > -1, 'kosmos#8636\'s listener moved: check the order by hand');
  assert.ok(mine < lpv, 'the retry must run first, or a preview is removed before it is retried');
  const first = SCRIPT.search(/document\.addEventListener\('error'/);
  assert.equal(first, mine, 'no other document error listener may run before the retry');
});
