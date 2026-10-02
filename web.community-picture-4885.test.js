'use strict';
/**
 * kosmos#4885: an agent's picture travels with it to the Kosmos+ community. The page half:
 *   - Settings > Community says the picture goes with the agent, and what stays up while switched off;
 *   - every path that stores a picture passes it through fitPicture first (the canvas work itself is
 *     docs/browser-checks/render-picture-fit-4885.js, in a real browser);
 *   - a picture the board can no longer take down (picturesStuck) is said in Settings, and nothing is said otherwise;
 *   - pictures saved earlier that cannot go as they are (picturesUnsendable) are counted in Settings, which re-reads
 *     both counts each time its Automation section opens;
 *   - the agent page says when a chosen picture could not be fitted for the community;
 *   - pictureStill reads the bytes the way the community does.
 *
 *   node --test web.community-picture-4885.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');

function lift(name) {
  const at = HTML.indexOf('function ' + name + '(');
  assert.ok(at > 0, name + ' is not in web/index.html');
  const end = HTML.indexOf('\n}\n', at);
  return HTML.slice(at, end + 3);
}

test('#4885: Settings > Community says each agent\'s picture goes with it, and that a picture stays up until removed', () => {
  const f = flat(HTML);
  assert.ok(f.includes('Their public profiles show each agent’s picture, and the kind of business you pick below, if you pick one.</p>'), 'the picture line is missing from the switch\'s description');
  assert.ok(f.includes('stays there until you pick None, and a picture stays until you remove it from the agent.'), 'the off note says nothing about pictures');
});

test('#4885: every path that stores an agent\'s picture passes it through fitPicture first', () => {
  // The detail panel's file input, the create flow's pending picture, and a team member's portrait or mark.
  assert.match(HTML, /const pic = await fitPicture\(f\);[^\n]*\n\s*const res = await fetch\('\/api\/agent\/' \+ encodeURIComponent\(forAgent\) \+ '\/avatar',\n\s*\{ method: 'PUT', headers: \{ 'content-type': pic\.type \|\| f\.type \}, body: pic \}\);/);
  assert.match(HTML, /const up = await fitPicture\(chosen\);/);
  assert.match(HTML, /blob = await fitPicture\(blob\);[^\n]*\n\s*const res = await fetch\('\/api\/agent\/' \+ encodeURIComponent\(name\) \+ '\/avatar', \{ method: 'PUT'/);
  // A tripwire, not a proof: it counts PUTs written in this one form, so a fourth written the same way trips it.
  const puts = HTML.match(/'\/api\/agent\/' \+ encodeURIComponent\([a-zA-Z]+\) \+ '\/avatar',\s*\{\s*method: 'PUT'/g) || [];
  assert.equal(puts.length, 3, 'a new place stores an agent\'s picture without fitPicture: ' + puts.length);
});

test('#4885: the create flow clears its pending picture before it waits, and still knows a chosen file from the mark', () => {
  const src = lift('uploadPendingAvatar');
  assert.ok(src.indexOf('PENDING_AVATAR = null;') < src.indexOf('await fitPicture(chosen)'), 'the pending picture is cleared only after an await');
  assert.match(src, /if \(chosen === AVATAR_FILE && AVATAR_FILE\) \{/);
});

/* industryPaint with a stand-in document: only the elements it touches. */
function paint(r) {
  const els = {};
  // Each element starts SHOWN with old text, so a paint that never hides or clears the line cannot pass.
  const el = (id) => (els[id] = els[id] || { id, hidden: false, textContent: 'stale', value: '', children: [], appendChild(c) { this.children.push(c); } });
  const document = { getElementById: el, createElement: () => ({}) };
  const INDUSTRY_NONE_LABEL = 'None';
  const INDUSTRY_UNKNOWN_LABEL = 'Unknown';
  // eslint-disable-next-line no-new-func
  new Function('document', 'INDUSTRY_NONE_LABEL', 'INDUSTRY_UNKNOWN_LABEL', lift('industryPaint') + '\nindustryPaint(arguments[3]);')(document, INDUSTRY_NONE_LABEL, INDUSTRY_UNKNOWN_LABEL, r);
  return el(arguments[1] || 'community-picture-stuck');
}

test('#4885: a picture the board can no longer take down is said in Settings; none, or a board that does not say, says nothing', () => {
  const base = { ok: true, industry: null, industries: [] };
  for (const [r, why] of [[{ ...base, picturesStuck: 0 }, 'zero'], [base, 'no pictures field'], [null, 'an unreadable answer'],
    [{ ...base, picturesStuck: null }, 'cannot tell'], [{ ...base, picturesStuck: '2' }, 'a count that is not a number']]) {
    const line = paint(r);
    assert.equal(line.hidden, true, why + ': the line stayed shown');
    assert.equal(line.textContent, '', why + ': the old words stayed');
  }
  const one = paint({ ...base, picturesStuck: 1 });
  assert.equal(one.hidden, false);
  assert.equal(one.textContent, 'One agent’s picture may still show in the community. The community shut that agent out, so Kosmos can no longer take it down.');
  const two = paint({ ...base, picturesStuck: 2 });
  assert.equal(two.textContent, '2 agents’ pictures may still show in the community. The community shut those agents out, so Kosmos can no longer take them down.');
  assert.ok(!/[\u2014]/.test(one.textContent + two.textContent));
  assert.match(HTML, /<p class="dhint" id="community-picture-stuck" style="margin:4px 0 0;" hidden><\/p>/);
});

test('#4885: pictures that cannot go as they are (saved before Kosmos fitted them) are said, with what to do', () => {
  const base = { ok: true, industry: null, industries: [] };
  for (const [r, why] of [[{ ...base, picturesUnsendable: 0 }, 'zero'], [base, 'no field'], [null, 'unreadable'],
    [{ ...base, picturesUnsendable: null }, 'cannot tell']]) {
    const line = paint(r, 'community-picture-unsendable');
    assert.equal(line.hidden, true, why);
    assert.equal(line.textContent, '', why);
  }
  assert.equal(paint({ ...base, picturesUnsendable: 1 }, 'community-picture-unsendable').textContent,
    'One agent’s picture cannot go to the community as it is. Choose it again on the agent’s page and Kosmos will fit it.');
  assert.equal(paint({ ...base, picturesUnsendable: 3 }, 'community-picture-unsendable').textContent,
    '3 agents’ pictures cannot go to the community as they are. Choose each one again on the agent’s page and Kosmos will fit it.');
});

/* pictureStill reads the bytes the way the community does (kosmos-community app/avatars.py). */
const pictureStill = new Function(lift('pictureTurned') + lift('pictureStill') + '\nreturn pictureStill;')();
const chunk = (kind, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(kind, 'latin1'), data, Buffer.alloc(4)]);   // the CRC is not read here
};
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const png = (...chunks) => new Uint8Array(Buffer.concat([PNG_SIG, chunk('IHDR', Buffer.alloc(13)), ...chunks, chunk('IEND', Buffer.alloc(0))]));
const riff = (...chunks) => {
  const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...chunks]);
  const size = Buffer.alloc(4); size.writeUInt32LE(body.length);
  return new Uint8Array(Buffer.concat([Buffer.from('RIFF', 'latin1'), size, body]));
};
const wchunk = (kind, data) => {
  const len = Buffer.alloc(4); len.writeUInt32LE(data.length);
  return Buffer.concat([Buffer.from(kind, 'latin1'), len, data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
};

test('#4885 pictureStill: a still PNG or WebP is kept; an animated one, a JPEG, or a cut-short file is not', () => {
  assert.equal(pictureStill(png(chunk('IDAT', Buffer.alloc(20)))), true);
  // An animation chunk after a text chunk far past the first 4 KB (where a head-only scan stopped looking).
  assert.equal(pictureStill(png(chunk('tEXt', Buffer.alloc(6000, 65)), chunk('acTL', Buffer.alloc(8)), chunk('IDAT', Buffer.alloc(20)))), false);
  assert.equal(pictureStill(png(chunk('IDAT', Buffer.alloc(20)), chunk('fdAT', Buffer.alloc(8)))), false);
  // eXIf: one that turns the picture is redrawn; one with no turn (WebKit writes such a chunk into every PNG it makes,
  // these bytes are WebKit's own) or one saying upright is kept.
  const exif = (orientation) => Buffer.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0]);
  assert.equal(pictureStill(png(chunk('eXIf', exif(6)), chunk('IDAT', Buffer.alloc(20)))), false, 'a PNG turned by its eXIf is kept as chosen');
  assert.equal(pictureStill(png(chunk('eXIf', exif(1)), chunk('IDAT', Buffer.alloc(20)))), true, 'an upright eXIf is redrawn for nothing');
  const webkit = Buffer.from([77,77,0,42,0,0,0,8,0,1,135,105,0,4,0,0,0,1,0,0,0,26,0,0,0,0,0,3,160,1,0,3,0,0,0,1,0,1,0,0,160,2,0,4,0,0,0,1,0,0,0,96,160,3,0,4,0,0,0,1,0,0,0,96,0,0,0,0]);
  assert.equal(pictureStill(png(chunk('sRGB', Buffer.alloc(1)), chunk('eXIf', webkit), chunk('IDAT', Buffer.alloc(20)))), true, 'a WebKit PNG is redrawn for nothing');
  const prefixed = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), exif(6)]);
  assert.equal(pictureStill(png(chunk('eXIf', prefixed), chunk('IDAT', Buffer.alloc(20)))), false, 'an Exif-prefixed eXIf that turns the PNG is missed');
  assert.equal(pictureStill(riff(wchunk('VP8 ', Buffer.alloc(10))), true), false, 'a WebP is kept when only a PNG may be');
  const ii = Buffer.from([0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(pictureStill(png(chunk('eXIf', ii), chunk('IDAT', Buffer.alloc(20)))), false, 'little-endian EXIF is read too');
  assert.equal(pictureStill(png(chunk('IDAT', Buffer.alloc(20))).subarray(0, 40)), false, 'a PNG cut short before IEND');
  assert.equal(pictureStill(riff(wchunk('VP8 ', Buffer.alloc(10)))), true);
  const vp8x = Buffer.alloc(10); vp8x[0] = 0x02;   // the animation flag
  assert.equal(pictureStill(riff(wchunk('VP8X', vp8x), wchunk('VP8 ', Buffer.alloc(10)))), false);
  assert.equal(pictureStill(riff(wchunk('ICCP', Buffer.alloc(5001)), wchunk('ANIM', Buffer.alloc(6)))), false);
  assert.equal(pictureStill(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), false, 'a JPEG is never kept as chosen');
  assert.equal(pictureStill(new Uint8Array(0)), false);
  const noIdat = new Uint8Array(Buffer.concat([PNG_SIG, chunk('IHDR', Buffer.alloc(13)), chunk('IEND', Buffer.alloc(0))]));
  assert.equal(pictureStill(noIdat), false, 'a PNG with no picture data is kept as chosen');
  const late = new Uint8Array(Buffer.concat([PNG_SIG, chunk('tEXt', Buffer.alloc(4)), chunk('IHDR', Buffer.alloc(13)), chunk('IDAT', Buffer.alloc(20)), chunk('IEND', Buffer.alloc(0))]));
  assert.equal(pictureStill(late), false, 'a PNG whose first chunk is not IHDR is kept as chosen');
  const short = new Uint8Array(Buffer.concat([PNG_SIG, chunk('IHDR', Buffer.alloc(12)), chunk('IDAT', Buffer.alloc(20)), chunk('IEND', Buffer.alloc(0))]));
  assert.equal(pictureStill(short), false, 'a PNG with a 12-byte IHDR is kept as chosen');
  const cut = png(chunk('IDAT', Buffer.alloc(20)));
  assert.equal(pictureStill(cut.subarray(0, cut.length - 6)), false, 'a PNG whose last chunk is cut short is kept as chosen');
});

test('#4885: Settings re-reads the picture counts each time its Automation section opens, not only at page load', () => {
  assert.match(HTML, /if \(section === 'automation' && typeof refreshIndustry === 'function' && !INDUSTRY_SAVING\) refreshIndustry\(\);/);
});

test('#4885: the agent page says when a chosen picture could not be fitted for the community', () => {
  assert.match(HTML, /const unsendable = !PICTURE_FITS\.has\(pic\)\s*&& \(pic\.size > PICTURE_MAX_BYTES \|\| !\['image\/png', 'image\/jpeg', 'image\/webp'\]\.includes\(pic\.type\)\);\s*msg\.textContent = unsendable \? 'Saved\. Kosmos could not fit this picture for the community, so it will not show there\.' : 'Saved\.';/);
  // fitPicture vouches for what it returns kept or redrawn, and only that.
  const fit = lift('fitPicture');
  assert.equal((fit.match(/PICTURE_FITS\.add\(/g) || []).length, 2, 'fitPicture vouches for something other than a kept or redrawn picture');
});
