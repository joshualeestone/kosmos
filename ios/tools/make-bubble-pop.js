'use strict';
/**
 * kosmos#7345 (Josh 10-27): the iPhone's notification sound is the Mac's "bubble pop" (web/index.html playBubblePop),
 * which the board synthesises with Web Audio and never ships as a file. This renders the same voice to a WAV: a sine
 * gliding 400 to 900 Hz over 0.9 of a 0.13 s life (holding the top the last tenth), a 4 ms linear attack from 0.0001 to
 * the peak, then an exponential fall to 0.0001 at 0.13 s, stopped at 0.15 s.
 *
 * Peak: 0.5, the level the page auditioned the voice at. The board plays it at 0.08 inside the page; as a notification
 * the phone's own volume governs it, and 0.08 would be close to silent.
 *
 *   node ios/tools/make-bubble-pop.js <out.wav>
 *   afconvert -f caff -d LEI16 <out.wav> ios/Kosmos/bubble-pop.caf
 */
const fs = require('node:fs');

const RATE = 44100;
const DUR = 0.13;
const STOP = DUR + 0.02;
const PEAK = 0.5;
const FLOOR = 0.0001;
const ATTACK = 0.004;

function gainAt(t) {
  if (t < ATTACK) return FLOOR + (PEAK - FLOOR) * (t / ATTACK);
  if (t < DUR) return PEAK * Math.pow(FLOOR / PEAK, (t - ATTACK) / (DUR - ATTACK));
  return FLOOR;
}
function freqAt(t) {
  const glide = DUR * 0.9;
  return t < glide ? 400 + (900 - 400) * (t / glide) : 900;
}

function render() {
  const n = Math.round(STOP * RATE);
  const out = new Int16Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    phase += (2 * Math.PI * freqAt(t)) / RATE;
    out[i] = Math.round(Math.max(-1, Math.min(1, Math.sin(phase) * gainAt(t))) * 32767);
  }
  return out;
}

function wav(samples) {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

if (require.main === module) {
  const target = process.argv[2];
  if (!target) { process.stderr.write('usage: node ios/tools/make-bubble-pop.js <out.wav>\n'); process.exit(2); }
  fs.writeFileSync(target, wav(render()));
}

module.exports = { render, wav, gainAt, freqAt, RATE, DUR, STOP, PEAK };
