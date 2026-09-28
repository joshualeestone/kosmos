'use strict';
/**
 * #4271: acctFocusAfterFlow, where focus goes when the Claude sign-in panel is put away with
 * focus inside it. The browser check (docs/browser-checks/render-acct-stop-focus-4271.js)
 * drives the page, where "Start the sign-in" is always rendered next to the panel, so the
 * picker fallback never runs there. This runs the real function against a small stub so every
 * branch runs.
 *
 *   node --test web.acct-focus-after-flow-4271.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scriptOf, lift } = require('./test-support/page');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = scriptOf(PAGE);

/* A rendered element has client rects; a hidden one has none. */
function el(rendered, extra) {
  return Object.assign({ disabled: false, focused: false, getClientRects() { return rendered ? [{}] : []; }, focus() { this.focused = true; } }, extra);
}
function world({ start, trigger }) {
  const field = { querySelector: (sel) => (sel === '.pcombo-trigger' ? trigger : null) };
  const pick = { parentElement: field };
  const document = { getElementById: (id) => (id === 'acct-provider-pick' ? pick : null) };
  const fn = new Function('document', lift(SCRIPT, 'acctFocusAfterFlow') + '\nreturn acctFocusAfterFlow;')(document);
  return () => fn(start);
}

test('#4271 Start is rendered and enabled: focus goes to Start', () => {
  const start = el(true); const trigger = el(true);
  world({ start, trigger })();
  assert.equal(start.focused, true);
  assert.equal(trigger.focused, false);
});

test('#4271 Start is not rendered: focus falls back to the provider picker', () => {
  const start = el(false); const trigger = el(true);
  world({ start, trigger })();
  assert.equal(start.focused, false);
  assert.equal(trigger.focused, true, 'the picker trigger is the fallback, as in acctMuseShow');
});

test('#4271 Start is disabled: focus falls back to the provider picker', () => {
  const start = el(true, { disabled: true }); const trigger = el(true);
  world({ start, trigger })();
  assert.equal(start.focused, false);
  assert.equal(trigger.focused, true);
});

test('#4271 neither is rendered (the dialog is closed): nothing is focused', () => {
  const start = el(false); const trigger = el(false);
  world({ start, trigger })();
  assert.equal(start.focused, false);
  assert.equal(trigger.focused, false, 'a hidden trigger is never focused; focus stays where it is');
});
