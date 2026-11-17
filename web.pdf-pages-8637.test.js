'use strict';
/**
 * kosmos#8637, the page half: the file preview's arrows for a PDF with more than one page. pvPdfPageCount asks the
 * board's preview route for the count with a HEAD (only the three preview routes, written out); pvPdfPager turns the
 * note under the page into "Page 1 of 3" between a previous and a next arrow, flips by the arrows, by back.pvFlip (the
 * arrow keys) and by a sideways touch swipe, and leaves a one-page PDF (or a count the board cannot give) as it was.
 * The routes are server.pdf-pages-8637.test.js.
 *
 *   node --test web.pdf-pages-8637.test.js
 */
require('./test-support/tmpscope'); // the temp data root below, removed when this file exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));

/* Just enough of an element for these three functions: children, text, attributes, listeners, replaceWith. */
function el(tag) {
  const e = {
    tag, className: '', textContent: '', alt: '', src: '', disabled: false, dataset: {}, style: {}, attrs: {}, children: [], parent: null, on: {},
    setAttribute(k, v) { e.attrs[k] = String(v); },
    getAttribute(k) { return k in e.attrs ? e.attrs[k] : null; },
    addEventListener(type, fn) { (e.on[type] = e.on[type] || []).push(fn); },
    fire(type, ev) { for (const fn of e.on[type] || []) fn(ev || {}); },
    append(...kids) { for (const k of kids) { if (k.parent) k.parent.children.splice(k.parent.children.indexOf(k), 1); k.parent = e; e.children.push(k); } },
    appendChild(k) { e.append(k); return k; },
    replaceWith(other) { const p = e.parent; const i = p.children.indexOf(e); p.children[i] = other; other.parent = p; e.parent = null; },
    contains(x) { for (let n = x; n; n = n.parent) if (n === e) return true; return false; },
    focus() { DOC.activeElement = e; },
  };
  return e;
}
const DOC = { activeElement: null, root: null, createElement: el, contains(x) { return DOC.root ? DOC.root.contains(x) : false; } };

function lift(fetchImpl) {
  const fetches = [];
  const fetchFn = (url, init) => { fetches.push([url, init && init.method]); return fetchImpl(url, init); };
  // eslint-disable-next-line no-new-func
  const fns = new Function('fetch', 'document', "'use strict';\n" + page.lift(SCRIPT, 'pvPdfPageCount') + '\n' + page.lift(SCRIPT, 'pvPdfPageUrl') + '\n'
    + page.lift(SCRIPT, 'pvPdfPager') + '\nreturn { pvPdfPageCount, pvPdfPageUrl, pvPdfPager };')(fetchFn, DOC);
  return { ...fns, fetches };
}
const answer = (status, pages) => async () => ({ ok: status >= 200 && status < 300, headers: { get: (k) => (k === 'x-kosmos-pdf-pages' && pages !== undefined ? String(pages) : null) } });
const ATT = '/api/attachment/' + 'a'.repeat(24) + '/preview';
const AGENT = '/api/agent/ava/files/preview?name=report.pdf';
const PROJECT = '/api/project/p1/file-preview?name=sub%2Freport.pdf';

test('pvPdfPageCount: each of the three preview routes is asked with a HEAD at the same address', async () => {
  for (const url of [ATT, AGENT, PROJECT]) {
    const { pvPdfPageCount, fetches } = lift(answer(200, 3));
    assert.equal(await pvPdfPageCount(url), 3, url);
    assert.deepEqual(fetches, [[url, 'HEAD']]);
  }
});

test('pvPdfPageCount: one page, no header, a refusal, a failed fetch and a junk count are 0; any other address is never asked', async () => {
  for (const [impl, why] of [[answer(200, 1), 'one page'], [answer(200), 'no header'], [answer(404, 3), 'refused'], [async () => { throw new Error('offline'); }, 'failed'], [answer(200, 'x'), 'junk'], [answer(200, 2.5), 'fraction']]) {
    const { pvPdfPageCount } = lift(impl);
    assert.equal(await pvPdfPageCount(ATT), 0, why);
  }
  for (const url of ['/api/attachment/' + 'a'.repeat(24), '/api/accounts', 'https://example.com/x.pdf', '/api/agent/ava/files/preview?name=a&page=2', ATT + '?x=1']) {
    const { pvPdfPageCount, fetches } = lift(answer(200, 3));
    assert.equal(await pvPdfPageCount(url), 0, url);
    assert.equal(fetches.length, 0, 'asked ' + url);
  }
});

test('pvPdfPageUrl: page 1 is the address itself; later pages add page= with the right joiner', () => {
  const { pvPdfPageUrl } = lift(answer(200, 3));
  assert.equal(pvPdfPageUrl(ATT, 1), ATT);
  assert.equal(pvPdfPageUrl(ATT, 2), ATT + '?page=2');
  assert.equal(pvPdfPageUrl(AGENT, 3), AGENT + '&page=3');
});

/* A viewer as pvOpen builds it for a PDF: the stage holding the page and the note "The first page". */
function viewer() {
  const back = el('div');
  const stage = el('div');
  const img = el('img');
  img.src = ATT;
  const note = el('p');
  note.className = 'pv-note';
  note.textContent = 'The first page';
  stage.append(img, note);
  back.append(stage);
  DOC.root = back;
  DOC.activeElement = null;
  return { back, stage, img, note };
}
const settle = () => new Promise((r) => setImmediate(r));
const pause = () => new Promise((r) => setTimeout(r, 200));   // past the pager's 150 ms wait before it asks for a picture

test('pvPdfPager: three pages get arrows and "Page 1 of 3"; the arrows and pvFlip flip within 1..3', async () => {
  const { pvPdfPager } = lift(answer(200, 3));
  const { back, stage, img, note } = viewer();
  pvPdfPager(back, stage, img, note, { preview: ATT, name: 'three.pdf' });
  await settle();
  const bar = stage.children[1];
  assert.equal(bar.className, 'pv-pager');
  const [prev, mid, next] = bar.children;
  assert.equal(mid, note);
  assert.equal(note.textContent, 'Page 1 of 3');
  assert.equal(note.getAttribute('aria-live'), 'polite');
  assert.equal(prev.getAttribute('aria-label'), 'Previous page');
  assert.equal(next.getAttribute('aria-label'), 'Next page');
  assert.equal(prev.disabled, true);
  assert.equal(next.disabled, false);
  assert.equal(img.src, ATT, 'page 1 is still the first-page address');
  img.style.opacity = '0';   // as pvOpen's error handler leaves it after a later page failed
  next.fire('click');
  assert.equal(note.textContent, 'Page 2 of 3', 'the count waits for the picture');
  assert.equal(img.src, ATT, 'the picture was asked for before the flipping paused');
  assert.equal(img.style.opacity, '.4', 'the old picture is not dimmed while page 2 is asked for');
  await pause();
  img.fire('load');
  assert.equal(img.style.opacity, '', 'the next page stayed hidden after it loaded');
  assert.equal(img.src, ATT + '?page=2');
  assert.equal(note.textContent, 'Page 2 of 3');
  assert.equal(img.alt, 'Page 2 of three.pdf');
  assert.equal(img.dataset.pvPage, '2');
  assert.equal(prev.disabled, false);
  back.pvFlip(1);
  assert.equal(note.textContent, 'Page 3 of 3');
  assert.equal(next.disabled, true);
  await pause();
  assert.equal(img.src, ATT + '?page=3');
  back.pvFlip(1);
  assert.equal(note.textContent, 'Page 3 of 3', 'flipped past the last page');
  back.pvFlip(-5);
  assert.equal(note.textContent, 'Page 3 of 3', 'a jump past the first page was taken');
  prev.fire('click'); prev.fire('click');
  assert.equal(note.textContent, 'Page 1 of 3');
  await pause();
  assert.equal(img.src, ATT, 'back on page 1 is the first-page address again');
});

test('pvPdfPager: an arrow that turns off under the focus hands it to the other arrow', async () => {
  const { pvPdfPager } = lift(answer(200, 2));
  const { back, stage, img, note } = viewer();
  pvPdfPager(back, stage, img, note, { preview: AGENT, name: 'two.pdf' });
  await settle();
  const [prev, , next] = stage.children[1].children;
  next.focus();
  next.fire('click');
  assert.equal(next.disabled, true);
  assert.equal(DOC.activeElement, prev);
  prev.fire('click');
  assert.equal(DOC.activeElement, next);
});

test('pvPdfPager: a sideways touch swipe flips; a short, a mostly-vertical and a mouse drag do not', async () => {
  const { pvPdfPager } = lift(answer(200, 3));
  const { back, stage, img, note } = viewer();
  pvPdfPager(back, stage, img, note, { preview: ATT, name: 'three.pdf' });
  await settle();
  const swipe = (type, x0, y0, x1, y1) => { img.fire('pointerdown', { pointerType: type, clientX: x0, clientY: y0 }); img.fire('pointerup', { pointerType: type, clientX: x1, clientY: y1 }); };
  swipe('touch', 300, 100, 200, 110);
  assert.equal(note.textContent, 'Page 2 of 3', 'a leftward swipe did not go on');
  swipe('touch', 200, 100, 300, 100);
  assert.equal(note.textContent, 'Page 1 of 3', 'a rightward swipe did not go back');
  swipe('touch', 300, 100, 275, 100);
  swipe('touch', 300, 100, 240, 300);
  swipe('mouse', 300, 100, 100, 100);
  assert.equal(note.textContent, 'Page 1 of 3');
  img.fire('pointerdown', { pointerType: 'touch', clientX: 300, clientY: 100 }); img.fire('pointercancel'); img.fire('pointerup', { pointerType: 'touch', clientX: 100, clientY: 100 });
  assert.equal(note.textContent, 'Page 1 of 3', 'a cancelled touch flipped');
  assert.equal(img.style.touchAction, 'pan-y pinch-zoom');
});

test('pvPdfPager: a held arrow key flips the count through every page but asks for only the page it stops on', async () => {
  const { pvPdfPager } = lift(answer(200, 5));
  const { back, stage, img, note } = viewer();
  const asked = [];
  let src = img.src;
  Object.defineProperty(img, 'src', { get: () => src, set: (v) => { src = v; asked.push(v); } });
  pvPdfPager(back, stage, img, note, { preview: ATT, name: 'five.pdf' });
  await settle();
  for (let i = 0; i < 4; i++) back.pvFlip(1);
  assert.equal(note.textContent, 'Page 5 of 5');
  await pause();
  assert.deepEqual(asked, [ATT + '?page=5'], 'pages passed on the way were asked for');
});

test('pvPdfPager: one page, an unknown count, or a viewer closed before the answer leaves it as it was', async () => {
  for (const [impl, closeFirst, why] of [[answer(200, 1), false, 'one page'], [answer(200), false, 'no count'], [answer(200, 3), true, 'closed']]) {
    const { pvPdfPager } = lift(impl);
    const { back, stage, img, note } = viewer();
    pvPdfPager(back, stage, img, note, { preview: ATT, name: 'x.pdf' });
    if (closeFirst) DOC.root = null;
    await settle();
    assert.equal(note.textContent, 'The first page', why);
    assert.equal(stage.children[1], note, why + ': the note was replaced');
    assert.equal(typeof back.pvFlip, 'undefined', why + ': the keys were given a flip');
  }
});

test('the page wires it: pvOpen calls the pager for a PDF only, the keys call pvFlip, Tab reaches the arrows, and a later page that fails keeps the viewer', () => {
  const open = page.lift(SCRIPT, 'pvOpen');
  assert.match(open, /if \(a\.kind === 'pdf' && note\) pvPdfPager\(back, stage, img, note, a\);/);
  assert.match(open, /img\.dataset\.pvPage !== '1' && note\) \{ img\.style\.opacity = '0'; note\.textContent = 'Kosmos could not draw page '/);
  assert.match(SCRIPT, /\(e\.key === 'ArrowLeft' \|\| e\.key === 'ArrowRight'\) && typeof back\.pvFlip === 'function'/);
  assert.match(SCRIPT, /back\.pvFlip\(e\.key === 'ArrowRight' \? 1 : -1\)/);
  assert.match(SCRIPT, /\.pv-pg:not\(:disabled\), \.pv-acts button/);
  assert.match(open, /\.pv-tabs, \.pv-pager, #pv-x/, 'a click on the arrows closes the viewer');
});

/* Review 2: pvPdfPageCount asks only addresses of the three exact shapes, so a record whose preview address drifted
   (a parameter added, a route renamed) would lose the arrows with nothing failing. These build the addresses the way
   the page and the board really do (filesPvOpen's record; attachments.rowField's preview) and require that each is
   one the count is asked for. */
function filesRecord(where, name) {
  const PV_ATTS = new Map();
  // eslint-disable-next-line no-new-func
  const filesPvOpen = new Function('PV_ATTS', 'pvOpen', 'fetch', 'document', 'asSentence', 'onWindows', 'kplusDownload', 'kplusSayer',
    "'use strict';\nconst FILES_PV_ID = 'files-preview';\nlet FILES_PV_AT = null;\n" + page.lift(SCRIPT, 'filesPvOpen') + '\nreturn filesPvOpen;')(
    PV_ATTS, () => true, async () => ({ ok: false }), { getElementById: () => null }, (s) => s, () => false, () => {}, () => () => {});
  const row = { dataset: { doc: name }, closest: () => ({ id: 'd-files-list' }), querySelector: (sel) => (sel === '.pj-doc-w' ? { textContent: '12 KB' } : null) };
  assert.equal(filesPvOpen(row, where, { button: 0 }), true);
  return PV_ATTS.get('files-preview');
}

test('the preview addresses the page and board really build for a PDF are ones the count is asked for', async () => {
  const urls = [filesRecord({ agent: 'ava b' }, 'Spring lookbook.pdf').preview, filesRecord({ project: 'p-1' }, 'reports/Q3 deck.pdf').preview];
  const os = require('node:os');
  process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'pdfpages-web-'));
  const attachments = require('./engine/attachments');
  urls.push(attachments.rowField({ id: 'e'.repeat(24), name: 'deck.pdf', type: 'application/pdf', kind: 'pdf', size: 1024, file: '/nonexistent/deck.pdf' }).preview);
  for (const url of urls) {
    assert.equal(typeof url, 'string', 'no preview address was built');
    const { pvPdfPageCount, fetches } = lift(answer(200, 3));
    assert.equal(await pvPdfPageCount(url), 3, url + ' is not asked for its count, so its PDF gets no arrows');
    assert.deepEqual(fetches, [[url, 'HEAD']]);
  }
});
