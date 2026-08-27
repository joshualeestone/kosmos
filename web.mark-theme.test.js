'use strict';

/**
 * A monochrome provider mark must follow the theme.
 *
 * `.pmark.live` sets `color: var(--k-ink)` precisely so these marks inherit it
 * through `currentColor`. The OpenAI path hardcoded `fill="black"` and rendered
 * black on the dark ground -- an invisible logo on the row that says "works
 * today", and the third instance in one evening of a colour that reads fine in
 * light and is wrong in dark.
 *
 * 🔑 NOT EVERY HARDCODED FILL IS A BUG. Gemini, Qwen and Mistral carry real
 * brand colours and gradients, which are correct. This bans BLACK specifically,
 * because black is never a brand decision here -- it is what you get when a
 * mark was pasted in without being told to follow the theme.
 *
 *   node --test web.mark-theme.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');

test('no provider mark paints itself black past the theme', () => {
  const bad = PAGE.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /pmark/.test(l))
    .filter(([, l]) => /fill="(black|#000|#000000)"/i.test(l));
  assert.deepEqual(bad, [],
    'a mark hardcodes black and will vanish on the dark ground:\n'
      + bad.map(([n]) => '  line ' + n).join('\n'));
});

test('the OpenAI mark takes currentColor', () => {
  /* ⚠️ ANCHORED ON THE ELEMENT, NOT THE ATTRIBUTE. The first `data-pmark=
     "openai"` in this file is a CSS RULE (`#firstrun .llm-m[data-pmark=
     "openai"] svg`), so a plain indexOf lands in the stylesheet and slices to
     some other mark's `</svg>`. The first version of this test did exactly
     that and failed against a correct fix. Same trap this file has recorded
     before: an anchor that happens to match is worse than one that misses,
     because it reports confidently about the wrong thing. */
  const i = PAGE.indexOf('<span class="llm-m pmark live" data-pmark="openai"');
  assert.ok(i > -1, 'the OpenAI mark element moved; re-anchor this test');
  const mark = PAGE.slice(i, PAGE.indexOf('</svg>', i));
  assert.match(mark, /fill="currentColor"/,
    'the OpenAI path no longer inherits the theme colour');
});

/* The rule it depends on. Without this the marks inherit whatever the row
   happens to be, and the test above passes while the colour is still wrong. */
test('.pmark.live still hands the marks a themed colour to inherit', () => {
  assert.match(PAGE, /\.pmark\.live \{ color: var\(--k-ink\); \}/,
    'the marks have nothing themed to inherit, so currentColor resolves to whatever the row is');
});
