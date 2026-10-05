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
  assert.ok(f.includes('Their public profiles show each agent’s picture, and the kind of business you pick below, if you pick one.'), 'the picture line is missing from the switch\'s description');
  assert.ok(f.includes('stays there until you pick None, and a picture stays until you remove it from the agent.'), 'the off note says nothing about pictures');
});

test('#4885: every path that stores an agent\'s picture passes it through fitPicture first', () => {
  // The detail panel's file input, the create flow's pending picture, and a team member's portrait or mark.
  assert.match(HTML, /const pic = await fitPicture\(f\);[^\n]*\n\s*const res = await fetch\('\/api\/agent\/' \+ encodeURIComponent\(forAgent\) \+ '\/avatar',\n\s*\{ method: 'PUT', headers: \{ 'content-type': pic\.type \|\| f\.type \}, body: pic \}\);/);
  assert.match(HTML, /const up = await fitPicture\(chosen\);/);
  assert.match(HTML, /blob = await fitPicture\(blob\);[^\n]*\n\s*const res = await fetch\('\/api\/agent\/' \+ encodeURIComponent\(name\) \+ '\/avatar', \{ method: 'PUT'/);
  // A tripwire, not a proof: it counts PUTs written in this one form, so a fourth written the same way trips it.
  const puts = HTML.match(/'\/api\/agent\/' \+ encodeURIComponent\([a-zA-Z]+\) \+ '\/avatar',\s*\{\s*method: 'PUT'/g) || [];
  // kosmos#5302: the fourth, refitOldPictures, fits before it stores.
  assert.match(lift('refitOldPictures'), /const pic = await fitPicture\(await got\.blob\(\)\);\n\s*if \(!PICTURE_FITS\.has\(pic\)\) continue;\n\s*const put = await fetch\('\/api\/agent\/' \+ encodeURIComponent\(name\) \+ '\/avatar', \{ method: 'PUT'/);
  assert.equal(puts.length, 4, 'a new place stores an agent\'s picture without fitPicture: ' + puts.length);
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
    'One agent’s picture cannot go to the community as it is. Choose a different picture, or the same one again, on the agent’s page and Kosmos will fit it if it can.');
  assert.equal(paint({ ...base, picturesUnsendable: 3 }, 'community-picture-unsendable').textContent,
    '3 agents’ pictures cannot go to the community as they are. Choose a different picture, or the same one again, on the agent’s page and Kosmos will fit it if it can.');
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

test('#4885 pictureStill: a still PNG is kept; an animated one, a WebP, a JPEG, or a cut-short file is not', () => {
  assert.equal(pictureStill(riff(wchunk('VP8 ', Buffer.alloc(10)))), false, 'a WebP is kept as chosen (every WebP is redrawn)');
  assert.equal(pictureStill(png(chunk('IDAT', Buffer.alloc(20)))), true);
  // An animation chunk after a text chunk far past the first 4 KB (where a head-only scan stopped looking).
  assert.equal(pictureStill(png(chunk('tEXt', Buffer.alloc(6000, 65)), chunk('acTL', Buffer.alloc(8)), chunk('IDAT', Buffer.alloc(20)))), false);
  assert.equal(pictureStill(png(chunk('IDAT', Buffer.alloc(20)), chunk('fdAT', Buffer.alloc(8)))), false);
  // eXIf: one that turns the picture is redrawn; one with no turn (WebKit writes such a chunk into every PNG it makes,
  // these bytes are WebKit's own) or one saying upright is kept.
  const exif = (orientation) => Buffer.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0]);
  assert.equal(pictureStill(png(chunk('eXIf', exif(6)), chunk('IDAT', Buffer.alloc(20)))), false, 'a PNG turned by its eXIf is kept as chosen');
  assert.equal(pictureStill(png(chunk('eXIf', exif(1)), chunk('IDAT', Buffer.alloc(20)))), true, 'an upright eXIf is redrawn for nothing');
  assert.equal(pictureStill(png(chunk('eXIf', exif(0)), chunk('IDAT', Buffer.alloc(20)))), true, 'Orientation 0 is upright, as the community reads it');
  const webkit = Buffer.from([77,77,0,42,0,0,0,8,0,1,135,105,0,4,0,0,0,1,0,0,0,26,0,0,0,0,0,3,160,1,0,3,0,0,0,1,0,1,0,0,160,2,0,4,0,0,0,1,0,0,0,96,160,3,0,4,0,0,0,1,0,0,0,96,0,0,0,0]);
  assert.equal(pictureStill(png(chunk('sRGB', Buffer.alloc(1)), chunk('eXIf', webkit), chunk('IDAT', Buffer.alloc(20)))), true, 'a WebKit PNG is redrawn for nothing');
  const prefixed = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), exif(6)]);
  assert.equal(pictureStill(png(chunk('eXIf', prefixed), chunk('IDAT', Buffer.alloc(20)))), false, 'an Exif-prefixed eXIf that turns the PNG is missed');
  const ii = Buffer.from([0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(pictureStill(png(chunk('eXIf', ii), chunk('IDAT', Buffer.alloc(20)))), false, 'little-endian EXIF is read too');
  assert.equal(pictureStill(png(chunk('IDAT', Buffer.alloc(20))).subarray(0, 40)), false, 'a PNG cut short before IEND');
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
  assert.match(HTML, /if \(section === 'automation' && typeof refreshIndustry === 'function' && !INDUSTRY_SAVING\) refreshIndustry\(false, true\);/);
});

test('#4885: a quiet re-read that fails leaves the screen as it was; a page-load read that fails says so', async () => {
  for (const [quiet, failWith, painted] of [[true, 'status', 0], [true, 'throw', 0], [false, 'status', 1], [false, 'throw', 1], [true, 'ok', 1]]) {
    const calls = [];
    const fetch = async () => {
      if (failWith === 'throw') throw new Error('offline');
      return failWith === 'status' ? { ok: false } : { ok: true, json: async () => ({ ok: true }) };
    };
    // eslint-disable-next-line no-new-func
    const document = { getElementById: () => ({ hidden: false }) };   // something is already on screen
    const run = new Function('fetch', 'industryPaint', 'document', 'let INDUSTRY_EPOCH = 0; async ' + lift('refreshIndustry') + 'return refreshIndustry;')(fetch, (r) => calls.push(r), document);
    await run(false, quiet);
    assert.equal(calls.length, painted, 'quiet=' + quiet + ' ' + failWith);
  }
  // A page that opens straight onto Automation has nothing on screen yet: a quiet read that fails still says so.
  const calls = [];
  const blank = { getElementById: () => ({ hidden: true }) };
  const run = new Function('fetch', 'industryPaint', 'document', 'let INDUSTRY_EPOCH = 0; async ' + lift('refreshIndustry') + 'return refreshIndustry;')(async () => ({ ok: false }), (r) => calls.push(r), blank);
  await run(false, true);
  assert.deepEqual(calls, [null], 'a first read that failed painted nothing, leaving the picker hidden');
});

test('#4885: the agent page says when a chosen picture could not be fitted for the community', () => {
  assert.match(HTML, /const unsendable = !PICTURE_FITS\.has\(pic\)\s*&& \(pic\.size > PICTURE_MAX_BYTES \|\| !\['image\/png', 'image\/jpeg', 'image\/webp'\]\.includes\(pic\.type\)\);\s*msg\.textContent = unsendable \? 'Saved\. Kosmos could not fit this picture for the community, so it will not show there\.' : 'Saved\.';/);
  // fitPicture vouches for what it returns kept or redrawn, and only that.
  const fit = lift('fitPicture');
  assert.equal((fit.match(/PICTURE_FITS\.add\(/g) || []).length, 2, 'fitPicture vouches for something other than a kept or redrawn picture');
});

/* kosmos#5302: refitOldPictures with stand-ins for fetch, fitPicture and the Settings re-read. */
async function refit(names, { fits = () => true, getOk = () => true, putOk = () => true, tried, saving = false } = {}) {
  const calls = [];
  const heads = [];
  const PICTURE_FITS = new Set();
  const fitPicture = async (blob) => { const out = { type: 'image/webp', from: blob }; if (fits(blob.name)) PICTURE_FITS.add(out); return out; };
  const fetch = async (url, opts = {}) => {
    const name = decodeURIComponent(url.split('/')[3]);
    calls.push([opts.method || 'GET', name]);
    if (opts.method === 'PUT') heads.push(opts.headers || {});
    if ((opts.method || 'GET') === 'GET') return { ok: getOk(name), blob: async () => ({ name }) };
    return { ok: putOk(name) };
  };
  let rereads = 0;
  const refreshIndustry = () => { rereads += 1; };
  // eslint-disable-next-line no-new-func
  const run = new Function('fetch', 'fitPicture', 'PICTURE_FITS', 'refreshIndustry', 'PICTURE_REFIT_TRIED', 'INDUSTRY_SAVING',
    'let PICTURE_REFIT_RUNNING = false;\nasync ' + lift('refitOldPictures') + '\nreturn refitOldPictures;')(fetch, fitPicture, PICTURE_FITS, refreshIndustry, tried || new Set(), saving);
  await run(names.map((n, i) => ({ name: n, ver: 1000 + i })));
  return { calls, rereads, run, heads };
}

test('#5302: each listed picture is fetched, fitted and saved back, and Settings re-reads once after', async () => {
  const r = await refit(['ava', 'bo']);
  assert.deepEqual(r.calls, [['GET', 'ava'], ['PUT', 'ava'], ['GET', 'bo'], ['PUT', 'bo']]);
  assert.equal(r.rereads, 1);
});

test('#5302: one that cannot be fitted is never saved; nothing saved means no re-read; a failed read is skipped', async () => {
  const r = await refit(['ava', 'bo'], { fits: (n) => n === 'bo' });
  assert.deepEqual(r.calls, [['GET', 'ava'], ['GET', 'bo'], ['PUT', 'bo']], 'an unfitted picture was written over the original');
  const none = await refit(['ava'], { fits: () => false });
  assert.equal(none.rereads, 0, 're-read with nothing saved (a loop with the paint that called it)');
  const gone = await refit(['cy'], { getOk: () => false });
  assert.deepEqual(gone.calls, [['GET', 'cy']]);
});

test('#5302: an agent is tried once per page load, so a picture that will not fit is not fetched at every paint', async () => {
  const tried = new Set();
  const first = await refit(['ava'], { fits: () => false, tried });
  assert.equal(first.calls.length, 1);
  const again = await refit(['ava'], { fits: () => false, tried });
  assert.deepEqual(again.calls, [], 'tried again on the next paint');
});

test('#5302 review 1: each save names the version it read; no re-read over an industry save in flight', async () => {
  const r = await refit(['ava', 'bo']);
  assert.deepEqual(r.heads.map((h) => h['x-kosmos-refit-of']), ['1000', '1001']);
  const busy = await refit(['ava'], { saving: true });
  assert.equal(busy.calls.length, 2, 'fixture: the picture was not saved');
  assert.equal(busy.rereads, 0, 'a re-read over an industry save in flight drops its Saved.');
});
