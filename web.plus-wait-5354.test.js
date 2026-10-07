'use strict';
/**
 * kosmos#5354: the app's Kosmos+ sign-in said a long wait in seconds ("in 1290 seconds", live 2026-10-05). From two
 * minutes up it now says minutes, rounded up, in the relay sign-in page's own words (coordinator/src/signin.html
 * waitWords): "about 22 minutes", "about an hour" at sixty. Under two minutes the seconds still count down. Lifted from
 * the shipped page and run with a hand-driven clock.
 *
 *   node --test web.plus-wait-5354.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const page = require('./test-support/page');
const HTML = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(HTML);

function world() {
  const start = SCRIPT.indexOf('function plusSetBusy');
  const end = SCRIPT.indexOf('\n}\n', SCRIPT.indexOf('function plusCountdown')) + 3;
  assert.ok(start > 0 && end > start, 'plusSetBusy / plusCountdown moved');
  const ctx = { setInterval: (fn) => { ctx.tick = fn; return 1; }, clearInterval: () => { ctx.tick = null; } };
  vm.runInNewContext('let PLUS_COUNTDOWN = null;\n' + SCRIPT.slice(start, end) + '\nthis.plusCountdown = plusCountdown; this.plusWaitWords = plusWaitWords;', ctx);
  return ctx;
}

test('#5354 the words for a wait: seconds under two minutes, then minutes rounded up, "about an hour" at sixty', () => {
  const w = world().plusWaitWords;
  assert.equal(w(1), '1 second');
  assert.equal(w(59), '59 seconds');
  assert.equal(w(119), '119 seconds', 'CONTROL: just under two minutes stays in seconds');
  assert.equal(w(120), 'about 2 minutes');
  assert.equal(w(121), 'about 3 minutes', 'rounded UP, never shorter than the real wait');
  assert.equal(w(1290), 'about 22 minutes', 'the live case');
  assert.equal(w(3540), 'about 59 minutes');
  assert.equal(w(3600), 'about an hour');
});

test('#5354 the live case reads in minutes, and drops to a seconds countdown under two minutes', () => {
  const w = world(); const line = { textContent: '' }; const btn = { disabled: false };
  w.plusCountdown(line, btn, 'Too many codes asked for this address; you can ask for another in 1290 seconds', 1290);
  assert.equal(line.textContent, 'No code was sent: Too many codes asked for this address; you can ask for another in about 22 minutes.');
  for (let i = 0; i < 1290 - 119; i += 1) w.tick();
  assert.match(line.textContent, /in 119 seconds\.$/, 'under two minutes the seconds count down again');
  assert.equal(btn.disabled, true, 'still held during the wait');
});
