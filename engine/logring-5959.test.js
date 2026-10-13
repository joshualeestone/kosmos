'use strict';

/* #5959 slice 4: engine/logring.js keeps the board's last lines, and never changes what is written. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRing } = require('./logring');

function fakeStream() {
  const written = [];
  return { written, write(chunk, encoding, callback) { written.push(chunk); if (typeof callback === 'function') callback(); return true; } };
}
const fixed = () => new Date('2026-10-12T20:00:00.000Z');

test('#5959: a tapped stream records each finished line, and writes exactly what it was given', () => {
  const ring = createRing({ now: fixed });
  const s = fakeStream();
  assert.equal(ring.tap(s, 'stdout'), true);
  s.write('first line\nsecond ');
  s.write('half\r\nno end yet');
  assert.deepEqual(s.written, ['first line\nsecond ', 'half\r\nno end yet'], 'the write itself is unchanged');
  assert.deepEqual(ring.tail().map((e) => e.line), ['first line', 'second half'], 'an unfinished line is not a line yet');
  assert.equal(ring.tail()[0].stream, 'stdout');
  assert.equal(ring.tail()[0].at, '2026-10-12T20:00:00.000Z');
  s.write('\n');
  assert.equal(ring.tail().at(-1).line, 'no end yet', 'it is recorded once it ends');
});

test('#5959: a Buffer is decoded whole even when a character is split across two writes', () => {
  const ring = createRing();
  const s = fakeStream();
  ring.tap(s, 'stderr');
  const bytes = Buffer.from('café ok\n', 'utf8');
  const cut = bytes.indexOf(0xc3) + 1;   // between the two bytes of the e with an accent
  s.write(bytes.subarray(0, cut));
  s.write(bytes.subarray(cut));
  assert.equal(ring.tail()[0].line, 'café ok');
});

test('#5959: the ring keeps the newest lines and cuts a long one', () => {
  const ring = createRing({ maxLines: 3, maxChars: 5 });
  const s = fakeStream();
  ring.tap(s, 'stdout');
  s.write('a\nb\nc\n');
  assert.deepEqual(ring.tail().map((e) => e.line), ['a', 'b', 'c'], 'CONTROL: under the bound every line is kept');
  s.write('d\n0123456789\n');
  assert.deepEqual(ring.tail().map((e) => e.line), ['c', 'd', '01234']);
  assert.deepEqual(ring.tail(2).map((e) => e.line), ['d', '01234']);
  s.write('x'.repeat(50));
  s.write('\n');
  assert.equal(ring.tail().at(-1).line, 'xxxxx', 'an unfinished line is held cut too');
});

test('#5959: a stream is tapped once, and a failing recorder still lets the write through', () => {
  const ring = createRing();
  const s = fakeStream();
  assert.equal(ring.tap(s, 'stdout'), true);
  assert.equal(ring.tap(s, 'stdout'), false, 'a second tap would record every line twice');
  s.write('one\n');
  assert.equal(ring.tail().length, 1);
  // A Uint8Array in name only: reading its bytes throws inside the recorder.
  const bad = Object.create(Uint8Array.prototype);
  assert.throws(() => bad.byteLength, 'CONTROL: reading it really throws');
  const t = fakeStream();
  ring.tap(t, 'x');
  assert.doesNotThrow(() => t.write(bad));
  assert.equal(t.written.length, 1, 'the write went through');
  assert.equal(ring.tap(null), false);
});

test('#5959: tail returns copies', () => {
  const ring = createRing();
  const s = fakeStream();
  ring.tap(s, 'stdout');
  s.write('kept\n');
  ring.tail()[0].line = 'changed';
  assert.equal(ring.tail()[0].line, 'kept');
});

test('#5959: a string written in a non-text encoding is not recorded as a line, as logstamp leaves it', () => {
  const ring = createRing();
  const s = fakeStream();
  ring.tap(s, 'stdout');
  s.write('68656c6c6f0a', 'hex');
  s.write('text line\n', 'utf8');
  assert.deepEqual(ring.tail().map((e) => e.line), ['text line']);
  assert.equal(s.written.length, 2, 'both writes went through');
});
