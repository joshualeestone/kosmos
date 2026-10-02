'use strict';

/**
 * Click a file a message carries to see it full page (#4930). The real web/index.html is served with every /api call
 * answered by a stub (so no board runs), real attachment cards are drawn with the page's own pjAttachmentCard into a
 * test strip on top of the page, and they are clicked:
 *   P1  a plain click on an image card opens the preview: a backdrop at least 85% black over the whole window (the
 *       page's scrollbar strip too, which Chromium never paints a fixed layer over), the
 *       picture fitted inside it (never cropped, never past the window), the X in the top-right corner and
 *       "Open in Finder" in the bottom-left corner;
 *   P2  Escape closes it and focus goes back to the card; the X and a click on the dark close it too;
 *   P3  Open in Finder asks the board to reveal THAT attachment (POST /api/attachment/<id>/reveal), and nothing else;
 *   P4  over Kosmos+ (the page reached by a name other than this computer) the button is Download, a link to the
 *       attachment that downloads it, and nothing asks the board to reveal;
 *   P5  a Cmd-click (or Ctrl-click) does not open the preview: the card stays a download link;
 *   P6  a PDF shows its first page with "The first page"; a text file shows its opening as text (markup in it is not
 *       run); any other file shows its name and size;
 *   P7  at 390 x 844 (a phone) the X and the action are inside the window and at least 40 px tall to tap;
 *   P8  with the "Kosmos has been updated" window open under it, one Escape closes only the preview, and the window
 *       under it does not take focus while the preview is up;
 *   P10 Tab moves between the X and the action and wraps both ways; focus never leaves the preview;
 *   P9  a card drawn by the real message rows (the project thread panel's pjMsg and the DM's dmRow) opens the preview;
 *   and no page errors from the preview's own code.
 * Needs no URL. ENGINES=chromium,webkit adds WebKit, the Mac app's engine.
 *
 *   ENGINES=chromium,webkit HEADED=0 NODE_PATH="$HOME/work/pw-runtime/node_modules" node docs/browser-checks/render-file-preview-4930.js
 */
const fs = require('node:fs');
const path = require('node:path');
const pw = require('playwright');

const ALL_ENGINES = ['chromium', 'webkit'];
const ASKED = (process.env.ENGINES || 'chromium').split(',').map((s) => s.trim()).filter(Boolean);
const ENGINES = ASKED.filter((e) => ALL_ENGINES.includes(e));
if (!ENGINES.length || ENGINES.length !== ASKED.length) {
  console.log('FAIL  render-file-preview-4930: ENGINES names an unknown engine (' + (process.env.ENGINES || '') + '); known: ' + ALL_ENGINES.join(', '));
  process.exit(1);
}

const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'index.html'), 'utf8');
const IMG_ID = 'a1'.repeat(12);
const PDF_ID = 'b2'.repeat(12);
const NOPAGE_ID = 'e5'.repeat(12);   // a PDF whose first page the server cannot draw (Windows): its preview is a 404
const TXT_ID = 'c3'.repeat(12);
const DOC_ID = 'd4'.repeat(12);
/* A 1200 x 800 PNG drawn in the page itself is the picture; the stub hands it back as the preview. */
let PNG = null;

async function runOn(engine, base, say) {
  const browser = await pw[engine].launch({ headless: process.env.HEADED === '0' });
  try {
    for (const [label, viewport] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]]) {
      const ctx = await browser.newContext({ viewport });
      const pg = await ctx.newPage();
      const reveals = [];
      const errors = [];
      pg.on('pageerror', (e) => errors.push(String(e && e.message)));
      await pg.route('**/*', async (route) => {
        const u = new URL(route.request().url());
        if (u.pathname === '/' || u.pathname === '/index.html') return route.fulfill({ status: 200, contentType: 'text/html', body: HTML });
        const rv = u.pathname.match(/^\/api\/attachment\/([0-9a-f]{24})\/reveal$/);
        if (rv && route.request().method() === 'POST') { reveals.push(rv[1]); if (rv[1] === NOPAGE_ID) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no such attachment"}' }); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); }
        if (/^\/api\/attachment\/[0-9a-f]{24}\/preview$/.test(u.pathname)) return u.pathname.includes(NOPAGE_ID) ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
        if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"stub"}' });
        return route.fulfill({ status: 404, body: '' });
      });
      await pg.goto(base + '/', { waitUntil: 'load' });
      await pg.waitForFunction(() => typeof pjAttachmentCard === 'function' && typeof pvOpen === 'function');
      // A strip over the page holding real cards, above anything the page draws while its API calls fail.
      await pg.evaluate(({ IMG_ID, PDF_ID, TXT_ID, DOC_ID, NOPAGE_ID }) => {
        const strip = document.createElement('div');
        strip.setAttribute('data-pv-test', '');
        strip.style.cssText = 'position:fixed;left:8px;top:8px;width:300px;z-index:55;background:#fff;padding:6px;';
        strip.innerHTML = pjAttachmentCards({ attachments: [
          { name: 'screenshot.png', type: 'image/png', size: 123456, kind: 'image', url: '/api/attachment/' + IMG_ID, preview: '/api/attachment/' + IMG_ID + '/preview' },
          { name: 'report.pdf', type: 'application/pdf', size: 99000, kind: 'pdf', url: '/api/attachment/' + PDF_ID, preview: '/api/attachment/' + PDF_ID + '/preview' },
          { name: 'notes.md', type: 'text/markdown', size: 400, kind: 'text', url: '/api/attachment/' + TXT_ID, preview: '# Notes\n<img src=x onerror="window.__ran=1">\nline three' },
          { name: 'deck.pptx', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', size: 2048000, kind: 'other', url: '/api/attachment/' + DOC_ID },
          { name: 'windows.pdf', type: 'application/pdf', size: 5000, kind: 'pdf', url: '/api/attachment/' + NOPAGE_ID, preview: '/api/attachment/' + NOPAGE_ID + '/preview' },
        ] });
        document.body.appendChild(strip);
      }, { IMG_ID, PDF_ID, TXT_ID, DOC_ID, NOPAGE_ID });
      await pg.waitForFunction(() => { const i = document.querySelector('[data-pv-test] .att-image img'); return i && i.complete && i.naturalWidth > 0; });
      const card = (id) => '[data-pv-test] a.att[data-att="' + id + '"]';
      const open = () => pg.evaluate(() => !!document.getElementById('pv-preview'));
      const tag = engine + ' ' + label;

      // P1
      await pg.click(card(IMG_ID));
      await pg.waitForSelector('#pv-preview img.pv-media');
      await pg.waitForFunction(() => { const i = document.querySelector('#pv-preview img.pv-media'); return i.complete && i.naturalWidth > 0; });
      await pg.waitForTimeout(350);   // the zoom-in
      const m = await pg.evaluate(() => {
        const back = document.getElementById('pv-preview');
        const bg = getComputedStyle(back).backgroundColor.match(/[\d.]+/g).map(Number);
        const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
        const img = back.querySelector('img.pv-media');
        return {
          bg, back: r(back), img: r(img), nat: [img.naturalWidth, img.naturalHeight], fit: getComputedStyle(img).objectFit,
          x: r(back.querySelector('#pv-x')), act: r(back.querySelector('#pv-do')), actText: back.querySelector('#pv-do').textContent,
          vw: innerWidth, vh: innerHeight,
        };
      });
      const alpha = m.bg.length === 4 ? m.bg[3] : 1;
      say(alpha >= 0.85 && m.bg[0] < 30 && m.bg[1] < 30 && m.bg[2] < 30, tag + ' P1: the backdrop is at least 85% black', JSON.stringify(m.bg));
      say(m.back.l === 0 && m.back.t === 0 && Math.round(m.back.w) === m.vw && Math.round(m.back.h) === m.vh, tag + ' P1: the backdrop covers the whole window, edge to edge', JSON.stringify(m.back));
      say(m.img.l >= 0 && m.img.t >= 0 && m.img.r <= m.vw + 0.5 && m.img.b <= m.vh + 0.5 && m.img.w > m.vw * 0.5, tag + ' P1: the picture is fitted inside the window, and large', JSON.stringify(m.img));
      say(Math.abs(m.img.w / m.img.h - m.nat[0] / m.nat[1]) < 0.02, tag + ' P1: the picture keeps its shape (never cropped or stretched)', (m.img.w / m.img.h).toFixed(3) + ' vs ' + (m.nat[0] / m.nat[1]).toFixed(3));
      say(m.x.r > m.vw - 40 && m.x.t < 40, tag + ' P1: the X is in the top-right corner', JSON.stringify(m.x));
      say(m.act.l < 40 && m.act.b > m.vh - 40, tag + ' P1: the action is in the bottom-left corner', JSON.stringify(m.act));
      say(m.actText === 'Open in Finder', tag + ' P1: the action is Open in Finder on this computer', m.actText);
      if (label === 'phone') {
        // P7
        say(m.x.r <= m.vw && m.x.h >= 40 && m.act.b <= m.vh && m.act.h >= 40, tag + ' P7: the X and the action are inside the window and big enough to tap', JSON.stringify({ x: m.x, act: m.act }));
      }

      // P3
      await pg.click('#pv-do');
      await pg.waitForTimeout(200);
      say(reveals.length === 1 && reveals[0] === IMG_ID, tag + ' P3: Open in Finder asks to reveal that attachment', JSON.stringify(reveals));

      // P2
      const lockedOpen = await pg.evaluate(() => ({ overflow: getComputedStyle(document.documentElement).overflow, gutter: getComputedStyle(document.documentElement).scrollbarGutter }));
      say(lockedOpen.overflow === 'hidden', tag + ' P2: while it is up the page does not scroll (the lock is on)', JSON.stringify(lockedOpen));
      await pg.keyboard.press('Escape');
      await pg.waitForTimeout(100);
      const back2 = await pg.evaluate((sel) => ({ open: !!document.getElementById('pv-preview'), focus: document.activeElement === document.querySelector(sel) }), card(IMG_ID));
      say(!back2.open && back2.focus, tag + ' P2: Escape closes it and focus goes back to the card', JSON.stringify(back2));
      const unlockedAfter = await pg.evaluate(() => ({ overflow: getComputedStyle(document.documentElement).overflow, gutter: getComputedStyle(document.documentElement).scrollbarGutter }));
      say(unlockedAfter.overflow !== 'hidden', tag + ' P2: closing takes the lock off (it was on above)', JSON.stringify({ lockedOpen, unlockedAfter }));
      await pg.click(card(IMG_ID));
      await pg.click('#pv-x');
      say(!(await open()), tag + ' P2: the X closes it');
      await pg.click(card(IMG_ID));
      await pg.mouse.click(m.vw - 4, Math.round(m.vh / 2));   // at the very edge, where the scrollbar strip was
      say(!(await open()), tag + ' P2: a click on the dark closes it');
      await pg.click(card(IMG_ID));
      const bar = await pg.evaluate(() => { const b = document.querySelector('#pv-preview .pv-bar').getBoundingClientRect(); return { x: Math.round(b.right - 6), y: Math.round(b.top + b.height / 2) }; });
      await pg.mouse.click(bar.x, bar.y);
      say(!(await open()), tag + ' P2: a click on the dark bottom bar closes it too');
      await pg.click(card(IMG_ID));
      await pg.click('#pv-name');
      say(await open(), tag + ' P2: a click on the file name keeps it open (words can be selected)');
      await pg.keyboard.press('Escape');

      // P10
      await pg.click(card(IMG_ID));
      const seq = [];
      for (const k of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) { await pg.keyboard.press(k); seq.push(await pg.evaluate(() => document.activeElement && document.activeElement.id)); }
      say(JSON.stringify(seq) === JSON.stringify(['pv-x', 'pv-do', 'pv-x', 'pv-do', 'pv-x']), tag + ' P10: Tab moves between the X and the action and wraps both ways', JSON.stringify(seq));
      await pg.keyboard.press('Escape');

      // P8
      await pg.click(card(IMG_ID));
      await pg.evaluate(() => wnOpen('9.9.9', [{ icon: 'star', title: 'A thing', line: 'It changed.' }]));
      await pg.waitForTimeout(100);
      const under = await pg.evaluate(() => ({ wn: !!document.getElementById('whatsnew'), focusInPreview: document.getElementById('pv-preview').contains(document.activeElement) }));
      await pg.keyboard.press('Tab');
      const afterTab = await pg.evaluate(() => document.getElementById('pv-preview').contains(document.activeElement));
      await pg.keyboard.press('Escape');
      const after = await pg.evaluate(() => ({ pv: !!document.getElementById('pv-preview'), wn: !!document.getElementById('whatsnew') }));
      say(under.wn && under.focusInPreview && afterTab && !after.pv && after.wn, tag + ' P8: the update window under it waits: focus stays in the preview, one Escape closes only the preview', JSON.stringify({ under, afterTab, after }));
      await pg.evaluate(() => { if (typeof wnClose === 'function') wnClose(); });

      // P5
      // The click must land on the card (a control that counts it), or this would pass on a click that never happened.
      // Counted in the capture phase WITHOUT cancelling it, so the page's own handler decides (a cancelled click would
      // test the defaultPrevented guard, not the modifier one).
      await pg.evaluate((sel) => { window.__cardClicks = 0; window.__cardCancelled = null; document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest(sel)) { window.__cardClicks += 1; setTimeout(() => { window.__cardCancelled = e.defaultPrevented; }, 0); } }, true); }, card(IMG_ID));
      await pg.click(card(IMG_ID), { modifiers: ['Meta'] });
      await pg.waitForTimeout(150);
      const mod = await pg.evaluate(() => ({ clicks: window.__cardClicks, open: !!document.getElementById('pv-preview'), cancelled: window.__cardCancelled }));
      say(mod.clicks === 1 && !mod.open && mod.cancelled === false, tag + ' P5: a Cmd-click lands on the card, keeps the download and opens no preview', JSON.stringify(mod));
      await pg.evaluate(() => { const b = document.getElementById('pv-preview'); if (b) b.remove(); });

      // P9
      const rows = await pg.evaluate((IMG_ID) => {
        const att = { name: 'shot.png', type: 'image/png', size: 2048, kind: 'image', url: '/api/attachment/' + IMG_ID, preview: '/api/attachment/' + IMG_ID + '/preview' };
        const out = {};
        for (const [k, draw] of [['pjMsg', () => pjMsg({ text: 'here it is', attachments: [att], ts: new Date().toISOString() }, 'Ava')],
          ['dmRow', () => dmRow({ from: 'Ava', to: 'You', text: 'here it is', attachments: [att], ts: new Date().toISOString() }, 'Ava')]]) {
          const box = document.createElement('div');
          box.setAttribute('data-pv-rows', k);
          box.style.cssText = 'position:fixed;left:8px;top:8px;width:300px;z-index:56;background:#fff;';   // over the test strip, inside a phone's width
          try { box.innerHTML = draw(); out[k] = !!box.querySelector('a.att[data-att]'); } catch (e) { out[k] = 'threw: ' + e.message; }
          document.body.appendChild(box);
        }
        return out;
      }, IMG_ID);
      for (const k of ['pjMsg', 'dmRow']) {
        let opened = false;
        if (rows[k] === true) {
          await pg.evaluate((k) => { for (const b of document.querySelectorAll('[data-pv-rows]')) b.style.display = b.getAttribute('data-pv-rows') === k ? '' : 'none'; }, k);
          await pg.click('[data-pv-rows="' + k + '"] a.att[data-att]');
          opened = await open();
          await pg.keyboard.press('Escape');
        }
        say(rows[k] === true && opened, tag + ' P9: a card in a real ' + k + ' row opens the preview', JSON.stringify(rows[k]));
      }
      await pg.evaluate(() => { for (const b of document.querySelectorAll('[data-pv-rows]')) b.remove(); });

      // P6
      await pg.click(card(PDF_ID));
      const pdf = await pg.evaluate(() => ({ img: !!document.querySelector('#pv-preview img.pv-media'), note: (document.querySelector('#pv-preview .pv-note') || {}).textContent }));
      say(pdf.img && pdf.note === 'The first page', tag + ' P6: a PDF shows its first page', JSON.stringify(pdf));
      await pg.keyboard.press('Escape');
      await pg.click(card(NOPAGE_ID));
      await pg.waitForTimeout(250);
      const noPage = await pg.evaluate(() => ({ img: !!document.querySelector('#pv-preview img.pv-media'), card: (document.querySelector('#pv-preview .pv-file b') || {}).textContent }));
      say(!noPage.img && noPage.card === 'windows.pdf', tag + ' P6: a PDF whose first page will not load shows its card, not a broken image', JSON.stringify(noPage));
      await pg.click('#pv-do');   // the board answers 404 for this one: the file is gone
      await pg.waitForTimeout(150);
      const gone = await pg.evaluate(() => (document.getElementById('pv-msg') || {}).textContent);
      say(gone === 'That file is no longer on this computer.', tag + ' P6: Open in Finder on a file that is gone says so in words', JSON.stringify(gone));
      await pg.keyboard.press('Escape');
      await pg.click(card(TXT_ID));
      await pg.waitForTimeout(150);
      const txt = await pg.evaluate(() => ({ text: (document.querySelector('#pv-preview pre.pv-text') || {}).textContent, imgs: document.querySelectorAll('#pv-preview img').length, ran: !!window.__ran }));
      say(typeof txt.text === 'string' && txt.text.includes('line three') && txt.text.includes('<img src=x') && txt.imgs === 0 && !txt.ran, tag + ' P6: a text file shows its opening as text, its markup not run', JSON.stringify(txt));
      // Selecting the text and letting go on the dark does not close it.
      const sel = await pg.evaluate(() => { const r = document.querySelector('#pv-preview pre.pv-text').getBoundingClientRect(); return { x: r.left + 20, y: r.top + 12, ex: innerWidth - 6, ey: r.top + 12 }; });
      await pg.mouse.move(sel.x, sel.y); await pg.mouse.down(); await pg.mouse.move(sel.ex, sel.ey, { steps: 8 }); await pg.mouse.up();
      say(await open(), tag + ' P6: selecting a text file\'s words and letting go on the dark keeps it open');
      await pg.keyboard.press('Escape');
      await pg.click(card(DOC_ID));
      const doc = await pg.evaluate(() => ({ name: (document.querySelector('#pv-preview .pv-file b') || {}).textContent, meta: (document.querySelector('#pv-preview .pv-file span') || {}).textContent }));
      say(doc.name === 'deck.pptx' && /PowerPoint/.test(doc.meta || ''), tag + ' P6: any other file shows its name and size', JSON.stringify(doc));
      await pg.keyboard.press('Escape');
      say(errors.length === 0, tag + ': no page errors', errors.slice(0, 3).join(' | '));
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

async function runRemote(engine, say) {
  const browser = await pw[engine].launch({ headless: process.env.HEADED === '0' });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pg = await ctx.newPage();
    const reveals = [];
    await pg.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: HTML });
      if (/\/reveal$/.test(u.pathname)) { reveals.push(u.pathname); return route.fulfill({ status: 200, body: '{}' }); }
      if (/\/preview$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });
    await pg.goto('http://kosmos-remote.test/', { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof pjAttachmentCard === 'function' && typeof pvOpen === 'function');
    await pg.evaluate((IMG_ID) => {
      const strip = document.createElement('div');
      strip.setAttribute('data-pv-test', '');
      strip.style.cssText = 'position:fixed;left:8px;top:8px;width:300px;z-index:55;background:#fff;';
      strip.innerHTML = pjAttachmentCard({ name: 'screenshot.png', type: 'image/png', size: 1, kind: 'image', url: '/api/attachment/' + IMG_ID, preview: '/api/attachment/' + IMG_ID + '/preview' });
      document.body.appendChild(strip);
    }, IMG_ID);
    await pg.click('[data-pv-test] a.att');
    await pg.waitForSelector('#pv-preview');
    const d = await pg.evaluate(() => { const a = document.getElementById('pv-do'); return { tag: a.tagName, text: a.textContent, href: a.getAttribute('href'), dl: a.getAttribute('download') }; });
    say(d.tag === 'A' && d.text === 'Download' && d.href === '/api/attachment/' + IMG_ID && d.dl === 'screenshot.png', engine + ' P4: over Kosmos+ the action is Download, a link to that attachment', JSON.stringify(d));
    say(reveals.length === 0, engine + ' P4: and nothing asks the board to reveal', JSON.stringify(reveals));
    await ctx.close();
  } finally {
    await browser.close();
  }
}

(async () => {
  const fails = [];
  const say = (ok, l, x) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (x ? '  ' + x : '')); if (!ok) fails.push(l); };
  for (const engine of ENGINES) {
    try {
      if (!PNG) {
        const b = await pw.chromium.launch({ headless: true });
        const p = await b.newPage();
        PNG = Buffer.from(await p.evaluate(async () => {
          const c = document.createElement('canvas'); c.width = 1200; c.height = 800;
          const x = c.getContext('2d'); x.fillStyle = '#3a7'; x.fillRect(0, 0, 1200, 800); x.fillStyle = '#fff'; x.fillRect(100, 100, 300, 200);
          const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
          return Array.from(new Uint8Array(await blob.arrayBuffer()));
        }));
        await b.close();
      }
      await runOn(engine, 'http://127.0.0.1:59930', say);
      await runRemote(engine, say);
    } catch (e) {
      say(false, engine + ': ran to the end', String(e && e.message).split('\n')[0]);
    }
  }
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'all good');
  process.exit(fails.length ? 1 : 0);
})();
