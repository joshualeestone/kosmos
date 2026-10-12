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
  let release = null;
  const ctx = {
    document: { getElementById: (id) => (id === 'plus-si-computer' ? box : null) },
    fetch: async (path) => {
      assert.equal(path, '/api/remote/computer-name');
      if (ctx.hold) await new Promise((r) => { release = r; });
      const [status, json] = answer();
      return { ok: status === 200, status, json: async () => json };
    },
  };
  vm.runInNewContext([
    slice('const PLUS_SI_COMPUTER', 'function plusSiComputerSent'),
    'this.fill = plusSiComputerName; this.sent = plusSiComputerSent; this.state = PLUS_SI_COMPUTER;',
  ].join('\n'), ctx);
  return { ctx, box, release: () => release() };
}
const plain = (v) => JSON.parse(JSON.stringify(v));   // out of the vm's realm, so deepEqual compares values

test('#5995: the box shows the name that would be sent, and the start sends what the box says', async () => {
  const w = world(() => [200, { ok: true, name: 'Studio Mac', fromComputer: true }]);
  assert.deepEqual(plain(w.ctx.sent()), {}, 'CONTROL: a box that has shown nothing yet already sends a name');
  await w.ctx.fill();
  assert.equal(w.box.value, 'Studio Mac');
  assert.deepEqual(plain(w.ctx.sent()), { computer_name: 'Studio Mac' });
  // The person clears it: that is a choice, and it is sent as an empty name.
  w.box.value = '';
  assert.deepEqual(plain(w.ctx.sent()), { computer_name: '' });
});

test('#5995: a read that fails fills nothing and sends nothing, so an empty box is never read as the person clearing it', async () => {
  for (const answer of [() => [500, { error: 'no' }], () => { throw new Error('offline'); }, () => [200, { ok: true }]]) {
    const w = world(answer);
    await w.ctx.fill();
    assert.equal(w.box.value, '');
    assert.deepEqual(plain(w.ctx.sent()), {}, 'an unread name was sent as a cleared one');
  }
});

test('#5995: a name the person is typing is not replaced by a read that answers late, and it is what goes', async () => {
  const w = world(() => [200, { ok: true, name: 'Studio Mac', fromComputer: true }]);
  w.ctx.hold = true;
  const reading = w.ctx.fill();
  await new Promise((r) => setImmediate(r));
  w.box.value = 'Kit';
  w.ctx.state.touched = true;             // what the box's input listener does
  w.release();
  await reading;
  assert.equal(w.box.value, 'Kit', 'the late answer typed over the person');
  assert.deepEqual(plain(w.ctx.sent()), { computer_name: 'Kit' });
});

test('#5995: the page wires the box: the email step fills it, a typed character marks it, the start sends it, a new sign-in reads again', () => {
  const body = (name) => slice(name, name);
  assert.match(body('function plusSiShow('), /step === 'plus-si-email'\) plusSiComputerName\(\)/, 'the email step no longer fills the box');
  assert.match(body('async function plusSiRequestCode('), /plusSiPost\('\/api\/remote\/signin-start', Object\.assign\(\{ email \}, plusSiComputerSent\(\)\)\)/, 'the start no longer sends the name');
  assert.match(body('function plusSiClear('), /PLUS_SI_COMPUTER\.loaded = false; PLUS_SI_COMPUTER\.touched = false;/, 'a new sign-in keeps the last one\'s box state');
  assert.match(SCRIPT, /getElementById\('plus-si-computer'\); if \(cn\) cn\.addEventListener\('input', \(\) => \{ PLUS_SI_COMPUTER\.touched = true; \}\)/, 'typing no longer marks the box');
  assert.match(SCRIPT, /'plus-si-computer': 'plus-signin-code'/, 'Enter in the box no longer asks for the code');
  const field = HTML.slice(HTML.indexOf('id="plus-si-computer-field"'), HTML.indexOf('id="plus-signin-code"'));
  assert.match(field, /<label class="flabel" for="plus-si-computer">Name for this computer<\/label>/);
  assert.match(field, /id="plus-si-computer"[^>]*maxlength="47"/, 'the box no longer stops at what fits before the ending the engine adds');
});
