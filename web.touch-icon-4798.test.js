'use strict';
/**
 * kosmos#4798 (Josh, 2026-09-30 17:53): "if I save the icon as a bookmark for my home screen, it has a big black
 * stroke around it." iOS fills a touch icon's transparent pixels with black and then applies its own rounded mask,
 * so the Mac icon (already rounded, inside a clear margin) got a black frame. Android's maskable icons have the
 * same rule. So every home-screen icon the page declares must be a FULL-BLEED OPAQUE square: no alpha channel, and
 * gold at all four corners (no drawn rounding either).
 *
 * Read from the PNG bytes, not from a picture of them: the header's colour type says whether there is an alpha
 * channel, and the first and last rows are decoded (zlib, PNG row filters) to read the corners.
 *
 * CONTROL: kosmos-180.png, the Mac icon the page used to declare, fails every one of these (it has alpha, and its
 * corners are clear). It stays in the repo for the Dock row, so the control keeps running against the real file.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const WEB = path.join(__dirname, 'web');

/* The PNG header and the four corner pixels. Handles colour types 2 (RGB) and 6 (RGBA), 8 bits, no interlace,
   which is all these icons are; anything else is reported as unreadable rather than guessed at. */
function readPng(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.toString('latin1', 1, 4), 'PNG', `${file} is not a PNG`);
  let off = 8; const idat = []; let ihdr = null;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], colour: data[9], interlace: data[12] };
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const bpp = ihdr.colour === 6 ? 4 : ihdr.colour === 2 ? 3 : 0;
  if (!bpp || ihdr.depth !== 8 || ihdr.interlace) return { ...ihdr, corners: null };
  const raw = zlib.inflateSync(Buffer.concat(idat)); const stride = ihdr.w * bpp;
  let prev = Buffer.alloc(stride); const rows = [];
  for (let y = 0; y < ihdr.h; y++) {
    const f = raw[y * (stride + 1)]; const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0; const b = prev[i]; const c = i >= bpp ? prev[i - bpp] : 0;
      const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? Math.floor((a + b) / 2) : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      line[i] = (line[i] + pred) & 0xff;
    }
    if (y === 0 || y === ihdr.h - 1) rows.push(Buffer.from(line));
    prev = line;
  }
  const px = (row, x) => [...row.subarray(x * bpp, x * bpp + bpp)];
  const last = ihdr.w - 1;
  return { ...ihdr, corners: [px(rows[0], 0), px(rows[0], last), px(rows[1], 0), px(rows[1], last)] };
}

/* Opaque, square at the declared size, gold at every corner. Returns the problems, empty when it is right. */
function homeScreenProblems(file, size) {
  const p = readPng(file); const out = [];
  if (p.w !== size || p.h !== size) out.push(`${p.w}x${p.h}, not ${size}x${size}`);
  if (p.colour !== 2) out.push(`colour type ${p.colour} (${p.colour === 6 ? 'has an alpha channel' : 'not RGB'})`);
  for (const c of p.corners || [[0, 0, 0, 0]]) {
    const [r, g, b, a = 255] = c;
    if (a < 255 || r < 180 || g < 120 || b > 90) out.push(`a corner is not opaque gold: ${c.join(',')}`);
  }
  return out;
}

test('#4798: the page\'s apple-touch-icon is a full-bleed opaque 180 square', () => {
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const m = html.match(/<link rel="apple-touch-icon" sizes="180x180" href="\/icons\/([^"]+)">/);
  assert.ok(m, 'no 180x180 apple-touch-icon link in web/index.html');
  assert.deepEqual(homeScreenProblems(path.join(WEB, 'icons', m[1]), 180), [], m[1]);
});

test('#4798: the manifest declares maskable icons, and each is a full-bleed opaque square', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(WEB, 'manifest.webmanifest'), 'utf8'));
  const maskable = manifest.icons.filter((i) => String(i.purpose || '').split(/\s+/).includes('maskable'));
  assert.ok(maskable.length >= 2, 'the manifest declares fewer than two maskable icons');
  for (const icon of maskable) {
    const size = Number(icon.sizes.split('x')[0]);
    assert.deepEqual(homeScreenProblems(path.join(WEB, icon.src.replace(/^\//, '')), size), [], icon.src);
  }
});

test('#4798 CONTROL: the Mac icon the page used to declare fails the same check', () => {
  const problems = homeScreenProblems(path.join(WEB, 'icons', 'kosmos-180.png'), 180);
  assert.ok(problems.some((p) => /alpha/.test(p)), 'the control is not RGBA any more: ' + problems.join('; '));
  assert.ok(problems.some((p) => /corner/.test(p)), 'the control\'s corners read as opaque gold: ' + problems.join('; '));
});
