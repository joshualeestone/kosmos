'use strict';

/**
 * An agent's picture fits the Kosmos+ community (#4885). The community takes a PNG, JPEG or WebP of at most 60,000
 * bytes, and every picture Kosmos stores passes through fitPicture in web/index.html first. This lifts that function
 * out of the real page and runs it in a real browser, because it is a canvas and an image decoder that do the work
 * and neither exists in node:
 *   F1  a big photo (a noisy 2000 x 1500 PNG, far over the cap) comes back as WebP or JPEG, at most 60,000 bytes,
 *       longest side at most 512 px, and it still decodes;
 *   F2  a GIF comes back as WebP or JPEG (the community takes no GIF);
 *   F3  a picture that already fits is returned untouched, the very same object;
 *   F4  something that is not a picture is returned as it was, and nothing throws;
 *   F5  a JPEG that already fits is still redrawn (a phone photo's rotation tag is refused by the community, and a
 *       redraw applies it and leaves no tag), and comes back within the cap.
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
        // F5: a small JPEG.
        const jpg = await new Promise((res) => small.toBlob(res, 'image/jpeg', 0.9));
        const jpgOut = await window.fitPicture(jpg);
        return {
          jpgIn: jpg.type + ' ' + jpg.size, jpgRedrawn: jpgOut !== jpg, jpgType: jpgOut.type, jpgSize: jpgOut.size,
          bigSize: big.size, fitType: fit.type, fitSize: fit.size, fitDims,
          gifType: gifOut.type, gifSize: gifOut.size, okSize: ok.size, same, junkSame: junkOut === junk, threw,
        };
      }, GIF_B64);
      say(r.bigSize > 60000, engine + ' F1 control: the source photo really is over the cap', r.bigSize + ' bytes');
      say(['image/webp', 'image/jpeg'].includes(r.fitType), engine + ' F1: a big photo comes back as WebP or JPEG', r.fitType);
      say(r.fitSize <= 60000, engine + ' F1: and at most 60,000 bytes', r.fitSize + ' bytes');
      say(Math.max(r.fitDims.w, r.fitDims.h) <= 512 && r.fitDims.w > 0, engine + ' F1: longest side at most 512 px, and it decodes', r.fitDims.w + 'x' + r.fitDims.h);
      say(Math.abs(r.fitDims.w / r.fitDims.h - 2000 / 1500) < 0.02, engine + ' F1: the shape is kept', r.fitDims.w + 'x' + r.fitDims.h);
      say(['image/webp', 'image/jpeg'].includes(r.gifType) && r.gifSize <= 60000, engine + ' F2: a GIF comes back as WebP or JPEG', r.gifType + ' ' + r.gifSize);
      say(r.okSize <= 60000 && r.same, engine + ' F3: a picture that fits is returned untouched', r.okSize + ' bytes');
      say(r.junkSame && !r.threw, engine + ' F4: something that is not a picture is returned as it was, without throwing');
      say(r.jpgRedrawn && ['image/webp', 'image/jpeg'].includes(r.jpgType) && r.jpgSize <= 60000, engine + ' F5: a JPEG that fits is still redrawn', r.jpgIn + ' -> ' + r.jpgType + ' ' + r.jpgSize);
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
