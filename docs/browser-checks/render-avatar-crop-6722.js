// Browser-check-surface: cropmodal crop-t crop-stage crop-cv crop-zoom crop-help crop-no crop-go you-file create-avatar d-file
'use strict';
/**
 * #6722 (Josh, 2026-10-20): "a little avatar editor so if I upload an image I get some basic cropping tools before i
 * save". Drives the real editor (cropPicture) on the shipped page, file://, fetch stubbed, on chromium and webkit:
 *   - Cancel resolves to nothing, closes the editor and gives focus back to what opened it;
 *   - Save with no change cuts the centre square: a 512 x 512 PNG whose left half is the picture's left colour and
 *     whose right half is its right colour (a two-colour picture, so a wrong cut shows as a wrong colour);
 *   - a drag to the right, and separately the Right arrow key, slide the picture right, so the circle shows its left
 *     edge and the saved picture is the left colour all the way across (CONTROL: the centred save above is not);
 *   - the wheel and + zoom in (the slider follows), - zooms back out;
 *   - Enter on the picture saves, Escape cancels, and Tab stays inside the editor;
 *   - a phone photo whose rotation tag says "turned" comes in upright (its sides swapped), and the same photo with no
 *     tag does not (the CONTROL that the tag, not the photo, did it);
 *   - a GIF is handed back exactly as chosen (an animated one would stop moving);
 *   - wired: choosing a picture of yourself opens the editor; Cancel uploads nothing; Save uploads one 512 PNG;
 *   - at 375 x 667 the whole editor, both buttons included, is on screen.
 *
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-avatar-crop-6722.js [shots-dir]
 */
const path = require('node:path');
const pw = require('playwright');

const PAGE = 'file://' + (process.env.KOSMOS_PAGE || path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html'));
const SHOTS = process.argv[2] || '';
const fail = [];
let RAN = 0;
const chk = (ok, label, extra) => {
  RAN += 1;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push(label);
};

async function open(browser, w, h, theme, eng) {
  // A phone is a touch screen, as in the sibling checks (the page sizes its controls for touch there).
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, hasTouch: w < 700, isMobile: w < 700 && eng === 'chromium' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => {
    window.PUTS = [];
    const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    window.setInterval = () => 0;
    window.fetch = async (url, opts) => {
      if (opts && opts.method === 'PUT') {
        const b = opts.body;
        window.PUTS.push({ url: String(url), type: b && b.type, size: b && b.size, body: b });
      }
      return enc({ ok: true });
    };
  });
  await page.goto(PAGE);
  await page.evaluate(() => {
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
    /* Test helpers, in the page. A two-colour picture: red on the left half, blue on the right. */
    window.T = {
      async twoTone(w, h, type) {
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const g = cv.getContext('2d');
        g.fillStyle = '#ff0000'; g.fillRect(0, 0, w / 2, h);
        g.fillStyle = '#0000ff'; g.fillRect(w / 2, 0, w / 2, h);
        const b = await new Promise((r) => cv.toBlob(r, type || 'image/png', 0.95));
        return new File([b], 'me.' + (type === 'image/jpeg' ? 'jpg' : 'png'), { type: type || 'image/png' });
      },
      /* The same JPEG with an EXIF Orientation of 6 (turned a quarter) spliced in after its start marker. */
      async turned(file) {
        const src = new Uint8Array(await file.arrayBuffer());
        const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0];
        const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
        const len = body.length + 2;
        const app1 = [0xff, 0xe1, len >> 8, len & 0xff, ...body];
        const out = new Uint8Array(src.length + app1.length);
        out.set(src.subarray(0, 2), 0); out.set(app1, 2); out.set(src.subarray(2), 2 + app1.length);
        return new File([out], 'phone.jpg', { type: 'image/jpeg' });
      },
      /* Colour names at two points of a saved picture: a quarter in from the left, and from the right. */
      async sides(file) {
        if (!file) return null;
        const bmp = await createImageBitmap(file);
        const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
        const g = cv.getContext('2d'); g.drawImage(bmp, 0, 0);
        const at = (x) => { const d = g.getImageData(x, Math.floor(bmp.height / 2), 1, 1).data; return d[0] > 150 && d[2] < 100 ? 'red' : d[2] > 150 && d[0] < 100 ? 'blue' : `rgb(${d[0]},${d[1]},${d[2]})`; };
        return { w: bmp.width, h: bmp.height, type: file.type, left: at(Math.floor(bmp.width / 4)), right: at(Math.floor(bmp.width * 3 / 4)) };
      },
    };
  });
  return { ctx, page, errs };
}

/* Starts the editor on a fresh two-tone picture, from a focused button so the focus return can be read. */
async function start(page) {
  await page.evaluate(async () => {
    // A button of the test's own, held by reference (it is no part of the page), to read where focus goes back to.
    window.PROBE = window.PROBE || Object.assign(document.createElement('button'), { textContent: 'probe' });
    document.body.appendChild(window.PROBE); window.PROBE.focus();
    window.CROP_RESULT = undefined;
    const f = await T.twoTone(800, 400);
    window.CROP_P = cropPicture(f).then((r) => { window.CROP_RESULT = r; return r; });
  });
  await page.waitForFunction(() => !document.getElementById('cropmodal').hidden);
}
const result = (page) => page.evaluate(async () => { const r = await window.CROP_P; return r ? T.sides(r) : null; });

(async () => {
  const engines = (process.env.ENGINES || 'chromium,webkit').split(',').filter(Boolean);
  for (const eng of engines) {
    const browser = await pw[eng].launch();
    const t = `[${eng}]`;
    const { ctx, page, errs } = await open(browser, 1280, 800, 'light');

    // Open, then Cancel.
    await start(page);
    const st = await page.evaluate(() => ({ focus: document.activeElement && document.activeElement.id, zoom: document.getElementById('crop-zoom').value }));
    chk(st.focus === 'crop-stage' && Number(st.zoom) === 1, `${t} the editor opens on the picture, at zoom 1`, JSON.stringify(st));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `crop-${eng}-light.png`) });
    await page.click('#crop-no');
    const cancelled = await page.evaluate(async () => ({ r: await window.CROP_P, hidden: document.getElementById('cropmodal').hidden, backToOpener: document.activeElement === window.PROBE }));
    chk(cancelled.r === null && cancelled.hidden && cancelled.backToOpener, `${t} Cancel gives nothing back, closes, and returns focus to the opener`, JSON.stringify(cancelled));

    // Save as is: the centre square.
    await start(page);
    await page.click('#crop-go');
    const centre = await result(page);
    chk(centre && centre.w === 512 && centre.h === 512 && centre.type === 'image/png' && centre.left === 'red' && centre.right === 'blue',
      `${t} Save as it opened is the centre square, 512 x 512 PNG, red on the left and blue on the right`, JSON.stringify(centre));

    // Drag right: the circle shows the left edge.
    await start(page);
    const box = await page.locator('#crop-stage').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await page.click('#crop-go');
    const dragged = await result(page);
    chk(dragged && dragged.left === 'red' && dragged.right === 'red', `${t} a drag to the right slides the picture right, so the left edge fills the circle`, JSON.stringify(dragged));

    // The Right arrow does the same.
    await start(page);
    for (let i = 0; i < 12; i += 1) await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Enter');
    const keyed = await result(page);
    chk(keyed && keyed.left === 'red' && keyed.right === 'red', `${t} the Right arrow slides the picture right, and Enter saves`, JSON.stringify(keyed));

    // Zoom: wheel and +, then -.
    await start(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -400);
    const z1 = await page.evaluate(() => Number(document.getElementById('crop-zoom').value));
    await page.focus('#crop-stage');
    await page.keyboard.press('+');
    const z2 = await page.evaluate(() => Number(document.getElementById('crop-zoom').value));
    await page.keyboard.press('-'); await page.keyboard.press('-');
    const z3 = await page.evaluate(() => Number(document.getElementById('crop-zoom').value));
    chk(z1 > 1 && z2 > z1 && z3 < z2, `${t} the wheel and + zoom in (the slider follows), - zooms out`, JSON.stringify({ z1, z2, z3 }));
    // Tab stays inside: from Save it comes back to the picture.
    await page.focus('#crop-go');
    await page.keyboard.press(eng === 'webkit' ? 'Alt+Tab' : 'Tab');
    const ring = await page.evaluate(() => document.activeElement && document.activeElement.id);
    chk(ring === 'crop-stage', `${t} Tab from Save comes back to the picture, not out of the editor`, ring);
    await page.keyboard.press('Escape');
    const esc = await page.evaluate(async () => ({ r: await window.CROP_P, hidden: document.getElementById('cropmodal').hidden }));
    chk(esc.r === null && esc.hidden, `${t} Escape cancels`, JSON.stringify(esc));

    // A phone photo with a rotation tag comes in upright; the same photo without one does not.
    const turn = await page.evaluate(async () => {
      const plain = await T.twoTone(300, 120, 'image/jpeg');
      const tagged = await T.turned(plain);
      const read = async (f) => { const b = await cropRead(f); const s = [b.width, b.height]; b.close(); return s; };
      return { plain: await read(plain), tagged: await read(tagged) };
    });
    chk(turn.plain[0] === 300 && turn.plain[1] === 120, `${t} CONTROL: a photo with no rotation tag is read as it is`, JSON.stringify(turn));
    chk(turn.tagged[0] === 120 && turn.tagged[1] === 300, `${t} a phone photo tagged as turned is read upright (its sides swapped)`, JSON.stringify(turn));

    // A GIF is handed back untouched, with no editor.
    const gif = await page.evaluate(async () => {
      const f = new File([new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])], 'moving.gif', { type: 'image/gif' });
      const r = await cropPicture(f);
      return { same: r === f, hidden: document.getElementById('cropmodal').hidden };
    });
    chk(gif.same && gif.hidden, `${t} a GIF is handed back exactly as chosen, with no editor`, JSON.stringify(gif));

    // Wired: the person's own picture.
    const pick = async () => page.evaluate(async () => {
      const f = await T.twoTone(800, 400);
      const dt = new DataTransfer(); dt.items.add(f);
      const input = document.getElementById('you-file');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await pick();
    await page.waitForFunction(() => !document.getElementById('cropmodal').hidden);
    await page.click('#crop-no');
    await page.waitForTimeout(200);
    const noPut = await page.evaluate(() => window.PUTS.length);
    chk(noPut === 0, `${t} choosing a picture of yourself opens the editor, and Cancel uploads nothing`, String(noPut));
    await pick();
    await page.waitForFunction(() => !document.getElementById('cropmodal').hidden);
    await page.click('#crop-go');
    await page.waitForFunction(() => window.PUTS.length > 0);
    const put = await page.evaluate(async () => { const p = window.PUTS[0]; return { url: p.url, n: window.PUTS.length, ...(await T.sides(p.body)) }; });
    chk(put.n === 1 && put.url === '/api/you/avatar' && put.w === 512 && put.h === 512 && put.type === 'image/png',
      `${t} Save uploads one 512 x 512 PNG of yourself`, JSON.stringify(put));
    // A key with a modifier is the browser's: Ctrl+= is page zoom, not the editor's.
    await start(page);
    await page.focus('#crop-stage');
    const zBefore = await page.evaluate(() => Number(document.getElementById('crop-zoom').value));
    await page.keyboard.press('Control+Equal');
    const zMod = await page.evaluate(() => Number(document.getElementById('crop-zoom').value));
    await page.keyboard.press('Equal');
    const zPlain = await page.evaluate(() => Number(document.getElementById('crop-zoom').value));
    chk(zMod === zBefore && zPlain > zBefore, `${t} Ctrl+= is left to the browser; = alone zooms (CONTROL)`, JSON.stringify({ zBefore, zMod, zPlain }));
    // A drag that starts on the picture and ends on the backdrop is a drag, not a dismissal.
    const sb = await page.locator('#crop-stage').boundingBox();
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await page.mouse.down();
    await page.mouse.move(5, 5, { steps: 6 });
    await page.mouse.up();
    const stillOpen = await page.evaluate(() => !document.getElementById('cropmodal').hidden);
    chk(stillOpen, `${t} a drag that ends on the backdrop does not cancel`, String(stillOpen));
    await page.keyboard.press('Escape');
    await page.evaluate(async () => { await window.CROP_P; });

    // Wired: an agent's own page. Cancel uploads nothing; Save uploads one picture to that agent.
    await page.evaluate(() => { window.PUTS.length = 0; CURRENT = { sessionName: 'ada', name: 'Ada' }; });
    const pickAgent = () => page.evaluate(async () => {
      const f = await T.twoTone(800, 400); const dt = new DataTransfer(); dt.items.add(f);
      const input = document.getElementById('d-file'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await pickAgent();
    await page.waitForFunction(() => !document.getElementById('cropmodal').hidden);
    await page.click('#crop-no');
    await page.waitForTimeout(200);
    const agentNone = await page.evaluate(() => window.PUTS.length);
    await pickAgent();
    await page.waitForFunction(() => !document.getElementById('cropmodal').hidden);
    const agentVerb = await page.evaluate(() => document.getElementById('crop-go').textContent);
    await page.click('#crop-go');
    await page.waitForFunction(() => window.PUTS.length > 0, null, { timeout: 10000 }).catch(() => {});
    const agentPut = await page.evaluate(() => window.PUTS.map((x) => x.url));
    chk(agentNone === 0 && agentVerb === 'Save' && JSON.stringify(agentPut) === JSON.stringify(['/api/agent/ada/avatar']),
      `${t} an agent's page: Cancel uploads nothing; Save uploads one picture to that agent`, JSON.stringify({ agentNone, agentVerb, agentPut }));

    // Wired: a new agent. Nothing uploads yet; the button says Use picture; the held file is the cut, named as chosen.
    const created = await page.evaluate(async () => {
      window.PUTS.length = 0;
      const f = await T.twoTone(800, 400); const dt = new DataTransfer(); dt.items.add(f);
      const input = document.getElementById('create-avatar'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 100 && document.getElementById('cropmodal').hidden; i += 1) await new Promise((r) => setTimeout(r, 20));
      const verb = document.getElementById('crop-go').textContent;
      document.getElementById('crop-go').click();
      for (let i = 0; i < 100 && !(AVATAR_FILE && AVATAR_FILE.type === 'image/png'); i += 1) await new Promise((r) => setTimeout(r, 20));
      const sides = AVATAR_FILE ? await T.sides(AVATAR_FILE) : null;
      return { verb, name: AVATAR_FILE && AVATAR_FILE.name, sides, hint: document.getElementById('genav-hint').textContent, puts: window.PUTS.length };
    });
    chk(created.verb === 'Use picture' && created.name === 'me.png' && created.sides && created.sides.w === 512 && created.puts === 0
      && /me\.png will be its picture/.test(created.hint),
      `${t} a new agent: "Use picture", the held picture is the 512 cut named as chosen, the hint names it, nothing uploads yet`, JSON.stringify(created));
    chk(errs.length === 0, `${t} no page errors`, errs.join(' | '));
    await ctx.close();

    // A phone held sideways: the dialog scrolls rather than clipping, so both buttons can be reached.
    {
      const p = await open(browser, 667, 375, 'light', eng);
      await start(p.page);
      const side = await p.page.evaluate(() => {
        const box = document.querySelector('.crop-box');
        const go = document.getElementById('crop-go');
        go.scrollIntoView({ block: 'nearest' });
        const r = go.getBoundingClientRect();
        return { fits: box.getBoundingClientRect().height <= innerHeight + 1, goOn: r.top >= 0 && r.bottom <= innerHeight, boxH: Math.round(box.getBoundingClientRect().height), vh: innerHeight };
      });
      chk(side.fits && side.goOn, `[${eng} 667x375 sideways] the dialog fits the screen and Save can be reached`, JSON.stringify(side));
      await p.ctx.close();
    }

    // A phone, both themes: the whole editor is on screen.
    for (const theme of ['light', 'dark']) {
      const p = await open(browser, 375, 667, theme, eng);
      await start(p.page);
      const fit = await p.page.evaluate(() => {
        const r = (id) => document.getElementById(id).getBoundingClientRect();
        const on = (b) => b.top >= 0 && b.left >= 0 && b.bottom <= innerHeight && b.right <= innerWidth;
        return { stage: on(r('crop-stage')), no: on(r('crop-no')), go: on(r('crop-go')), goH: Math.round(r('crop-go').height), zoom: on(r('crop-zoom')) };
      });
      chk(fit.stage && fit.no && fit.go && fit.zoom && fit.goH >= 44, `${t} 375x667 ${theme}: the picture, the slider and both buttons are on screen (Save at least 44px tall)`, JSON.stringify(fit));
      if (SHOTS) await p.page.screenshot({ path: path.join(SHOTS, `crop-${eng}-375-${theme}.png`) });
      chk(p.errs.length === 0, `${t} 375x667 ${theme}: no page errors`, p.errs.join(' | '));
      await p.ctx.close();
    }
    await browser.close();
  }
  // The count is part of the result: a run that skipped arms (or an empty ENGINES) must not read as green.
  const EXPECTED_PER_ENGINE = 23;
  if (RAN !== EXPECTED_PER_ENGINE * engines.length) chk(false, `ran ${RAN} checks, expected ${EXPECTED_PER_ENGINE * engines.length}`);
  console.log(`render-avatar-crop-6722: ${RAN - fail.length} PASS, ${fail.length} FAIL`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
