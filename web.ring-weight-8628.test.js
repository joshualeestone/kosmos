'use strict';

/**
 * kosmos#8628 (Josh, 2026-11-17): the memory rings got FATTER as they filled, and at high fill the fat stroke
 * was cut square at the top, bottom and sides. Two faults, one cause: the .gf.warn / .gf.high bands set
 * stroke-width 5 and 6, and on a small ring (lrowRing, r 15.5 in a 34 box) r + 6/2 = 18.5 reaches past the
 * box's edge at 17, where the SVG clips it. The My Agents rail (#8303) drew those rings with no override.
 *
 * Decided: one thin constant stroke; fullness shows only by arc length and colour. So this pins two things:
 *   1. no rule anywhere in the page gives a band (warn / high) a stroke width: colour only;
 *   2. every ring drawing keeps r + width/2 inside half its viewBox, so no stroke is ever clipped.
 * Read from the page source, never restated, so a change there reaches this test.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

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

/** Every CSS rule (selector + body) whose selector names a band class on .gf. */
function bandRules(css) {
  const out = [];
  const re = /([^{}]*)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    if (/\.gf\.(warn|high)\b/.test(m[1])) out.push({ sel: m[1].trim(), body: m[2] });
  }
  return out;
}

test('control: the rule reader finds a band rule that sets a width (so it can return the dangerous answer)', () => {
  const bad = bandRules('.gf { stroke: green; }\n.gf.high { stroke: red; stroke-width: 6; }');
  assert.equal(bad.length, 1);
  assert.match(bad[0].body, /stroke-width/);
});

test('#8628: the warn and high bands change colour only, never weight', () => {
  const css = [...PAGE.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  assert.ok(css.length > 100000, `the page's style blocks were not found (${css.length} chars)`);
  const rules = bandRules(css);
  assert.ok(rules.length >= 2, `expected the .gf.warn and .gf.high colour rules, found ${rules.length}`);
  const weighted = rules.filter((r) => /stroke-width/.test(r.body));
  assert.deepEqual(weighted.map((r) => r.sel), [], 'a band rule sets a stroke width, so a ring would thicken as it fills');
});

/** viewBox half-size, radius and the fill arc's stroke width, read off one ring drawing's source. */
function geometryOf(name, src) {
  const vb = src.match(/viewBox="0 0 (\d+(?:\.\d+)?) \1"/);
  const r = src.match(/const R = (\d+(?:\.\d+)?)/);
  const sw = src.match(/class="gf \$\{[^}]+\}"[^>]*?stroke-width="(\d+(?:\.\d+)?)"/);
  assert.ok(vb && r && sw, `${name}: could not read its viewBox, R and fill stroke-width`);
  return { half: Number(vb[1]) / 2, r: Number(r[1]), sw: Number(sw[1]) };
}
const fits = (g) => g.r + g.sw / 2 <= g.half;

test('#8628: every ring keeps its stroke inside its own box, so nothing is clipped', () => {
  for (const name of ['ring', 'lrowRing', 'detailRing', 'orgRing']) {
    const g = geometryOf(name, slice(name));
    assert.ok(fits(g), `${name}: r ${g.r} + width ${g.sw}/2 = ${g.r + g.sw / 2} passes the box edge at ${g.half}`);
  }
});

test('control: the box check fails on the real small ring drawn at the old band width', () => {
  /* The real lrowRing source with its fill stroke set to 6, the width .gf.high used to force: the same reader and the
     same check must call it clipped, or the test above could not see the fault Josh reported. */
  const thick = slice('lrowRing').replace(/(class="gf \$\{[^}]+\}"[^>]*?stroke-width=")[\d.]+"/, (m, head) => head + '6"');
  assert.notEqual(thick, slice('lrowRing'), 'the control did not change the drawing');
  assert.equal(fits(geometryOf('lrowRing (stroke 6)', thick)), false);
});
