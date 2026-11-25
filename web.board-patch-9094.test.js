'use strict';

/**
 * kosmos#9094: patchBoardHtml, lifted from the page and run on a small fake DOM. It must leave the container in the
 * new markup's order every time, keep the node of every piece whose agent and markup are unchanged, and move as few
 * kept nodes as possible: a row that changes place moves alone, up or down. The rendered behaviour is
 * docs/browser-checks/render-board-patch-9094.js (gated); this runs on every validation.
 *
 *   node --test web.board-patch-9094.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
const SRC = page.lift(SCRIPT, 'patchBoardHtml');

/* The fake DOM: pieces are <div data-agent="k">text</div> (keyed) or <h3>text</h3> (unkeyed), which is all the
   function reads (nodeType, outerHTML, dataset.agent, childNodes, replaceChildren, insertBefore, remove). */
let moves = 0;   // insertBefore of a node that was already in the container (a move, which detaches it)
function el(markup) {
  const m = /^<(div|h3)(?: data-agent="([^"]*)")?>([^<]*)<\/\1>$/.exec(markup);
  if (!m) throw new Error('bad piece ' + markup);
  return { nodeType: 1, outerHTML: markup, dataset: m[2] ? { agent: m[2] } : {}, parent: null,
    remove() { if (this.parent) this.parent.take(this); } };
}
function parse(html) { return (html.match(/<(div|h3)[^>]*>[^<]*<\/\1>/g) || []).map(el); }
function container() {
  return {
    childNodes: [],
    take(n) { const i = this.childNodes.indexOf(n); if (i > -1) this.childNodes.splice(i, 1); n.parent = null; },
    replaceChildren(...ns) { for (const n of this.childNodes) n.parent = null; this.childNodes = []; for (const n of ns) { n.parent = this; this.childNodes.push(n); } },
    insertBefore(n, ref) {
      if (n.parent === this) { moves += 1; this.take(n); }
      const i = ref === null ? this.childNodes.length : this.childNodes.indexOf(ref);
      if (i < 0) throw new Error('reference node is not a child');
      n.parent = this; this.childNodes.splice(i, 0, n);
    },
  };
}
const document = { createElement: () => { const t = { content: { childNodes: [] } }; Object.defineProperty(t, 'innerHTML', { set(h) { t.content.childNodes = parse(h); } }); return t; } };
const patchBoardHtml = new Function('document', 'return (' + SRC + ');')(document);

function board() {
  const box = container(); let html = null; let parts = null;
  return {
    box,
    write(next) { parts = patchBoardHtml(box, next, html, parts); html = next; },
    order() { return box.childNodes.map((n) => n.outerHTML).join(''); },
    node(agent) { return box.childNodes.find((n) => n.dataset.agent === agent); },
  };
}
const row = (a, v) => '<div data-agent="' + a + '">' + (v || a) + '</div>';

test('#9094 one changed row is replaced; every other node is kept and none moves', () => {
  const b = board(); b.write(['a', 'b', 'c', 'd'].map((x) => row(x)).join(''));
  const before = { a: b.node('a'), b: b.node('b'), d: b.node('d') };
  moves = 0;
  b.write([row('a'), row('b'), row('c', 'c working'), row('d')].join(''));
  assert.equal(b.order(), [row('a'), row('b'), row('c', 'c working'), row('d')].join(''));
  assert.ok(b.node('a') === before.a && b.node('b') === before.b && b.node('d') === before.d, 'an unchanged row was rebuilt');
  assert.equal(moves, 0, 'an unchanged row was moved');
});

test('#9094 a row moving UP moves alone', () => {
  const b = board(); b.write(['a', 'b', 'c', 'd'].map((x) => row(x)).join(''));
  const kept = ['a', 'b', 'c', 'd'].map((x) => b.node(x));
  moves = 0;
  b.write(['d', 'a', 'b', 'c'].map((x) => row(x)).join(''));
  assert.equal(b.order(), ['d', 'a', 'b', 'c'].map((x) => row(x)).join(''));
  assert.deepEqual(['a', 'b', 'c', 'd'].map((x) => b.node(x)), kept, 'a moved row was rebuilt');
  assert.equal(moves, 1, 'the rows it passed were moved too');
});

test('#9094 a row moving DOWN moves alone', () => {
  const b = board(); b.write(['a', 'b', 'c', 'd'].map((x) => row(x)).join(''));
  moves = 0;
  b.write(['b', 'c', 'd', 'a'].map((x) => row(x)).join(''));
  assert.equal(b.order(), ['b', 'c', 'd', 'a'].map((x) => row(x)).join(''));
  assert.equal(moves, 1, 'the rows it passed were moved too');
});

test('#9094 another writer\'s added child is removed; unchanged rows are kept; a repeated key writes whole', () => {
  const b = board(); b.write([row('a'), row('b')].join(''));
  const a0 = b.node('a');
  b.box.insertBefore(el('<h3>someone else</h3>'), null);   // another writer added a child
  b.write([row('a'), row('b')].join(''));
  assert.equal(b.order(), [row('a'), row('b')].join(''), 'a foreign child survived');
  assert.equal(b.node('a'), a0, 'an unchanged row was rebuilt');
  const a1 = b.node('a');
  b.write([row('a'), row('a', 'twice')].join(''));
  assert.equal(b.order(), [row('a'), row('a', 'twice')].join(''));
  assert.notEqual(b.box.childNodes[0], a1, 'a repeated key did not force a whole write');
});

test('#9094 another writer that swaps a child at the same count: its node is removed and the swapped-out row comes back', () => {
  const b = board(); b.write([row('a'), row('b'), row('c')].join(''));
  const stranger = el('<h3>someone else</h3>');
  b.box.insertBefore(stranger, b.box.childNodes[1]); b.box.take(b.box.childNodes[2]);   // b swapped out, count unchanged
  const a0 = b.node('a');
  b.write([row('a'), row('b'), row('c', 'c v2')].join(''));
  assert.equal(b.order(), [row('a'), row('b'), row('c', 'c v2')].join(''), 'the swapped-in child survived or a row is missing');
  assert.ok(!b.box.childNodes.includes(stranger));
  assert.equal(b.node('a'), a0, 'an unchanged row was rebuilt');
});

test('#9094 the write after a repeated key is right too', () => {
  const b = board(); b.write([row('a'), row('a', 'twice'), row('b')].join(''));
  b.write([row('a'), row('b')].join(''));
  assert.equal(b.order(), [row('a'), row('b')].join(''));
});

test('#9094 random sequences: order always right, unchanged pieces keep their nodes, moves stay minimal', () => {
  let seed = 9094;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const lis = (xs) => { const t = []; for (const v of xs) { let lo = 0; let hi = t.length; while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < v) lo = m + 1; else hi = m; } t[lo] = v; } return t.length; };
  for (let run = 0; run < 400; run += 1) {
    const b = board();
    let pieces = ['h3:Members', 'a', 'b', 'c', 'h3:Others', 'd', 'e'].map((x) => (x.startsWith('h3:') ? '<h3>' + x.slice(3) + '</h3>' : row(x)));
    b.write(pieces.join(''));
    for (let step = 0; step < 6; step += 1) {
      let next = pieces.slice();
      const r = rnd();
      if (r < 0.3) { const i = Math.floor(rnd() * next.length); const [x] = next.splice(i, 1); next.splice(Math.floor(rnd() * (next.length + 1)), 0, x); }
      else if (r < 0.5) { const i = Math.floor(rnd() * next.length); next[i] = next[i].replace(/>([^<]*)</, '>$1 v' + step + '<'); }
      else if (r < 0.65) next.splice(Math.floor(rnd() * (next.length + 1)), 0, row('n' + run + 's' + step));
      else if (r < 0.8 && next.length > 2) next.splice(Math.floor(rnd() * next.length), 1);
      else next = next.slice().sort(() => rnd() - 0.5);
      const prevLoose = b.box.childNodes.filter((n) => !n.dataset.agent);
      const prevNodes = new Map(b.box.childNodes.map((n, i) => [n, i]));
      const byMarkup = new Map(b.box.childNodes.map((n) => [n.outerHTML, n]));
      moves = 0;
      b.write(next.join(''));
      assert.equal(b.order(), next.join(''), 'run ' + run + ' step ' + step + ': wrong order');
      const keptIdx = [];
      for (const n of b.box.childNodes) {
        if (n.dataset.agent && byMarkup.has(n.outerHTML)) {
          assert.equal(n, byMarkup.get(n.outerHTML), 'run ' + run + ' step ' + step + ': an unchanged row was rebuilt');
        }
        if (prevNodes.has(n)) keptIdx.push(prevNodes.get(n));
      }
      assert.equal(moves, keptIdx.length - lis(keptIdx), 'run ' + run + ' step ' + step + ': more kept nodes moved than needed');
      // Unkeyed pieces (headers) are matched by rank among themselves: same rank, same markup, same node.
      b.box.childNodes.filter((n) => !n.dataset.agent).forEach((n, k) => {
        if (prevLoose[k] && prevLoose[k].outerHTML === n.outerHTML) assert.equal(n, prevLoose[k], 'run ' + run + ' step ' + step + ': an unchanged header was rebuilt');
      });
      pieces = next;
    }
  }
});
