'use strict';
/*
 * kosmos#4542: on a classic-scrollbar machine the #1309 gutter painted a white strip beside the navy Kosmos Plus page,
 * because a gutter paints the canvas COLOUR and the Plus navy is a gradient IMAGE on the body. The canvas now takes
 * the gradient's outer stop. That colour lives in two places, so this pins them together.
 *
 *   node --test web.plus-gutter-4542.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

test('#4542: the Plus canvas colour is the Plus gradient\'s outer stop, so the gutter reads as its edge', () => {
  const block = PAGE.match(/body\.plus-active \{[\s\S]*?background: radial-gradient\(([^;]*)\) fixed;/);
  assert.ok(block, 'the body.plus-active gradient was not found');
  const stops = [...block[1].matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase());
  const outer = stops[stops.length - 1];
  const rule = PAGE.match(/html\[data-scrollbar-classic\]:not\(\[data-layout="consolidated"\]\):not\(\.tip-dimming\):has\(> body\.plus-active\) \{ background-color: (#[0-9a-fA-F]{6}); \}/);
  assert.ok(rule, 'the Plus canvas rule is missing (the white gutter returns)');
  assert.equal(rule[1].toLowerCase(), outer, 'the canvas colour drifted from the gradient\'s outer stop');
});

test('#4542: the rule keeps #4216\'s guards (classic scrollbars only, not the consolidated layout, not while the tour dims)', () => {
  const line = PAGE.split('\n').find((l) => /:has\(> body\.plus-active\) \{ background-color:/.test(l));
  assert.ok(line);
  for (const guard of ['html[data-scrollbar-classic]', ':not([data-layout="consolidated"])', ':not(.tip-dimming)']) {
    assert.ok(line.includes(guard), 'missing guard ' + guard);
  }
});

test('#4542 review: the body fills the window under the same guards, so a short Plus page keeps its gradient to the bottom', () => {
  assert.match(PAGE, /html\[data-scrollbar-classic\]:not\(\[data-layout="consolidated"\]\):not\(\.tip-dimming\):has\(> body\.plus-active\) > body \{ min-height: 100vh; \}/);
});
