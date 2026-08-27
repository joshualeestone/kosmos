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
    /* 🔑 paintThreadInto now routes the room through pinToBottom, so the pin
       must be IN SCOPE here. Without it every arm below dies on a
       ReferenceError, which reads like nine broken behaviours instead of one
       missing function. pageFnSource asserts if it ever vanishes. */
    pageFnSource('pinToBottom'),
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
    _imgs: [],
    get clientHeight() { return VIEW; },
    get scrollHeight() { return Math.max(VIEW, this._rows * ROW); },
    get scrollTop() { return this._top; },
    set scrollTop(v) {
      this._top = Math.max(0, Math.min(v, Math.max(0, this.scrollHeight - this.clientHeight)));
    },
    // 🔑 IMAGES THAT ARE NOT DONE YET. A bare pin measures scrollHeight at the
    // moment of the write; pinToBottom re-pins when they finish. Without this
    // the fixture cannot tell the two apart, which is why the first version of
    // this file passed against a page that still bounced Josh.
    get imgs() { return this._imgs; },
    querySelectorAll() { return this._imgs; },
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

/* ── Josh, 2026-08-27 11:03, after the first fix shipped in 0.5.78 ───────────
   "It bounces me up after I send the message. I can't see my message. It also
   does this if the agent starts typing."

   🛑 MY FIRST FIX RESTORED A READER WHO HAD SCROLLED UP AND LEFT THE PIN WEAK.
   It set `scrollTop = scrollHeight` directly, where setThread has used
   pinToBottom since #1037. ROWS ARE NOT THEIR FINAL HEIGHT AT THE MOMENT OF THE
   WRITE: an image has no height until it loads, so a single jump lands part way
   up and the reader is left mid-thread looking at older messages.

   ⭐ That is ONE cause under all three of his surviving triggers -- send, agent
   typing, and the relabel tick -- because every one of them arrives at the pin.
   The bug I fixed in the morning and the bug he still saw were different halves
   of the same function. */
test('a pin that lands before the rows finish growing must RE-PIN, not strand the reader', () => {
  const paint = loadPaint();
  const box = makeBox();

  // A late image: not complete at write time, and it will add height afterwards.
  let fire = null;
  box._imgs = [{
    complete: false,
    addEventListener: (ev, fn) => { if (ev === 'load') fire = fn; },
  }];

  paintRows(paint, box, 50, true);
  const pinnedShort = box.scrollTop;
  assert.equal(pinnedShort, bottomOf(50), 'it did not pin at all');

  // The picture arrives and the thread grows underneath the reader.
  box._rows = 60;
  assert.ok(fire, 'pinToBottom did not register a listener, so nothing can re-pin');
  fire();

  assert.equal(box.scrollTop, bottomOf(60),
    'THE READER WAS LEFT PART WAY UP AFTER THE CONTENT GREW. That is exactly what Josh reports: '
    + 'pinned to a bottom that had not finished existing.');
});

test('CONTROL: a reader who moved after the pin is NOT dragged down by a late image', () => {
  /* Without this the fix above is satisfied by something that yanks anybody to
     the bottom whenever a picture loads, which is the #1037 defect inverted. */
  const paint = loadPaint();
  const box = makeBox();
  let fire = null;
  box._imgs = [{ complete: false, addEventListener: (ev, fn) => { if (ev === 'load') fire = fn; } }];
  paintRows(paint, box, 50, true);
  box.scrollTop = 400;            // the person scrolls up after the pin
  box._rows = 60;
  fire();
  assert.equal(box.scrollTop, 400, 'a late image dragged a reader who had moved away');
});

test('CONTROL: a late image from a DIFFERENT room does not move the reader', () => {
  /* 🔑 THIS ARM EXISTS BECAUSE I CHANGED THAT GUARD. pinToBottom keyed on
     `__lastThread`; the room stamps `__lastRoom`, so the room passed the guard
     only because `undefined !== undefined` is false. I generalised it to read
     whichever field the box carries, and changed code with no test is the thing
     I have spent today objecting to in other people's work. */
  const paint = loadPaint();
  const box = makeBox();
  let fire = null;
  box._imgs = [{ complete: false, addEventListener: (ev, fn) => { if (ev === 'load') fire = fn; } }];
  box.__lastRoom = 'room-A';
  paintRows(paint, box, 50, true);
  const landed = box.scrollTop;

  box.__lastRoom = 'room-B';   // the person opened another project
  box._rows = 60;
  fire();

  assert.equal(box.scrollTop, landed,
    "a picture from the PREVIOUS room re-pinned a reader who has since opened another one");
});
