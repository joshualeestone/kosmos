// Browser-check-surface: msg msg-bd data-unread data-mid d-dmthread pj-room asp-th asp-m
'use strict';

/**
 * The unread edge (#3743, Josh 2026-09-25 09:15): "the stroke would be cool for an unread message and then as you
 * read it it fades away".
 *
 * An agent message the person has not read carries a thin gold edge, and it fades once the message has been on
 * screen a moment with the window in front.
 *
 * #3967 (Josh 2026-09-26) removed the first edge (an inset shadow on the bubble box) because it did not wrap the
 * bubble's tail. It is back (2026-09-27) as a 1px outline of bubble AND tail: a drop-shadow filter on the bubble,
 * with the wing carving itself by a mask so nothing else is painted for the filter to trace. The arms read the
 * drawn outline, its fade, the tail inside it (U17, by pixels, with a read bubble as the control; U17b: the wing
 * carves its own curve, so the outline follows the curve and not the wing's box; U17c: no kink where the tail meets
 * the bubble) and the strokes of bubbles at the thread's ends (U18 bottom, U18b top).
 *
 * Unread is the app's own count as the thread opens (a DM's dmUnread, a
 * project's unread) plus any agent message that lands while it is open. History never shows it.
 *
 * Harness: loaded over file:// with fetch answered here (render-agentdm-3414.js's posture), so the DM goes through
 * the real paintTalk and the room through the real pjMarkSeen and paintRoom.
 *
 *   NODE_PATH=~/work/pw-runtime/node_modules HEADED=0 node docs/browser-checks/render-unread-edge-3743.js [shots-dir]
 */
require('./lib-sandbox-home.js'); // #3675: never read the host Mac's real accounts
const fs = require('node:fs');
const path = require('node:path');
const pw = require('playwright');
/* Both engines: the tail's curve and the stroke's row are drawn differently by Chromium and WebKit (WebKit stands
   in for Safari, which Josh's Mac uses), and U17c's numbers differ between them. The runner installs what this
   list names. */
const ENGINES = ['chromium', 'webkit'];
let ENGINE = '';

const PAGE = 'file://' + path.join(path.resolve(__dirname, '..', '..'), 'web', 'index.html');
const SHOTS = process.argv[2] || null;
const fail = [];
function chk(ok, label, extra) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + '[' + ENGINE + '] ' + label + (extra ? '  ' + extra : ''));
  if (!ok) fail.push('[' + ENGINE + '] ' + label);
}

(async () => {
  for (ENGINE of ENGINES) {
  const browser = await pw[ENGINE].launch({ headless: process.env.HEADED === '0' });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript(() => {
      window.setInterval = () => 0;   // no polls: the check paints when it chooses
      const enc = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
      window.fetch = async (url) => {
        const u = String(url);
        if (u.includes('/thread')) return enc(window.__fx);
        return enc({});
      };
    });
    await page.goto(PAGE);
    await page.bringToFront();
    const t0 = Date.parse('2026-09-25T09:00:00Z');
    /* The person's own row has no `from` and carries its delivery (render-agentdm-3414.js's fixture shape). */
    const row = (i, from) => (from === 'april' ? { from, at: new Date(t0 + i * 60000).toISOString(), text: 'April line ' + i }
      : { at: new Date(t0 + i * 60000).toISOString(), text: 'My line ' + i, delivery: { state: 'placed', paneState: 'idle' } });
    const fx = { messages: [row(1, 'april'), row(2, 'you'), row(3, 'april'), row(4, 'april'), row(5, 'april')] };
    await page.evaluate((f) => {
      window.__fx = f;
      CURRENT = { sessionName: 'april', name: 'April' };
      LAST = [{ sessionName: 'april', name: 'April', state: 'idle', dmUnread: 2 }];
      document.getElementById('panel-detail').hidden = false;
      const fr = document.getElementById('firstrun'); if (fr) fr.hidden = true;
      document.querySelectorAll('body > *').forEach((el) => { el.inert = false; });
    }, fx);
    const dmState = () => page.evaluate(() => [...document.querySelectorAll('#d-dmthread .msg:not(.you)')].map((r) => ({
      text: (r.querySelector('.msg-bd p') || r.querySelector('.msg-bd')).textContent.replace(/\s+/g, ' ').trim().replace(/ \d.*$/, ''),
      unread: r.querySelector('.msg-bd').hasAttribute('data-unread'),
      edge: getComputedStyle(r.querySelector('.msg-bd')).filter,
      mask: getComputedStyle(r.querySelector('.msg-bd'), '::after').visibility })));

    // U1: opening a DM with two unread: the newest two agent messages carry the edge, the older ones do not.
    // Measured at once, before any of them could have been read.
    await page.evaluate(() => paintTalk('april', 'April'));
    const u1 = await dmState();
    const flags = u1.map((r) => r.unread);
    chk(u1.length === 4 && JSON.stringify(flags) === JSON.stringify([false, false, true, true]), 'U1 the two unread agent messages have the edge; history does not', JSON.stringify(flags));
    const GOLD = 'rgb(214, 166, 46)';
    const OUTLINE = 'drop-shadow(rgb(214, 166, 46) 1px 0px 0px) drop-shadow(rgb(214, 166, 46) -1px 0px 0px) drop-shadow(rgb(214, 166, 46) 0px 1px 0px) drop-shadow(rgb(214, 166, 46) 0px -1px 0px)';
    chk(u1[3] && u1[3].edge === OUTLINE && u1[0].edge === 'none', 'U1 an unread message carries the gold outline (four 1px drop-shadows, one per side, each direction once); a read one carries none', JSON.stringify([u1[0] && u1[0].edge, u1[3] && u1[3].edge]));
    // U1b: a jump's flash on an unread message takes the outline away at once (the flash draws its own ring), and
    // the flash keeps its own .3s fade.
    const flash = await page.evaluate(() => { const r = document.querySelectorAll('#d-dmthread .msg:not(.you)')[3]; r.classList.add('msg-flash');
      const cs = getComputedStyle(r.querySelector('.msg-bd')); const out = { filter: cs.filter, prop: cs.transitionProperty, dur: cs.transitionDuration };
      r.classList.remove('msg-flash'); return out; });
    chk(flash.filter === 'none' && flash.prop === 'outline-color' && flash.dur === '0.3s', 'U1b a flash on an unread message removes the outline at once and keeps its own .3s fade', JSON.stringify(flash));
    chk(u1[3] && u1[3].mask === 'hidden' && u1[0].mask === 'visible', 'U1 while unread the tail\'s ground mask is hidden (the wing carves itself), so the outline traces no block; a read bubble keeps it', JSON.stringify([u1[0] && u1[0].mask, u1[3] && u1[3].mask]));

    // U17: the tail is INSIDE the outline (the #3967 defect). Gold pixels in the wing's strip just outside the bubble's
    // tail-side edge: on the unread bubble there are some; on a read bubble (CONTROL, same strip, same shape) none.
    const goldIn = async (clip) => {
      const b64 = (await page.screenshot({ clip })).toString('base64');
      return page.evaluate(async (src) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + src; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i] - d[i + 2] > 60 && d[i + 1] < 200) n += 1;
        return n;
      }, b64);
    };
    const bds = await page.$$('#d-dmthread .msg:not(.you) .msg-bd');
    const wing = async (h) => { const bb = await h.boundingBox(); return goldIn({ x: bb.x - 9, y: bb.y + bb.height - 18, width: 8, height: 18 }); };
    const wingUnread = await wing(bds[3]), wingRead = await wing(bds[0]);
    chk(wingUnread >= 6 && wingRead === 0, 'U17 the outline goes round the tail: gold on the unread bubble\'s wing, none on a read one', JSON.stringify({ wingUnread, wingRead }));
    // U17b: the wing carves ITS OWN curve (the mask), so the outline follows the curve. Without the mask the whole wing
    // box would be outlined; its top-left corner, well outside the crescent, is where that shows.
    const wingBox = async (h) => { const bb = await h.boundingBox(); return goldIn({ x: bb.x - 9, y: bb.y + bb.height - 21, width: 4, height: 4 }); };
    const boxCorner = await wingBox(bds[3]);
    chk(boxCorner === 0, 'U17b the outline follows the tail\'s curve, not the wing\'s box (no gold at the box\'s top-left corner)', 'gold=' + boxCorner);
    // U17c: the bottom stroke runs unbroken where the tail meets the bubble (a rounded inner wing corner left a notch
    // there, which the outline traced as a V-shaped kink).
    const junction = async (h, dx) => { const bb = await h.boundingBox(); return goldIn({ x: bb.x + dx, y: bb.y + bb.height - 0.5, width: 10, height: 2 }); };
    const joinRow = await junction(bds[3], -2);
    const refRow = await junction(bds[3], 40);   // the same band further along the same bottom stroke: same row, same metrics
    // Compared with the same band further along the bottom stroke, so what a font or an engine does to the row
    // moves both. Measured on this branch: equal with the square corner in both engines; 6 (Chromium) and 8 (WebKit)
    // of 10 at the junction with it rounded (the kink).
    chk(refRow >= 8 && joinRow >= refRow - 1, 'U17c the bottom stroke has no kink where the tail meets the bubble', JSON.stringify({ joinRow, refRow }));
    // U17d: the wing's mask carves the same ellipse the ground mask (::after) does, so a read bubble is unchanged.
    // The two are written separately; this pins them together (radii 12px and 16px).
    const carve = await page.evaluate(() => { const b = document.querySelector('#d-dmthread .msg:not(.you) .msg-bd');
      return { after: getComputedStyle(b, '::after').borderBottomRightRadius, mask: getComputedStyle(b, '::before').webkitMaskImage || getComputedStyle(b, '::before').maskImage }; });
    chk(carve.after === '12px 16px' && /radial-gradient\(12px 16px at -4px 0px/.test(carve.mask), 'U17d the wing\'s mask and the ground mask carve the same ellipse', JSON.stringify(carve));

    // U19: a READ bubble looks exactly as before this change: the wing's mask only removes pixels the ground mask
    // (::after) already paints over, so switching the mask off changes nothing on a read bubble. In light and dark
    // (each ground differs). Not Kosmos+ navy: there the bubble (27,42,75) and the ground (28,44,79) are within 4 of
    // each other, so a mask error is invisible to a person and to this measure alike (a wrong ellipse read 0 there;
    // light read 30, dark 36 to 38). Pixels counted as changed past a small tolerance, over the tail's region.
    const diffCount = (a, b) => page.evaluate(async ([x, y]) => {
      const load = async (src) => { const i = new Image(); i.src = 'data:image/png;base64,' + src; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
      const A = await load(x); const B = await load(y); let n = 0;
      for (let i = 0; i < A.length; i += 4) if (Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])) > 24) n += 1;
      return n;
    }, [a, b]);
    const readSame = {};
    for (const look of ['light', 'dark']) {
      await page.evaluate((how) => { if (how === 'dark') document.documentElement.setAttribute('data-theme', 'dark'); if (how === 'navy') document.body.classList.add('plus-active'); }, look);
      const bb = await bds[0].boundingBox();
      const clip = { x: bb.x - 16, y: bb.y + bb.height - 24, width: 32, height: 26 };
      const withMask = (await page.screenshot({ clip })).toString('base64');
      const off = await page.addStyleTag({ content: '#d-dmthread .msg-bd::before { -webkit-mask: none !important; mask: none !important; }' });
      const noMask = (await page.screenshot({ clip })).toString('base64');
      readSame[look] = await diffCount(withMask, noMask);
      await off.evaluate((t) => t.remove());   // by its handle: the page adds style tags of its own
      await page.evaluate(() => { document.documentElement.removeAttribute('data-theme'); document.body.classList.remove('plus-active'); });
    }
    chk(Object.values(readSame).every((n) => n === 0), 'U19 a read bubble is unchanged by the wing\'s mask (light, dark)', JSON.stringify(readSame));

    // U18: scrolled to the end, the newest bubble's bottom stroke shows (a filter is not scrollable content; the DM
    // thread's 2px bottom padding keeps it inside). CONTROL: the same strip on a read bubble has no gold.
    await page.evaluate(() => { const t = document.getElementById('d-dmthread'); t.scrollTop = t.scrollHeight; });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));   // painted at the new scroll (WebKit)
    const under = async (h) => { const bb = await h.boundingBox(); return goldIn({ x: bb.x + 20, y: bb.y + bb.height, width: 40, height: 2 }); };
    const underNewest = await under(bds[3]), underRead = await under(bds[0]);
    chk(underNewest >= 20 && underRead === 0, 'U18 scrolled to the end, the newest unread bubble\'s bottom stroke is not cut off', JSON.stringify({ underNewest, underRead }));
    // U18b: the same at the TOP: an unread bubble first in the thread, scrolled to the top, keeps its top stroke (the
    // thread's 2px top padding). Marked by hand and measured at once, before the read clock could clear it.
    const overTop = await (async () => {
      await page.evaluate(() => { const t = document.getElementById('d-dmthread'); t.scrollTop = 0; document.querySelector('#d-dmthread .msg:not(.you) .msg-bd').setAttribute('data-unread', ''); });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const bb = await bds[0].boundingBox();
      const n = await goldIn({ x: bb.x + 20, y: bb.y - 1, width: 40, height: 1 });
      await page.evaluate(() => document.querySelector('#d-dmthread .msg:not(.you) .msg-bd').removeAttribute('data-unread'));
      await page.evaluate(() => { const t = document.getElementById('d-dmthread'); t.scrollTop = t.scrollHeight; });   // back to the newest, which U2 reads
      return n;
    })();
    chk(overTop >= 20, 'U18b an unread bubble first in the thread keeps its top stroke at scroll 0', 'gold=' + overTop);
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'unread-dm-before-read.png') }); }

    // U2: on screen with the window in front, the edge goes after a moment, and it fades rather than snapping.
    const tr = await page.evaluate(() => { const b = document.querySelectorAll('#d-dmthread .msg:not(.you) .msg-bd')[0], cs = getComputedStyle(b), af = getComputedStyle(b, '::after');
      return { prop: cs.transitionProperty, dur: cs.transitionDuration, maskDelay: af.transitionDelay, maskProp: af.transitionProperty }; });
    chk(tr.prop === 'filter, outline-color' && tr.dur === '1.2s, 0.3s' && tr.maskProp === 'visibility' && tr.maskDelay === '1.2s', 'U2 the outline fades over 1.2s, and the tail\'s ground mask comes back only once the fade has ended', JSON.stringify(tr));
    await page.waitForTimeout(2600);
    const u2 = await dmState();
    chk(u2.length === 4 && u2.every((r) => !r.unread), 'U2 once on screen a moment, the edge goes', JSON.stringify(u2.map((r) => r.unread)));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'unread-dm-after-read.png') });

    // U3: a repaint does not bring back what was read, and a message that lands while open arrives with the edge.
    await page.evaluate(() => { window.__fx = { messages: window.__fx.messages.concat([{ from: 'april', at: '2026-09-25T09:10:00Z', text: 'April line 6' }]) }; });
    await page.evaluate(() => paintTalk('april', 'April'));
    const u3 = await dmState();
    chk(JSON.stringify(u3.map((r) => r.unread)) === JSON.stringify([false, false, false, false, true]), 'U3 a message that lands while open has the edge; the ones already read do not come back', JSON.stringify(u3.map((r) => r.unread)));

    // U4: not while the window is behind another (CONTROL for U2: the same message, same wait, stays unread).
    await page.evaluate(() => { Object.defineProperty(document, 'hasFocus', { value: () => false, configurable: true }); });
    await page.evaluate(() => { window.__fx = { messages: window.__fx.messages.concat([{ from: 'april', at: '2026-09-25T09:11:00Z', text: 'April line 7' }]) }; });
    await page.evaluate(() => paintTalk('april', 'April'));
    await page.waitForTimeout(2600);
    const u4 = await dmState();
    chk(u4[u4.length - 1].unread === true, 'U4 with the window behind another, a new message keeps its edge', JSON.stringify(u4.map((r) => r.unread)));
    await page.evaluate(() => { delete document.hasFocus; window.dispatchEvent(new Event('focus')); });
    await page.waitForTimeout(2600);
    const u4b = await dmState();
    chk(u4b.length === 6 && u4b.every((r) => !r.unread), 'U4 and coming back to the window starts the clock: it goes');

    // U5: reduced motion drops the edge without the fade (U2 is the CONTROL: the same read, 1.2s, without it).
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const tr5 = await page.evaluate(() => { const b = document.querySelector('#d-dmthread .msg:not(.you) .msg-bd');
      return { dur: getComputedStyle(b).transitionDuration, maskDelay: getComputedStyle(b, '::after').transitionDelay, wingDelay: getComputedStyle(b, '::before').transitionDelay }; });
    chk(tr5.dur.split(',').every((d) => d.trim() === '0s') && tr5.maskDelay === '0s' && tr5.wingDelay === '0s', 'U5 with reduced motion there is no fade and nothing waits for one', JSON.stringify(tr5));
    const tr5b = await page.evaluate(() => { const b = document.querySelector('#d-dmthread .msg:not(.you) .msg-bd'); b.setAttribute('data-unread', '');
      const d = getComputedStyle(b).transitionDuration; b.removeAttribute('data-unread'); return d; });
    chk(tr5b.split(',').every((d) => d.trim() === '0s'), 'U5b with reduced motion an UNREAD bubble has no transition either (its rule outranks the read one)', tr5b);
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // U6: the project room, through pjMarkSeen and paintRoom: three unread, the newest three agent posts have it.
    const rrow = (i, from) => ({ id: 'r' + i, kind: 'post', from: from === 'you' ? undefined : from, operator: from === 'you', at: new Date(t0 + i * 60000).toISOString(), text: 'Room line ' + i });
    const room = { rows: [rrow(1, 'april'), rrow(2, 'bo'), rrow(3, 'you'), rrow(4, 'april'), rrow(5, 'bo'), rrow(6, 'april')] };
    const u6 = await page.evaluate((body) => {
      PROJECTS = [{ id: 'p1', name: 'Room', unread: 3, agents: [{ sessionName: 'april', name: 'April' }, { sessionName: 'bo', name: 'Bo' }] }];
      PJ_CURRENT = 'p1';
      document.getElementById('panel-detail').hidden = true;
      const pr = document.getElementById('panel-projects'); if (pr) pr.hidden = false;
      const one = document.getElementById('pj-one-view'); if (one) one.hidden = false;
      pjMarkSeen('p1');
      paintRoom(body);
      return [...document.querySelectorAll('#pj-room .msg:not(.you)')].map((r) => r.querySelector('.msg-bd').hasAttribute('data-unread'));
    }, room);
    chk(JSON.stringify(u6) === JSON.stringify([false, false, true, true, true]), 'U6 a project room opened with three unread: the newest three agent posts have the edge', JSON.stringify(u6));

    // U8: a message taller than the window is read a screenful at a time: it still loses its edge.
    await page.evaluate(() => { document.getElementById('panel-detail').hidden = false; const pr = document.getElementById('panel-projects'); if (pr) pr.hidden = true; });
    await page.evaluate(() => { window.__fx = { messages: window.__fx.messages.concat([{ from: 'april', at: '2026-09-25T09:12:00Z', text: Array.from({ length: 200 }, (_, i) => 'A long report, line ' + (i + 1) + '.').join('\n') }]) }; });
    await page.evaluate(() => paintTalk('april', 'April'));
    const tall = await page.evaluate(() => { const b = [...document.querySelectorAll('#d-dmthread .msg:not(.you) .msg-bd')].pop(); return { h: Math.round(b.getBoundingClientRect().height), vh: innerHeight, unread: b.hasAttribute('data-unread') }; });
    await page.evaluate(() => { const b = [...document.querySelectorAll('#d-dmthread .msg:not(.you) .msg-bd')].pop(); b.scrollIntoView({ block: 'start' }); });
    await page.waitForTimeout(2600);
    const tallAfter = await page.evaluate(() => [...document.querySelectorAll('#d-dmthread .msg:not(.you) .msg-bd')].pop().hasAttribute('data-unread'));
    chk(tall.h > 2 * tall.vh && tall.unread && !tallAfter, 'U8 a message taller than twice the window arrives with the edge and loses it once read', JSON.stringify({ ...tall, after: tallAfter }));

    // U12: the moment on screen is continuous: leaving the window inside it starts it again on the way back.
    const add = (t, text) => page.evaluate(([at, tx]) => { window.__fx = { messages: window.__fx.messages.concat([{ from: 'april', at, text: tx }]) }; return paintTalk('april', 'April'); }, [t, text]);
    await add('2026-09-25T09:13:00Z', 'April line 12');
    await page.evaluate(() => [...document.querySelectorAll('#d-dmthread .msg:not(.you) .msg-bd')].pop().scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(700);
    await page.evaluate(() => { Object.defineProperty(document, 'hasFocus', { value: () => false, configurable: true }); window.dispatchEvent(new Event('blur')); });
    await page.waitForTimeout(200);
    await page.evaluate(() => { delete document.hasFocus; window.dispatchEvent(new Event('focus')); });
    await page.waitForTimeout(500);   // 1.4s since it arrived, 0.5s since the window came back
    const u12a = await page.evaluate(() => [...document.querySelectorAll('#d-dmthread .msg:not(.you) .msg-bd')].pop().hasAttribute('data-unread'));
    await page.waitForTimeout(1300);
    const u12b = await page.evaluate(() => [...document.querySelectorAll('#d-dmthread .msg:not(.you) .msg-bd')].pop().hasAttribute('data-unread'));
    chk(u12a === true && u12b === false, 'U12 leaving the window inside the moment starts it again: still edged 0.5s after coming back, gone after 1.2s', JSON.stringify({ u12a, u12b }));

    // U13: a message far taller than the window, read by scrolling down it a little at a time, still loses its edge.
    await add('2026-09-25T09:14:00Z', Array.from({ length: 1200 }, (_, i) => 'A very long report, line ' + (i + 1) + '.').join('\n'));
    /* The thread scrolls inside its own box. Put the new message's first 10px at that box's bottom, then read down it
       60px at a time: no ratio threshold is crossed on the way (it is over twenty boxes tall). */
    const huge = await page.evaluate(() => {
      const b = [...document.querySelectorAll('#d-dmthread .msg:not(.you) .msg-bd')].pop();
      let sc = b.parentElement; while (sc && !(sc.scrollHeight > sc.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
      if (!sc) return { scroller: false };
      window.__sc = sc;
      const box = sc.getBoundingClientRect(), r = b.getBoundingClientRect();
      sc.scrollTop += (r.top - box.bottom) + 10;
      return { scroller: true, h: Math.round(r.height), box: Math.round(box.height), onScreen: Math.round(box.bottom - b.getBoundingClientRect().top) };
    });
    await page.waitForTimeout(400);
    const before13 = await page.evaluate(() => [...document.querySelectorAll('#d-dmthread .msg:not(.you) .msg-bd')].pop().hasAttribute('data-unread'));
    for (let i = 0; i < 6; i++) { await page.evaluate(() => { window.__sc.scrollTop += 60; }); await page.waitForTimeout(120); }
    await page.waitForTimeout(1600);
    const u13 = await page.evaluate(() => [...document.querySelectorAll('#d-dmthread .msg:not(.you) .msg-bd')].pop().hasAttribute('data-unread'));
    chk(huge.scroller && huge.h > 20 * huge.box && huge.onScreen <= 20 && before13 && u13 === false, 'U13 a message over twenty thread-heights tall, read down a little at a time, loses its edge', JSON.stringify({ ...huge, before13, stillUnread: u13 }));

    // U14: the edge in the dark looks: a darker, opaque gold, forced dark and Kosmos+ navy.
    const edgeIn = (setup) => page.evaluate((how) => {
      if (how === 'dark') document.documentElement.setAttribute('data-theme', 'dark'); else document.body.classList.add('plus-active');
      const b = document.createElement('div'); b.className = 'msg'; b.innerHTML = '<div class="msg-b"><div class="msg-bd" data-unread>x</div></div>';
      document.getElementById('d-dmthread').appendChild(b);
      const v = getComputedStyle(b.querySelector('.msg-bd')).filter; b.remove();
      document.documentElement.removeAttribute('data-theme'); document.body.classList.remove('plus-active');
      return v;
    }, setup);
    const dark14 = await edgeIn('dark'), navy14 = await edgeIn('navy');
    const DARKGOLD = /^(drop-shadow\(rgb\(168, 132, 47\) [^)]*\) ?){4}$/;
    chk(DARKGOLD.test(dark14) && DARKGOLD.test(navy14), 'U14 in dark and on Kosmos+ navy the outline is the darker gold', JSON.stringify({ dark14, navy14 }));

    // U9: a room whose first read did not answer (ok false, no rows) does not make its history look new on the next.
    const u9 = await page.evaluate((body) => {
      document.getElementById('panel-detail').hidden = true;
      const pr = document.getElementById('panel-projects'); if (pr) pr.hidden = false;
      PROJECTS.push({ id: 'p2', name: 'Other', unread: 0, agents: [{ sessionName: 'april', name: 'April' }] });
      PJ_CURRENT = 'p2';
      pjMarkSeen('p2');
      paintRoom({ ok: false, rows: [] });
      paintRoom(body);
      return [...document.querySelectorAll('#pj-room .msg:not(.you)')].map((r) => r.querySelector('.msg-bd').hasAttribute('data-unread'));
    }, room);
    chk(u9.length === 5 && u9.every((x) => !x), 'U9 after a room read that did not answer, the next one shows history without the edge', JSON.stringify(u9));

    // U10: a count read before its /seen landed does not bring the edge back to a post already read.
    await page.evaluate(() => { PJ_CURRENT = 'p1'; });
    await page.evaluate((body) => paintRoom(body), room);
    // Read one at a time into view: the room scrolls with its column, not inside #pj-room.
    for (let i = 0; i < 5; i++) {
      await page.evaluate((k) => { const b = document.querySelectorAll('#pj-room .msg:not(.you) .msg-bd')[k]; if (b) b.scrollIntoView({ block: 'center' }); }, i);
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(1300);
    const read10 = await page.evaluate(() => [...document.querySelectorAll('#pj-room .msg:not(.you) .msg-bd')].map((b) => b.hasAttribute('data-unread')));
    const u10 = await page.evaluate((body) => {
      pjById('p1').unread = 1;   // a poll computed before the /seen landed
      pjMarkSeen('p1');
      paintRoom({ ...body, rows: body.rows.concat([{ id: 'r7', kind: 'post', operator: true, at: '2026-09-25T09:20:00Z', text: 'My next post' }]) });
      return [...document.querySelectorAll('#pj-room .msg:not(.you) .msg-bd')].map((b) => b.hasAttribute('data-unread'));
    }, room);
    chk(read10.length === 5 && read10.every((x) => !x), 'U10 precondition: the room\'s unread posts were read', JSON.stringify(read10));
    chk(u10.length === 5 && u10.every((x) => !x), 'U10 a stale count does not bring the edge back to a post already read', JSON.stringify(u10));

    // U11: what a thread remembers is bounded by what it shows: a post that leaves the thread leaves its sets.
    const u11 = await page.evaluate((body) => {
      paintRoom({ ...body, rows: body.rows.slice(1) });
      const st = UNREAD_EDGE.get('pj:p1');
      return { known: st.known.size, read: st.read.size, shown: document.querySelectorAll('#pj-room .msg:not(.you) .msg-bd').length, hasR1: st.known.has('r1') || st.read.has('r1') };
    }, room);
    chk(u11.shown === 4 && u11.known === 4 && !u11.hasR1, 'U11 the thread\'s sets hold only the posts it shows', JSON.stringify(u11));

    // U15: the setup assistant's chat. Replies that came while it was folded arrive with the edge (by id: the poll's
    // asbNoteReplies records the replies at its first read, folded, and marks any other new when it is open), history does not, a reply landing while it is open gets it, each goes once read, and the
    // hosted assistant's words (typed back in this page) never do. Painted through the real asbPaintThread.
    const asbState = () => page.evaluate(() => [...document.querySelectorAll('#asp-th .asp-m.him[data-mid]')].map((d) => ({ id: d.dataset.mid, unread: d.hasAttribute('data-unread'), edge: getComputedStyle(d).filter })));
    const gRows = [{ id: 'g1', from: 'guide', text: 'Hello, I can help.' }, { id: 'y1', from: 'you', text: 'Make me an agent' }, { id: 'g2', from: 'guide', text: 'Done, meet April.' }];
    await page.evaluate((rows) => {
      document.getElementById('panel-projects').hidden = true;
      asbLayerEnsure();
      document.getElementById('asp').hidden = false;
      ASB.replyIds = null;
      asbNoteReplies('guide', rows.slice(0, 1), false);   // the folded first read: g1 is history
      asbNoteReplies('guide', rows, true);                // opened: g2 came while folded
      ASB.shown = '';
      asbPaintThread(rows, 'guide');
    }, gRows);
    const u15a = await asbState();
    chk(u15a.length === 2 && !u15a[0].unread && u15a[1].unread && u15a[1].edge.includes('drop-shadow(' + GOLD) && u15a[0].edge === 'none', 'U15 the assistant\'s reply that came while folded carries the gold outline; the one read before does not', JSON.stringify(u15a));
    await page.waitForTimeout(2600);
    const u15b = await asbState();
    chk(u15b.length === 2 && u15b.every((r) => !r.unread), 'U15 once on screen a moment, it goes', JSON.stringify(u15b));
    await page.evaluate((rows) => asbPaintThread(rows.concat([{ id: 'g3', from: 'guide', text: 'Anything else?' }]), 'guide'), gRows);
    const u15c = await asbState();
    chk(u15c.length === 3 && !u15c[0].unread && !u15c[1].unread && u15c[2].unread, 'U15 a reply landing while it is open gets the edge, and the read ones keep theirs off', JSON.stringify(u15c));
    await page.waitForTimeout(2600);
    chk((await asbState()).every((r) => !r.unread), 'U15 and it goes once read');
    const u15h = await page.evaluate(() => {
      unreadEdgeBacklog('asb:hosted', 2); ASB.shown = '';
      asbPaintThread([{ id: 'h1', from: 'hosted', text: 'Hi' }, { id: 'h2', from: 'hosted', text: 'Ask me anything' }], 'hosted');
      return document.querySelectorAll('#asp-th [data-unread]').length;
    });
    chk(u15h === 0, 'U15 the hosted assistant\'s words never carry it (CONTROL for the arms above: the same backlog, no edge)', 'edged=' + u15h);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'unread-asb.png') });
    // U16: a guide forgotten and a new one made under the same name: the new one's thread is its own history, not new.
    // CONTROL: without the forget, the same ids painted again under the same name are known, so this reads a real reset.
    const u16 = await page.evaluate(() => {
      ASB.guide = { sessionName: 'guide' };
      asbForgetGuide();
      document.getElementById('asp').hidden = false;
      const rows = [{ id: 'n1', from: 'guide', text: 'Hi, I am new.' }, { id: 'n2', from: 'guide', text: 'Shall we start?' }];
      asbNoteReplies('guide', rows, true);   // the new guide's first read, open: a baseline, nothing new
      ASB.shown = '';
      asbPaintThread(rows, 'guide');
      return { left: [...UNREAD_EDGE.keys()].filter((k) => k.startsWith('asb:') && k !== 'asb:guide').length, edged: document.querySelectorAll('#asp-th [data-unread]').length };
    });
    chk(u16.edged === 0 && u16.left === 0, 'U16 a new guide under the same name shows its history without the edge', JSON.stringify(u16));

    // U6b (#3311), LAST because it switches the open room: in a shared project the unread can be words from OUTSIDE this Kosmos. They are
    // rows too, so the edge goes on them, not on local posts read long ago.
    const xrow = (i) => ({ id: 'x' + i, kind: 'external', external: true, from: 'Grace', fromKind: 'person', at: new Date(t0 + (10 + i) * 60000).toISOString(), text: 'Outside line ' + i });
    const room6b = { rows: [rrow(1, 'april'), rrow(2, 'bo'), xrow(1), xrow(2)] };
    const u6b = await page.evaluate((body) => {
      PROJECTS = [{ id: 'p2', name: 'Shared', unread: 2, agents: [{ sessionName: 'april', name: 'April' }, { sessionName: 'bo', name: 'Bo' }] }];
      PJ_CURRENT = 'p2';
      pjMarkSeen('p2');
      paintRoom(body);
      return [...document.querySelectorAll('#pj-room .msg:not(.you)')].map((r) => (r.classList.contains('ext') ? 'x' : 'l') + (r.querySelector('.msg-bd').hasAttribute('data-unread') ? '1' : '0'));
    }, room6b);
    chk(JSON.stringify(u6b) === JSON.stringify(['l0', 'l0', 'x1', 'x1']), 'U6b a shared room whose two unread are from outside: those two have the edge, the local posts do not', JSON.stringify(u6b));

    chk(errs.length === 0, 'U7 no page errors', errs.join(' | '));
  } finally {
    await browser.close();
  }
  }
  if (fail.length) { console.log('\n' + fail.length + ' FAILED'); process.exit(1); }
  console.log('\nall unread-edge checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
