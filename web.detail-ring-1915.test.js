'use strict';

/**
 * The DETAIL avatar's memory ring (#1915).
 *
 * The ring was on the board cards (.agauge/ring) and the consolidated rows
 * (.lring/lrowRing) but never on the agent's own page, where a person actually
 * looks; the regression Josh reported was an avatar with no arc around it. A test
 * that only asserted the element EXISTS would have passed straight through that:
 * an unstyled or arc-less node is present but says nothing. So this file EXECUTES
 * detailRing and pins the ARC GEOMETRY -- the drawn arc must track the reading and
 * come off the SAME pctOf/memBand the MEMORY panel uses, so the two cannot disagree.
 *
 * Dependencies are spliced from the page, never restated, so what runs here is what
 * ships in the browser (the harness the memory-words test established).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

/** Brace-matched slice of one top-level function, as source. */
function slice(name) {
  const at = PAGE.indexOf(`function ${name}(`);
  assert.notEqual(at, -1, `${name} is not in the page`);
  let depth = 0;
  let i = PAGE.indexOf('{', at);
  for (; i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth += 1;
    else if (PAGE[i] === '}') { depth -= 1; if (depth === 0) break; }
  }
  return PAGE.slice(at, i + 1);
}

/** The band thresholds, pulled from the page so a change there reaches this test. */
function constLine(name) {
  const m = PAGE.match(new RegExp(`const ${name} = \\d+;`));
  assert.ok(m, `const ${name} is not in the page`);
  return m[0];
}

// eslint-disable-next-line no-new-func
const detailRing = new Function(
  [constLine('NEARLY_FULL'), constLine('WARM'), slice('pctOf'), slice('memBand'), slice('detailRing'),
    'return detailRing;'].join('\n'),
)();

const R = 47, C = 2 * Math.PI * R;
function dashOf(svg) {
  const m = svg.match(/stroke-dasharray="([\d.]+) [\d.]+"/);
  return m ? Number(m[1]) : null;
}

test('the arc length tracks the reading (the assertion that can return the dangerous answer)', () => {
  // Set the reading to a known value; the drawn arc must be that fraction of the
  // circumference. If the ring were arc-less or fixed, this fails.
  for (const pct of [10, 30, 55, 72, 95]) {
    const svg = detailRing({ context: { percent: pct } });
    const dash = dashOf(svg);
    assert.ok(dash !== null, `${pct}%: no arc drawn`);
    assert.ok(Math.abs(dash - (pct / 100) * C) < 0.5, `${pct}%: arc ${dash} is not ${(pct / 100) * C}`);
  }
});

test('a fuller reading draws a longer arc (control: the arc is not a constant)', () => {
  const low = dashOf(detailRing({ context: { percent: 20 } }));
  const high = dashOf(detailRing({ context: { percent: 80 } }));
  assert.notEqual(low, high);
  assert.ok(high > low, 'a fuller reading must draw a longer arc');
});

test('the colour/weight band changes at the thresholds, off the shared memBand', () => {
  assert.match(detailRing({ context: { percent: 30 } }), /class="gf ok"/);   // below WARM
  assert.match(detailRing({ context: { percent: 65 } }), /class="gf warn"/);  // WARM..NEARLY_FULL
  assert.match(detailRing({ context: { percent: 85 } }), /class="gf high"/);  // at/over NEARLY_FULL
});

test('an unknown reading draws no ring (the membadge unk + memory panel carry unknown)', () => {
  for (const ctx of [null, undefined, {}, { percent: null }, { percent: 'x' }]) {
    assert.equal(detailRing({ context: ctx }), '', `${JSON.stringify(ctx)} drew a ring`);
  }
});

test('the ring is wired: the id the render fills is the id the markup declares', () => {
  // A ring computed into an element that does not exist lands nowhere -- the
  // "fixed but not running" shape. Pin that the markup declares #d-ring and the
  // detail render fills that same id with detailRing's output.
  assert.match(PAGE, /id="d-ring"/, 'the detail markup has no #d-ring element');
  assert.match(PAGE, /getElementById\('d-ring'\)\.innerHTML = detailRing\(a\)/,
    'the detail render does not fill #d-ring with detailRing(a)');
});
