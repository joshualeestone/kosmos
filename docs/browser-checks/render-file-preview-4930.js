'use strict';

/**
 * Click a file a message carries to see it full page (#4930). The real web/index.html is served with every /api call
 * answered by a stub (so no board runs), real attachment cards are drawn with the page's own pjAttachmentCard into a
 * test strip on top of the page, and they are clicked:
 *   P1  a plain click on an image card opens the preview: a backdrop at least 85% black over the whole window (the
 *       page's scrollbar strip too, which Chromium never paints a fixed layer over), the
 *       picture fitted inside it (never cropped, never past the window), the X in the top-right corner and
 *       "Open in Finder" centred right under the picture, in the regular gold (#8122; it was the bottom-left corner);
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
 *   P8120 in the Mac app (its download handler stood in for): a click carries its own key and turns the button off, a
 *       second click asks for nothing, another download's answer does not reach it, only `saved` says Saved to Downloads
 *       (with the name and Show in Finder, which asks by id and keeps the viewer open), a failure puts the button back,
 *       two Files-list downloads answered out of order each get their own answer; in a browser nothing changes;
 *   and no page errors from the preview's own code.
 *   P8122 (runSheet, the spreadsheet grid, against stubbed sheet routes): tabs and grid, markup as text, numbers right,
 *       the notes (cut, no saved values, more sheets, empty, no sheets), arrows with Home and End, firstRow, a long cell
 *       cut to one line with its whole value on hover, too large and a 404 showing the card, a viewer closed before the
 *       answer, a CSV falling back to its text, the dark-click rule (a tab, a cell, the gap between tabs keep it; beside a
 *       narrow grid, also under a wider note, closes it), the grid centred over the button, Tab reaching tab and grid,
 *       and a phone (44 px tabs, a 200 x 50 sheet scrolling inside the window).
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
const TALL_ID = 'f6'.repeat(12);   // #8122: an 800 x 3000 picture, so the layout's height cap is tested
let TALL = null;
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
        if (u.pathname === '/api/attachment/' + TALL_ID + '/preview') return route.fulfill({ status: 200, contentType: 'image/png', body: TALL });
        if (/^\/api\/attachment\/[0-9a-f]{24}\/preview$/.test(u.pathname)) return u.pathname.includes(NOPAGE_ID) ? route.fulfill({ status: 404, body: '' }) : route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
        if (u.pathname.startsWith('/api/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"stub"}' });
        return route.fulfill({ status: 404, body: '' });
      });
      await pg.goto(base + '/', { waitUntil: 'load' });
      await pg.waitForFunction(() => typeof pjAttachmentCard === 'function' && typeof pvOpen === 'function');
      // A strip over the page holding real cards, above anything the page draws while its API calls fail.
      await pg.evaluate(({ IMG_ID, PDF_ID, TXT_ID, DOC_ID, NOPAGE_ID, TALL_ID }) => {
        const strip = document.createElement('div');
        strip.setAttribute('data-pv-test', '');
        strip.style.cssText = 'position:fixed;left:8px;top:8px;width:300px;z-index:55;background:#fff;padding:6px;';
        strip.innerHTML = pjAttachmentCards({ attachments: [
          { name: 'screenshot.png', type: 'image/png', size: 123456, kind: 'image', url: '/api/attachment/' + IMG_ID, preview: '/api/attachment/' + IMG_ID + '/preview' },
          { name: 'report.pdf', type: 'application/pdf', size: 99000, kind: 'pdf', url: '/api/attachment/' + PDF_ID, preview: '/api/attachment/' + PDF_ID + '/preview' },
          { name: 'notes.md', type: 'text/markdown', size: 400, kind: 'text', url: '/api/attachment/' + TXT_ID, preview: '# Notes\n<img src=x onerror="window.__ran=1">\nline three' + '\nmore'.repeat(200) },   // #8122: long, so the layout row below means something
          { name: 'deck.pptx', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', size: 2048000, kind: 'other', url: '/api/attachment/' + DOC_ID },
          { name: 'windows.pdf', type: 'application/pdf', size: 5000, kind: 'pdf', url: '/api/attachment/' + NOPAGE_ID, preview: '/api/attachment/' + NOPAGE_ID + '/preview' },
          { name: 'tall.png', type: 'image/png', size: 400000, kind: 'image', url: '/api/attachment/' + TALL_ID, preview: '/api/attachment/' + TALL_ID + '/preview' },
        ] });
        document.body.appendChild(strip);
      }, { IMG_ID, PDF_ID, TXT_ID, DOC_ID, NOPAGE_ID, TALL_ID });
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
          actBg: getComputedStyle(back.querySelector('#pv-do')).backgroundColor,
          vw: innerWidth, vh: innerHeight,
        };
      });
      const alpha = m.bg.length === 4 ? m.bg[3] : 1;
      say(alpha >= 0.85 && m.bg[0] < 30 && m.bg[1] < 30 && m.bg[2] < 30, tag + ' P1: the backdrop is at least 85% black', JSON.stringify(m.bg));
      say(m.back.l === 0 && m.back.t === 0 && Math.round(m.back.w) === m.vw && Math.round(m.back.h) === m.vh, tag + ' P1: the backdrop covers the whole window, edge to edge', JSON.stringify(m.back));
      say(m.img.l >= 0 && m.img.t >= 0 && m.img.r <= m.vw + 0.5 && m.img.b <= m.vh + 0.5 && m.img.w > m.vw * 0.5, tag + ' P1: the picture is fitted inside the window, and large', JSON.stringify(m.img));
      say(Math.abs(m.img.w / m.img.h - m.nat[0] / m.nat[1]) < 0.02, tag + ' P1: the picture keeps its shape (never cropped or stretched)', (m.img.w / m.img.h).toFixed(3) + ' vs ' + (m.nat[0] / m.nat[1]).toFixed(3));
      say(m.x.r > m.vw - 40 && m.x.t < 40, tag + ' P1: the X is in the top-right corner', JSON.stringify(m.x));
      // #8122 (Josh 11-06: "put the download button right below it ... so it's not hidden off in the corner ... our regular
      // gold button color"): centred, right under the picture, gold.
      say(Math.abs((m.act.l + m.act.r) / 2 - m.vw / 2) < 2 && m.act.t >= m.img.b && m.act.t - m.img.b < 90 && m.act.b <= m.vh,
        tag + ' P1: the action is centred right under the picture (#8122), not in a corner', JSON.stringify({ act: m.act, imgBottom: m.img.b }));
      { const c = (m.actBg.match(/[\d.]+/g) || []).map(Number); say(c[0] > 200 && c[1] > 150 && c[1] < 200 && c[2] < 110, tag + ' P1: the action is the regular gold button (#8122)', m.actBg); }
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
      for (const [key, word] of [['Meta', 'Cmd'], ['Control', 'Ctrl']]) {
        await pg.evaluate(() => { window.__cardClicks = 0; window.__cardCancelled = null; });
        /* A real Ctrl-click on a Mac host is a right-click (no click event), so the Ctrl arm dispatches the click the
           Windows app gets: a primary-button click carrying ctrlKey. */
        if (key === 'Meta') await pg.click(card(IMG_ID), { modifiers: [key] });
        else await pg.evaluate((sel) => { const a = document.querySelector(sel); a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true })); }, card(IMG_ID));
        await pg.waitForTimeout(150);
        const mod = await pg.evaluate(() => ({ clicks: window.__cardClicks, open: !!document.getElementById('pv-preview'), cancelled: window.__cardCancelled }));
        say(mod.clicks === 1 && !mod.open && mod.cancelled === false, tag + ' P5: a ' + word + '-click lands on the card, keeps the download and opens no preview', JSON.stringify(mod));
        await pg.evaluate(() => { const b = document.getElementById('pv-preview'); if (b) b.remove(); });
      }

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
      /* #8122: whatever the file, the action sits inside the window and below it (never over a long text or a tall page). */
      const placed = (what) => pg.evaluate((what) => {
        const d = document.getElementById('pv-do').getBoundingClientRect();
        const c = document.querySelector('#pv-preview .pv-media, #pv-preview .pv-text, #pv-preview .pv-file').getBoundingClientRect();
        return { what, ok: d.top >= 0 && d.bottom <= innerHeight + 0.5 && d.left >= 0 && d.right <= innerWidth + 0.5 && d.top >= c.bottom - 1, act: [d.top, d.bottom], file: [c.top, c.bottom], vh: innerHeight };
      }, what);
      await pg.click(card(PDF_ID));
      { const r = await placed('a PDF\'s first page (a picture here)'); say(r.ok, tag + ' P1 #8122: the action is inside the window, below ' + r.what, JSON.stringify(r)); }
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
      { const r = await placed('a long text (200 lines)'); say(r.ok, tag + ' P1 #8122: the action is inside the window, below ' + r.what, JSON.stringify(r)); }
      // Selecting the text and letting go on the dark does not close it.
      const sel = await pg.evaluate(() => { const r = document.querySelector('#pv-preview pre.pv-text').getBoundingClientRect(); return { x: r.left + 20, y: r.top + 12, ex: innerWidth - 6, ey: r.top + 12 }; });
      await pg.mouse.move(sel.x, sel.y); await pg.mouse.down(); await pg.mouse.move(sel.ex, sel.ey, { steps: 8 }); await pg.mouse.up();
      say(await open(), tag + ' P6: selecting a text file\'s words and letting go on the dark keeps it open');
      await pg.keyboard.press('Escape');
      await pg.click(card(TALL_ID));
      await pg.waitForFunction(() => { const i = document.querySelector('#pv-preview img.pv-media'); return i && i.complete && i.naturalWidth > 0; });
      await pg.waitForTimeout(400);   // the zoom-in (350 ms), as P1 waits for it
      { const r = await placed('an 800 x 3000 picture (fitted to the window\'s height)'); say(r.ok && r.file[0] >= 0, tag + ' P1 #8122: the action is inside the window, below ' + r.what, JSON.stringify(r)); }
      await pg.keyboard.press('Escape');
      await pg.click(card(DOC_ID));
      const doc = await pg.evaluate(() => ({ name: (document.querySelector('#pv-preview .pv-file b') || {}).textContent, meta: (document.querySelector('#pv-preview .pv-file span') || {}).textContent }));
      say(doc.name === 'deck.pptx' && /PowerPoint/.test(doc.meta || '') && /2\.0 MB/.test(doc.meta || ''), tag + ' P6: any other file shows its name and size', JSON.stringify(doc));
      { const r = await placed('a file card'); say(r.ok && r.act[0] - r.file[1] < 60, tag + ' P1 #8122: the action is right under ' + r.what + ', inside the window', JSON.stringify(r)); }
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
    // kosmos#8120: a browser (no kosmosDownload handler) shows its own downloads: no key, and the button does not wait.
    await pg.evaluate(() => { const a = document.getElementById('pv-do'); a.addEventListener('click', (e) => e.preventDefault()); a.click(); });
    const plain = await pg.evaluate(() => { const a = document.getElementById('pv-do'); return { href: a.getAttribute('href'), busy: a.classList.contains('dl-busy') }; });
    say(plain.href === '/api/attachment/' + IMG_ID && !plain.busy, engine + ' P8120: in a browser the click is as before (no key, no waiting)', JSON.stringify(plain));
    await ctx.close();
  } finally {
    await browser.close();
  }
}

/* kosmos#8120: in the Mac app (its kosmosDownload handler, stood in for here), a Download says when the file saved, and
   only then; a second click saves no second copy; each answer reaches only the click that asked (the key on its address).
   The app's events are dispatched by hand, the way the app sends them. */
async function runApp(engine, say) {
  const browser = await pw[engine].launch({ headless: process.env.HEADED === '0' });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => { window.__posted = []; window.webkit = { messageHandlers: { kosmosDownload: { postMessage: (m) => window.__posted.push(m) } } }; });
    const pg = await ctx.newPage();
    const asked = [];   // every download address the page asked for, with its query (a download skips the route: its own event)
    const note = (u) => { const a = u.pathname + u.search; if (!asked.includes(a)) asked.push(a); };   // each address once, however the engine reports it
    pg.on('download', (d) => { note(new URL(d.url())); d.cancel().catch(() => {}); });
    const errors = [];
    pg.on('pageerror', (e) => errors.push(String(e && e.message)));
    await pg.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === '/') return route.fulfill({ status: 200, contentType: 'text/html', body: HTML });
      if (/\/preview$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
      if (/\/files\/download$/.test(u.pathname) && u.searchParams.get('check')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });   // the ?check=1 look
      // WebKit routes a download's request here (Chromium reports it as a download instead): noted, and answered as nothing.
      if (/^\/api\/attachment\/[0-9a-f]{24}$/.test(u.pathname) || /\/files\/download$/.test(u.pathname)) { note(u); return route.fulfill({ status: 204, body: '' }); }
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });
    await pg.goto('http://kosmos-remote.test/', { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof pjAttachmentCard === 'function' && typeof pvOpen === 'function' && typeof dlWatch === 'function');
    const tell = (detail) => pg.evaluate((d) => window.dispatchEvent(new CustomEvent('kosmos-download', { detail: d })), detail);
    const state = () => pg.evaluate(() => { const d = document.getElementById('pv-do'), m = document.getElementById('pv-msg'), q = document.querySelector('.pv-quiet');
      return { text: d && d.textContent, aria: d && d.getAttribute('aria-label'), busy: !!(d && d.classList.contains('dl-busy')), href: d && d.getAttribute('href'), msg: m && m.textContent, show: q ? q.textContent : null }; });
    const keyOf = (a) => (a.match(/[?&]kdl=([A-Za-z0-9]+)/) || [])[1] || null;
    /* Playwright's WebKit performs no download for a script's link click (measured 11-06: no request, no download event);
       the app's WKWebView does (its download selftest clicks keyed links and is answered). So on WebKit the keys are read
       from the page's own waiting list, and the rows that need the request itself run only where it can be seen. */
    const netSeen = engine !== 'webkit';
    const waitingKeys = () => pg.evaluate(() => [...DL_WAIT.keys()]);
    if (!netSeen) console.log('INFO  ' + engine + ' P8120: the address rows (its key, one request per file) are judged on Chromium; WebKit here downloads nothing for a script click');
    const open = async () => {
      await pg.evaluate((IMG_ID) => {
        pvClose();
        document.querySelectorAll('[data-pv-test]').forEach((n) => n.remove());
        const strip = document.createElement('div');
        strip.setAttribute('data-pv-test', '');
        strip.style.cssText = 'position:fixed;left:8px;top:8px;width:300px;z-index:55;background:#fff;';
        strip.innerHTML = pjAttachmentCard({ name: 'Budget 2026.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 68000, kind: 'file', url: '/api/attachment/' + IMG_ID });
        document.body.appendChild(strip);
      }, IMG_ID);
      await pg.click('[data-pv-test] a.att');
      await pg.waitForSelector('#pv-preview #pv-do');
    };
    const T = engine + ' P8120';
    // 1. The viewer's link: the click carries its key, a second click saves nothing, another click's answer is not
    // this one's, and only `saved` says saved.
    await open();
    await pg.click('#pv-do'); await pg.waitForTimeout(150);
    const k1 = netSeen ? keyOf(asked[asked.length - 1] || '') : (await waitingKeys())[0];
    const first = await state();
    await pg.click('#pv-do', { force: true }); await pg.waitForTimeout(150);
    say(!!k1 && (!netSeen || asked.length === 1) && first.busy, T + ': a Download click carries its own key, and turns the button off', JSON.stringify({ asked, first }));
    say(netSeen ? asked.length === 1 : (await waitingKeys()).length === 1, T + ': a second click while it saves asks for no second copy', JSON.stringify(netSeen ? asked : await waitingKeys()));
    await tell({ state: 'saved', key: 'someoneelse', id: 1, name: 'Files.zip' });
    const other = await state();
    say(other.busy && !/Saved/.test(other.text) && !/Files\.zip/.test(other.msg), T + ': another download\'s answer (a folder zip) does not reach this click', JSON.stringify(other));
    await pg.waitForTimeout(400);
    const slow = await state();
    say(/Saving/.test(slow.text), T + ': a save that takes a moment says Saving, with the Sweep dots', JSON.stringify(slow));
    say(slow.aria === 'Saving Budget 2026.xlsx', T + ': and a screen reader hears Saving and the file\'s name', JSON.stringify(slow.aria));
    await tell({ state: 'saving', key: k1, id: 7, name: 'Budget 2026.xlsx' });
    say((await state()).busy && !/Saved/.test((await state()).text), T + ': saving is not saved', '');
    await tell({ state: 'saved', key: k1, id: 7, name: 'Budget 2026.xlsx' });
    const saved = await state();
    say(/Saved to Downloads/.test(saved.text) && /Budget 2026\.xlsx is in your Downloads folder/.test(saved.msg) && saved.show === 'Open in Finder', T + ': only the app\'s saved says Saved to Downloads, with the name and Open in Finder', JSON.stringify(saved));
    // A click while it says Saved saves nothing (it is the click Josh made three times), and the button comes back as
    // Download, never stuck on Saved (review round 2).
    const busyKeys = () => pg.evaluate(() => [...DL_BUSY.values()].map((w) => w.key));
    const before = asked.length, waitBefore = (await waitingKeys()).length, busyBefore = JSON.stringify(await busyKeys());
    await pg.click('#pv-do', { force: true }); await pg.waitForTimeout(200);
    const again = await state();
    // The busy watch is the same one (no new click started) on every engine; on Chromium also no new request.
    say((netSeen ? asked.length === before : true) && (await waitingKeys()).length === waitBefore && JSON.stringify(await busyKeys()) === busyBefore && busyBefore !== '[]' && /Saved to Downloads/.test(again.text),
      T + ': a click while it says Saved saves nothing, and it still says Saved', JSON.stringify({ asked: asked.length - before, again }));
    // The keyboard reaches it: Tab from the action goes to Open in Finder (the viewer keeps focus inside itself).
    await pg.focus('#pv-do'); await pg.keyboard.press('Tab');
    const tabbed = await pg.evaluate(() => document.activeElement && document.activeElement.classList.contains('pv-quiet'));
    say(tabbed, T + ': Tab from the action reaches Open in Finder', String(tabbed));
    await pg.click('.pv-quiet');
    const posted = await pg.evaluate(() => window.__posted);
    say(JSON.stringify(posted) === JSON.stringify([{ reveal: 7 }]) && !!(await pg.$('#pv-preview')), T + ': Open in Finder asks the app for that download (by id, never a path), and the viewer stays open', JSON.stringify(posted));
    // The app could not find it (moved away): said in the line, only for this button's save, never for another id.
    await tell({ state: 'revealfailed', id: 99 });
    const other99 = await state();
    await tell({ state: 'revealfailed', id: 7 });
    const gone = await state();
    say(!/could not find/.test(other99.msg || '') && gone.msg === 'Kosmos could not find that file in your Downloads folder.', T + ': Open in Finder on a file that is gone says so, for its own save only', JSON.stringify({ other99, gone }));
    // Opened again while it still says Saved: it says Saved, not Saving.
    await open();
    const reSaved = await state();
    say(/Saved to Downloads/.test(reSaved.text) && reSaved.show === 'Open in Finder' && /Budget 2026\.xlsx is in your Downloads folder/.test(reSaved.msg || ''), T + ': opened again after it saved, it says Saved (not Saving), in its button and its line', JSON.stringify(reSaved));
    await pg.waitForTimeout(6300);
    const back = await state();
    say(back.text === 'Download' && !back.busy && !back.aria, T + ': six seconds on, the button is Download again (not stuck on Saved), its name its own', JSON.stringify(back));
    // 1b. The viewer opened again while the same file saves: it shows Saving, and the answer lands on it.
    await open();
    await pg.click('#pv-do'); await pg.waitForTimeout(100);
    const k3 = netSeen ? keyOf(asked[asked.length - 1] || '') : (await waitingKeys())[0];
    await open();
    const reopened = await state();
    say(reopened.busy && /Saving/.test(reopened.text) && /^Saving Budget 2026\.xlsx/.test(reopened.msg || ''), T + ': opened again mid-save, the button and the line say Saving', JSON.stringify(reopened));
    await tell({ state: 'saved', key: k3, id: 8, name: 'Budget 2026.xlsx' });
    const reAns = await state();
    say(/Saved to Downloads/.test(reAns.text) && /Budget 2026\.xlsx is in your Downloads folder/.test(reAns.msg || ''), T + ': and the save\'s answer lands on the reopened viewer, its button and its line', JSON.stringify(reAns));
    await pg.waitForTimeout(6300);
    // 2. A failure: the button comes straight back, and nothing says saved.
    await open();
    await pg.click('#pv-do'); await pg.waitForTimeout(100);
    const k2 = netSeen ? keyOf(asked[asked.length - 1] || '') : (await waitingKeys()).find((k) => k !== k1);
    await tell({ state: 'asking', key: k2 });
    await tell({ state: 'failed', key: k2 });
    const failed = await state();
    say(!!k2 && k2 !== k1 && !failed.busy && failed.text === 'Download' && !/Downloads folder/.test(failed.msg), T + ': a failed save puts the button straight back, and says no saved', JSON.stringify(failed));
    // 2b. Round 4: while the app asks Allow the button waits without saying Saving; with no word at all it comes back;
    // a save that never answers ends with an honest line; Open in Finder on a file that is gone says so.
    await pg.evaluate(() => { window.__dlLostMs = 700; });   // the ceiling stays long until its own arm below
    await open();
    await pg.click('#pv-do'); await pg.waitForTimeout(80);
    const ka2 = netSeen ? keyOf(asked[asked.length - 1] || '') : (await waitingKeys())[0];
    await tell({ state: 'asking', key: ka2 });
    await pg.waitForTimeout(600);
    const asking = await state();
    say(asking.busy && !/Saving/.test(asking.text) && !/Saving/.test(asking.msg || '') && /^Waiting for your answer/.test(asking.aria || ''), T + ': while the app asks Allow, it waits without saying Saving (and is named so)', JSON.stringify(asking));
    await pg.waitForTimeout(400);
    say((await state()).busy, T + ': and no timer gives the button back while it asks', JSON.stringify(await state()));
    await tell({ state: 'failed', key: ka2 });
    await open();
    await pg.click('#pv-do'); await pg.waitForTimeout(900);
    const lost = await state();
    say(!lost.busy && lost.text === 'Download', T + ': no word from the app at all: the button comes back', JSON.stringify(lost));
    await pg.evaluate(() => { window.__dlCeilingMs = 900; });
    await pg.click('#pv-do'); await pg.waitForTimeout(80);
    const kc = netSeen ? keyOf(asked[asked.length - 1] || '') : (await waitingKeys())[0];
    await tell({ state: 'saving', key: kc, id: 11, name: 'Budget 2026.xlsx' });
    await pg.waitForTimeout(1100);
    const ceiling = await state();
    say(!ceiling.busy && /lost track of Budget 2026\.xlsx\. Look in your Downloads folder/.test(ceiling.msg || ''), T + ': a save whose answer never comes ends with an honest line, not a claim', JSON.stringify(ceiling));
    // Asked, then silence (the window gone): the honest line too, never a spinner for ever.
    await open();
    await pg.click('#pv-do'); await pg.waitForTimeout(80);
    const kq = netSeen ? keyOf(asked[asked.length - 1] || '') : (await waitingKeys())[0];
    await tell({ state: 'asking', key: kq });
    await pg.waitForTimeout(1100);
    const silent = await state();
    say(!silent.busy && /lost track of/.test(silent.msg || ''), T + ': asked, then no answer at all, it ends with the honest line', JSON.stringify(silent));
    await pg.evaluate(() => { delete window.__dlLostMs; delete window.__dlCeilingMs; });
    // 2c. Two rows clicked in one Files list (no buttons, one line): the first one's saved still shows (round 6).
    const rowsLine = await pg.evaluate(() => { pvClose(); const m = document.createElement('p'); m.id = '__rl'; document.body.appendChild(m); const say = kplusSayer(m);
      kplusDownload('agent', 'ana', 'r1.txt', say); kplusDownload('agent', 'ana', 'r2.txt', say);
      return [...DL_WAIT.values()].filter((w) => /r[12]\.txt/.test(w.name)).map((w) => [w.name, w.key]); });
    const kr1 = (rowsLine.find(([n]) => n === 'r1.txt') || [])[1];
    await tell({ state: 'saved', key: kr1, id: 21, name: 'r1.txt' });
    const rl = await pg.evaluate(() => document.getElementById('__rl').textContent);
    say(rl === 'r1.txt is in your Downloads folder.', T + ': two rows clicked in one list, the first one\'s saved still shows in the line', JSON.stringify(rl));
    await tell({ state: 'failed', key: (rowsLine.find(([n]) => n === 'r2.txt') || [])[1] });   // r2 ends, so it is not in the next arm
    // 2d. Round 7: a Files-list icon clicked, then the viewer opened for that file (it takes the save over): when it
    // saves, the list's line keeps no Saving and its icon shows the tick; and a saved line never replaces an error.
    const lv = await pg.evaluate(() => {
      pvClose();
      const b = document.createElement('button'); b.id = '__lb'; b.className = 'pj-doc-dl'; b.textContent = 'D'; document.body.appendChild(b);
      const m = document.createElement('p'); m.id = '__lm'; document.body.appendChild(m);
      kplusDownload('agent', 'ana', 'pic.png', kplusSayer(m), undefined, b);
      return [...DL_WAIT.values()].find((w) => w.name === 'pic.png').key;
    });
    await pg.waitForTimeout(500);   // the list line says Saving pic.png...
    const listSaving = await pg.evaluate(() => document.getElementById('__lm').textContent);
    await pg.evaluate(() => {   // the viewer opens for that same file and adopts the save
      PV_ATTS.set('lv', { id: 'lv', name: 'pic.png', kind: 'file', meta: '', url: '/x', dlFile: 'agent\nana\npic.png', download: (btn) => kplusDownload('agent', 'ana', 'pic.png', kplusSayer(document.getElementById('pv-msg')), undefined, btn) });
      window.kplusRemote = () => true; pvOpen('lv');
    });
    await tell({ state: 'saving', key: lv, id: 31, name: 'pic.png' });
    await tell({ state: 'saved', key: lv, id: 31, name: 'pic.png' });
    const lvOut = await pg.evaluate(() => ({ line: document.getElementById('__lm').textContent, icon: document.getElementById('__lb').className, viewer: (document.getElementById('pv-msg') || {}).textContent }));
    say(/Saving pic\.png/.test(listSaving) && !/Saving/.test(lvOut.line) && /dl-saved/.test(lvOut.icon) && /pic\.png is in your Downloads folder/.test(lvOut.viewer || ''),
      T + ': a list click the viewer took over leaves no Saving in the list, and its icon and the viewer say saved', JSON.stringify({ listSaving, lvOut }));
    const err = await pg.evaluate(() => {
      pvClose();
      const m = document.createElement('p'); m.id = '__em'; document.body.appendChild(m); const say = kplusSayer(m);
      kplusDownload('agent', 'ana', 'e1.txt', say);
      m.textContent = 'That folder is too big to download.';   // another writer (a folder refused) says something in the same line
      return [...DL_WAIT.values()].find((w) => w.name === 'e1.txt').key;
    });
    await tell({ state: 'saved', key: err, id: 32, name: 'e1.txt' });
    const errLine = await pg.evaluate(() => document.getElementById('__em').textContent);
    say(errLine === 'That folder is too big to download.', T + ': a saved line never replaces someone else\'s error in the line', JSON.stringify(errLine));
    await pg.waitForTimeout(3300);   // the list icon's restore
    // 3. Two files from a Files list, answered out of order, one failing: each answer reaches its own click.
    const two = await pg.evaluate(() => {
      pvClose();
      const mk = (id) => { const b = document.createElement('button'); b.id = id; b.textContent = 'D'; b.className = 'pj-doc-dl'; document.body.appendChild(b); const m = document.createElement('p'); m.id = id + '-m'; document.body.appendChild(m); return [b, kplusSayer(m)]; };
      const [ba, sa] = mk('__fa'), [bb, sb] = mk('__fb');
      kplusDownload('agent', 'ana', 'one.txt', sa, undefined, ba);
      kplusDownload('agent', 'ana', 'two.txt', sb, undefined, bb);
      kplusDownload('agent', 'ana', 'one.txt', sa, undefined, ba);   // the same file again, while it saves
      return true;
    });
    await pg.waitForTimeout(200);
    const files = asked.filter((a) => /files\/download\?name=(one|two)\.txt/.test(a));
    const byFile = await pg.evaluate(() => [...DL_WAIT.values()].map((w) => [w.name, w.key]));
    const kOf = (n) => netSeen ? keyOf(files.find((a) => new RegExp('name=' + n.replace('.', '\\.')).test(a)) || '') : ((byFile.find(([x]) => x === n) || [])[1] || null);
    const ka = kOf('one.txt'), kb = kOf('two.txt');
    say(two && (netSeen ? files.length === 2 : byFile.length === 2) && ka && kb && ka !== kb, T + ': two files, two keys, and the same file twice asks once', JSON.stringify(netSeen ? files : byFile));
    await tell({ state: 'saving', key: kb, id: 9, name: 'two.txt' });
    await tell({ state: 'saved', key: kb, id: 9, name: 'two.txt' });
    await tell({ state: 'failed', key: ka });
    const fl = await pg.evaluate(() => ({ a: document.getElementById('__fa').className, am: document.getElementById('__fa-m').textContent, b: document.getElementById('__fb').className, bm: document.getElementById('__fb-m').textContent }));
    say(/dl-saved/.test(fl.b) && /two\.txt is in your Downloads folder/.test(fl.bm) && !/dl-busy|dl-saved/.test(fl.a) && fl.am === '',
      T + ': answered out of order, the saved file says saved, and the failed one says nothing (its Already saving cleared)', JSON.stringify(fl));
    say(errors.length === 0, T + ': no page errors', errors.slice(0, 3).join(' | '));
    await ctx.close();
  } finally {
    await browser.close();
  }
}

/* #8122: a spreadsheet opens as a read-only grid (Ice Cream Kitty's route, stood in for here): sheets as tabs, a cell's
   words as text never markup, the gold button under it; a file the board cannot draw shows its card and the board's
   sentence, the button still under it. */
async function runSheet(engine, say) {
  const browser = await pw[engine].launch({ headless: process.env.HEADED === '0' });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pg = await ctx.newPage();
    const errors = []; pg.on('pageerror', (e) => errors.push(String(e && e.message)));
    const BIG = 'e7'.repeat(12), OK = 'e8'.repeat(12);
    const WIDE = 'eb'.repeat(12), NOVAL = 'ec'.repeat(12), EMPTY = 'ed'.repeat(12), MORE = 'ee'.repeat(12), SLOW = 'ef'.repeat(12);
    const ans = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(Object.assign({ ok: true, sheets: [], moreSheets: 0, noValues: false, someNoValues: false, empty: false }, o)) });
    const routes = async (route) => {
      // #6022: one answer waits 700 ms, so the page can be gone by the time any answer is sent; a late one is dropped.
      try {
        const u = new URL(route.request().url());
        if (u.pathname === '/api/attachment/' + NOVAL + '/sheet') return await route.fulfill(ans({ noValues: true }));
        if (u.pathname === '/api/attachment/' + EMPTY + '/sheet') return await route.fulfill(ans({ empty: true }));
        if (u.pathname === '/api/attachment/' + 'f1'.repeat(12) + '/sheet') return await route.fulfill(ans({}));   // no sheets, no flags (review 4)
        if (u.pathname === '/api/attachment/' + MORE + '/sheet') return await route.fulfill(ans({ sheets: [{ name: 'A', rows: [['1']], cut: false }], moreSheets: 3 }));
        if (u.pathname === '/api/attachment/' + SLOW + '/sheet') { await new Promise((r) => setTimeout(r, 700)); return await route.fulfill(ans({ sheets: [{ name: 'Late', rows: [['late']], cut: false }] })); }
        if (u.pathname === '/api/attachment/' + WIDE + '/sheet') {
          const rows = Array.from({ length: 200 }, (_, r) => Array.from({ length: 50 }, (_, c) => (r === 0 ? 'Head ' + c : String(r * 50 + c))));
          return await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, sheets: [{ name: 'Big', rows, cut: true }, { name: 'Other', rows: [['x']], cut: false }], moreSheets: 0, noValues: false, someNoValues: false, empty: false }) });
        }
        if (u.pathname === '/') return await route.fulfill({ status: 200, contentType: 'text/html', body: HTML });
        if (u.pathname === '/api/attachment/' + OK + '/sheet') return await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true,
          sheets: [{ name: 'Budget', rows: [['Item', 'Cost'], ['<img src=x onerror="window.__ran=1">', '12.5'], ['A very long note that runs on and on past any sensible column width, '.repeat(4), '3']], cut: true }, { name: 'Notes', rows: [['done']], cut: false, firstRow: 301 }, { name: 'Chart', rows: [], cut: false, notGrid: true }],
          moreSheets: 0, noValues: false, someNoValues: true, empty: false }) });
        if (u.pathname === '/api/attachment/' + BIG + '/sheet') return await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, because: 'This spreadsheet is too large to preview.', tooLarge: true }) });
        return await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      } catch (e) { /* the page closed at teardown */ }
    };
    await pg.route('**/*', routes);
    await pg.goto('http://kosmos-remote.test/', { waitUntil: 'load' });
    await pg.waitForFunction(() => typeof pjAttachmentCard === 'function' && typeof pvSheetInto === 'function');
    /* kosmos#8188: every path of the sheet view says a cut. Rendered straight through the shipped pvSheetInto into a
       detached stage, each case beside its uncut control. */
    {
      const notesFor = (sheet) => pg.evaluate((sh) => { const st = document.createElement('div'); pvSheetInto(st, { sheets: [sh] }); return [...st.querySelectorAll('.pv-note')].map((x) => x.textContent); }, sheet);
      const big = Array.from({ length: 200 }, (_, r) => [String(r)]);
      const c = {
        notGridCut: await notesFor({ name: 'A', rows: [], cut: true, notGrid: true }),
        notGrid: await notesFor({ name: 'A', rows: [], cut: false, notGrid: true }),
        emptyCut: await notesFor({ name: 'A', rows: [], cut: true }),
        empty: await notesFor({ name: 'A', rows: [], cut: false }),
        smallCut: await notesFor({ name: 'A', rows: [['1', '2']], cut: true }),
        bigCut: await notesFor({ name: 'A', rows: big, cut: true }),
        whole: await notesFor({ name: 'A', rows: [['1', '2']], cut: false }),
      };
      const has = (a, re) => a.some((t) => re.test(t));
      say(has(c.notGridCut, /Part of this file could not be read, so this sheet is not shown here/) && !has(c.notGridCut, /not a table of values/), engine + ' sheet #8188: a cut sheet that is not a grid says part of the file could not be read', JSON.stringify(c.notGridCut));
      say(has(c.notGrid, /not a table of values/) && !has(c.notGrid, /could not be read/), engine + ' sheet #8188 control: an uncut sheet that is not a grid still says so', JSON.stringify(c.notGrid));
      say(has(c.emptyCut, /could not be read, so nothing of this sheet is shown/) && !has(c.emptyCut, /This sheet is empty/), engine + ' sheet #8188: a cut sheet with no rows never says it is empty', JSON.stringify(c.emptyCut));
      say(has(c.empty, /This sheet is empty/), engine + ' sheet #8188 control: an uncut sheet with no rows says it is empty', JSON.stringify(c.empty));
      say(has(c.smallCut, /Not all of this sheet could be read here/) && !has(c.smallCut, /200 rows and 50 columns/), engine + ' sheet #8188: a small cut sheet does not claim the 200 x 50 limit', JSON.stringify(c.smallCut));
      say(has(c.bigCut, /up to 200 rows and 50 columns/), engine + ' sheet #8188: a sheet cut at 200 rows keeps the limit sentence', JSON.stringify(c.bigCut));
      say(c.whole.length === 0, engine + ' sheet #8188 control: a whole sheet says nothing', JSON.stringify(c.whole));
    }
    const open = async (id, name, extra) => {
      await pg.evaluate(([id, name, extra]) => {
        pvClose(); document.querySelectorAll('[data-pv-test]').forEach((n) => n.remove());
        const strip = document.createElement('div'); strip.setAttribute('data-pv-test', ''); strip.style.cssText = 'position:fixed;left:8px;top:8px;width:300px;z-index:55;background:#fff;';
        strip.innerHTML = pjAttachmentCard(Object.assign({ name, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 68000, kind: 'file', url: '/api/attachment/' + id }, extra || {}));
        document.body.appendChild(strip);
      }, [id, name, extra || null]);
      await pg.click('[data-pv-test] a.att');
      await pg.waitForSelector('#pv-preview #pv-do');
      await pg.waitForFunction(() => !/Opening the spreadsheet/.test(document.getElementById('pv-stage').textContent));
    };
    const T = engine + ' P8122';
    await open(OK, 'Budget 2026.xlsx');
    const g = await pg.evaluate(() => ({
      tabs: [...document.querySelectorAll('#pv-preview .pv-tab')].map((t) => t.textContent + (t.getAttribute('aria-selected') === 'true' ? '*' : '')),
      cells: [...document.querySelectorAll('#pv-preview .pv-grid tbody td')].map((c) => c.textContent),
      imgs: document.querySelectorAll('#pv-preview .pv-grid img').length, ran: !!window.__ran,
      notes: [...document.querySelectorAll('#pv-preview .pv-note')].map((n) => n.textContent),
      name: document.getElementById('pv-name').textContent,
      below: (() => { const w = document.querySelector('.pv-grid-wrap').getBoundingClientRect(), d = document.getElementById('pv-do').getBoundingClientRect(); return d.top >= w.bottom - 1 && d.bottom <= innerHeight; })(),
    }));
    say(JSON.stringify(g.tabs) === '["Budget*","Notes","Chart"]' && g.cells[0] === 'Item' && g.cells[3] === '12.5', T + ': a spreadsheet opens as a grid, its sheets as tabs', JSON.stringify(g));
    const nums = await pg.evaluate(() => [...document.querySelectorAll('#pv-preview .pv-grid tbody td')].map((c) => c.className === 'num'));
    say(nums[1] === false && nums[3] === true, T + ': a number sits right and a word does not (12.5, Cost)', JSON.stringify(nums));
    say(g.cells[2] === '<img src=x onerror="window.__ran=1">' && g.imgs === 0 && !g.ran, T + ': a cell\'s words are text, never markup', JSON.stringify(g.cells));
    // A narrow grid is centred over the name and the gold button, not left in the corner (the real reader's small CSV).
    const mid = await pg.evaluate(() => { const w = document.querySelector('#pv-preview .pv-grid-wrap').getBoundingClientRect(), d = document.getElementById('pv-do').getBoundingClientRect();
      return { grid: Math.round(w.left + w.width / 2), button: Math.round(d.left + d.width / 2), narrow: w.width < innerWidth / 2 }; });
    say(mid.narrow && Math.abs(mid.grid - mid.button) <= 2, T + ': a narrow grid sits centred over the gold button', JSON.stringify(mid));
    // A click on the dark beside a narrow grid closes the viewer, as any click on the dark does (review 2: the sheet's box
    // was wider than its grid and kept it open). Clicked 40 px left of the grid, level with it; reopened after.
    const beside = await pg.evaluate(() => { const w = document.querySelector('#pv-preview .pv-grid-wrap').getBoundingClientRect(); return { x: Math.round(w.left - 40), y: Math.round(w.top + w.height / 2) }; });
    await pg.mouse.click(beside.x, beside.y); await pg.waitForTimeout(400);
    say(!(await pg.$('#pv-preview')), T + ': a click on the dark beside a narrow grid closes the viewer', JSON.stringify(beside));
    await open(OK, 'Budget 2026.xlsx');
    // A long value is cut to one line with an ellipsis, the whole value on hover (review 1: max-width on a td is ignored).
    const lc = await pg.evaluate(() => { const c = [...document.querySelectorAll('#pv-preview .pv-grid .pv-cell')].find((x) => /very long note/.test(x.textContent));
      if (!c) return null; const r = c.getBoundingClientRect(), fs = parseFloat(getComputedStyle(document.documentElement).fontSize);
      return { w: r.width, max: 24 * fs, cut: c.scrollWidth > c.clientWidth + 1, oneLine: r.height < 30, title: (c.title || '').length, ell: getComputedStyle(c).textOverflow }; });
    say(!!lc && lc.w <= lc.max + 0.5 && lc.cut && lc.oneLine && lc.title > 200 && lc.ell === 'ellipsis', T + ': a long cell is cut to one line at 24rem with an ellipsis, the whole value on hover', JSON.stringify(lc));
    // kosmos#8188: Budget is a small sheet marked cut, so it gets the words true for any cut, not the 200 x 50 sentence.
    say(g.notes.some((n) => /Not all of this sheet could be read here/.test(n)) && !g.notes.some((n) => /goes on past what is shown/.test(n)) && g.notes.some((n) => /no saved value/.test(n)) && g.below && g.name === 'Budget 2026.xlsx', T + ': it says when it is cut short or values are missing; the name and the gold button are under it', JSON.stringify(g));
    // The keyboard reaches the sheets: Tab from the X goes to the selected tab, then the grid (review 1).
    await pg.focus('#pv-x'); await pg.keyboard.press('Tab');
    const t1 = await pg.evaluate(() => document.activeElement.className + ':' + document.activeElement.textContent.slice(0, 12));
    await pg.keyboard.press('Tab');
    const t2 = await pg.evaluate(() => document.activeElement.className);
    say(/pv-tab:Budget/.test(t1) && /pv-grid-wrap/.test(t2), T + ': Tab reaches the selected sheet tab, then the grid', JSON.stringify({ t1, t2 }));
    await pg.focus('#pv-preview .pv-tab'); await pg.keyboard.press('ArrowRight');
    const k = await pg.evaluate(() => ({ sel: [...document.querySelectorAll('#pv-preview .pv-tab')].map((t) => t.getAttribute('aria-selected')), cell: (document.querySelector('#pv-preview .pv-grid tbody td') || {}).textContent, row: (document.querySelector('#pv-preview .pv-grid tbody th') || {}).textContent, focus: document.activeElement.textContent }));
    say(k.sel.join() === 'false,true,false' && k.cell === 'done' && k.focus === 'Notes' && k.row === '301', T + ': the arrow keys move between sheets; a sheet starting at row 301 numbers its rows from 301', JSON.stringify(k));
    // A mouse click on a tab (and on a cell) keeps the viewer open (review 1); a chart sheet's note is readable, outside
    // the white panel.
    await pg.click('#pv-preview .pv-tab:nth-child(3)'); await pg.waitForTimeout(150);
    const ch = await pg.evaluate(() => { const n = [...document.querySelectorAll('#pv-preview .pv-note')].find((x) => /not a table/.test(x.textContent));
      return { open: !!document.getElementById('pv-preview'), note: n ? n.textContent : null, inPanel: !!(n && n.closest('.pv-grid-wrap')), colour: n ? getComputedStyle(n).color : null }; });
    say(ch.open && ch.note && !ch.inPanel && /255, 255, 255/.test(ch.colour), T + ': clicking a tab keeps the viewer open, and a chart sheet says so in readable words', JSON.stringify(ch));
    // The 4 px gap between two tabs is part of the tab row: a near-miss there keeps the viewer (review 6).
    const gap = await pg.evaluate(() => { const [a, b] = [...document.querySelectorAll('#pv-preview .pv-tab')].map((t) => t.getBoundingClientRect()); return { x: Math.round((a.right + b.left) / 2), y: Math.round(a.top + a.height / 2), w: b.left - a.right }; });
    await pg.mouse.click(gap.x, gap.y); await pg.waitForTimeout(150);
    say(gap.w > 0 && !!(await pg.$('#pv-preview')), T + ': a click in the gap between two sheet tabs keeps the viewer open', JSON.stringify(gap));
    await pg.click('#pv-preview .pv-tab:nth-child(1)'); await pg.click('#pv-preview .pv-grid td'); await pg.waitForTimeout(100);
    say(!!(await pg.$('#pv-preview')), T + ': clicking a cell keeps the viewer open', '');
    await open(BIG, 'Huge.xlsx');
    const big = await pg.evaluate(() => ({ card: !!document.querySelector('#pv-preview .pv-file'), notes: [...document.querySelectorAll('#pv-preview .pv-note')].map((n) => n.textContent), btn: !!document.getElementById('pv-do') }));
    say(big.card && big.notes.includes('This spreadsheet is too large to preview.') && big.btn, T + ': one too large to draw shows its card and the board\'s sentence, the button still there', JSON.stringify(big));
    // A 404 ({ error }, a file gone, or a board without the route) shows the card, never an empty white box (review 1).
    await open('e9'.repeat(12), 'Gone.xlsx');
    const gone = await pg.evaluate(() => ({ card: !!document.querySelector('#pv-preview .pv-file'), grid: !!document.querySelector('#pv-preview .pv-grid-wrap') }));
    say(gone.card && !gone.grid, T + ': a 404 shows the file card, not an empty grid', JSON.stringify(gone));
    // The other answers the board gives (review 1): formulas with no saved values, an empty workbook, sheets past the
    // ones shown. Each says so in words, under no empty white box.
    const words = async () => pg.evaluate(() => ({ notes: [...document.querySelectorAll('#pv-preview .pv-note')].map((n) => n.textContent), grid: !!document.querySelector('#pv-preview .pv-grid'), card: !!document.querySelector('#pv-preview .pv-file') }));
    await open(NOVAL, 'Formulas.xlsx'); const nv = await words();
    say(nv.notes.some((n) => /no saved values/.test(n)) && !nv.grid && !nv.card, T + ': a workbook of formulas with no saved values says so', JSON.stringify(nv));
    await open(EMPTY, 'Blank.xlsx'); const em = await words();
    say(em.notes.includes('This spreadsheet is empty.') && !em.grid && !em.card, T + ': an empty workbook says it is empty', JSON.stringify(em));
    await open('f1'.repeat(12), 'NoSheets.xlsx'); const ns = await pg.evaluate(() => ({ notes: [...document.querySelectorAll('#pv-preview .pv-note')].map((n) => n.textContent), box: !!document.querySelector('#pv-preview .pv-grid-wrap') }));
    say(ns.notes.includes('This spreadsheet is empty.') && !ns.box, T + ': an answer with no sheets and no flags reads as empty, with no empty box to tab into', JSON.stringify(ns));
    await open(MORE, 'Many.xlsx'); const mo = await words();
    say(mo.grid && mo.notes.includes('3 more sheets are not shown.'), T + ': sheets past the ones shown are counted', JSON.stringify(mo));
    // A small grid under a wider note: a click on the dark beside the grid still closes the viewer (review 5: the sheet's box
    // is as wide as its widest note, so the box itself must not count as the file).
    const nb = await pg.evaluate(() => { const w = document.querySelector('#pv-preview .pv-grid-wrap').getBoundingClientRect(), n = [...document.querySelectorAll('#pv-preview .pv-note')].map((x) => x.getBoundingClientRect().width);
      return { x: Math.round(w.left - 40), y: Math.round(w.top + w.height / 2), grid: Math.round(w.width), note: Math.round(Math.max(...n)) }; });
    await pg.mouse.click(nb.x, nb.y); await pg.waitForTimeout(400);
    say(nb.note > nb.grid + 80 && !(await pg.$('#pv-preview')), T + ': beside a small grid under a wider note, a click on the dark closes the viewer', JSON.stringify(nb));
    await open(MORE, 'Many.xlsx');
    const one = await pg.evaluate(() => { const w = document.querySelector('#pv-preview .pv-grid-wrap'); return { tabs: document.querySelectorAll('#pv-preview .pv-tab').length, role: w.getAttribute('role'), name: w.getAttribute('aria-label'), by: w.getAttribute('aria-labelledby') }; });
    say(one.tabs === 0 && one.role === 'region' && one.name === 'A' && !one.by, T + ': a one-sheet workbook has no tabs and its grid is named for its sheet', JSON.stringify(one));
    // ArrowLeft from the first sheet goes round to the last.
    await open(OK, 'Budget 2026.xlsx');
    await pg.focus('#pv-preview .pv-tab'); await pg.keyboard.press('ArrowLeft');
    const wrapL = await pg.evaluate(() => ({ sel: [...document.querySelectorAll('#pv-preview .pv-tab')].map((t) => t.getAttribute('aria-selected')).join(), focus: document.activeElement.textContent }));
    say(wrapL.sel === 'false,false,true' && wrapL.focus === 'Chart', T + ': ArrowLeft on the first sheet goes round to the last', JSON.stringify(wrapL));
    await pg.keyboard.press('Home');
    const home = await pg.evaluate(() => ({ sel: [...document.querySelectorAll('#pv-preview .pv-tab')].map((t) => t.getAttribute('aria-selected')).join(), focus: document.activeElement.textContent, controls: document.activeElement.getAttribute('aria-controls'), panel: !!document.getElementById(document.activeElement.getAttribute('aria-controls') || 'x') }));
    await pg.keyboard.press('End');
    const end = await pg.evaluate(() => document.activeElement.textContent);
    say(home.sel === 'true,false,false' && home.focus === 'Budget' && home.panel && end === 'Chart', T + ': Home and End go to the first and last sheet; a tab names the panel it controls', JSON.stringify({ home, end }));
    // Closed before the answer: nothing is drawn afterwards, and nothing reopens.
    await pg.evaluate((id) => {
      pvClose(); document.querySelectorAll('[data-pv-test]').forEach((n) => n.remove());
      const strip = document.createElement('div'); strip.setAttribute('data-pv-test', ''); strip.style.cssText = 'position:fixed;left:8px;top:8px;width:300px;z-index:55;background:#fff;';
      strip.innerHTML = pjAttachmentCard({ name: 'Late.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 68000, kind: 'file', url: '/api/attachment/' + id });
      document.body.appendChild(strip);
    }, SLOW);
    await pg.click('[data-pv-test] a.att');
    await pg.waitForSelector('#pv-preview #pv-do');
    const waiting = await pg.evaluate(() => /Opening the spreadsheet/.test(document.getElementById('pv-stage').textContent));
    // The closed stage is kept, so a late answer drawn into it (off the page) is seen (review 3: the page alone cannot see it).
    await pg.evaluate(() => { window.__lateStage = document.getElementById('pv-stage'); pvClose(); });
    await pg.waitForTimeout(1100);
    const late = await pg.evaluate(() => ({ viewer: !!document.getElementById('pv-preview'), sheet: !!document.querySelector('.pv-sheet'),
      lateCell: [...document.querySelectorAll('td')].some((c) => c.textContent === 'late'),
      stageDrawn: !!window.__lateStage.querySelector('.pv-sheet, .pv-file, .pv-grid'), stageText: window.__lateStage.textContent }));
    say(waiting && !late.viewer && !late.sheet && !late.lateCell && !late.stageDrawn && /Opening the spreadsheet/.test(late.stageText), T + ': a viewer closed before the answer draws nothing when it comes', JSON.stringify({ waiting, late }));
    // A CSV used to show as text; when its grid answer fails (here a 404) it still does, never the bare card (review 1).
    await open('ea'.repeat(12), 'list.csv', { type: 'text/csv', kind: 'text', preview: 'name,cost\nchairs,40' });
    const csv = await pg.evaluate(() => ({ text: (document.querySelector('#pv-preview .pv-text') || {}).textContent || null, card: !!document.querySelector('#pv-preview .pv-file'), grid: !!document.querySelector('#pv-preview .pv-grid-wrap') }));
    say(csv.text === 'name,cost\nchairs,40' && !csv.card && !csv.grid, T + ': a CSV whose grid fails shows its text, as before the grid', JSON.stringify(csv));
    say(errors.length === 0, T + ': no page errors', errors.slice(0, 3).join(' | '));
    await ctx.close();
    // A phone (390 x 844, a finger): a 200 x 50 sheet scrolls inside the window, the tabs are a finger's size, and the
    // gold button is under the grid and on screen (review 1).
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: engine === 'chromium' });
    const pp = await pctx.newPage(); const perr = []; pp.on('pageerror', (e) => perr.push(String(e && e.message)));
    await pp.route('**/*', routes);
    await pp.goto('http://kosmos-remote.test/', { waitUntil: 'load' });
    await pp.waitForFunction(() => typeof pjAttachmentCard === 'function' && typeof pvSheetInto === 'function');
    await pp.evaluate((id) => {
      const strip = document.createElement('div'); strip.setAttribute('data-pv-test', ''); strip.style.cssText = 'position:fixed;left:8px;top:8px;width:300px;z-index:55;background:#fff;';
      strip.innerHTML = pjAttachmentCard({ name: 'Big.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 68000, kind: 'file', url: '/api/attachment/' + id });
      document.body.appendChild(strip);
    }, WIDE);
    await pp.click('[data-pv-test] a.att');
    await pp.waitForSelector('#pv-preview .pv-grid');
    const ph = await pp.evaluate(() => {
      const w = document.querySelector('#pv-preview .pv-grid-wrap').getBoundingClientRect(), d = document.getElementById('pv-do').getBoundingClientRect();
      const tabs = [...document.querySelectorAll('#pv-preview .pv-tab')].map((t) => Math.round(t.getBoundingClientRect().height));
      const wrap = document.querySelector('#pv-preview .pv-grid-wrap');
      return { coarse: matchMedia('(pointer: coarse)').matches, tabs, inside: w.left >= 0 && w.right <= innerWidth + 0.5, scrolls: wrap.scrollWidth > wrap.clientWidth && wrap.scrollHeight > wrap.clientHeight,
        below: d.top >= w.bottom - 1 && d.bottom <= innerHeight, noSideways: document.documentElement.scrollWidth <= innerWidth + 1, rows: document.querySelectorAll('#pv-preview .pv-grid tbody tr').length };
    });
    say(ph.coarse && ph.tabs.length === 2 && ph.tabs.every((h) => h >= 44), T + ' phone: the sheet tabs are a finger\'s size (44 px or more)', JSON.stringify(ph));
    say(ph.rows === 200 && ph.inside && ph.scrolls && ph.below && ph.noSideways, T + ' phone: a 200 x 50 sheet scrolls inside the window, the gold button under it and on screen, no sideways page scroll', JSON.stringify(ph));
    say(perr.length === 0, T + ' phone: no page errors', perr.slice(0, 3).join(' | '));
    await pctx.close();
  } finally { await browser.close(); }
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
        TALL = Buffer.from(await p.evaluate(async () => {
          const c = document.createElement('canvas'); c.width = 800; c.height = 3000;
          const x = c.getContext('2d'); x.fillStyle = '#37a'; x.fillRect(0, 0, 800, 3000);
          const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
          return Array.from(new Uint8Array(await blob.arrayBuffer()));
        }));
        await b.close();
      }
      await runOn(engine, 'http://127.0.0.1:59930', say);
      await runRemote(engine, say);
      await runApp(engine, say);
      await runSheet(engine, say);
    } catch (e) {
      say(false, engine + ': ran to the end', String(e && e.message).split('\n')[0]);
    }
  }
  console.log(fails.length ? 'FAILED: ' + fails.join(', ') : 'all good');
  process.exit(fails.length ? 1 : 0);
})();
