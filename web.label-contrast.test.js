'use strict';

/**
 * The quietest text token clears AA against the darkest ground it sits on.
 *
 * 🛑 IT DID NOT. `--label-3` measured 3.24 in light and 4.09 in dark as 12px
 * body text, against a 4.5 floor, on sixteen rules including an agent's role
 * line, the making-an-agent status glyphs, a project member's role and the
 * restart consequence hint. Readable content rather than chrome, which is why
 * the text floor applies rather than the 3:1 one for graphics.
 *
 * 🔑 IT COMPUTES THE RATIO FROM THE DECLARED TOKENS rather than matching the
 * strings. A test pinning `rgba(20,22,26,0.61)` passes on any future value
 * somebody types, including a worse one; this one fails on the property. The
 * arithmetic is the WCAG relative-luminance formula, and translucent colours
 * are composited onto the ground rather than treated as opaque, which is the
 * bug that made my first sweep report a plainly legible control at 1.00.
 *
 * ⚠️ AGAINST THE WORST GROUND IN EACH THEME, which is the correction Mona Lisa
 * made to my first numbers. I computed dark against `--k-bg`; panels are
 * `--k-surface`, which is LIGHTER, so the alpha that cleared 4.5 on the page
 * background failed by 0.04 where the text actually lives.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

/* ⚠️ ONE PARSER FOR BOTH SHAPES. The tokens are a mix: `--label-3` is `rgba()`
   and `--k-bg` is a hex triple, and a helper that handled only one threw
   "not a colour" on a perfectly good value, which reads like a missing token
   rather than a narrow parser. */
const colour = (s) => {
  const t = String(s).trim();
  if (t.startsWith('#')) {
    return { r: parseInt(t.slice(1, 3), 16), g: parseInt(t.slice(3, 5), 16), b: parseInt(t.slice(5, 7), 16), a: 1 };
  }
  const m = t.match(/[\d.]+/g);
  assert.ok(m && m.length >= 3, 'not a colour: ' + s);
  return { r: +m[0], g: +m[1], b: +m[2], a: m.length > 3 ? +m[3] : 1 };
};
const rgb = colour;
const hex = colour;
const lum = (c) => {
  const f = [c.r, c.g, c.b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
};
const over = (top, under) => ({
  r: top.a * top.r + (1 - top.a) * under.r,
  g: top.a * top.g + (1 - top.a) * under.g,
  b: top.a * top.b + (1 - top.a) * under.b, a: 1,
});
const ratio = (fg, bg) => {
  const L1 = lum(fg.a === 1 ? fg : over(fg, bg));
  const L2 = lum(bg);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
};

/* Read out of the page, never restated: a copy of a token goes stale the day
   somebody edits the real one, and this test would then be measuring a colour
   the product does not use. */
function decls(name) {
  const found = [...PAGE.matchAll(new RegExp('--' + name + ':\\s*(rgba\\([^)]*\\)|#[0-9a-fA-F]{6})', 'g'))].map((m) => m[1]);
  assert.ok(found.length, '--' + name + ' is not declared anywhere');
  return found;
}

test('every --label-3 declaration clears 4.5 on the worst ground in its theme', () => {
  const all = decls('label-3');
  const light = all.filter((c) => c.startsWith('rgba(20,'));
  const dark = all.filter((c) => c.startsWith('rgba(255,'));
  assert.ok(light.length && dark.length,
    'the light/dark split stopped working, so this test is measuring one theme twice');
  /* ⚠️ EXHAUSTIVE, and the first version was not. A loose pattern put the DARK
     token in the light bucket and measured white on white at 1.00, which reads
     as a catastrophic failure and was a bad filter. Worse than a false alarm:
     any declaration matching NEITHER pattern would have been silently unchecked,
     which is the shape that lets a token slip through a guard written for it. */
  assert.equal(light.length + dark.length, all.length,
    'a --label-3 declaration matched neither theme and was not checked: '
    + all.filter((c) => !light.includes(c) && !dark.includes(c)).join(', '));

  /* The worst ground each theme puts this text on: white and the panel surface.
     `--k-surface` in dark is lighter than `--k-bg`, so it is the harder one. */
  const grounds = {
    light: [hex('#ffffff'), rgb(decls('k-bg')[0])],
    dark: [rgb(decls('k-surface').find((c) => c.startsWith('#17')) || '#17191c'), hex('#0c0d0f')],
  };

  for (const [theme, colours] of [['light', light], ['dark', dark]]) {
    for (const c of colours) {
      for (const g of grounds[theme]) {
        const r = ratio(rgb(c), g);
        assert.ok(r >= 4.5, theme + ' --label-3 ' + c + ' is ' + r.toFixed(2)
          + ' on rgb(' + [g.r, g.g, g.b].join(',') + '), below the 4.5 floor for body text');
      }
    }
  }
});

test('the arithmetic is right, checked against a pair with a known answer', () => {
  /* 🔑 THE CONTROL. Every assertion above is an inequality, and an inequality
     is satisfied by a formula that returns a large number for everything.
     Black on white is exactly 21, which is the maximum the formula can produce
     and the one value that cannot come out right by accident. */
  assert.equal(Math.round(ratio(hex('#000000'), hex('#ffffff'))), 21);
  assert.equal(Math.round(ratio(hex('#ffffff'), hex('#ffffff'))), 1);
  /* And translucency is composited rather than treated as opaque, which is the
     bug that made a 5% tint over white measure as near-black on near-black. */
  const faint = ratio({ r: 20, g: 22, b: 26, a: 0.05 }, hex('#ffffff'));
  assert.ok(faint < 1.3, 'a 5% ink over white measured as ' + faint.toFixed(2) + ', so alpha is being ignored');
});

test('label-3 still recedes, which is the reason it exists', () => {
  /* Raising it for AA must not collapse the scale into label-2. Measured on
     white: the gap stays close to a factor of two. */
  const white = hex('#ffffff');
  const l2 = decls('label-2').find((c) => c.startsWith('rgba(20,')) || decls('label-2')[0];
  const l3 = decls('label-3').find((c) => c.startsWith('rgba(20,'));
  const r2 = ratio(rgb(l2), white), r3 = ratio(rgb(l3), white);
  assert.ok(r3 >= 4.5, 'label-3 is ' + r3.toFixed(2));
  assert.ok(r2 > r3 * 1.4,
    'label-3 (' + r3.toFixed(2) + ') has crept up to label-2 (' + r2.toFixed(2) + '), so the level stopped meaning anything');
});

/**
 * The Settings status glyphs, which are decorative and still have to be seen.
 *
 * 🛑 THE ARIA WAS THE DEFECT AND THE RATIO WAS THE SYMPTOM. Every row's title
 * states its own state in words, so the tick carries nothing the sentence does
 * not, and exposing it made a screen reader say the glyph and then the sentence
 * meaning the same thing. It is `aria-hidden` now, which is what makes the 3:1
 * graphical floor the right one rather than the 4.5 text floor.
 *
 * ⚠️ AND THE FIX IS LIGHT-ONLY, WHICH IS THE PART WORTH GUARDING. On the tint
 * over white the brand gold is 2.78; at 85% it is 3.74. On the same tint over
 * the dark surface the brand gold is already 4.67 and that same 85% value is
 * 3.47. One colour cannot serve both grounds, and shipping the light fix
 * globally would have been a regression wearing an accessibility fix's clothes.
 * A test that checked only light would have passed on exactly that mistake.
 */
test('the Settings status glyph clears 3:1 in BOTH themes, on the ground each sits on', () => {
  const tick = { light: colour('#9c741b'), dark: colour('#b88920') };
  const tint = { r: 184, g: 137, b: 32, a: 0.13 };
  const ground = { light: over(tint, hex('#ffffff')), dark: over(tint, hex('#17191c')) };

  for (const theme of ['light', 'dark']) {
    const r = ratio(tick[theme], ground[theme]);
    assert.ok(r >= 3, theme + ' status glyph is ' + r.toFixed(2) + ', below the 3:1 floor for a graphical indicator');
  }
  /* 🔑 THE CROSS-CHECK THAT CATCHES THE GLOBAL FIX. Each theme's value must be
     the better one FOR ITS OWN GROUND, or somebody has applied one everywhere. */
  assert.ok(ratio(tick.light, ground.light) > ratio(tick.dark, ground.light),
    'the dark glyph colour reads better on the LIGHT ground, so the two are the wrong way round');
  assert.ok(ratio(tick.dark, ground.dark) > ratio(tick.light, ground.dark),
    'the light glyph colour reads better on the DARK ground, so the light fix was applied globally');

  /* Both declarations are really in the page, so the numbers above are about
     the product rather than about this file. */
  assert.match(PAGE, /\.chk\.ok \.chk-m[^}]*color:\s*#9c741b/, 'the light glyph colour is not declared');
  /* ⚠️ BOTH DARK RULES, BY THEIR OWN SELECTORS. The first version anchored on
     `@media (prefers-color-scheme: dark)` and then matched lazily across the
     whole file, so it was satisfied by the FORCED-theme rule six hundred lines
     further down and passed with the media rule broken. A lazy match after an
     anchor is not an anchor. There are two dark rules because
     `sync-forced-theme.js` generates the `[data-theme="dark"]` twin, and both
     have to say the same thing or the picker and the system setting disagree. */
  for (const sel of ['\\:root\\:not\\(\\[data-theme="light"\\]\\) \\.chk\\.ok \\.chk-m',
    '\\:root\\[data-theme="dark"\\] \\.chk\\.ok \\.chk-m']) {
    const re = new RegExp(sel.replace(/\\\\/g, '\\') + '[^}]*var\\(--gold-deep\\)');
    assert.match(PAGE, re, 'a dark rule for the glyph is missing or no longer restores the brand gold: ' + sel);
  }
  assert.match(PAGE, /class="chk-m" aria-hidden="true"/,
    'the glyph is exposed again, so it is announced beside a sentence that already says it');
});

/**
 * The "!" attention glyph, same shape as the .ok test above and the same
 * reason it exists: .att used to share .ok's exact gold, distinguished only
 * by the glyph's own shape, easy to skim past (Josh, 2026-08-26 07:12, from
 * a screenshot of the first-run "Checking this computer" pane).
 *
 * ⚠️ THIS COMPONENT NEVER RENDERS INSIDE #firstrun. `chkRow()` output lands
 * only in `#set-machine` and `#set-applocation` (Settings), both outside the
 * `#firstrun` subtree -- so its grounds are the ordinary theme grounds, white
 * in light and the #17191c card surface in dark. An earlier iteration added a
 * `#firstrun`-scoped pin for this selector on the premise that the dark red
 * could land on `#firstrun`'s pinned-white ground; that premise was false
 * (disjoint subtrees) and the pin was removed as dead CSS. The first-run
 * screen has its own component (`frCheckRow()` -> `.fr-check`) and its own
 * test below.
 */
test('the attention glyph clears 3:1 in BOTH themes', () => {
  const tick = { light: colour('#b3261e'), dark: colour('#ff8c82') };
  const tint = { light: { r: 179, g: 38, b: 30, a: 0.13 }, dark: { r: 255, g: 140, b: 130, a: 0.13 } };
  const ground = { light: over(tint.light, hex('#ffffff')), dark: over(tint.dark, hex('#17191c')) };

  for (const theme of ['light', 'dark']) {
    const r = ratio(tick[theme], ground[theme]);
    assert.ok(r >= 3, theme + ' attention glyph is ' + r.toFixed(2) + ', below the 3:1 floor for a graphical indicator');
  }
  assert.ok(ratio(tick.light, ground.light) > ratio(tick.dark, ground.light),
    'the dark glyph colour reads better on the LIGHT ground, so the two are the wrong way round');
  assert.ok(ratio(tick.dark, ground.dark) > ratio(tick.light, ground.dark),
    'the light glyph colour reads better on the DARK ground, so the light fix was applied globally');

  assert.match(PAGE, /\.chk\.att \.chk-m[^}]*color:\s*#b3261e/, 'the light glyph colour is not declared');
  for (const sel of ['\\:root\\:not\\(\\[data-theme="light"\\]\\) \\.chk\\.att \\.chk-m',
    '\\:root\\[data-theme="dark"\\] \\.chk\\.att \\.chk-m']) {
    const re = new RegExp(sel.replace(/\\\\/g, '\\') + '[^}]*#ff8c82');
    assert.match(PAGE, re, 'a dark rule for the glyph is missing or no longer uses the dark attention red: ' + sel);
  }
});

test('the one state pill whose SHAPE carries meaning clears 3:1 in both themes, and idle has an edge (#293)', () => {
  /**
   * Six pills, and ten of their twelve theme readings are under 3:1 on
   * purpose: every pill carries its state WORD, so the border is a container
   * boundary and a quiet one is a choice, not a failure. Two are different.
   * `st-unknown` is the only pill that uses shape (the sole dashed border;
   * "shape distinguishes, words identify"), so its edge is doing
   * identification work and SC 1.4.11 binds on it: it measured 1.61:1 on
   * white, the one edge that had to be seen and nearly could not be. `st-idle`
   * is the commonest state on a healthy board and measured 1.31 / 1.27, so the
   * pill shape was absent from most pills a person sees; it only has to read
   * as the same object as paused and stopped, which is the bar here.
   *
   * Ground: the plain card, `--k-surface`, which is what idle and unknown
   * cards sit on (#221: only working and needs-you tint the card).
   */
  const rule = (sel, theme) => {
    const re = theme === 'light'
      ? new RegExp('^\\.astate\\.' + sel + '\\s*\\{[^}]*border-color:\\s*(rgba\\([^)]*\\)|#[0-9a-fA-F]{6}|var\\(--[a-z-]+\\))', 'm')
      : new RegExp(':root\\[data-theme="dark"\\] \\.astate\\.' + sel + '(?:,[^{]*)?\\s*\\{[^}]*border-color:\\s*(rgba\\([^)]*\\)|#[0-9a-fA-F]{6})', 'm');
    const m = PAGE.match(re);
    assert.ok(m, `no ${theme} border-color rule for .astate.${sel}`);
    return m[1];
  };
  const surface = { light: colour(decls('k-surface')[0]), dark: colour('#17191c') };
  assert.equal(decls('k-surface')[1], '#17191c', 'the dark card surface moved; re-point the ground here');

  for (const theme of ['light', 'dark']) {
    const dash = ratio(colour(rule('st-unknown', theme)), surface[theme]);
    assert.ok(dash >= 3, `st-unknown's dashed edge is ${dash.toFixed(2)}:1 in ${theme}; the one border that carries meaning must clear 3:1`);
    const idle = ratio(colour(rule('st-idle', theme)), surface[theme]);
    const paused = ratio(colour(rule('st-paused', theme)), surface[theme]);
    assert.ok(idle >= 1.9, `st-idle's edge is ${idle.toFixed(2)}:1 in ${theme}; it reads as floating text`);
    assert.ok(Math.abs(idle - paused) < 0.05, `st-idle (${idle.toFixed(2)}) and st-paused (${paused.toFixed(2)}) are not the same object in ${theme}`);
  }
  // The dash is the shape, and the shape is the point: it must still be dashed.
  assert.match(PAGE, /\.astate\.st-unknown\s*\{[^}]*border-style:\s*dashed/, 'unknown lost its dash, so its edge now means nothing');
  // POSITIVE CONTROL: the instrument sees the old value as the failure it was.
  assert.ok(ratio(colour('rgba(20,22,26,.22)'), surface.light) < 3, 'the contrast helper no longer fails the value this card was filed on');
});

/**
 * The FIRST-RUN "!" glyph -- the screen Josh's screenshot was actually of.
 *
 * 🛑 NOT THE SAME COMPONENT AS THE `.chk.att` TEST ABOVE. That one paints
 * Settings > This Mac (`chkRow()` into `#set-machine`); this one paints the
 * first-run wizard's own machine-check step (`frCheckRow()` into
 * `#fr-checks`, both inside `#firstrun`). Two near-identical-looking
 * components with the same bug, caught first on the wrong one in
 * challenge-loop iteration 1 and traced to the right one in iteration 2 by
 * checking which function actually renders the screen in the screenshot,
 * not by which class name looked most likely.
 *
 * ⚠️ ONLY ONE GROUND HERE, ON PURPOSE. `#firstrun` pins white in every
 * theme (its own single-look ruling) and this rule has no dark-mode
 * variant at all -- confirmed by `tools/sync-forced-theme.js --check`
 * passing clean with none added. A test asserting a dark-mode split here
 * would be testing a rule that does not exist.
 */
test('the first-run "!" glyph (frCheckRow, not chkRow) clears 3:1 against its real (always-white) ground', () => {
  const attnRule = PAGE.match(/#firstrun \.fr-check\.attention \.fr-mark\s*\{[^}]*\}/);
  assert.ok(attnRule, '#firstrun .fr-check.attention .fr-mark rule is missing or moved');
  assert.doesNotMatch(attnRule[0], /\.fr-check\.ok/,
    'the .ok and .attention rules are combined again, which is the exact bug this card reported');

  const okRule = PAGE.match(/#firstrun \.fr-check\.ok \.fr-mark\s*\{[^}]*\}/);
  assert.ok(okRule, '#firstrun .fr-check.ok .fr-mark rule is missing or moved');

  const parse = (rule) => ({
    tint: colour(rule.match(/background:\s*(rgba\([^)]*\))/)[1]),
    ink: colour(rule.match(/color:\s*(#[0-9a-fA-F]{6})/)[1]),
  });
  const attn = parse(attnRule[0]);
  const ok = parse(okRule[0]);

  const white = hex('#ffffff');
  const attnGround = over(attn.tint, white);
  const r = ratio(attn.ink, attnGround);
  assert.ok(r >= 3, 'the "!" glyph is ' + r.toFixed(2) + ':1 on its own tint over white, below the 3:1 floor');

  /* THE ACTUAL BUG, as a regression sensor: .ok and .attention must not be
     the same colour, or the glyph shape is the only thing telling them
     apart again -- which is Josh's exact complaint. */
  assert.notEqual(attn.ink.r + ',' + attn.ink.g + ',' + attn.ink.b, ok.ink.r + ',' + ok.ink.g + ',' + ok.ink.b,
    '.ok and .attention share a colour again -- easy to skim past, which is the bug this card reported');
});
