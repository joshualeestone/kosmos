'use strict';

/**
 * kosmos#1044, REVERSED BY JOSH 2026-08-26 22:05: the gold primary button has
 * NO edge, and this file now pins that decision instead of the opposite one.
 *
 * His words, on seeing it live: "I never asked for that. All the gold buttons
 * are supposed to be just like they are on the style guide and the pack design
 * that Mona Lisa designed, where it's just a nice bright gold button with black
 * text." It was on the post and send button of every page.
 *
 * ⭐ THE MEASUREMENTS BELOW ARE KEPT ON PURPOSE, and that is the point of not
 * deleting this file. The edge was a real contrast floor, so the revert has a
 * real cost, and whoever proposes another way to carry it should start from
 * numbers that are already derived rather than measuring it a third time. What
 * changed is whose call it is, not whether the arithmetic was right.
 *
 * The original reasoning, still true and now unapplied:
 *
 * `.uprime` painted its border the same colour as its fill, so the control's
 * whole visual boundary measured 1.95:1 against a white card -- under the 3:1
 * WCAG SC 1.4.11 asks of anything that identifies a control. The TEXT was never
 * the problem (ink on gold is 9.31:1); the button itself was what disappeared,
 * on the primary action of nearly every screen that decides something.
 *
 * 🔑 THIS COMPUTES FROM THE REAL TOKEN BLOCKS rather than matching a sentence.
 * A comment can assert a ratio; only arithmetic on the actual hex can hold it.
 * The same shape as the open-project marker pin in web.consolidated-980.
 *
 *   node --test web.gold-edge-1044.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');

function lum(hex) {
  const h = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const x = lum(a); const y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/* Read a token out of a NAMED block, so the light and dark values cannot be
   confused for each other -- the failure this whole card is about is a colour
   read against the wrong ground. */
function token(name, after) {
  const from = after ? PAGE.indexOf(after) : 0;
  assert.ok(from > -1, 'block anchor missing: ' + after);
  const m = PAGE.slice(from).match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})'));
  assert.ok(m, 'token --' + name + ' not found after ' + (after || 'start'));
  return m[1];
}

const LIGHT_EDGE = token('gold-edge');
const DARK_EDGE = token('gold-edge', '@media (prefers-color-scheme: dark) {');
const FILL = token('gold-bright');

test('the gold edge clears 3:1 on every LIGHT ground it sits on', () => {
  for (const [name, ground] of [['card', '#ffffff'], ['page', '#faf9f7'], ['side', '#f3f1ec']]) {
    const r = ratio(LIGHT_EDGE, ground);
    assert.ok(r >= 3, `the gold button's edge measures ${r.toFixed(2)}:1 on the ${name} ground (needs 3:1), so the control has no visible boundary there`);
  }
});

test('the gold edge clears 3:1 on every DARK ground it sits on', () => {
  for (const [name, ground] of [['card', '#17191c'], ['page', '#0c0d0f'], ['side', '#111316']]) {
    const r = ratio(DARK_EDGE, ground);
    assert.ok(r >= 3, `the gold button's edge measures ${r.toFixed(2)}:1 on the dark ${name} ground (needs 3:1)`);
  }
});

/* ⚠️ THE INVERTING CONTROL. Without it these pass on any dark-enough colour and
   would keep passing if someone "simplified" the edge back to the fill. This
   asserts the OLD value still fails, so the test is measuring the thing that
   was broken rather than agreeing with itself. */
test('the control: the fill colour would still fail as an edge', () => {
  const r = ratio(FILL, '#ffffff');
  assert.ok(r < 3,
    `--gold-bright now measures ${r.toFixed(2)}:1 on a white card. Either the brand gold changed, or this control is no longer testing anything -- re-derive it rather than deleting it.`);
});

test('both themes still define the token, so the evidence survives the revert', () => {
  assert.notEqual(LIGHT_EDGE.toLowerCase(), DARK_EDGE.toLowerCase(),
    'light and dark share one edge colour; no single value clears 3:1 on both, so a future proposal that reuses this token would fail one theme');
});

/* 🛑 JOSH'S DECISION, PINNED. This is the assertion that used to say the
   opposite. It is here so the edge cannot come back by way of an accessibility
   sweep that has not read this file: the fix is real, and it is still not ours
   to re-apply on his brand without him. */
test('the gold primary carries NO edge: its border matches its fill', () => {
  /* ⚠️ [\s\S], not [^\n]: this matched on ONE LINE and went red the moment the
     selector list legitimately wrapped to two. It failed loudly ("the rule is
     gone") rather than passing, which is the right direction to fail, but the
     rule was there the whole time. */
  const rule = PAGE.match(/^button\.uprime, \.btn\.uprime,[\s\S]{0,200}?\{[^}]*\}/m);
  assert.ok(rule, 'the .uprime rule is gone; this test now checks nothing');
  assert.doesNotMatch(rule[0], /--gold-edge/,
    'the gold edge is back on .uprime. Josh reverted it by name on 2026-08-26; it needs HIM, not a sweep.');
  /* THE INTENT, not the old spelling: the border must draw no visible line in a colour of
     its own. Until #4059 the fill was one flat gold and the border repeated it
     (var(--gold-bright) twice). Since #4059 the fill is a gradient (the polished gold Josh
     picked from study A, 09-27), which a border colour cannot repeat, so the border is
     TRANSPARENT and the metal shows through it. Both satisfy "no edge"; any other colour,
     the edge token included, is an outline nobody chose. */
  const border = rule[0].match(/border-color:\s*([^;]+);/);
  const fill = rule[0].match(/background:\s*([^;]+);/);
  assert.ok(border && fill, 'the .uprime rule no longer sets both its fill and its border; this test now checks nothing');
  const b = border[1].trim(); const f = fill[1].trim();
  assert.match(f, /^var\(--gold(-bright|-polished)\)$/,
    'the gold primary is no longer filled gold (' + f + '), so "its border matches its fill" is no longer about the gold button');
  assert.ok(b === 'transparent' || b === f,
    'the border is ' + b + ': neither the fill nor transparent, so the button has an outline nobody chose');
});

/* ⭐ THE SECOND DEFECT IN THE SAME REPORT, and it was not the edge: "when I
   mouse over it, it turns a light gray". .uprime had no hover of its own, so
   the generic .btn:hover repainted the primary action --attn-bg. */
test('hovering the gold primary keeps it gold', () => {
  /* THE INTENT: .uprime has a hover of its OWN and it paints GOLD. Until #4059 that was the
     flat var(--gold); since #4059 it is the darker polished gold, var(--gold-polished-hover).
     Either is gold; --attn-bg (the grey wash Josh saw) or anything else is the defect. */
  const hover = PAGE.match(/^button\.uprime:hover,[\s\S]{0,240}?\{[^}]*\}/m);
  assert.ok(hover, 'the gold primary has no hover of its own again, so .btn:hover paints it grey under the pointer');
  const hfill = hover[0].match(/background:\s*([^;]+);/);
  assert.ok(hfill, 'the .uprime hover sets no background, so .btn:hover paints it grey under the pointer');
  assert.match(hfill[1].trim(), /^var\(--gold(-polished-hover)?\)$/,
    'the .uprime hover paints ' + hfill[1].trim() + ', not gold, so the primary stops looking gold under the pointer');
  /* And the polished hover token must itself be gold: a gradient built on the gold tokens, so
     renaming a grey into it cannot pass the line above. */
  if (/polished-hover/.test(hfill[1])) {
    const tok = PAGE.match(/--gold-polished-hover:\s*([^;]+);/);
    assert.ok(tok, '--gold-polished-hover is used but never defined, so the hover paints nothing');
    assert.match(tok[1], /linear-gradient\([^;]*var\(--gold-bright\)/,
      '--gold-polished-hover no longer runs through the brand gold, so the hover is not gold');
    assert.doesNotMatch(tok[1], /--attn-bg/, '--gold-polished-hover is built on the grey wash');
  }
  /* The control: the generic hover that would otherwise win must still exist,
     or this pin is guarding against nothing. */
  assert.match(PAGE, /\.btn:hover \{ background: var\(--attn-bg\)/,
    'the generic .btn:hover is gone, so the rule above is no longer protecting anything -- re-derive this');
});

/* ⭐ ORDER-INDEPENDENCE, and it is the button Josh named.
 *
 * #d-send (Send, on an agent) is a .btn.uprime INSIDE a .dbox, so it is fought
 * over by the dialog skin: `.dbox .btn` (0-2-0) and `.dbox .btn:hover` (0-3-0)
 * TIE with plain `.btn.uprime` / `.btn.uprime:hover`. A tie is broken by source
 * order, which means the gold was winning by position alone.
 *
 * MEASURED IN A REAL BROWSER, three ways, before this was written:
 *   A  hardened, normal order      -> rgb(227,179,65)  gold
 *   B  hardened, .dbox moved AFTER -> rgb(227,179,65)  gold      (specificity)
 *   C  UNhardened, .dbox AFTER     -> rgba(0,0,0,0) + gold-deep border
 * C is the control: it is the defect Josh reported, reproduced on demand, and
 * it is what proves B is a real result rather than a rule that cannot fail.
 *
 * Flagged by Mona Lisa, who declined to edit a just-landed fix and left the
 * call here instead.
 */
test('the gold primary beats the dialog skin on SPECIFICITY, not on position', () => {
  const fill = PAGE.match(/^button\.uprime, \.btn\.uprime,[\s\S]{0,200}?\{[^}]*\}/m);
  assert.ok(fill, 'the .uprime fill rule is gone; this test now checks nothing');
  assert.match(fill[0], /\.dbox \.btn\.uprime/,
    'the gold fill no longer outscopes `.dbox .btn`, so #d-send goes transparent if either block moves');

  const hov = PAGE.match(/^button\.uprime:hover,[\s\S]{0,240}?\{[^}]*\}/m);
  assert.ok(hov, 'the .uprime hover rule is gone; this test now checks nothing');
  assert.match(hov[0], /\.dbox \.btn\.uprime:hover/,
    'the gold hover no longer outscopes `.dbox .btn:hover`, so Send returns to the pale wash if either block moves');

  /* The controls: the rules being outscoped must still EXIST, or the two
     assertions above are guarding against nothing at all. */
  assert.match(PAGE, /\.dbox \.btn \{ background: transparent/,
    'the dialog skin fill is gone, so the .dbox scoping above protects nothing -- re-derive this');
  assert.match(PAGE, /\.dbox \.btn:hover \{ background: rgba/,
    'the dialog skin hover is gone, so the .dbox hover scoping above protects nothing -- re-derive this');
});
