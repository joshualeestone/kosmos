'use strict';

/**
 * An agent's picture fits the Kosmos+ community (#4885). The community takes a PNG, JPEG or WebP of at most 60,000
 * bytes, and every picture Kosmos stores passes through fitPicture in web/index.html first. This lifts that function
 * out of the real page and runs it in a real browser, because it is a canvas and an image decoder that do the work
 * and neither exists in node:
 *   F1  a big photo (a noisy 2000 x 1500 PNG, far over the cap) comes back as WebP, PNG or JPEG (WebKit cannot write
 *       WebP, so it gets PNG or JPEG), at most 60,000 bytes,
 *       longest side at most 512 px, and it still decodes;
 *   F2  a GIF comes back as WebP, PNG or JPEG (the community takes no GIF);
 *   F3  a picture that already fits is returned untouched, the very same object;
 *   F4  something that is not a picture is returned as it was, and nothing throws;
 *   F5  a JPEG that already fits is still redrawn, and comes back within the cap;
 *   F6  a transparent picture over the cap never gets a black background: transparent where it can be kept within
 *       the cap, else on white (WebKit cannot write WebP, and a JPEG once turned every transparent pixel black);
 *   F6b a transparent logo too big to keep (2,500 px) stays transparent in every engine;
 *   F6c a soft transparent illustration that only fits as a smaller PNG stays transparent in every engine: every
 *       size in a format that keeps transparency is tried before any JPEG on white;
 *   F7  a phone JPEG with a rotation tag (EXIF Orientation 6) comes back upright, its sides swapped;
 *   F8  a thin banner is padded to the community's 16 px minimum, never squeezed under it;
 *   F9  a JPEG whose file says PNG is still redrawn: what is kept is decided by the bytes, never the name;
 *   F10 a PNG whose eXIf turns it (Orientation 6) comes back upright, its sides swapped;
 *   and every picture that comes back (F1, F2, F5 to F8) has each side from 16 to 2,048 px.
 * Needs no URL. ENGINES=chromium,webkit adds WebKit, the Mac app's engine.
 *
 *   ENGINES=chromium,webkit HEADED=0 NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-picture-fit-4885.js
 */
const fs = require('node:fs');
const path = require('node:path');
const pw = require('playwright');

const ALL_ENGINES = ['chromium', 'webkit'];
const ASKED = (process.env.ENGINES || 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const ENGINES = ASKED.filter((e) => ALL_ENGINES.includes(e));
if (!ENGINES.length || ENGINES.length !== ASKED.length) {
  console.log('FAIL  render-picture-fit-4885: ENGINES names an unknown engine (' + (process.env.ENGINES || '') + '); known: ' + ALL_ENGINES.join(', '));
  process.exit(1);
}

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'index.html'), 'utf8');
const start = html.indexOf('const PICTURE_MAX_BYTES');
const end = html.indexOf('\n}\n', html.indexOf('async function fitPicture(blob)'));
if (start < 0 || end < 0) {
  console.log('FAIL  render-picture-fit-4885: fitPicture was not found in web/index.html');
  process.exit(1);
}
const LIFTED = html.slice(start, end + 3) + '\nwindow.fitPicture = fitPicture;\n';

/* A 1 x 1 GIF89a. */
const GIF_B64 = 'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

(async () => {
  const fails = [];
  const say = (ok, l, x) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (x ? '  ' + x : '')); if (!ok) fails.push(l); };
  for (const engine of ENGINES) {
    let browser;
    try { browser = await pw[engine].launch({ headless: process.env.HEADED === '0' }); }
    catch (e) { say(false, engine + ': launch', String(e && e.message).split('\n')[0]); continue; }
    try {
      const pg = await browser.newPage();
      const errors = [];
      pg.on('pageerror', (e) => errors.push(String(e && e.message)));
      await pg.setContent('<!doctype html><html><body></body></html>');
      await pg.addScriptTag({ content: LIFTED });
      const r = await pg.evaluate(async (gifB64) => {
        const decode = async (b) => { const i = await createImageBitmap(b); return { w: i.width, h: i.height }; };
        // F1: a noisy photo-sized PNG, which no PNG encoder can squeeze under the cap.
        const cv = document.createElement('canvas');
        cv.width = 2000; cv.height = 1500;
        const ctx = cv.getContext('2d');
        const img = ctx.createImageData(cv.width, cv.height);
        let seed = 7;
        for (let i = 0; i < img.data.length; i += 4) {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          img.data[i] = seed & 255; img.data[i + 1] = (seed >> 8) & 255; img.data[i + 2] = (seed >> 16) & 255; img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        const big = await new Promise((res) => cv.toBlob(res, 'image/png'));
        const fit = await window.fitPicture(big);
        const fitDims = await decode(fit);
        // F2: a GIF.
        const gif = new Blob([Uint8Array.from(atob(gifB64), (c) => c.charCodeAt(0))], { type: 'image/gif' });
        const gifOut = await window.fitPicture(gif);
        // F3: a small PNG that already fits.
        const small = document.createElement('canvas');
        small.width = 96; small.height = 96;
        small.getContext('2d').fillRect(10, 10, 40, 40);
        const ok = await new Promise((res) => small.toBlob(res, 'image/png'));
        const same = (await window.fitPicture(ok)) === ok;
        // F4: not a picture.
        const junk = new Blob(['not a picture at all'.repeat(5000)], { type: 'image/png' });
        let junkOut = null; let threw = false;
        try { junkOut = await window.fitPicture(junk); } catch { threw = true; }
        // F6: a transparent picture over the cap (an opaque disc on a transparent square, with noise in the disc).
        const tc = document.createElement('canvas');
        tc.width = 800; tc.height = 800;
        const tctx = tc.getContext('2d');
        const timg = tctx.createImageData(800, 800);
        for (let y = 0; y < 800; y++) for (let x = 0; x < 800; x++) {
          const i = (y * 800 + x) * 4;
          if ((x - 400) ** 2 + (y - 400) ** 2 < 300 ** 2) {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            timg.data[i] = seed & 255; timg.data[i + 1] = (seed >> 8) & 255; timg.data[i + 2] = 90; timg.data[i + 3] = 255;
          }
        }
        tctx.putImageData(timg, 0, 0);
        const trans = await new Promise((res) => tc.toBlob(res, 'image/png'));
        const transOut = await window.fitPicture(trans);
        const corner = async (b) => {
          const i = await createImageBitmap(b);
          const c = document.createElement('canvas'); c.width = i.width; c.height = i.height;
          const x = c.getContext('2d'); x.drawImage(i, 0, 0);
          return Array.from(x.getImageData(1, 1, 1, 1).data);
        };
        // F6b: a flat transparent logo with a side over 2,048 px, so it must be redrawn.
        const lc = document.createElement('canvas');
        lc.width = 2500; lc.height = 2500;
        const lctx = lc.getContext('2d');
        lctx.fillStyle = '#2a6'; lctx.beginPath(); lctx.arc(1250, 1250, 900, 0, Math.PI * 2); lctx.fill();
        const logo = await new Promise((res) => lc.toBlob(res, 'image/png'));
        const logoOut = await window.fitPicture(logo);
        // F6c: soft shaded blobs on transparent, which compress only at smaller sizes.
        const sc = document.createElement('canvas');
        sc.width = 1024; sc.height = 1024;
        const sctx = sc.getContext('2d');
        for (let b = 0; b < 40; b++) {
          const x = 100 + ((b * 211) % 824); const y = 100 + ((b * 377) % 824);
          const g = sctx.createRadialGradient(x, y, 0, x, y, 160);
          g.addColorStop(0, 'rgba(' + ((b * 53) % 255) + ',' + ((b * 97) % 255) + ',' + ((b * 31) % 255) + ',0.9)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          sctx.fillStyle = g; sctx.fillRect(x - 160, y - 160, 320, 320);
        }
        const soft = await new Promise((res) => sc.toBlob(res, 'image/png'));
        const softOut = await window.fitPicture(soft);
        // F7: a 200 x 100 JPEG with an EXIF Orientation 6 segment spliced in after its start marker.
        const wide = document.createElement('canvas');
        wide.width = 200; wide.height = 100;
        wide.getContext('2d').fillRect(0, 0, 100, 100);
        const plain = new Uint8Array(await (await new Promise((res) => wide.toBlob(res, 'image/jpeg', 0.9))).arrayBuffer());
        const exif = [0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
          0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
        const rotated = new Blob([plain.subarray(0, 2), new Uint8Array(exif), plain.subarray(2)], { type: 'image/jpeg' });
        const rotOut = await window.fitPicture(rotated);
        // F8: a thin banner.
        const thin = document.createElement('canvas');
        thin.width = 3000; thin.height = 20;
        thin.getContext('2d').fillRect(0, 0, 3000, 20);
        const banner = await new Promise((res) => thin.toBlob(res, 'image/png'));
        const thinOut = await window.fitPicture(banner);
        // F10: a 200 x 100 PNG with an eXIf chunk (Orientation 6) spliced in after IHDR, with a correct CRC.
        const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
        const crc = (u) => { let c = 0xffffffff; for (const b of u) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
        const pngPlain = new Uint8Array(await (await new Promise((res) => wide.toBlob(res, 'image/png'))).arrayBuffer());
        // Drop any eXIf the engine wrote, then insert ours after IHDR (8 + 25 bytes).
        const chunks = []; for (let at = 8; at < pngPlain.length;) { const len = (pngPlain[at] << 24 >>> 0) + (pngPlain[at + 1] << 16) + (pngPlain[at + 2] << 8) + pngPlain[at + 3]; const kind = String.fromCharCode(...pngPlain.subarray(at + 4, at + 8)); if (kind !== 'eXIf') chunks.push(pngPlain.subarray(at, at + 12 + len)); at += 12 + len; }
        const exifData = new Uint8Array([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]);
        const typeAndData = new Uint8Array([0x65, 0x58, 0x49, 0x66, ...exifData]);
        const c = crc(typeAndData);
        const exifChunk = new Uint8Array([0, 0, 0, exifData.length, ...typeAndData, c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255]);
        const turnedPng = new Blob([pngPlain.subarray(0, 8), chunks[0], exifChunk, ...chunks.slice(1)], { type: 'image/png' });
        const turnedOut = await window.fitPicture(turnedPng);
        // F9: the F7 JPEG labelled as a PNG.
        const lying = new Blob([plain], { type: 'image/png' });
        const lyingOut = await window.fitPicture(lying);
        // F5: a small JPEG.
        const jpg = await new Promise((res) => small.toBlob(res, 'image/jpeg', 0.9));
        const jpgOut = await window.fitPicture(jpg);
        return {
          softIn: soft.size, softType: softOut.type, softSize: softOut.size, softCorner: await corner(softOut),
          logoType: logoOut.type, logoSize: logoOut.size, logoSame: logoOut === logo, logoCorner: await corner(logoOut),
          transIn: trans.size, transType: transOut.type, transSize: transOut.size, transCorner: await corner(transOut),
          turnedDims: await decode(turnedOut), turnedRedrawn: turnedOut !== turnedPng,
          lyingRedrawn: lyingOut !== lying, lyingType: lyingOut.type,
          rotDims: await decode(rotOut), thinDims: await decode(thinOut), thinSame: thinOut === banner,
          sides: await Promise.all([fit, gifOut, jpgOut, transOut, logoOut, rotOut, thinOut].map(decode)),
          jpgIn: jpg.type + ' ' + jpg.size, jpgRedrawn: jpgOut !== jpg, jpgType: jpgOut.type, jpgSize: jpgOut.size,
          bigSize: big.size, fitType: fit.type, fitSize: fit.size, fitDims,
          gifType: gifOut.type, gifSize: gifOut.size, okSize: ok.size, same, junkSame: junkOut === junk, threw,
        };
      }, GIF_B64);
      say(r.bigSize > 60000, engine + ' F1 control: the source photo really is over the cap', r.bigSize + ' bytes');
      say(['image/webp', 'image/png', 'image/jpeg'].includes(r.fitType), engine + ' F1: a big photo comes back as WebP, PNG or JPEG', r.fitType);
      say(r.fitSize <= 60000, engine + ' F1: and at most 60,000 bytes', r.fitSize + ' bytes');
      say(Math.max(r.fitDims.w, r.fitDims.h) <= 512 && r.fitDims.w > 0, engine + ' F1: longest side at most 512 px, and it decodes', r.fitDims.w + 'x' + r.fitDims.h);
      say(Math.abs(r.fitDims.w / r.fitDims.h - 2000 / 1500) < 0.02, engine + ' F1: the shape is kept', r.fitDims.w + 'x' + r.fitDims.h);
      say(['image/webp', 'image/png', 'image/jpeg'].includes(r.gifType) && r.gifSize <= 60000, engine + ' F2: a GIF comes back as WebP, PNG or JPEG', r.gifType + ' ' + r.gifSize);
      say(r.okSize <= 60000 && r.same, engine + ' F3: a picture that fits is returned untouched', r.okSize + ' bytes');
      say(r.junkSame && !r.threw, engine + ' F4: something that is not a picture is returned as it was, without throwing');
      say(r.jpgRedrawn && ['image/webp', 'image/png', 'image/jpeg'].includes(r.jpgType) && r.jpgSize <= 60000, engine + ' F5: a JPEG that fits is still redrawn', r.jpgIn + ' -> ' + r.jpgType + ' ' + r.jpgSize);
      say(r.transIn > 60000, engine + ' F6 control: the transparent source really is over the cap', r.transIn + ' bytes');
      say(r.transSize <= 60000, engine + ' F6: a transparent picture comes back within the cap', r.transType + ' ' + r.transSize);
      const [cr, cg, cb, ca] = r.transCorner;
      say(ca === 0 || (cr === 255 && cg === 255 && cb === 255), engine + ' F6: its transparent corner is transparent, or white, never black', JSON.stringify(r.transCorner));
      say(r.logoCorner[3] === 0 && r.logoSize <= 60000 && !r.logoSame, engine + ' F6b: a transparent logo too big to keep stays transparent', r.logoType + ' ' + r.logoSize + ' ' + JSON.stringify(r.logoCorner));
      say(r.softIn > 60000, engine + ' F6c control: the soft illustration really is over the cap', r.softIn + ' bytes');
      say(r.softCorner[3] < 255 && r.softSize <= 60000 && r.softType !== 'image/jpeg', engine + ' F6c: a soft transparent illustration stays transparent', r.softType + ' ' + r.softSize + ' ' + JSON.stringify(r.softCorner));
      say(r.rotDims.w === 100 && r.rotDims.h === 200, engine + ' F7: a phone JPEG with a rotation tag comes back upright', r.rotDims.w + 'x' + r.rotDims.h);
      say(!r.thinSame && Math.min(r.thinDims.w, r.thinDims.h) >= 16, engine + ' F8: a thin banner is padded to at least 16 px', r.thinDims.w + 'x' + r.thinDims.h);
      say(r.turnedRedrawn && r.turnedDims.w === 100 && r.turnedDims.h === 200, engine + ' F10: a PNG turned by its eXIf comes back upright', r.turnedDims.w + 'x' + r.turnedDims.h);
      say(r.lyingRedrawn, engine + ' F9: a JPEG whose file says PNG is redrawn, not kept', r.lyingType);
      const badSide = r.sides.filter((d) => Math.min(d.w, d.h) < 16 || Math.max(d.w, d.h) > 2048);
      say(badSide.length === 0, engine + ': every picture that comes back is 16 to 2,048 px on each side', JSON.stringify(r.sides));
      say(errors.length === 0, engine + ': no page errors', errors.join(' | '));
    } catch (e) {
      say(false, engine + ': ran to the end', String(e && e.message).split('\n')[0]);
    } finally {
      await browser.close();
    }
  }
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'all good');
  process.exit(fails.length ? 1 : 0);
})();
