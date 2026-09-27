'use strict';
/* #718 state 3: tick's failure branch writes the cannot-read / signed-out card into #grid and
   #alist only when it changes, so the five-second poll does not rebuild the card's button under
   a keyboard's focus. The browser check (render-device-signed-out-401-718.js, Scenario 1b) shows
   the keep arm in a real page; this runs the page's own loop against fake containers so both arms
   are in the fast suite. The loop is cut out of web/index.html, not restated here. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const nodePath = require('path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const OPEN = "for (const id of ['grid', 'alist']) {";
const start = PAGE.indexOf(OPEN);
const end = PAGE.indexOf('\n    }\n', start);
const LOOP = start >= 0 && end > start ? PAGE.slice(start, end + '\n    }'.length) : '';

/* A container whose innerHTML write replaces its first child, as the DOM does, and counts writes. */
function box() {
  const b = { writes: 0, html: '', firstElementChild: null };
  Object.defineProperty(b, 'innerHTML', {
    get() { return b.html; },
    set(v) { b.writes += 1; b.html = v; b.firstElementChild = { from: v }; },
  });
  return b;
}

function paint(boxes, boardErr) {
  // eslint-disable-next-line no-new-func
  new Function('document', 'boardErr', LOOP)({ getElementById: (id) => boxes[id] }, boardErr);
}

test('#718 the failure-card loop is found in web/index.html', () => {
  assert.ok(LOOP.includes('box.__failNode'), 'the loop was not cut out of the page: ' + LOOP.slice(0, 80));
  assert.ok(LOOP.endsWith('box.__failNode = box.firstElementChild;\n    }'), 'the cut ends early: ' + LOOP.slice(-80));
});

test('#718 the same card on the next poll is not rewritten, so its button keeps focus', () => {
  const boxes = { grid: box(), alist: box() };
  paint(boxes, '<div>signed out</div>');
  const node = boxes.grid.firstElementChild;
  paint(boxes, '<div>signed out</div>');
  assert.strictEqual(boxes.grid.writes, 1);
  assert.strictEqual(boxes.alist.writes, 1);
  assert.strictEqual(boxes.grid.firstElementChild, node, 'the button node was replaced');
});

test('#718 a different card is written', () => {
  const boxes = { grid: box(), alist: box() };
  paint(boxes, '<div>signed out</div>');
  paint(boxes, '<div>cannot read</div>');
  assert.strictEqual(boxes.grid.writes, 2);
  assert.strictEqual(boxes.grid.html, '<div>cannot read</div>');
});

test('#718 the same card is written again once another paint replaced the node', () => {
  const boxes = { grid: box(), alist: box() };
  paint(boxes, '<div>signed out</div>');
  boxes.grid.innerHTML = '<div>agents</div>'; // the success path's own write
  paint(boxes, '<div>signed out</div>');
  assert.strictEqual(boxes.grid.html, '<div>signed out</div>');
  assert.strictEqual(boxes.grid.writes, 3);
  assert.strictEqual(boxes.alist.writes, 1, 'alist was not repainted, so it is kept');
});
