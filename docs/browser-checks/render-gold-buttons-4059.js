// Browser-check-surface: gold-light gold-lit goldLightState
'use strict';

/**
 * The gold primary buttons (#4059, Josh picked study A on 2026-09-27): polished gold, fully rounded pills, and a
 * liquid light that follows the pointer and lingers after it leaves.
 *
 * What this pins, in Chromium and WebKit (WebKit stands in for Safari, which Josh's Mac uses, and Safari is the
 * engine that did not clip a GPU canvas to the pill with overflow alone):
 *   G1  every gold primary is a pill (border-radius 999px), the create flow's big one too; the blue ask-card
 *       primary is NOT gold and keeps its own shape
 *   G2  the label (#14161a) clears 4.5:1 on EVERY pixel of the fill, at rest and on hover, light and dark theme,
 *       measured from the rendered pixels with the label hidden: the band, the two ends, and the minimum over the
 *       whole inside of the pill
 *   G3  hovering two different gold buttons in turn leaves exactly ONE extra canvas in the document (the shared
 *       WebGL canvas), and it is inside the button under the pointer, not the first one
 *   G4  that canvas is clipped to the pill: clip-path rounds it, and the bounding box's corners, which are outside
 *       the pill, are the same pixels after the light as before it, while the inside of the pill has changed
 *   G5  no layout shift: a gold button's box is identical before and during hover, and the polished pill is the
 *       same size as the flat gold button it replaces (the old rule forced back on, the boxes compared)
 *   G6  the loop stops when nothing is visible: a hidden host, and the light fading with the pointer gone
 *   G7  reduced motion: no canvas and no loop; the hover only darkens the fill
 *   G8  no WebGL (context creation returns null, or throws): no canvas, no loop, the hover still darkens
 *   G9  the keyboard ring on the pill is the app's 2px ink ring
 *   G10 no page errors anywhere
 *   G11 a repaint that rebuilds the lit button under a still pointer (the empty board's Create button, every poll)
 *       carries the light to the new copy: it is not dropped until the pointer next moves
 *   G11b when the old button is still on the page (only its canvas was taken), it gets its class and position back
 *   G1c the found and import rows' Added state keeps its own shape (the control radius), not the gold pill
 *   G2d the label clears 4.5:1 on every pixel of the fill WITH THE LIGHT SHOWING (motion on, the light hosted on
 *       that button while the pixels are read). The light is blended with screen, which can only brighten the fill
 *       under a dark label, so this should hold by construction; the arm is what proves it.
 *
 * It also fails if it ran any number of checks other than EXPECTED, so a skipped arm cannot read as green.
 *
 * Harness: loaded over file:// with fetch answered here and the polls off (render-unread-edge-3743.js's posture).
 * The hover arms use a strip of gold buttons fixed over the page, drawn by the page's own CSS and served by the
 * page's own gold-light script, plus the real + New task and Post buttons on their own panels.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-gold-buttons-4059.js
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const path = require('node:path');
const pw = require('playwright');
const ENGINES = ['chromium', 'webkit'];
let ENGINE = '';   // the engine the loop below is on, for chk's labels

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const EXPECTED = 78;   // 39 per engine
const fail = [];
let passed = 0;
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + '[' + ENGINE + '] ' + label + (extra ? '  ' + extra : ''));
  if (ok) passed += 1; else fail.push('[' + ENGINE + '] ' + label);
}

/* The page, hermetic, with the first-run wizard out of the way and a strip of gold buttons over everything. */
async function open(browser, opts, init) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1200, height: 800 } }, opts || {}));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => {
    window.setInterval = () => 0;
    window.fetch = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  if (init) await page.addInitScript(init);
  await page.goto(PAGE, { timeout: 90000 });   // a loaded machine (other agents' suites) took >30s to load this 4MB page
  await page.bringToFront();
  await page.evaluate(() => {
    const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
    document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
    const strip = document.createElement('div');
    strip.dataset.gx = 'strip';
    strip.style.cssText = 'position:fixed;left:0;top:0;right:0;z-index:2147483647;display:flex;gap:24px;align-items:center;padding:24px 40px;background:var(--bg);';
    strip.innerHTML = '<button class="btn uprime" data-gx="g1" type="button">Post</button>'
      + '<button class="btn uprime big" data-gx="g2" type="button">Create agent</button>'
      + '<button class="btn uprime" data-gx="g3" type="button"><span aria-hidden="true">+</span> New task</button>'
      + '<button class="btn uprime" data-gx="gdis" type="button" disabled>Create task</button>'
      + '<div class="askcard"><button class="btn uprime" data-gx="blue" type="button">Allow</button></div>';
    document.body.appendChild(strip);
  });
  return { ctx, page, errs };
}
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const box = async (page, sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 100) / 100); }, sel);
const litCount = (page) => page.evaluate(() => document.querySelectorAll('canvas.gold-light').length);
const allCanvas = (page) => page.evaluate(() => document.querySelectorAll('canvas').length);
const state = (page) => page.evaluate(() => { const s = window.goldLightState(); return { running: s.running, host: s.host ? (s.host.dataset.gx || s.host.id) : null, dead: s.dead, size: s.size }; });

/* Swipe the real mouse across a button, through the middle, cap to cap. */
async function swipe(page, sel, passes) {
  const [x, y, w, h] = await box(page, sel);
  await page.mouse.move(x + w / 2, y + h / 2);
  for (let i = 0; i < (passes || 2); i += 1) {
    await page.mouse.move(x + 3, y + h / 2, { steps: 8 });
    await page.mouse.move(x + w - 3, y + h / 2 + (i % 2 ? -h / 4 : h / 4), { steps: 12 });
  }
  await page.mouse.move(x + w / 2, y + h / 2, { steps: 6 });
}

/* A screenshot of a region, decoded in the page into RGBA rows. */
async function pixels(page, clip) {
  const b64 = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(async (src) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + src; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    return { w: c.width, h: c.height, d: Array.from(x.getImageData(0, 0, c.width, c.height).data) };
  }, b64);
}
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const INK = lum(0x14, 0x16, 0x1a);
const cr = (r, g, b) => { const l = lum(r, g, b); return (Math.max(l, INK) + 0.05) / (Math.min(l, INK) + 0.05); };

/* Contrast of the label ink against the fill, from the pixels, with the label hidden (so only fill is read).
   Band: the middle column. Ends: the pill's two caps at mid height, 4px in. Min: every pixel 3px inside the pill. */
async function fillContrast(page, sel) {
  await page.evaluate((s) => { document.querySelector(s).style.setProperty('color', 'transparent', 'important'); }, sel);
  await settle(page);
  const [x, y, w, h] = await box(page, sel);
  const px = await pixels(page, { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) });
  await page.evaluate((s) => { document.querySelector(s).style.removeProperty('color'); }, sel);
  const at = (i, j) => { const k = (j * px.w + i) * 4; return cr(px.d[k], px.d[k + 1], px.d[k + 2]); };
  const r = px.h / 2, m = 3;
  let min = Infinity, n = 0;
  for (let j = 0; j < px.h; j += 1) {
    for (let i = 0; i < px.w; i += 1) {
      const cx = i + 0.5, cy = j + 0.5;
      const capX = cx < r ? r : (cx > px.w - r ? px.w - r : cx);
      if (Math.hypot(cx - capX, cy - r) > r - m) continue;
      min = Math.min(min, at(i, j)); n += 1;
    }
  }
  const mid = Math.floor(px.h / 2);
  let band = Infinity;
  for (let j = m; j < px.h - m; j += 1) band = Math.min(band, at(Math.floor(px.w / 2), j));
  const ends = Math.min(at(4, mid), at(px.w - 5, mid));
  return { min: +min.toFixed(2), band: +band.toFixed(2), ends: +ends.toFixed(2), n };
}

(async () => {
  for (ENGINE of ENGINES) {
    const browser = await pw[ENGINE].launch({ headless: process.env.HEADED === '0' });
    try {
      /* ---------------- the ordinary case ---------------- */
      const { ctx, page, errs } = await open(browser);
      await page.mouse.move(1150, 780);

      // G1: pills.
      const radii = await page.evaluate(() => ['g1', 'g2', 'g3', 'blue'].map((g) => getComputedStyle(document.querySelector('[data-gx=' + g + ']')).borderTopLeftRadius));
      chk(radii[0] === '999px' && radii[1] === '999px' && radii[2] === '999px', 'G1 every gold primary is a fully rounded pill (999px), the big create-flow one too', JSON.stringify(radii));
      chk(radii[3] !== '999px', 'G1b the blue ask-card primary is not gold and keeps its own shape', radii[3]);
      const added = await page.evaluate(() => {
        const out = [];
        for (const [host, row, cls] of [['#firstrun', 'fr-foundrow', 'fr-foundgo'], ['#import-found', 'fr-importrow', 'fr-importgo']]) {
          const h = document.querySelector(host); if (!h) { out.push('no ' + host); continue; }
          const w = document.createElement('div'); w.className = row;
          w.innerHTML = '<button class="btn uprime ' + cls + ' added" type="button">Added</button>';
          h.appendChild(w); out.push(getComputedStyle(w.firstChild).borderTopLeftRadius); w.remove();
        }
        return out;
      });
      chk(added.length === 2 && added.every((r) => r === '10px'), 'G1c the found and import rows\' Added state keeps the control radius, not the gold pill', JSON.stringify(added));

      // G2: contrast on every pixel of the fill, at rest, then on the dark theme.
      const cLight = await fillContrast(page, '[data-gx=g1]');
      const cBig = await fillContrast(page, '[data-gx=g2]');
      chk(cLight.n > 500 && cLight.min >= 4.5 && cLight.band >= 4.5 && cLight.ends >= 4.5, 'G2 the label clears 4.5:1 on every pixel of the fill at rest (band, ends, whole pill)', JSON.stringify(cLight));
      chk(cBig.n > 500 && cBig.min >= 4.5 && cBig.ends >= 4.5, 'G2 and on the big create-flow pill', JSON.stringify(cBig));
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
      const cDark = await fillContrast(page, '[data-gx=g1]');
      chk(cDark.n > 500 && cDark.min >= 4.5 && cDark.ends >= 4.5, 'G2 and on the dark theme', JSON.stringify(cDark));
      await page.evaluate(() => { delete document.documentElement.dataset.theme; });

      // G9: the keyboard ring.
      await page.keyboard.press('Shift');
      const ring = await page.evaluate(() => { const b = document.querySelector('[data-gx=g1]'); b.focus(); const cs = getComputedStyle(b);
        const out = { fv: b.matches(':focus-visible'), style: cs.outlineStyle, width: cs.outlineWidth, off: cs.outlineOffset }; b.blur(); return out; });
      chk(ring.fv && ring.style === 'solid' && ring.width === '2px', 'G9 a keyboard focus on the pill draws the app\'s 2px solid ring', JSON.stringify(ring));

      // G3 + G4 + G5 on the fixture buttons.
      const base = await allCanvas(page);
      const g1Before = await box(page, '[data-gx=g1]');
      const [ax, ay, aw, ah] = g1Before;
      const clip1 = { x: Math.round(ax), y: Math.round(ay), width: Math.round(aw), height: Math.round(ah) };
      const shotBefore = await pixels(page, clip1);
      await swipe(page, '[data-gx=g1]', 3);
      await page.mouse.down(); await page.mouse.up();   // the tap bloom, so the light reaches the caps
      await page.waitForTimeout(250);
      const s1 = await state(page);
      const in1 = await page.evaluate(() => { const c = document.querySelector('canvas.gold-light'); return c ? { parent: c.parentElement.dataset.gx, clip: getComputedStyle(c).clipPath, z: getComputedStyle(c).zIndex, pe: getComputedStyle(c).pointerEvents } : null; });
      const g1During = await box(page, '[data-gx=g1]');
      chk(s1.running && s1.host === 'g1' && in1 && in1.parent === 'g1', 'G3 hovering a gold button runs the light, on a canvas inside that button', JSON.stringify({ s1, in1 }));
      chk(s1.size === 3.3, 'G3 the light is size 2 of the study (3.3)', String(s1.size));
      chk(in1 && /round/.test(in1.clip) && in1.pe === 'none' && in1.z === '-1', 'G4 the canvas is clipped to the pill (clip-path round), under the label, and never takes the pointer', JSON.stringify(in1));
      chk(JSON.stringify(g1During) === JSON.stringify(g1Before), 'G5 no layout shift: the button\'s box is identical before and during hover', JSON.stringify([g1Before, g1During]));
      // G4 by pixels: the four corners of the bounding box lie outside the pill; the light must not reach them.
      await page.mouse.move(ax + aw / 2, ay + ah / 2);   // still hovered, the light is still up
      const shotDuring = await pixels(page, clip1);
      const idx = (p, i, j) => (j * p.w + i) * 4;
      const diffAt = (i, j) => { const k = idx(shotBefore, i, j); return Math.abs(shotBefore.d[k] - shotDuring.d[k]) + Math.abs(shotBefore.d[k + 1] - shotDuring.d[k + 1]) + Math.abs(shotBefore.d[k + 2] - shotDuring.d[k + 2]); };
      let cornerMoved = 0, insideMoved = 0;
      for (const [ci, cj] of [[0, 0], [1, 0], [0, 1], [shotBefore.w - 1, 0], [shotBefore.w - 2, 0], [shotBefore.w - 1, 1], [0, shotBefore.h - 1], [1, shotBefore.h - 1], [0, shotBefore.h - 2], [shotBefore.w - 1, shotBefore.h - 1], [shotBefore.w - 2, shotBefore.h - 1], [shotBefore.w - 1, shotBefore.h - 2]]) if (diffAt(ci, cj) > 6) cornerMoved += 1;
      for (let j = 4; j < shotBefore.h - 4; j += 1) for (let i = Math.floor(shotBefore.h / 2); i < shotBefore.w - shotBefore.h / 2; i += 1) if (diffAt(i, j) > 12) insideMoved += 1;
      chk(insideMoved > 50, 'G4 the light is really drawn: pixels inside the pill changed', 'changed=' + insideMoved);
      chk(cornerMoved === 0, 'G4 the light stays inside the pill: the bounding-box corners outside it are unchanged', 'corners changed=' + cornerMoved);
      // G4 by pixels, whatever the light happens to reach: the dye may never touch a corner, so the arm above can pass
      // with no clip at all (measured: it did). Here the canvas ITSELF is painted solid magenta, unblended, for one
      // screenshot, so every pixel of its box shows unless the clip removes it: magenta inside the pill, none in the
      // corners of the box that lie outside it.
      await page.evaluate(() => { const c = document.querySelector('canvas.gold-light'); c.style.background = '#ff00ff'; c.style.mixBlendMode = 'normal'; c.style.opacity = '1'; });
      await settle(page);
      const mag = await pixels(page, clip1);
      await page.evaluate(() => { const c = document.querySelector('canvas.gold-light'); if (c) { c.style.background = ''; c.style.mixBlendMode = ''; c.style.opacity = ''; } });
      const isMag = (i, j) => { const k = idx(mag, i, j); return mag.d[k] > 180 && mag.d[k + 1] < 110 && mag.d[k + 2] > 180; };
      let magCorner = 0, magInside = 0;
      const rr = mag.h / 2;
      for (let j = 0; j < mag.h; j += 1) {
        for (let i = 0; i < mag.w; i += 1) {
          const cx = i + 0.5, cy = j + 0.5;
          const capX = cx < rr ? rr : (cx > mag.w - rr ? mag.w - rr : cx);
          const d = Math.hypot(cx - capX, cy - rr);
          if (d > rr + 1 && isMag(i, j)) magCorner += 1;          // clearly outside the pill
          if (d < rr - 3 && isMag(i, j)) magInside += 1;          // clearly inside it
        }
      }
      chk(magInside > 200 && magCorner === 0, 'G4 the canvas is clipped to the pill: painted solid, it shows inside the pill and not in the box corners outside it', JSON.stringify({ magInside, magCorner }));

      // G3: the second button takes the same canvas.
      await swipe(page, '[data-gx=g2]', 2);
      await page.waitForTimeout(150);
      const s2 = await state(page);
      const where = await page.evaluate(() => [...document.querySelectorAll('canvas.gold-light')].map((c) => c.parentElement && c.parentElement.dataset.gx));
      const after = await allCanvas(page);
      chk(after - base === 1 && where.length === 1 && where[0] === 'g2' && s2.host === 'g2', 'G3 after hovering two gold buttons in turn there is exactly one extra canvas, inside the second', JSON.stringify({ base, after, where, s2 }));
      chk(await page.evaluate(() => !document.querySelector('[data-gx=g1] canvas') && !document.querySelector('[data-gx=g1]').classList.contains('gold-lit')), 'G3 the first button gave the canvas up entirely');
      // G2d: contrast while the light is actually showing on the big pill (the pointer still on it).
      const litBefore = await state(page);
      const cLit = await fillContrast(page, '[data-gx=g2]');
      const litAfter = await state(page);
      chk(litBefore.running && litBefore.host === 'g2' && litAfter.running && litAfter.host === 'g2' && cLit.n > 500 && cLit.min >= 4.5 && cLit.band >= 4.5 && cLit.ends >= 4.5,
        'G2d the label clears 4.5:1 on every pixel of the fill with the light showing', JSON.stringify({ cLit, litBefore: litBefore.host, litAfter: litAfter.host }));

      // Not gold: the blue ask-card primary and a disabled gold button never host the light.
      await swipe(page, '[data-gx=blue]', 1);
      await page.waitForTimeout(100);
      const blue = await page.evaluate(() => !!document.querySelector('[data-gx=blue] canvas'));
      await page.mouse.move(1150, 780);
      await page.mouse.move(await page.evaluate(() => { const r = document.querySelector('[data-gx=gdis]').getBoundingClientRect(); return r.x + r.width / 2; }), 50, { steps: 4 });
      const dis = await page.evaluate(() => !!document.querySelector('[data-gx=gdis] canvas'));
      chk(!blue && !dis, 'G3b the blue primary and a disabled gold button never host the light', JSON.stringify({ blue, dis }));
      // G3b's control: the same button enabled DOES host the light, so the disabled reading above is the guard's work
      // and not an engine that sends no pointer events to a disabled button.
      await page.evaluate(() => { document.querySelector('[data-gx=gdis]').disabled = false; });
      await page.mouse.move(1150, 780);
      await swipe(page, '[data-gx=gdis]', 1);
      await page.waitForTimeout(100);
      const en = await page.evaluate(() => !!document.querySelector('[data-gx=gdis] canvas.gold-light'));
      await page.evaluate(() => { document.querySelector('[data-gx=gdis]').disabled = true; });
      chk(en, 'G3b control: the same button, enabled, does host the light', String(en));

      // G11: a repaint rebuilds the lit button under a pointer that has not moved.
      await swipe(page, '[data-gx=g1]', 1);   // ends still, in the middle
      await page.waitForTimeout(100);
      const r0 = await state(page);
      await page.evaluate(() => {
        const old = document.querySelector('[data-gx=g1]');
        const t = document.createElement('template');
        t.innerHTML = '<button class="btn uprime" data-gx="g1" type="button">Post</button>';
        old.replaceWith(t.content.firstChild);
      });
      await settle(page); await settle(page);
      const r1 = await state(page);
      const fresh = await page.evaluate(() => { const b = document.querySelector('[data-gx=g1]'); return !!b.querySelector('canvas.gold-light') && b.classList.contains('gold-lit'); });
      chk(r0.running && r0.host === 'g1' && r1.running && r1.host === 'g1' && fresh && (await litCount(page)) === 1, 'G11 a repaint under a still pointer carries the light to the new copy of the button', JSON.stringify({ r0, r1, fresh }));
      // G11b: the old button stays on the page and only loses its canvas (a label change), while a same-size gold
      // button now sits under the still pointer: the light moves, and the old button gets its class and position back.
      await swipe(page, '[data-gx=g1]', 1);
      await page.waitForTimeout(100);
      await page.evaluate(() => {
        const old = document.querySelector('[data-gx=g1]'); const r = old.getBoundingClientRect();
        const b = document.createElement('button'); b.className = 'btn uprime'; b.type = 'button'; b.dataset.gx = 'g1b'; b.textContent = 'Post';
        b.style.cssText = 'position:fixed;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;margin:0;z-index:2147483647;box-sizing:border-box;';
        document.body.appendChild(b);
        old.textContent = 'Post';   // takes the canvas out of the old button, which stays on the page
      });
      await settle(page); await settle(page);
      const r2 = await state(page);
      const oldBack = await page.evaluate(() => { const o = document.querySelector('[data-gx=g1]'); return { lit: o.classList.contains('gold-lit'), pos: o.style.position }; });
      chk(r2.host === 'g1b' && !oldBack.lit && oldBack.pos === '', 'G11b the old button, still on the page, gets its class and position back when the light moves on', JSON.stringify({ r2, oldBack }));
      await page.evaluate(() => document.querySelector('[data-gx=g1b]').remove());
      await page.mouse.move(1150, 780);


      // G6: a hidden host stops the loop and takes the canvas out.
      await swipe(page, '[data-gx=g3]', 1);
      await page.waitForTimeout(100);
      const s3 = await state(page);
      await page.evaluate(() => { document.querySelector('[data-gx=g3]').style.display = 'none'; });
      await settle(page); await settle(page);
      const s3b = await state(page);
      chk(s3.running && s3.host === 'g3' && !s3b.running && s3b.host === null && (await litCount(page)) === 0, 'G6 a host that is hidden stops the loop and drops the canvas', JSON.stringify({ s3, s3b }));
      await page.evaluate(() => { document.querySelector('[data-gx=g3]').style.display = ''; });
      // G6: with the pointer gone, the light lingers, then the loop stops.
      await swipe(page, '[data-gx=g1]', 1);
      await page.mouse.move(1150, 780, { steps: 4 });
      await page.waitForTimeout(400);
      const linger = await state(page);
      await page.waitForTimeout(12400);
      const gone = await state(page);
      chk(linger.running && linger.host === 'g1', 'G6 after the pointer leaves, the light lingers (the loop still runs)', JSON.stringify(linger));
      chk(!gone.running && gone.host === null && (await litCount(page)) === 0, 'G6 once it has faded, the loop stops and the canvas is gone: no idle GPU work', JSON.stringify(gone));

      // G5 on real buttons, each on its own panel: + New task, and Post on an agent.
      for (const [panel, sel] of [['panel-tasks', '#tsk-new'], ['panel-detail', '#d-send']]) {
        await page.evaluate((p) => { document.querySelector('[data-gx=strip]').hidden = true; for (const el of document.querySelectorAll('[id^=panel-]')) el.hidden = el.id !== p; }, panel);
        await page.evaluate((s) => { const b = document.querySelector(s); b.disabled = false; }, sel);
        await page.mouse.move(1150, 780);
        await settle(page);
        const b0 = await box(page, sel);
        const hit = await page.evaluate(([s, x, y]) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest(s)); }, [sel, b0[0] + b0[2] / 2, b0[1] + b0[3] / 2]);
        await swipe(page, sel, 1);
        await page.waitForTimeout(100);
        const b1 = await box(page, sel);
        const lit = await page.evaluate((s) => !!document.querySelector(s + ' > canvas.gold-light'), sel);
        chk(hit && lit && JSON.stringify(b0) === JSON.stringify(b1), 'G5 ' + sel + ' on its own panel hosts the light without moving', JSON.stringify({ hit, lit, b0, b1 }));
        await page.mouse.move(1150, 780);
      }
      await page.evaluate(() => { document.querySelector('[data-gx=strip]').hidden = false; for (const el of document.querySelectorAll('[id^=panel-]')) el.hidden = true; });
      // G5: the polished pill is the same size as the flat gold button it replaces (every gold button measured on the
      // page under both rules: panels shown one at a time so each is laid out, then the old rule forced back on).
      const sizes = await page.evaluate(async () => {
        const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const read = () => [...document.querySelectorAll('.uprime')].filter((b) => b.getClientRects().length).map((b) => (b.id || b.textContent.trim()) + ':' + b.offsetWidth + 'x' + b.offsetHeight);
        const out = [];
        for (const p of ['panel-tasks', 'panel-detail', 'panel-create', 'panel-projects', 'panel-settings', null]) {
          for (const el of document.querySelectorAll('[id^=panel-]')) el.hidden = el.id !== p;
          await frame();
          const now = read();
          const st = document.createElement('style');
          st.textContent = '.uprime { background: #e3b341 !important; border-color: #e3b341 !important; border-radius: 10px !important; box-shadow: none !important; }';
          document.head.appendChild(st); await frame();
          const old = read();
          st.remove(); await frame();
          out.push({ p, now, old });
        }
        return out;
      });
      const nSized = sizes.reduce((a, s) => a + s.now.length, 0);
      const differ = sizes.filter((s) => JSON.stringify(s.now) !== JSON.stringify(s.old));
      chk(nSized >= 4 && differ.length === 0, 'G5 every visible gold button is the same size as the flat button it replaces', 'measured=' + nSized + (differ.length ? ' ' + JSON.stringify(differ) : ''));

      chk(errs.length === 0, 'G10 no page errors', errs.join(' | '));
      await ctx.close();

      /* ---------------- reduced motion ---------------- */
      const rm = await open(browser, { reducedMotion: 'reduce' });
      await rm.page.mouse.move(1150, 780);
      const restImg = await rm.page.evaluate(() => getComputedStyle(document.querySelector('[data-gx=g1]')).backgroundImage);
      await swipe(rm.page, '[data-gx=g1]', 2);
      await rm.page.waitForTimeout(200);
      const rmState = await state(rm.page);
      const hoverImg = await rm.page.evaluate(() => getComputedStyle(document.querySelector('[data-gx=g1]')).backgroundImage);
      chk((await litCount(rm.page)) === 0 && !rmState.running && rmState.host === null, 'G7 reduced motion: no canvas and no loop', JSON.stringify(rmState));
      chk(/gradient/.test(hoverImg) && hoverImg !== restImg, 'G7 reduced motion: the hover still darkens the fill');
      const cHover = await fillContrast(rm.page, '[data-gx=g1]');   // the pointer is on it: this is the hover fill, with no light
      chk(cHover.n > 500 && cHover.min >= 4.5 && cHover.band >= 4.5 && cHover.ends >= 4.5, 'G2 the label clears 4.5:1 on every pixel of the darker hover fill', JSON.stringify(cHover));
      await swipe(rm.page, '[data-gx=g2]', 1);
      const cHoverBig = await fillContrast(rm.page, '[data-gx=g2]');
      chk(cHoverBig.n > 500 && cHoverBig.min >= 4.5 && cHoverBig.ends >= 4.5, 'G2 and on the big pill\'s hover fill', JSON.stringify(cHoverBig));
      chk(rm.errs.length === 0, 'G10 no page errors under reduced motion', rm.errs.join(' | '));
      await rm.ctx.close();

      /* ---------------- no WebGL: getContext returns null, then getContext throws ---------------- */
      for (const [mode, init] of [
        ['returns null', () => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t) { return /webgl/.test(t) ? null : g.apply(this, arguments); }; }],
        ['throws', () => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t) { if (/webgl/.test(t)) throw new Error('no webgl here'); return g.apply(this, arguments); }; }],
      ]) {
        const nw = await open(browser, null, init);
        await nw.page.mouse.move(1150, 780);
        const rest = await nw.page.evaluate(() => getComputedStyle(document.querySelector('[data-gx=g1]')).backgroundImage);
        await swipe(nw.page, '[data-gx=g1]', 2);
        await nw.page.mouse.down(); await nw.page.mouse.up();
        await swipe(nw.page, '[data-gx=g2]', 1);
        await nw.page.waitForTimeout(150);
        const st = await state(nw.page);
        const hov = await nw.page.evaluate(() => getComputedStyle(document.querySelector('[data-gx=g2]')).backgroundImage);
        chk((await litCount(nw.page)) === 0 && st.dead && !st.running, 'G8 no WebGL (' + mode + '): no canvas, no loop', JSON.stringify(st));
        chk(hov !== rest && /gradient/.test(hov), 'G8 no WebGL (' + mode + '): the hover still darkens the fill');
        chk(nw.errs.length === 0, 'G10 no WebGL (' + mode + '): no page errors', nw.errs.join(' | '));
        await nw.ctx.close();
      }
    } finally {
      await browser.close();
    }
  }
  if (passed + fail.length !== EXPECTED) fail.push('ran ' + (passed + fail.length) + ' checks, expected ' + EXPECTED + ': an arm was skipped or added without updating EXPECTED');
  if (fail.length) { console.log('\n' + fail.length + ' FAILED, ' + passed + ' PASS'); process.exit(1); }
  console.log('\n' + passed + ' PASS, all gold-button checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
