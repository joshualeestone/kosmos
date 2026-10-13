'use strict';
/**
 * kosmos#5995 item 4: the Kosmos+ sign-in's "Name for this computer" box. The page's own functions (sliced from
 * web/index.html) against a fake fetch: what the box shows, and what the start is given to send.
 * The real page and the real routes are driven in docs/browser-checks/render-plus-computer-name-5995.js.
 *
 *   node --test web.computer-name-5995.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = require('./test-support/page');
const HTML = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = page.scriptOf(HTML);

function slice(from, last) {
  const start = SCRIPT.indexOf(from);
  const tail = SCRIPT.indexOf(last, start);
  const end = SCRIPT.indexOf('\n}\n', tail) + 3;
  assert.ok(start > 0 && tail >= start && end > tail, `the computer-name script moved (${from} .. ${last})`);
  return SCRIPT.slice(start, end);
}

/** answer: () => [status, json], or a function that throws (the board did not answer). */
function world(answer) {
  const box = { id: 'plus-si-computer', value: '' };
  const field = { id: 'plus-si-computer-field', hidden: true };
  let release = null;
  const ctx = {
    measured: 0,
    plusSiMeasure: () => { ctx.measured += 1; },
    reads: 0,
    AbortController: class { constructor() { this.signal = { aborted: false }; } abort() { this.signal.aborted = true; if (ctx.onAbort) ctx.onAbort(); } },
    setTimeout: (fn, ms) => { ctx.timers.push({ fn, ms }); return ctx.timers.length; }, clearTimeout: (id) => { if (ctx.timers[id - 1]) ctx.timers[id - 1].cleared = true; },
    timers: [],
    document: { getElementById: (id) => (id === 'plus-si-computer' ? box : id === 'plus-si-computer-field' ? field : null) },
    fetch: async (path, init) => {
      assert.equal(path, '/api/remote/computer-name');
      ctx.reads += 1;
      if (ctx.hang) await new Promise((_, reject) => { ctx.onAbort = () => reject(new Error('aborted')); assert.ok(init && init.signal, 'the read cannot be given up on'); });
      if (ctx.hold) await new Promise((r) => { release = r; });
      const [status, json] = answer();
      return { ok: status === 200, status, json: async () => json };
    },
  };
  vm.runInNewContext([
    slice('const PLUS_SI_COMPUTER', 'function plusSiComputerSent'),
    'this.fill = plusSiComputerName; this.sent = plusSiComputerSent; this.state = PLUS_SI_COMPUTER;',
  ].join('\n'), ctx);
  return { ctx, box, field, release: () => release() };
}
const plain = (v) => JSON.parse(JSON.stringify(v));   // out of the vm's realm, so deepEqual compares values

test('#5995: the box appears with the name that would be sent, and the start sends what the box says', async () => {
  const w = world(() => [200, { ok: true, name: 'Studio Mac', fromComputer: true }]);
  assert.equal(w.field.hidden, true, 'CONTROL: the box is on screen before any name was read');
  assert.deepEqual(plain(w.ctx.sent()), {}, 'CONTROL: a box that has shown nothing yet already sends a name');
  await w.ctx.fill();
  assert.equal(w.box.value, 'Studio Mac');
  assert.equal(w.field.hidden, false, 'the name was read and the box stayed hidden');
  assert.equal(w.ctx.measured, 1, 'the card was not measured again after it grew');
  assert.deepEqual(plain(w.ctx.sent()), { computer_name: 'Studio Mac' });
  // The person types over it, then clears it: each is what goes, and an empty box is a choice.
  w.box.value = 'Kit';
  assert.deepEqual(plain(w.ctx.sent()), { computer_name: 'Kit' });
  w.box.value = '';
  assert.deepEqual(plain(w.ctx.sent()), { computer_name: '' });
  // Shown again (the 5 s repaint, a step change): the name is not read a second time and nothing typed is replaced.
  w.box.value = 'Kit';
  await w.ctx.fill();
  assert.deepEqual([w.ctx.reads, w.box.value], [1, 'Kit']);
});

test('#5995: a read that fails leaves the box hidden and sends nothing, so its words are never beside a box that showed no name', async () => {
  for (const answer of [() => [500, { error: 'no' }], () => [403, { error: 'another website' }], () => { throw new Error('offline'); }, () => [200, { ok: true }]]) {
    const w = world(answer);
    await w.ctx.fill();
    assert.equal(w.field.hidden, true, 'the box and its "...by this name" line showed with no name read');
    assert.equal(w.box.value, '');
    assert.deepEqual(plain(w.ctx.sent()), {}, 'an unread name was sent as a cleared one');
    // The start does not try again (on a board that never answers, each press would wait the whole give-up time)...
    await w.ctx.fill();
    assert.equal(w.ctx.reads, 1, 'a start re-ran a read that had just failed');
    // ...and the next time the step is shown, it is read again.
    await w.ctx.fill(true);
    assert.equal(w.ctx.reads, 2, 'a failed read was never tried again');
  }
});

test('#5995: one read at a time, a caller can wait for it, and a read from a sign-in since cleared changes nothing', async () => {
  const w = world(() => [200, { ok: true, name: 'Studio Mac', fromComputer: true }]);
  w.ctx.hold = true;
  const first = w.ctx.fill();
  const second = w.ctx.fill();
  await new Promise((r) => setImmediate(r));
  assert.equal(w.ctx.reads, 1, 'two reads were started for one step');
  assert.deepEqual(plain(w.ctx.sent()), {}, 'CONTROL: the name was sent before its read answered');
  w.release();
  await Promise.all([first, second]);
  assert.deepEqual(plain(w.ctx.sent()), { computer_name: 'Studio Mac' }, 'waiting for the read did not end with the name shown');

  const c = world(() => [200, { ok: true, name: 'Studio Mac', fromComputer: true }]);
  c.ctx.hold = true;
  const old = c.ctx.fill();
  await new Promise((r) => setImmediate(r));
  c.ctx.state.loaded = false; c.ctx.state.reading = null;   // what plusSiClear does
  c.release();
  await old;
  assert.deepEqual([c.box.value, c.field.hidden, plain(c.ctx.sent())], ['', true, {}], 'a read from the cleared sign-in filled the box');
});

test('#5995: a board that takes the request and never answers is given up on, so the start is not held for good', async () => {
  const w = world(() => [200, { ok: true, name: 'Studio Mac', fromComputer: true }]);
  w.ctx.hang = true;
  const reading = w.ctx.fill();
  await new Promise((r) => setImmediate(r));
  const live = w.ctx.timers.filter((t) => !t.cleared);
  assert.equal(live.length, 1, 'no give-up timer was set for the read');
  assert.ok(live[0].ms > 0 && live[0].ms <= 5000, 'the read is waited for longer than a person would: ' + live[0].ms);
  live[0].fn();            // the wait runs out
  await reading;           // CONTROL by construction: without the give-up this never settles and the test times out
  assert.deepEqual([w.field.hidden, plain(w.ctx.sent())], [true, {}], 'a read that was given up on showed a box or sent a name');
  // A read that answers in time clears its timer.
  const ok = world(() => [200, { ok: true, name: 'Studio Mac', fromComputer: true }]);
  await ok.ctx.fill();
  assert.equal(ok.ctx.timers.filter((t) => !t.cleared).length, 0, 'the give-up timer was left running after the read answered');
});

test('#5995: the page wires the box: the email step fills it, the start waits for it and sends it, a new sign-in reads again', () => {
  const body = (name) => slice(name, name);
  assert.match(body('function plusSiShow('), /step === 'plus-si-email'\) plusSiComputerName\(true\)/, 'the email step no longer fills the box, or no longer tries a failed read again');
  const ask = body('async function plusSiRequestCode(');
  assert.match(ask, /plusSiPost\('\/api\/remote\/signin-start', Object\.assign\(\{ email \}, plusSiComputerSent\(\)\)\)/, 'the start no longer sends the name');
  assert.ok(ask.indexOf('await plusSiComputerName();') > 0 && ask.indexOf('await plusSiComputerName();') < ask.indexOf("plusSiPost('/api/remote/signin-start'"), 'the start no longer waits for the name to be on screen');
  const clear = body('function plusSiClear(');
  assert.match(clear, /PLUS_SI_COMPUTER\.loaded = false; PLUS_SI_COMPUTER\.reading = null; PLUS_SI_COMPUTER\.failed = false;/, 'a new sign-in keeps the last one\'s box state');
  assert.match(clear, /getElementById\('plus-si-computer-field'\); if \(cf\) cf\.hidden = true;/, 'a new sign-in starts with the box on screen before its name is read');
  assert.match(SCRIPT, /'plus-si-computer': 'plus-signin-code'/, 'Enter in the box no longer asks for the code');
  const field = HTML.slice(HTML.indexOf('id="plus-si-computer-field"'), HTML.indexOf('id="plus-signin-code"'));
  assert.match(HTML, /<div class="field" id="plus-si-computer-field" hidden>/, 'the box is on screen before its name is read');
  assert.match(field, /<label class="flabel" for="plus-si-computer">Name for this computer<\/label>/);
  const max = Number((/id="plus-si-computer"[^>]*maxlength="(\d+)"/.exec(field) || [])[1]);
  /* The box's limit is the engine's: the longest name deviceNameFrom keeps whole, and one more is cut. */
  const { deviceNameFrom } = require('./engine/remote');
  assert.equal(deviceNameFrom('x'.repeat(max)), 'x'.repeat(max) + ' (Kosmos app)', 'the box lets a name through that the engine then cuts');
  assert.equal(deviceNameFrom('x'.repeat(max + 1)), 'x'.repeat(max) + ' (Kosmos app)', 'the box stops short of what the engine would keep');
});
