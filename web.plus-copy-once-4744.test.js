'use strict';
/**
 * kosmos#4744 (review 8): the Kosmos+ box's Copy button. When the synchronous copy fails, the handler waits on the
 * clipboard API; a second press during that wait must not start a second copy, so the screen never says "could
 * not copy" after the address was copied.
 *
 *   node --test web.plus-copy-once-4744.test.js
 *   PLUS_PAGE=<main's web/index.html> node --test web.plus-copy-once-4744.test.js   (must fail there)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = require('./test-support/page');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');
const SCRIPT = page.scriptOf(PAGE);

function world({ execOk, clipboard }) {
  const els = {};
  const el = (id) => (els[id] ||= { id, textContent: '', dataset: {}, focus() {} });
  const timers = [];
  const ctx = {
    PLUS_ACCOUNT_URL: 'https://login.kosmosplus.com/',
    document: {
      getElementById: el,
      createElement: () => ({ style: {}, setAttribute() {}, select() {}, remove() {} }),
      body: { appendChild() {} },
      execCommand: () => execOk,
      createRange: () => ({ selectNodeContents() {} }),
      querySelector: () => ({}),
    },
    window: { getSelection: () => ({ removeAllRanges() {}, addRange() {} }) },
    navigator: { clipboard },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: (id) => { if (id) timers[id - 1] = null; },
  };
  const start = SCRIPT.indexOf('let PLUS_COPY_TIMER = null;');
  const end = SCRIPT.indexOf('/* #4744: the one-line sentence may wrap');
  assert.ok(start > 0 && end > start, 'the Copy handler moved; re-anchor this test');
  vm.runInNewContext(SCRIPT.slice(start, end) + '\nthis.plusCopyAddress = plusCopyAddress;', ctx);
  const flush = () => { for (let i = 0; i < timers.length; i++) { const f = timers[i]; if (f) { timers[i] = null; f(); } } };
  return { ctx, el, flush };
}

test('#4744: a second press while the clipboard answer is pending starts no second copy', async () => {
  let calls = 0;
  const pending = [];
  const clipboard = { writeText: () => { calls += 1; return new Promise((r) => { pending.push(r); }); } };
  const w = world({ execOk: false, clipboard });
  const first = w.ctx.plusCopyAddress();
  const second = w.ctx.plusCopyAddress();
  for (const r of pending) r();                            // every write that started is answered, so nothing hangs
  await first; await second;
  assert.equal(calls, 1, 'a press during the pending clipboard write started another copy');
  w.flush();
  assert.equal(w.el('plus-copy').textContent, 'Copy', 'the button did not settle back to Copy');
});

test('#4744: a press that succeeds while an earlier one waits cannot be followed by that one\'s failure note', async () => {
  let refuse;
  const w = world({ execOk: false, clipboard: { writeText: () => new Promise((_, no) => { refuse = no; }) } });
  const first = w.ctx.plusCopyAddress();                   // copy by command fails; waits on the clipboard
  let copied = false;
  w.ctx.document.execCommand = () => { copied = true; return true; };   // a second press now would copy at once
  const second = w.ctx.plusCopyAddress();
  refuse(new Error('refused')); await first; await second;
  w.flush();
  const note = w.el('plus-status').textContent;
  // Either the second press was refused (nothing was copied, so "could not copy" is true), or it copied and the
  // screen must not then say it could not.
  assert.ok(!(copied && note), `the address was copied, then the screen said: "${note}"`);
});
