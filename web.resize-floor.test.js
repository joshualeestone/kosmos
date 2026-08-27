'use strict';

/**
 * Where a RESIZE leaves the reader.
 *
 * 🛑 THE DEFECT, AND IT IS THE SECOND ONE OF ITS KIND. `holdFloorOnResize`
 * pinned with a bare `el.scrollTop = el.scrollHeight` and NOTHING corrected it.
 * `pinToBottom` makes the same assignment and then re-pins as its images
 * complete; this path assigned and hoped. That asymmetry is the bug: a pin
 * measured while layout is still moving lands SHORT, which leaves a reader
 * above the newest row, which is what being "popped back up" is.
 *
 * ⚠️ THE DOCUMENTED TRIGGER IS THE COMPOSER, not messages arriving. The call
 * site says so: this exists to hold a reader on the floor "when the composer
 * grows under them" (#1037). Josh named it himself on day one, "any time I
 * input a message, then it immediately pops back up too".
 *
 *   node --test web.resize-floor.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const nodePath = require('node:path');

function pageFnSource(name) {
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  const start = script.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' vanished from the page');
  let depth = 0;
  for (let k = script.indexOf('{', start); k < script.length; k += 1) {
    if (script[k] === '{') depth += 1;
    else if (script[k] === '}') { depth -= 1; if (depth === 0) return script.slice(start, k + 1); }
  }
  throw new Error('could not find the end of ' + name);
}

const ROW = 40;

/* ⭐ THE FIXTURE CLAMPS, because the clamp is what makes a short pin possible.
   A container that accepted any scrollTop would pass every case here with the
   product still popping. */
function makeBox(view) {
  return {
    _rows: 0,
    _top: 0,
    _view: view,
    _listeners: {},
    get clientHeight() { return this._view; },
    get scrollHeight() { return Math.max(this._view, this._rows * ROW); },
    get scrollTop() { return this._top; },
    set scrollTop(v) {
      this._top = Math.max(0, Math.min(v, Math.max(0, this.scrollHeight - this.clientHeight)));
    },
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    fireScroll() { (this._listeners.scroll || []).forEach((f) => f()); },
    querySelectorAll() { return []; },
  };
}

function load() {
  let resize = null;
  const frames = [];
  const RO = function (fn) { resize = fn; return { observe() {} }; };
  const raf = (fn) => { frames.push(fn); };
  const hold = new Function('ResizeObserver', 'requestAnimationFrame', [
    'const THREAD_BOTTOM_SLACK = 4;',
    pageFnSource('holdFloorOnResize'),
    'return holdFloorOnResize;',
  ].join('\n'))(RO, raf);
  return {
    hold,
    resize: () => resize && resize(),
    // Nothing runs a frame for us; the test says when layout has settled.
    settle: () => { const q = frames.splice(0); q.forEach((f) => f()); },
    pending: () => frames.length,
  };
}

test('CONTROL: the fixture can pin to a settled bottom, so a miss below means something', () => {
  const h = load();
  const b = makeBox(240);
  b._rows = 30;                       // 1200 tall, bottom is 960
  h.hold(b);
  h.resize();
  assert.equal(b.scrollTop, 960, 'a settled resize must land on the real bottom');
});

test('JOSH: a resize measured mid-layout lands SHORT, and the correction brings him back', () => {
  const h = load();
  const b = makeBox(240);
  b._rows = 30;
  h.hold(b);
  b.scrollTop = 960;
  b.fireScroll();                     // he is on the floor, reading the newest row

  b._rows = 10;                       // layout still moving: 400 tall
  h.resize();                         // the observer measures NOW
  assert.equal(b.scrollTop, 160, 'sanity: it pinned to the height it could see');

  b._rows = 30;                       // layout settles; the real bottom is 960 again
  assert.ok(b.scrollTop < 960, 'without the correction he is left above the newest row');
  h.settle();
  assert.equal(b.scrollTop, 960, 'the deferred correction must put him back on the floor');
});

test('CONTROL: a reader who moved away in that frame is NOT dragged down', () => {
  const h = load();
  const b = makeBox(240);
  b._rows = 30;
  h.hold(b);
  b.scrollTop = 960;
  b.fireScroll();

  b._rows = 10;
  h.resize();                         // arms a correction
  b._rows = 30;
  b.scrollTop = 100;                  // he starts reading back before the frame runs
  b.fireScroll();                     // __wasOnFloor becomes false
  h.settle();
  assert.equal(b.scrollTop, 100, 'the correction dragged a reader who had moved away');
});

test('IDEMPOTENT: a resize storm arms exactly ONE correction', () => {
  /* 🛑 THE CONSTRAINT BARON NAMED. A ResizeObserver fires repeatedly, so the
     obvious fix of calling pinToBottom from here would register listeners per
     image on every call. This arms one frame per storm and no listeners. */
  const h = load();
  const b = makeBox(240);
  b._rows = 30;
  h.hold(b);
  b.scrollTop = 960;
  b.fireScroll();
  for (let i = 0; i < 20; i += 1) h.resize();
  assert.equal(h.pending(), 1, `a storm of 20 resizes armed ${h.pending()} corrections`);
});

test('CONTROL: after the frame runs, a LATER storm can arm again', () => {
  // Otherwise the guard would fire once per page load and protect nothing after.
  const h = load();
  const b = makeBox(240);
  b._rows = 30;
  h.hold(b);
  b.scrollTop = 960;
  b.fireScroll();
  h.resize();
  h.settle();
  h.resize();
  assert.equal(h.pending(), 1, 'the arm never re-armed after its first use');
});
