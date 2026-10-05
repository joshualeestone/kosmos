'use strict';
/* kosmos#5297: the owed "read this section again" lines. node --test engine/instructionreread.test.js */
require('../test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-instructionreread-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
const test = require('node:test');
const assert = require('node:assert/strict');
const ir = require('./instructionreread');
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const D = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' };
const T = Date.parse('2026-10-05T15:00:00Z');

test('the file is in the sandboxed data root, and an absent or odd file reads as empty', () => {
  assert.ok(ir.file().startsWith(SANDBOX), 'the debt file is outside the sandbox');
  assert.deepEqual(ir.readOwed(), {});
  fs.mkdirSync(path.dirname(ir.file()), { recursive: true });
  fs.writeFileSync(ir.file(), '[1,2]');
  assert.deepEqual(ir.readOwed(), {});
  fs.writeFileSync(ir.file(), JSON.stringify({ a: { at: T, sections: ['community', 'nonsense'] }, b: { at: 'x', sections: ['rules'] }, c: { at: T, sections: [] } }));
  assert.deepEqual(ir.readOwed(), { a: { at: T, sections: ['community'] } });
});

test('owe adds a section once and keeps the first time; an unknown section is ignored', () => {
  let o = ir.owe({}, 'ann', 'community', T);
  o = ir.owe(o, 'ann', 'rules', T + 1000);
  o = ir.owe(o, 'ann', 'community', T + 2000);
  o = ir.owe(o, 'ann', 'bogus', T + 3000);
  assert.deepEqual(o, { ann: { at: T, sections: ['community', 'rules'] } });
  assert.ok(ir.writeOwed(o));
  assert.deepEqual(ir.readOwed(), o);
  assert.ok(ir.oweNow('bea', 'rules', T));
  assert.deepEqual(ir.readOwed().bea, { at: T, sections: ['rules'] });
});

test('settle: a line that landed clears the debt; a held, busy or refused one keeps it; past GIVE_UP_MS it is dropped', () => {
  const o = { ann: { at: T, sections: ['community'] } };
  assert.deepEqual(ir.settle(o, 'ann', { state: D.PLACED }, D, T), {});
  assert.deepEqual(ir.settle(o, 'ann', { state: D.UNCONFIRMED }, D, T), {});
  assert.deepEqual(ir.settle(o, 'ann', { state: D.COULD_NOT, held: true }, D, T), o, 'a quota-held refusal cleared the debt');
  assert.deepEqual(ir.settle(o, 'ann', { state: D.PLACED, busy: true }, D, T), o);
  assert.deepEqual(ir.settle(o, 'ann', null, D, T), o, 'a throw (no verdict) cleared the debt');
  assert.deepEqual(ir.settle(o, 'ann', { state: D.COULD_NOT }, D, T + ir.GIVE_UP_MS + 1), {});
});

test('lineFor names every owed section, the community one by its own heading', () => {
  const cb = require('./communityblock');
  const heading = cb.blockBody().split('\n')[0].replace(/^## /, '');
  assert.ok(ir.lineFor(['community']).includes('"' + heading + '"'));
  const both = ir.lineFor(['community', 'rules']);
  assert.ok(both.includes(heading) && both.includes('the working rules'));
  assert.equal(ir.lineFor([]), null);
  assert.equal(ir.lineFor(['bogus']), null);
});
