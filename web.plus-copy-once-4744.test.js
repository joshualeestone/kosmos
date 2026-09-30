'use strict';
/**
 * kosmos#4744 (review 8): the Kosmos+ box's Copy button. When the synchronous copy fails, the handler waits on the
 * clipboard API; a second press during that wait must not start a second copy, so the screen never says "could
 * not copy" after the address was copied. A clipboard that never answers counts as a refusal after 3 seconds, so
 * the button is not left locked.
 *
 *   node --test web.plus-copy-once-4744.test.js
 *   PLUS_PAGE=<web/index.html at 747aa169d> node --test web.plus-copy-once-4744.test.js   (the handler before the
 *   guard: both tests fail there, measured 0/2)
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
  // The second press is refused while the first waits, so nothing was copied and the screen says so, once.
  assert.equal(copied, false, 'the second press copied while the first was still waiting');
  assert.match(note, /could not copy/, `nothing was copied, but the screen said: "${note}"`);
  assert.notEqual(w.el('plus-copy').textContent, 'Copied');
});

test('#4744: a clipboard answer that never comes does not leave Copy locked', async () => {
  const w = world({ execOk: false, clipboard: { writeText: () => new Promise(() => {}) } });   // never settles
  const first = w.ctx.plusCopyAddress();
  await new Promise((r) => setImmediate(r));
  w.flush();                                               // the 3 s limit fires
  const settled = await Promise.race([first.then(() => true), new Promise((r) => setTimeout(() => r(false), 500))]);
  assert.ok(settled, 'the press never finished: the clipboard\'s silence left it waiting (and Copy locked)');
  w.flush();                                               // the failure's words land
  assert.match(w.el('plus-status').textContent, /could not copy/, 'no failure was said after the clipboard gave no answer');
  w.ctx.document.execCommand = () => true;
  await w.ctx.plusCopyAddress();                           // a later press works
  assert.equal(w.el('plus-copy').textContent, 'Copied', 'Copy stayed locked after a clipboard that never answered');
});
