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
 *   - Enter on the picture saves, Escape cancels (and reaches no handler under the editor), and Tab stays inside the editor;
 *   - a phone photo whose rotation tag says "turned" comes in upright (its sides swapped), and the same photo with no
 *     tag does not (the CONTROL that the tag, not the photo, did it);
 *   - a GIF is handed back exactly as chosen (an animated one would stop moving);
 *   - with the browser's resize options refused, a big picture is still read at 2048 (a canvas does it); the editor
 *     stacks above the file preview and first run;
 *   - a picture the editor cannot draw closes the editor with a picture, not a hang, and the next choice still opens it;
 *   - a small picture is saved at its own size, not blown up to 512;
 *   - a key with a modifier (Ctrl+=, Ctrl+Tab) is left to the browser; a drag that ends on the backdrop does not cancel;
 *   - wired, all three pickers: the person's own picture and an agent's page (Cancel uploads nothing; Save uploads
 *     one picture to the right place), and a new agent ("Use picture"; the held picture is the 512 cut named as
 *     chosen, the hint names it, nothing uploads yet);
 *   - at 375 x 667 (both themes) the whole editor is on screen with 44 px buttons; at 667 x 375 it fits and Save can
 *     be reached.
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
    const f = await T.twoTone(1600, 800);
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
    // Review 4: a window under the editor keeps its own document-level Escape handler; one Escape must not reach it.
    await page.evaluate(() => { window.UNDER_ESC = 0; document.addEventListener('keydown', () => { window.UNDER_ESC += 1; }); });   // counts ANY key that reaches it
    await page.keyboard.press('Escape');
    const esc = await page.evaluate(async () => ({ r: await window.CROP_P, hidden: document.getElementById('cropmodal').hidden, under: window.UNDER_ESC }));
    chk(esc.r === null && esc.hidden, `${t} Escape cancels`, JSON.stringify(esc));
    await page.keyboard.press('Escape');
    const under = await page.evaluate(() => window.UNDER_ESC);
    // Review 7: and with a modifier held (Option+Escape) the editor still closes and nothing under it hears it.
    await start(page);
    await page.keyboard.press('Alt+ArrowRight');   // review 8: a chord other than Escape stops at the editor too
    await page.keyboard.press('Alt+Escape');
    const alt = await page.evaluate(async () => ({ r: await window.CROP_P, hidden: document.getElementById('cropmodal').hidden, under: window.UNDER_ESC }));
    chk(esc.under === 0 && under === 1 && alt.r === null && alt.hidden && alt.under === 1,
      `${t} no key the editor gets (Escape, Option+Escape, Option+Arrow) reaches a handler under it (CONTROL: with the editor closed one does)`, JSON.stringify({ during: esc.under, after: under, alt }));

    // A phone photo with a rotation tag comes in upright; the same photo without one does not.
    const turn = await page.evaluate(async () => {
      const plain = await T.twoTone(300, 120, 'image/jpeg');
      const tagged = await T.turned(plain);
      const read = async (f) => { const b = await cropRead(f); const s = [b.width, b.height]; b.close(); return s; };
      return { plain: await read(plain), tagged: await read(tagged) };
    });
    chk(turn.plain[0] === 300 && turn.plain[1] === 120, `${t} CONTROL: a photo with no rotation tag is read as it is`, JSON.stringify(turn));
    chk(turn.tagged[0] === 120 && turn.tagged[1] === 300, `${t} a phone photo tagged as turned is read upright (its sides swapped)`, JSON.stringify(turn));

    // A big picture (a phone photo's size) is read at 2048 on its long side and still opens the editor and saves 512;
    // a very long, thin one keeps a 1 px side rather than failing to read and skipping the editor.
    const big = await page.evaluate(async () => {
      const read = async (f) => { const b = await cropRead(f); const s = [b.width, b.height]; b.close(); return s; };
      const large = await T.twoTone(4000, 1000);
      const thin = await T.twoTone(1, 5000);
      const r = { large: await read(large), thin: await read(thin).catch((e) => String(e)) };
      window.CROP_P = cropPicture(large);
      for (let i = 0; i < 150 && document.getElementById('cropmodal').hidden; i += 1) await new Promise((res) => setTimeout(res, 20));
      r.opened = !document.getElementById('cropmodal').hidden;
      document.getElementById('crop-go').click();
      r.saved = await T.sides(await window.CROP_P);
      return r;
    });
    chk(big.large[0] === 2048 && big.large[1] === 512 && big.opened && big.saved && big.saved.w === 512 && big.saved.left === 'red' && big.saved.right === 'blue',
      `${t} a 4000 px picture is read at 2048, opens the editor, and saves a 512 centre square`, JSON.stringify(big));
    chk(Array.isArray(big.thin) && big.thin[0] === 1 && big.thin[1] === 2048, `${t} a 1 x 5000 picture is read at 1 x 2048, not refused`, JSON.stringify(big));
    // A browser that refuses the resize options (an older WebKit) still reads a phone-sized picture at 2048, through a
    // canvas, rather than skipping the editor.
    const noResize = await page.evaluate(async () => {
      const real = window.createImageBitmap;
      window.createImageBitmap = (src, opts) => (opts && opts.resizeWidth ? Promise.reject(new Error('no resize options')) : real(src, opts));
      try { const b = await cropRead(await T.twoTone(4000, 1000)); const s = [b.width, b.height]; b.close(); return s; }
      catch (e) { return String(e); } finally { window.createImageBitmap = real; }
    });
    chk(Array.isArray(noResize) && noResize[0] === 2048 && noResize[1] === 512, `${t} with the resize options refused, a 4000 px picture is still read at 2048`, JSON.stringify(noResize));
    // The editor paints above the file preview (59) and first run (60), so the windows that count it as covering them are under it.
    const z = await page.evaluate(() => Number(getComputedStyle(document.getElementById('cropmodal')).zIndex));
    chk(z > 60, `${t} the editor stacks above the file preview and first run`, String(z));

    // A small picture is not blown up: its cut is saved at its own size, so it is not blurred.
    const small = await page.evaluate(async () => {
      const f = await T.twoTone(200, 100);
      window.CROP_P = cropPicture(f);
      for (let i = 0; i < 100 && document.getElementById('cropmodal').hidden; i += 1) await new Promise((r) => setTimeout(r, 20));
      document.getElementById('crop-go').click();
      return T.sides(await window.CROP_P);
    });
    chk(small && small.w === 100 && small.h === 100 && small.left === 'red' && small.right === 'blue', `${t} a small picture is saved at its own size, not enlarged (CONTROL: a big one is 512)`, JSON.stringify(small));
    // A GIF is handed back untouched, with no editor.
    const gif = await page.evaluate(async () => {
      const f = new File([new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])], 'moving.gif', { type: 'image/gif' });
      const r = await cropPicture(f);
      return { same: r === f, hidden: document.getElementById('cropmodal').hidden };
    });
    chk(gif.same && gif.hidden, `${t} a GIF is handed back exactly as chosen, with no editor`, JSON.stringify(gif));
    // A picture the editor cannot draw closes the editor with a picture (the centre cut, as Save would), not a hang, and
    // the next choice still opens the editor.
    const unpaintable = await page.evaluate(async () => {
      const real = window.cropPaint;
      window.cropPaint = () => { throw new Error('cannot draw'); };
      const f = await T.twoTone(400, 200);
      const r = await Promise.race([cropPicture(f), new Promise((res) => setTimeout(() => res('hung'), 3000))]);
      window.cropPaint = real;
      const out = { file: r instanceof File, hung: r === 'hung', hidden: document.getElementById('cropmodal').hidden, crop: CROP === null };
      window.CROP_P = cropPicture(await T.twoTone(400, 200));
      for (let i = 0; i < 100 && document.getElementById('cropmodal').hidden; i += 1) await new Promise((res) => setTimeout(res, 20));
      out.nextOpens = !document.getElementById('cropmodal').hidden;
      document.getElementById('crop-no').click();
      await window.CROP_P;
      return out;
    });
    chk(unpaintable.file && !unpaintable.hung && unpaintable.hidden && unpaintable.crop && unpaintable.nextOpens,
      `${t} a picture the editor cannot draw closes the editor with a picture, not a hang, and the next choice still opens it`, JSON.stringify(unpaintable));

    // Wired: the person's own picture.
    const pick = async () => page.evaluate(async () => {
      const f = await T.twoTone(1600, 800);
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
    // Review 6: Ctrl+Tab is the browser's tab switch, so the editor's Tab ring leaves it alone; plain Tab is kept (CONTROL).
    const tabs = await page.evaluate(() => {
      const send = (ctrlKey) => { const ev = new KeyboardEvent('keydown', { key: 'Tab', ctrlKey, bubbles: true, cancelable: true });
        document.getElementById('crop-stage').dispatchEvent(ev); return ev.defaultPrevented; };
      return { ctrl: send(true), plain: send(false) };
    });
    chk(tabs.ctrl === false && tabs.plain === true, `${t} Ctrl+Tab is left to the browser; plain Tab is kept in the editor (CONTROL)`, JSON.stringify(tabs));
    // Pinch: two fingers moving apart zoom in (synthetic touch pointers, so both engines run it); one finger alone moves,
    // never zooms (CONTROL).
    const pinch = await page.evaluate(() => {
      const st = document.getElementById('crop-stage'); const b = st.getBoundingClientRect();
      const x = b.left + b.width / 2; const y = b.top + b.height / 2;
      const ev = (type, id, dx) => st.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 11, clientX: x + dx, clientY: y, bubbles: true }));
      const z = () => Number(document.getElementById('crop-zoom').value);
      const z0 = z();
      ev('pointerdown', 11, 0); ev('pointermove', 11, 30); ev('pointerup', 11, 30);
      const zOne = z();
      ev('pointerdown', 11, -40); ev('pointerdown', 12, 40); ev('pointermove', 12, 120); ev('pointerup', 12, 120); ev('pointerup', 11, -40);
      return { z0, zOne, zTwo: z(), left: CROP ? CROP.ptrs.size : -1 };
    });
    chk(pinch.zOne === pinch.z0 && pinch.zTwo > pinch.z0 * 1.5 && pinch.left === 0, `${t} two fingers moving apart zoom in; one finger does not zoom (CONTROL); both lifts are let go`, JSON.stringify(pinch));
    // The backdrop cancels only a press that began on it. A click is dispatched on the backdrop directly, so pointer
    // capture cannot route it elsewhere: after a press on the picture it must not close; after a press on the backdrop it
    // must (CONTROL).
    const back = await page.evaluate(async () => {
      const m = document.getElementById('cropmodal'); const st = document.getElementById('crop-stage');
      st.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 21, pointerType: 'mouse', button: 0, bubbles: true }));
      st.dispatchEvent(new PointerEvent('pointerup', { pointerId: 21, pointerType: 'mouse', button: 0, bubbles: true }));
      m.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const afterPicture = !m.hidden;
      m.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 22, pointerType: 'mouse', button: 0, bubbles: true }));
      m.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const r = await window.CROP_P;
      return { afterPicture, afterBackdrop: m.hidden, r };
    });
    chk(back.afterPicture && back.afterBackdrop && back.r === null, `${t} a press that began on the picture does not dismiss from the backdrop; one that began on the backdrop does (CONTROL)`, JSON.stringify(back));

    // Wired: an agent's own page. Cancel uploads nothing; Save uploads one picture to that agent.
    await page.evaluate(() => { window.PUTS.length = 0; CURRENT = { sessionName: 'ada', name: 'Ada' }; });
    const pickAgent = () => page.evaluate(async () => {
      const f = await T.twoTone(1600, 800); const dt = new DataTransfer(); dt.items.add(f);
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

    // The panel moves to another agent while the editor is open: Save still uploads to the agent it was chosen for.
    await page.evaluate(() => { window.PUTS.length = 0; CURRENT = { sessionName: 'ada', name: 'Ada' }; });
    await pickAgent();
    await page.waitForFunction(() => !document.getElementById('cropmodal').hidden);
    await page.evaluate(() => { CURRENT = { sessionName: 'bob', name: 'Bob' }; });
    await page.click('#crop-go');
    await page.waitForFunction(() => window.PUTS.length > 0, null, { timeout: 10000 }).catch(() => {});
    const moved = await page.evaluate(() => window.PUTS.map((x) => x.url));
    chk(JSON.stringify(moved) === JSON.stringify(['/api/agent/ada/avatar']), `${t} Save still uploads to the agent it was chosen for after the panel moved on`, JSON.stringify(moved));

    // Wired: a new agent. Nothing uploads yet; the button says Use picture; the held file is the cut, named as chosen.
    const created = await page.evaluate(async () => {
      window.PUTS.length = 0;
      const f = await T.twoTone(1600, 800); const dt = new DataTransfer(); dt.items.add(f);
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
  if (engines.length === 0) chk(false, 'ENGINES named no engine, so nothing ran');
  const EXPECTED_PER_ENGINE = 33;
  if (RAN !== EXPECTED_PER_ENGINE * engines.length) chk(false, `ran ${RAN} checks, expected ${EXPECTED_PER_ENGINE * engines.length}`);
  console.log(`render-avatar-crop-6722: ${RAN - fail.length} PASS, ${fail.length} FAIL`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
