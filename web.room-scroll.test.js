'use strict';

/**
 * Where a repaint of the PROJECT ROOM leaves the reader.
 *
 * 🛑 THE BUG THIS PINS, in Josh's words (2026-08-26 22:00, the scroll item):
 * posting a message bounces him up the thread, so does an agent starting to
 * type, so does a ~30s tick. Three triggers, one cause, and the cause is not a
 * scroll line: `setLive` replaces innerHTML, the box empties, scrollHeight
 * collapses and the browser CLAMPS scrollTop to 0. The agent thread has put the
 * reader back since #1037. The room, painted by a different function, never did.
 *
 * ⭐ THE FIXTURE IS THE INSTRUMENT. `makeBox` CLAMPS, because the clamp is the
 * defect. A container that accepted any scrollTop would pass every case in this
 * file with the product still broken, which is the same trap web.thread-scroll
 * documents. Borrowed deliberately rather than reinvented.
 *
 *   node --test web.room-scroll.test.js
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const nodePath = require('node:path');

function pageFnSource(name) {
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const script = raw.match(/<script>([\s\S]*?)<\/script>/)[1];
  let start = script.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' vanished from the page');
  let depth = 0;
  for (let k = script.indexOf('{', start); k < script.length; k += 1) {
    if (script[k] === '{') depth += 1;
    else if (script[k] === '}') { depth -= 1; if (depth === 0) return script.slice(start, k + 1); }
  }
  throw new Error('could not find the end of ' + name);
}

function loadPaint() {
  const raw = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
  const slack = raw.match(/const THREAD_BOTTOM_SLACK = \d+;/);
  assert.ok(slack, 'THREAD_BOTTOM_SLACK vanished; this test is now checking nothing');
  // eslint-disable-next-line no-new-func
  return new Function([
    slack[0],
    pageFnSource('setLive'),
    pageFnSource('paintThreadInto'),
    'return paintThreadInto;',
  ].join('\n'))();
}

const ROW = 40;
const VIEW = 240;

function makeBox() {
  return {
    _rows: 0,
    _top: 0,
    get clientHeight() { return VIEW; },
    get scrollHeight() { return Math.max(VIEW, this._rows * ROW); },
    get scrollTop() { return this._top; },
    set scrollTop(v) {
      this._top = Math.max(0, Math.min(v, Math.max(0, this.scrollHeight - this.clientHeight)));
    },
    set innerHTML(h) {
      /* The mover, modelled: the box empties, then refills. Whatever the reader
         was looking at is clamped against the new height, exactly as a browser
         does it. */
      this._rows = 0;
      this.scrollTop = this._top;
      this._rows = (h.match(/ROW/g) || []).length;
      this.scrollTop = this._top;
    },
  };
}

const rows = (n) => 'ROW'.repeat(n);
const bottomOf = (n) => n * ROW - VIEW;
const NOTE = '<p class="fhint">Nothing here yet.</p>';

/* keyChanged=true means the POSTS changed; filtering=false means no search. */
const paintRows = (paint, box, n, keyChanged) => paint(box, rows(n), true, keyChanged, false);

test('CONTROL: the fixture actually clamps, so an absence below means something', () => {
  /* 🔑 Without this the whole file could pass against a box that never moved
     anybody, which would say "I found no bounce" and "I cannot see a bounce" in
     the same green tick. */
  const box = makeBox();
  box.innerHTML = rows(50);
  box.scrollTop = 900;
  assert.equal(box.scrollTop, 900, 'could not park a reader at 900');
  box.innerHTML = NOTE;
  assert.equal(box.scrollTop, 0, 'the fixture did not clamp, so it cannot reproduce the defect');
});

test('opening a room lands on the newest post', () => {
  const paint = loadPaint();
  const box = makeBox();
  paintRows(paint, box, 50, true);
  assert.equal(box.scrollTop, bottomOf(50));
});

test("JOSH'S BOUNCE: a relabel repaint must not throw a reader to the top", () => {
  /* 🛑 THE REPORTED DEFECT. The list is unchanged (keyChanged=false) but the
     markup grew: an unanswered marker, a delivery verdict, pjWhen re-wording.
     Before the fix the write clamped him to 0 and nothing put him back. */
  const paint = loadPaint();
  const box = makeBox();
  paintRows(paint, box, 50, true);
  box.scrollTop = 900;
  assert.equal(box.scrollTop, 900, 'could not park a reader at 900');

  for (let tick = 0; tick < 3; tick += 1) {
    paint(box, rows(50) + '<i>' + tick + '</i>', true, false, false);
    assert.equal(box.scrollTop, 900,
      `tick ${tick + 1} moved the reader: a repaint that is not a new post must leave them put`);
  }
});

test('a flap through a note leaves the reader where they were', () => {
  /* The room's not-a-list arms: an unreadable record, an empty search, a project
     with no agents. Each collapses the box; the rows come back a poll later. */
  const paint = loadPaint();
  const box = makeBox();
  paintRows(paint, box, 50, true);
  box.scrollTop = 900;
  paint(box, NOTE, false, false, false);
  paintRows(paint, box, 50, false);
  assert.equal(box.scrollTop, 900, 'the note overwrote the remembered posture with its own clamped zero');
});

test('CONTROL: a reader ON the floor still follows the tail', () => {
  /* Without this, every assertion above is also true of a room that follows
     nothing at all, which is a worse product than the bug. */
  const paint = loadPaint();
  const box = makeBox();
  paintRows(paint, box, 50, true);
  paint(box, rows(50) + 'ROW', true, false, false);
  assert.equal(box.scrollTop, bottomOf(51), 'someone at the bottom stopped being shown new lines');
});

test('CONTROL: a new post still lands on the newest row', () => {
  const paint = loadPaint();
  const box = makeBox();
  paintRows(paint, box, 50, true);
  box.scrollTop = 900;
  paintRows(paint, box, 51, true);
  assert.equal(box.scrollTop, bottomOf(51));
});

test('a FILTERED paint never scrolls, it restores', () => {
  /* Searching is reading, not following. The person stays where they are. */
  const paint = loadPaint();
  const box = makeBox();
  paintRows(paint, box, 50, true);
  box.scrollTop = 900;
  paint(box, rows(50) + '<i>x</i>', true, false, true);
  assert.equal(box.scrollTop, 900);
});
