'use strict';
/**
 * kosmos#1212. Josh: "at the top I'd like to include a picture of the icon to
 * remind people that they can add it to their desktop... It doesn't have to be
 * huge, just something that will visually grab their attention."
 *
 * 🔑 THE SENTENCE SAYS "IT" AND HAD NOTHING TO POINT AT. "Drag it onto the Dock"
 * asks somebody to find one thing in a folder of hundreds, by a name they met ten
 * minutes ago. The picture is the referent, so this is the sentence becoming
 * answerable rather than an ornament beside it.
 *
 *   node --test web.dock-icon-1212.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');

const row = () => {
  const m = PAGE.match(/<div class="dockrow">[\s\S]*?<\/div>/);
  assert.ok(m, 'the icon row beside the Dock line is gone');
  return m[0];
};

test('the icon stands beside the sentence that names it', () => {
  const r = row();
  assert.match(r, /<img[^>]*class="dockrow-i"/, 'the icon is gone from the Dock row');
  assert.match(r, /Drag it onto the Dock/, 'the icon has been separated from the sentence it illustrates');
  assert.match(r, /alt="The Kosmos app icon"/,
    'the icon has no accessible name; it is informative here, not decorative, so an empty alt would drop the point of it');
});

test('the source is larger than the size it draws at, or it is soft on every Mac', () => {
  /* 📌 A 48px source at 48px is blurry on a retina display, and a blurry picture
     of the icon is worse than none: the entire job is "recognise this exact thing
     later in your Dock". */
  const r = row();
  const src = r.match(/src="\/icons\/kosmos-(\d+)\.png"/);
  const w = r.match(/width="(\d+)"/);
  assert.ok(src && w, 'the icon has no explicit source size or draw width to compare');
  assert.ok(Number(src[1]) >= Number(w[1]) * 2,
    `kosmos-${src[1]} drawn at ${w[1]}px is under 2x and will render soft`);
});

test('the file it points at actually ships', () => {
  /* A reference to an icon we do not ship is a broken image on the one screen
     whose job is to show people what the icon looks like. */
  const src = row().match(/src="(\/icons\/[^"]+)"/);
  assert.ok(src, 'no icon source');
  assert.ok(fs.existsSync(path.join(__dirname, 'web', src[1])), `${src[1]} is referenced but not in web/`);
});

test('CONTROL: the 2x check can fail', () => {
  assert.equal(48 >= 48 * 2, false, 'a 48px source at 48px must not satisfy the rule');
  assert.equal(180 >= 44 * 2, true, 'and the shipped pairing must');
});
