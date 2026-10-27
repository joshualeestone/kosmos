'use strict';
/**
 * kosmos#7345: the iPhone's notification sound (ios/Kosmos/bubble-pop.caf) is the Mac's bubble pop. This keeps the
 * three in step: the board's voice (web/index.html playBubblePop), the generator (ios/tools/make-bubble-pop.js), and the
 * file the app ships.
 *
 *   node --test ios.bubble-pop-7345.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pop = require('./ios/tools/make-bubble-pop');

const CAF = path.join(__dirname, 'ios', 'Kosmos', 'bubble-pop.caf');

/* The samples in a CAF file's data chunk (16-bit little-endian PCM, as afconvert -d LEI16 writes it). */
function cafSamples(buf) {
  assert.equal(buf.toString('ascii', 0, 4), 'caff', 'a CAF file');
  let at = 8;
  while (at + 12 <= buf.length) {
    const type = buf.toString('ascii', at, at + 4);
    const size = Number(buf.readBigUInt64BE(at + 4));
    if (type === 'data') {
      const body = buf.subarray(at + 12 + 4, at + 12 + size);   // after the 4-byte edit count
      const out = new Int16Array(body.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = body.readInt16LE(i * 2);
      return out;
    }
    at += 12 + size;
  }
  return null;
}

test('kosmos#7345: the generator plays the board\'s own voice (frequencies, life and glide read from playBubblePop)', () => {
  const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const start = html.indexOf('function playBubblePop()');
  assert.ok(start > 0, 'playBubblePop was found in the board page');
  const body = html.slice(start, start + 2000);
  assert.match(body, /const dur = 0\.13;/, 'the board\'s life is 0.13 s');
  assert.match(body, /setValueAtTime\(400, now\)/, 'the board starts at 400 Hz');
  assert.match(body, /linearRampToValueAtTime\(900, now \+ dur \* 0\.9\)/, 'and glides to 900 Hz over 0.9 of the life');
  assert.match(body, /now \+ 0\.004\)/, 'with a 4 ms attack');
  assert.equal(pop.DUR, 0.13);
  assert.equal(pop.freqAt(0), 400);
  assert.equal(pop.freqAt(pop.DUR), 900);
  assert.ok(Math.abs(pop.freqAt(pop.DUR * 0.45) - 650) < 1, 'halfway through the glide is halfway in pitch');
});

test('kosmos#7345: the app ships exactly what the generator makes', () => {
  const shipped = cafSamples(fs.readFileSync(CAF));
  assert.ok(shipped, 'the CAF file has a data chunk');
  const made = pop.render();
  assert.equal(shipped.length, made.length, 'the same length');
  let worst = 0;
  for (let i = 0; i < made.length; i++) worst = Math.max(worst, Math.abs(shipped[i] - made[i]));
  assert.ok(worst <= 1, `the shipped sound matches the generator (largest sample difference ${worst})`);
  // CONTROL: the comparison can fail: a pop at another pitch differs by far more.
  const other = new Int16Array(made.length);
  for (let i = 0; i < made.length; i++) other[i] = Math.round(Math.sin((2 * Math.PI * 300 * i) / pop.RATE) * pop.gainAt(i / pop.RATE) * 32767);
  let apart = 0;
  for (let i = 0; i < made.length; i++) apart = Math.max(apart, Math.abs(other[i] - made[i]));
  assert.ok(apart > 1000, 'CONTROL: a different sound does not pass as the same');
});

test('kosmos#7345: the sound is short and audible enough for a notification', () => {
  const made = pop.render();
  assert.ok(made.length / pop.RATE < 30, 'under the 30 s iOS allows a notification sound');
  let peak = 0;
  for (const s of made) peak = Math.max(peak, Math.abs(s));
  assert.ok(peak > 0.3 * 32767, `loud enough to hear (peak ${(peak / 32767).toFixed(2)})`);
});
