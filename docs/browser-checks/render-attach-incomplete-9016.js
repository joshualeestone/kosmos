'use strict';
// Browser-check-functions: pjAttachmentCard, pjAttachmentCards

/**
 * kosmos#9016: a file kept though its end is missing (a zip-based office file) says so beside it: "incomplete upload, please
 * send again", in the file card's own text, in the warning ink, in light and dark. The card still downloads.
 *
 * Drives the real pjAttachmentCard builder, in Chromium and WebKit, at desktop and phone width.
 * NEGATIVE ARM: the same file without the mark says nothing.
 *
 * Run:
 *   NODE_PATH="$HOME/work/pw-runtime/node_modules" HEADED=0 node docs/browser-checks/render-attach-incomplete-9016.js
 */

const nodePath = require('node:path');

let pw;
try { pw = require('playwright'); }
catch {
  console.log('render-attach-incomplete-9016: playwright is not on NODE_PATH - SKIPPED, not passed.');
  process.exit(0);
}

const PAGE = nodePath.join(__dirname, '..', '..', 'web', 'index.html');

(async () => {
  const fail = [];
  const chk = (ok, label, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : '')); if (!ok) fail.push(label); };
  for (const engine of ['chromium', 'webkit']) {
    let browser;
    try { browser = await pw[engine].launch({ headless: process.env.HEADED === '0' }); }
    catch (err) { chk(false, '[' + engine + '] could not start a browser', err && err.message ? err.message.split('\n')[0] : String(err)); continue; }
    for (const [w, h] of [[1100, 900], [390, 844]]) for (const theme of ['light', 'dark']) {
      const tag = '[' + engine + ' ' + w + ' ' + theme + ']';
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      const errs = [];
      page.on('pageerror', (e) => { if (!/due to access control checks/.test(e.message)) errs.push(e.message); });
      await page.goto('file://' + PAGE);
      const r = await page.evaluate((t) => {
        if (typeof pjAttachmentCard !== 'function') return { error: 'pjAttachmentCard is not a function (renamed? re-anchor this check)' };
        document.documentElement.setAttribute('data-theme', t);
        const url = '/api/attachment/' + 'a'.repeat(24);
        const base = { url, name: 'book.xlsx', kind: 'other', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 65536 };
        const host = document.createElement('div');
        host.style.width = '320px';
        document.body.prepend(host);
        host.innerHTML = pjAttachmentCard({ ...base, incomplete: true }) + pjAttachmentCard(base);
        const cards = [...host.querySelectorAll('a.att')];
        if (cards.length !== 2) return { error: 'expected 2 cards, got ' + cards.length };
        const bad = cards[0].querySelector('.att-bad');
        const cs = bad ? getComputedStyle(bad) : null;
        const box = bad ? bad.getBoundingClientRect() : null;
        /* The colour behind the words, up the tree, for the contrast figure. */
        const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
        let bg = 'rgb(255,255,255)';
        for (let e = bad; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; const m = c.match(/[\d.]+/g).map(Number); if (m.length < 4 || m[3] > 0.5) { bg = c; break; } }
        const a = lum(cs.color), b = lum(bg);
        return { text: bad ? bad.textContent.trim() : '', visible: box ? box.width > 4 && box.height > 4 : false, contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          clear: cards[1].textContent.replace(/\s+/g, ' ').trim(), download: cards[0].getAttribute('download'), bg, color: cs.color };
      }, theme);
      if (r.error) { chk(false, tag + ' ' + r.error); await page.close(); continue; }
      chk(r.text === 'incomplete upload, please send again', tag + ' the card says the words', r.text);
      chk(r.visible, tag + ' they are drawn');
      chk(r.contrast >= 4.5, tag + ' they meet AA contrast', r.contrast.toFixed(2) + ' ' + r.color + ' on ' + r.bg);
      chk(r.download === 'book.xlsx', tag + ' the card still downloads');
      chk(!/incomplete/i.test(r.clear), tag + ' NEGATIVE: a whole file says nothing', r.clear);
      chk(errs.length === 0, tag + ' no page errors', errs.join(' | '));
      await page.close();
    }
    await browser.close();
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall passed');
})().catch((e) => { console.error(e); process.exit(2); });
